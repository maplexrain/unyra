/**
 * 对话里的一小块代码（工具气泡的参数与结果）。
 *
 * 为什么不用 MarkdownView：这里的正文是**就地更新**的——流式输出时每几十毫秒换一次，
 * 而 MarkdownView 是"内容变了就把整棵 DOM 重写一遍"（它还得跑注解、链接、插件那一整套）。
 * 只为显示一段代码走那一趟，代价与噪声都不值当。这一块只做一件事：把文本放进 <code>，
 * 交给 lib/codeHighlight 上色（语言按需加载、结果有缓存，与正文里的代码块同一条路）。
 *
 * 内容由本组件独占：<code> 在 React 那边**没有子节点**，正文是命令式写进去的
 * （innerHTML 被高亮那一层换成了一堆 span，交给 React 托管的话下一次重渲染就会把它抹掉）。
 */
import { useLayoutEffect, useRef } from 'react'

import { forgetCodeBlock, hydrateCodeBlocks } from '../../lib/codeHighlight'

interface Props {
  /** 代码正文（不含注释行——那些由调用方另画） */
  text: string
  /** 语言标记（javascript / json / text…）。认不出来的一律按纯文本处理 */
  lang: string
  /** 长行要不要折行。代码不折（折了看不出层级），说明性文本折（横向滚动条更烦人） */
  wrap?: boolean
  /** 最高多高，超出就在里面滚 */
  maxH?: string
}

/**
 * 上色前等这么久（正文一变就重新计时）。
 *
 * 正文是立刻写进 DOM 的（一个字都不会少），等的是**颜色**：tokenize 是同步 CPU 活
 * （vscode-textmate 逐行跑，一段几十行的编排要几毫秒），而流式输出时正文每几十毫秒就变一次——
 * 每次都跟着 tokenize 一遍，几秒钟里能把主线程占去小一半。等它安静下来再上色，读的人看不出差别。
 */
const HL_DELAY_MS = 160

export default function CodePane({ text, lang, wrap, maxH = 'max-h-56' }: Props) {
  const preRef = useRef<HTMLPreElement | null>(null)
  const codeRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const pre = preRef.current
    const code = codeRef.current
    if (!pre || !code) return
    code.textContent = text
    /*
     * 节点是 React 复用的（换正文时它只改这一个属性），而高亮那一层在 <code> 上
     * 留了"已处理"的标记——不清掉的话，换了正文也不会重新上色。
     */
    forgetCodeBlock(code)
    let dispose: (() => void) | null = null
    const timer = window.setTimeout(() => {
      dispose = hydrateCodeBlocks(pre)
    }, HL_DELAY_MS)
    // 清理做两件事：撤掉还没到点的那一次上色，并把在途的那一次作废（正文又变了）
    return () => {
      window.clearTimeout(timer)
      dispose?.()
    }
  }, [text, lang])

  return (
    <pre
      ref={preRef}
      className={`${maxH} overflow-auto rounded bg-paper-deep/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ink-soft ${
        wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
      }`}
    >
      <code ref={codeRef} className={'language-' + lang} />
    </pre>
  )
}
