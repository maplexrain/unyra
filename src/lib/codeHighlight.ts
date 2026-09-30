/**
 * 代码块高亮（DOM 这一层）：把正文里的 `<pre><code class="language-x">` 换成带颜色的令牌。
 *
 * 为什么在 DOM 提交之后做（与 lib/plot 同一套路）：tokenization 是**异步**的——语法与
 * oniguruma 的 wasm 都要按需下载；而 renderNote 是同步纯函数、产物还按源文缓存。
 * 于是解析期只留下 marked 默认的那个 `<pre><code>`（纯文本），颜色在这里补上。
 *
 * 这一层只干四件事：找块、认语言、调语法层拿令牌、把令牌写回 DOM。
 * 颜色怎么来它不管（那是 CSS 变量的事，见 src/syntax/Theme.ts）。
 *
 * 被两处用到：内置插件 `code-highlight`（正文、AI 消息都走它）与导出（exportDoc
 * 在序列化之前等一次，导出件里才有颜色）。
 */
import { resolveLanguageId } from '../syntax/LanguageAliases'
import { highlight } from '../syntax/SyntaxHighlighter'
import { AUTO_THEME, renderHighlight, type CodeTheme } from '../syntax/Theme'

/** 处理过的块打个标记，避免反复扫、反复写（React 每次重渲染都会重挂一次） */
const MARK = 'mojiHl'

/* ---------- 渲染结果缓存 ---------- */

/**
 * 缓存「已高亮的 HTML」。
 *
 * 语法层已经缓存了 tokenization 结果，这一层缓存的是**拼好的字符串**：AI 消息在流式
 * 输出时会被反复重渲染，同一段代码每次都要重新拼 span——那是一份大字符串的重复劳动。
 * 键里带主题 id：换主题是换一份缓存，tokenization 仍然复用（这是两件事，别混）。
 */
const CACHE_MAX_ENTRIES = 128
const CACHE_MAX_CHARS = 4 * 1024 * 1024
const htmlCache = new Map<string, string>()
let htmlCacheChars = 0

function cachedHtml(key: string): string | undefined {
  const hit = htmlCache.get(key)
  if (hit === undefined) return undefined
  htmlCache.delete(key)
  htmlCache.set(key, hit)
  return hit
}

function putHtml(key: string, html: string): void {
  htmlCache.set(key, html)
  htmlCacheChars += key.length + html.length
  while ((htmlCache.size > CACHE_MAX_ENTRIES || htmlCacheChars > CACHE_MAX_CHARS) && htmlCache.size > 1) {
    const oldest = htmlCache.keys().next().value as string
    const value = htmlCache.get(oldest)
    htmlCache.delete(oldest)
    htmlCacheChars -= oldest.length + (value?.length ?? 0)
  }
}

/** 清空缓存（用例用） */
export function clearCodeBlockCache(): void {
  htmlCache.clear()
  htmlCacheChars = 0
}

/* ---------- DOM ---------- */

/**
 * 从 `<code>` 的 class 里认语言（marked 的产物是 `class="language-js"`）。
 * 单独抽出来是因为这是这一层唯一的「解析」——其余都是 DOM 搬运；也方便用例直接钉。
 */
export function languageOfClass(className: string): string | null {
  const m = /language-([\w+#.-]+)/i.exec(className)
  return m ? resolveLanguageId(m[1]) : null
}

/** 这块代码的 languageId；没写语言或者不认识都给 null（按纯文本处理） */
function languageOf(code: HTMLElement): string | null {
  return languageOfClass(code.className)
}

/**
 * 让一块**已经处理过**的代码重新参与高亮。
 *
 * 给那些"React 复用了同一个 <code> 节点、只把正文换掉"的场合用（对话里的工具气泡：
 * 参数与结果都是就地更新的一小块代码）。标记不清掉的话，pendingBlocks 会认为
 * 这一块早就做完了，换了正文也不上色——而 DOM 节点是同一个，标记不会自己消失。
 */
export function forgetCodeBlock(code: HTMLElement): void {
  delete code.dataset[MARK]
}

/** 找出这一片 DOM 里还没处理过的代码块（marked 的产物一律是 pre > code） */
function pendingBlocks(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const code of Array.from(root.querySelectorAll<HTMLElement>('pre > code'))) {
    if (!code.dataset[MARK]) out.push(code)
  }
  return out
}

function paint(pre: HTMLElement, code: HTMLElement, html: string, style: Record<string, string>): void {
  for (const [name, value] of Object.entries(style)) pre.style.setProperty(name, value)
  // 这里写进去的是我们自己拼的 HTML（文字全部转义、span 只有 class），不经过外部输入
  code.innerHTML = html
  code.dataset[MARK] = 'done'
}

/**
 * 把 root 里的代码块全部高亮（异步，等它做完）。
 *
 * 顺序处理而不是 Promise.all：一份文档里十几段代码同时要语法、同时 tokenize，
 * 只会把主线程一次占满；一段一段来，先出来的先上色。
 * 导出路径需要「等它做完」，正文路径不关心（见 hydrateCodeBlocks）。
 */
export async function highlightCodeIn(
  root: HTMLElement,
  theme: CodeTheme = AUTO_THEME,
  /** 调用方中途反悔时（DOM 被换掉）给个 true：剩下的块就别做了 */
  abandoned?: () => boolean,
): Promise<void> {
  for (const code of pendingBlocks(root)) {
    if (abandoned?.()) return
    const pre = code.parentElement
    if (!pre) continue
    const text = code.textContent ?? ''
    const languageId = languageOf(code)
    // 先打标记：这一块归我了，页面再重挂时不会重复处理
    code.dataset[MARK] = languageId ? 'pending' : 'plain'
    if (!languageId || !text.trim()) continue

    const key = theme.id + '\u0000' + languageId + '\u0000' + text
    const hit = cachedHtml(key)
    if (hit !== undefined) {
      paint(pre, code, hit, {})
      continue
    }

    const result = await highlight(text, languageId)
    // 等语法的这几百毫秒里，这块 DOM 可能已经被换掉了（页签切走、消息重渲染）
    if (abandoned?.() || !code.isConnected) continue
    const rendered = renderHighlight(result, theme)
    if (!rendered.html) continue
    putHtml(key, rendered.html)
    paint(pre, code, rendered.html, rendered.style)
  }
}

/**
 * 挂载版：**不等待**，返回一个清理函数（与 lib/plot 的 hydratePlots 同一时机、同一契约）。
 * 清理时把在途的那一块作废——DOM 都要被 React 丢掉了，再往里写就是写进废弃节点。
 */
export function hydrateCodeBlocks(root: HTMLElement, theme: CodeTheme = AUTO_THEME): () => void {
  let disposed = false
  void highlightCodeIn(root, theme, () => disposed).catch((err: unknown) => {
    console.warn('[code] 代码块高亮失败', err)
  })
  return () => {
    disposed = true
  }
}
