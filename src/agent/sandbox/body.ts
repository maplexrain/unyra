/**
 * 这个文件负责什么：把模型写的一段「函数体」摆成可执行形状并在交给沙箱前先编译一次——
 * 剥外层括号、补 async、认出匿名函数头，语法错连同最可能的原因直接说给模型。全是纯字符串规则。
 */

/* ---------- body 的形状归一化 ---------- */

/** 括号计数可以信任的「上一个有意义的字符」：正则只可能出现在这些后面 */
const REGEX_AFTER = new Set(['(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%', '<', '>', '~', '^'])

/**
 * 标出「哪些字符是代码」。字符串、模板、注释、正则里的括号与 \`=>\` 都会骗过朴素的字符扫描，
 * 而扫描一错，后面的结论就会以完全无关的报错出现（见 outerParenRange 的注释）。
 * 返回与源码等长的布尔数组：true = 这个字符是代码。
 */
function codeMask(src: string): boolean[] {
  const mask: boolean[] = new Array(src.length).fill(true)
  const hide = (from: number, to: number) => {
    for (let k = from; k < to && k < src.length; k++) mask[k] = false
  }
  let last = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      const from = i
      while (i < src.length && src[i] !== '\n') i++
      hide(from, i)
      continue
    }
    if (c === '/' && next === '*') {
      const from = i
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i = Math.min(src.length, i + 2)
      hide(from, i)
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const from = i
      i++
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === c) {
          i++
          break
        }
        i++
      }
      hide(from, i)
      last = c
      continue
    }
    if (c === '/' && (last === '' || REGEX_AFTER.has(last))) {
      // 疑似正则：吃到收尾的 /；中途换行说明判断错了，整段还原成代码
      const from = i
      let inClass = false
      let closed = false
      i++
      while (i < src.length) {
        const ch = src[i]
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === '\n') break
        if (ch === '[') inClass = true
        else if (ch === ']') inClass = false
        else if (ch === '/' && !inClass) {
          i++
          closed = true
          break
        }
        i++
      }
      if (closed) {
        hide(from, i)
        last = '/'
        continue
      }
      i = from + 1
      last = '/'
      continue
    }
    if (!/\s/.test(c)) last = c
    i++
  }
  return mask
}
/**
 * 最外层那对「真配对」的括号（((api)=>{…}) → 首尾两个下标）；不是整段被一对括号包着就返回 null。
 *
 * 为什么必须跳过字符串与注释：一次真实运行里模型在函数体里写了 \`// 1) 换节点…\`，
 * 注释里那个 \`)\` 被朴素的括号计数当成配对括号，于是「剥外层括号」这一步悄悄放弃；
 * 接着补 async 的一步把 async 插到了整段最前面——\`async ((api)=>{…})\` 是
 * 「调用一个叫 async 的函数」，箭头函数自己仍是非 async，里面的 await 于是非法，
 * 沙箱最终抛出一句与模型写法毫无关系的语法错，行号还指向沙箱自己的包装代码。
 */
function outerParenRange(text: string, mask: boolean[]): [number, number] | null {
  if (text[0] !== '(') return null
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (!mask[i]) continue
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return i === text.length - 1 ? [0, i] : null
    }
  }
  return null
}

/** 剥掉最外层真配对的那对括号 */
function stripOuterParens(text: string): string {
  const range = outerParenRange(text, codeMask(text))
  return range ? text.slice(range[0] + 1, range[1]).trim() : text
}

/**
 * 结尾的自调用括号要去掉：沙箱一定会带着 api 调它一次，留着那对括号只会把参数当成调用实参，
 * 真正执行时 api 是 undefined，报出「Cannot read properties of undefined」这种指错方向的错。
 * 顺手去掉结尾分号——不处理的话它会破坏后面的括号配对判断。
 */
function stripTrailingCall(text: string): string {
  const trimmed = text.trim().replace(/;$/, '').trim()
  const tail = /\(\)$|\(api\)$/.exec(trimmed)
  if (!tail) return trimmed
  const cut = trimmed.slice(0, -tail[0].length)
  const before = cut[cut.length - 1]
  return before === '}' || before === ')' ? cut.trim() : trimmed
}

/** 第一个位于代码位置的 \`=>\`（注释与字符串里的不算） */
function findArrow(text: string, mask: boolean[], from: number): number {
  for (let i = from; i + 1 < text.length; i++) {
    if (mask[i] && mask[i + 1] && text[i] === '=' && text[i + 1] === '>') return i
  }
  return -1
}
/** 从 \`=>\` 往回找形参表的起点：\`(a, b) =>\` 回到 \`(\`，\`api =>\` 回到标识符开头 */
function paramStartOf(text: string, mask: boolean[], arrow: number): number {
  let i = arrow - 1
  while (i >= 0 && (!mask[i] || /\s/.test(text[i]))) i--
  if (i < 0) return -1
  if (text[i] === ')') {
    let depth = 0
    for (; i >= 0; i--) {
      if (!mask[i]) continue
      if (text[i] === ')') depth++
      else if (text[i] === '(') {
        depth--
        if (depth === 0) return i
      }
    }
    return -1
  }
  while (i >= 0 && mask[i] && /[\w$]/.test(text[i])) i--
  return i + 1
}

/** 第一个位于代码位置的 \`function\` 关键字 */
function findFunctionKeyword(text: string, mask: boolean[]): number {
  for (let i = 0; i + 8 <= text.length; i++) {
    if (!mask[i] || !text.startsWith('function', i)) continue
    const after = text[i + 8] ?? ''
    if (after === '' || !/[\w$]/.test(after)) return i
  }
  return -1
}

/**
 * 函数头的起点，以及它是不是已经是 async。
 * start 就是「补 async 时该插在哪里」：形参表或 function 关键字之前。
 * 前缀只允许空白、左括号与一个 async —— \`const f = (x) => x\` 这种语句片段在这里被挡掉。
 */
function functionHead(text: string, mask: boolean[], start: number): { start: number; async: boolean } | null {
  let kept = ''
  for (let k = 0; k < start; k++) {
    if (!mask[k] || /\s/.test(text[k])) continue
    kept += text[k]
  }
  const bare = kept.replace(/^\(*/, '').replace(/\(*$/, '')
  if (bare === '') return { start, async: false }
  if (bare === 'async') return { start, async: true }
  return null
}

/** 认出「这是一段匿名函数源码」并把它的头找出来；认不出返回 null */
function bodyHead(text: string): { start: number; async: boolean } | null {
  const mask = codeMask(text)
  const fn = findFunctionKeyword(text, mask)
  if (fn >= 0) return functionHead(text, mask, fn)
  const arrow = findArrow(text, mask, 0)
  if (arrow < 0) return null
  const param = paramStartOf(text, mask, arrow)
  return param < 0 ? null : functionHead(text, mask, param)
}

/**
 * 就地给模型写的函数补上 async。
 *
 * 关键点：**插在函数头之前**，不是整段最前面。对 ((api)=>{…}) 来说，插在最前面会得到
 * \`async ((api)=>{…})\`——那是「调用一个叫 async 的函数」，箭头函数本身仍是非 async，
 * 里面的 await 依旧非法。真实事故与完整因果见 outerParenRange 的注释。
 */
function makeAsync(text: string): string {
  const head = bodyHead(text)
  if (!head || head.async) return text
  return text.slice(0, head.start) + 'async ' + text.slice(head.start)
}

/**
 * 把 body 规范成一种确定形状：**一段 async 匿名函数源码**（外层括号已剥掉）。
 *
 * 三步，每一步都只做有把握的事：
 * 1. 去掉结尾的分号与那次自调用（沙箱会带 api 调它一次）；
 * 2. 剥掉最外层**真配对**的那对括号（括号计数跳过字符串与注释，见 outerParenRange）；
 * 3. 若还不是 async，就在函数头之前插一个 async。
 * 编不过就退回更保守的形状，最后原样退回，由 compileBody 报出真正的语法错。
 */
export function normalizeBody(raw: string): string {
  const text = stripTrailingCall(raw)
  const bare = stripOuterParens(text)
  const candidate = makeAsync(bare)
  if (isCallableBody(candidate)) return candidate
  if (candidate !== bare && isCallableBody(bare)) return bare
  return text
}

/** 编译得了、调用得到吗——形状对不对由编译器说了算，不靠字符串规则猜 */
function isCallableBody(text: string): boolean {
  if (!bodyHead(text)) return false
  try {
    const fn = new Function('api', 'return (' + text + ')')()
    return typeof fn === 'function'
  } catch {
    return false
  }
}
/** compileBody 的结果：失败时的 content 就是直接回给模型的那句话 */
export type CompileBodyResult = { ok: true; body: string } | { ok: false; content: string }

/**
 * 交给沙箱之前的编译检查。
 *
 * 为什么要单独做一次：normalizeBody 只是「尽力把形状摆正」，摆不正时它会原样退回，
 * 于是沙箱在它自己的 new Function 上抛出一句「await is only valid in async functions」，
 * 行号指向沙箱的包装代码——模型看不出该改哪里（真实运行里它连遇两次，两次都只能放弃）。
 * 这里把真实的语法错误、连同最可能的原因，直接说给模型听。
 */
export function compileBody(raw: string): CompileBodyResult {
  const text = raw.trim()
  if (!text) return { ok: false, content: 'body 为空：请给出形如 ((api)=>{ ... }) 的代码' }
  const candidates = [normalizeBody(raw), stripOuterParens(stripTrailingCall(raw)), text]
  let problem = ''
  for (const body of candidates) {
    if (!body) continue
    try {
      const fn = new Function('api', 'return (' + body + ')')()
      if (typeof fn === 'function') return { ok: true, body }
      if (!problem) problem = '它求值出来不是一个函数'
    } catch (err) {
      if (!problem) problem = err instanceof Error ? err.message : String(err)
    }
  }
  /*
   * 两类「不是模型写错」的失败要单独点出来：不然它只会一遍遍换写法重试，
   * 而这两条换什么写法都不会通（真实运行里各踩过一次）。
   */
  const hint = /await is only valid/i.test(problem)
    ? '\n这个问题出在写法上：await 落在了一个非 async 的内层函数里（例如没写 async 的箭头函数）。把它挪到最外层，或给那个内层函数加 async。'
    : /content security policy|unsafe-eval/i.test(problem)
      ? '\n这不是你代码的问题：当前运行环境的 CSP 不允许执行动态代码，而 execute 本身就是靠 new Function ' +
        '把这段代码编译成函数的。换写法不会有不同结果，请把这句话原样告诉用户（问题在应用侧，见 electron/csp.ts）。'
      : ''
  return {
    ok: false,
    content:
      'body 不能用' + (problem ? '（' + problem + '）' : '') + hint +
      '\n请写成形如 ((api)=>{ ... return 结果 }) 的匿名函数：参数就是 api，函数体里可以直接用 await。',
  }
}