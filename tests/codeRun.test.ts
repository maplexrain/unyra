/**
 * 代码块伪编译与运行（见 lib/codeArtifacts / lib/codeRun / src/run/RunnerRuntime.js）。
 *
 * 这里钉的是三件事，都不是「模型写得好不好」那种看运气的事：
 * 1. **沙箱真的跑得起来**：RunnerRuntime.js 是一个 .js 文件、被当字符串塞进 Worker，
 *    语法错在构建期看不出来（它只是一段字符串）——因此这里用 vm 造一个真全局，
 *    把它**真的执行一遍**：打印、返回值、抛错、顶层 await、联网同意与否各验一条；
 * 2. **指纹**：同一段代码同一个键（复现），改一个字 / 换个语言就换一个键
 *    （按钮因此自己从「重新编译」变回「编译」）；
 * 3. **交货这条路**：编译由导师的工作流做（见 learn/workflows 的「伪编译」），
 *    产物经 api.code.save 回到这里——key 对不上、js 为空、重复交货都要回一句能照着改的话；
 *    导师判定「这段代码没有输出」时走 api.code.silent，那一块从此不可编译、不可运行。
 */
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import runtimeSource from '../src/run/RunnerRuntime.js?raw'
import {
  artifactFor,
  artifactKey,
  beginCompile,
  compilingCount,
  isCompiling,
  silentFor,
  submitCompile,
  submitSilent,
  subscribeArtifacts,
} from '../src/lib/codeArtifacts'
import { runCompiledJs } from '../src/lib/codeRun'

/* ---------- 假宿主：把沙箱运行时在 node 里跑起来 ---------- */

interface Msg {
  kind: string
  [key: string]: unknown
}

interface Sandbox {
  sent: Msg[]
  /** 把一条消息喂回给沙箱（宿主 → Worker） */
  feed: (msg: Msg) => void
}

/**
 * 起一个假沙箱。**必须用 vm 造一个真全局**，而不是传个「self 对象」进去：
 * 运行时那句 `self.console = {…}` 只有在自己就是全局对象时才真的换掉 console
 * （Worker 里正是如此）。用一个普通对象当 self 的话，被执行的代码照样用到真 console，
 * 打印直接漏到测试进程的 stdout 上——于是「输出被捕获」这件事根本没被测到。
 * vm 还顺带把 document / localStorage 这些挡在外面，与 Worker 的处境一致。
 */
function bootSandbox(): Sandbox {
  const sent: Msg[] = []
  const sandbox: Record<string, unknown> = {}
  sandbox.self = sandbox
  sandbox.postMessage = (m: Msg) => sent.push(m)
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  // Response 是沙箱拼 fetch 返回值要用的；vm 的新全局里没有 Node 这一套，得显式给
  sandbox.Response = Response
  sandbox.console = console
  vm.createContext(sandbox)
  vm.runInContext(runtimeSource, sandbox, { filename: 'RunnerRuntime.js' })
  return {
    sent,
    feed: (msg) => (sandbox.onmessage as (e: { data: Msg }) => void)({ data: msg }),
  }
}

/** 等到出现某类消息（或超时）；沙箱是异步的，断言前必须等它 */
async function waitFor(sent: Msg[], kind: string, ms = 1500): Promise<Msg | undefined> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const hit = sent.find((m) => m.kind === kind)
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 5))
  }
  return undefined
}

/** 跑一段代码，并顺手替它应答联网的询问（默认拒绝） */
async function runSandbox(
  code: string,
  opts: { allowNet?: boolean } = {},
): Promise<{ sent: Msg[]; done: Msg | undefined }> {
  const box = bootSandbox()
  box.feed({ kind: 'run', code, timeoutMs: 2000 })
  // 沙箱要联网时会举手；这里当「宿主」，替用户回答
  for (let i = 0; i < 200; i++) {
    const ask = box.sent.find((m) => m.kind === 'net-ask')
    if (ask) {
      box.feed({ kind: 'net-ask-reply', id: ask.id, ok: opts.allowNet === true })
      break
    }
    if (box.sent.some((m) => m.kind === 'done')) break
    await new Promise((r) => setTimeout(r, 5))
  }
  const done = await waitFor(box.sent, 'done')
  return { sent: box.sent, done }
}

const lines = (sent: Msg[]): string[] => sent.filter((m) => m.kind === 'out').map((m) => String(m.text))

describe('沙箱运行时（src/run/RunnerRuntime.js）', () => {
  it('console.log 变成一行输出，对象被展开成人能读的样子', async () => {
    const { sent, done } = await runSandbox('console.log(1 + 1)\nconsole.log({ a: 1, b: [2, 3] })')
    expect(done?.ok).toBe(true)
    expect(lines(sent)).toEqual(['2', '{a: 1, b: [2, 3]}'])
  })

  it('顶层 await 与 return 都能用（返回的值单独一行显示）', async () => {
    const { sent } = await runSandbox('const x = await Promise.resolve(21)\nconsole.log(x * 2)\nreturn "done"')
    expect(lines(sent)).toContain('42')
    const back = sent.find((m) => m.kind === 'out' && m.level === 'return')
    expect(back?.text).toBe('done')
  })

  it('抛出来的错误进输出，并让这次运行以失败收场', async () => {
    const { sent, done } = await runSandbox('throw new Error("炸了")')
    expect(done?.ok).toBe(false)
    expect(String(done?.error)).toContain('炸了')
    expect(sent.some((m) => m.kind === 'out' && m.level === 'error' && String(m.text).includes('炸了'))).toBe(true)
  })

  it('连语法都没过的代码当场报出来，不把 Worker 带崩', async () => {
    const { sent, done } = await runSandbox('function ( {')
    expect(done?.ok).toBe(false)
    expect(done?.error).toBe('语法错误')
    expect(lines(sent).join()).toContain('语法都没过')
  })

  it('联网：用户不同意就抛错，代码拿不到数据', async () => {
    const { sent, done } = await runSandbox('await fetch("https://example.com")\nconsole.log("不该走到这里")', {
      allowNet: false,
    })
    expect(done?.ok).toBe(false)
    expect(sent.some((m) => m.kind === 'net-ask' && m.url === 'https://example.com')).toBe(true)
    expect(lines(sent).join()).toContain('没有获得允许')
  })

  it('联网：同意了才把请求转给宿主（沙箱自己不碰网络）', async () => {
    const box = bootSandbox()
    box.feed({
      kind: 'run',
      code: 'const r = await fetch("https://example.com")\nconsole.log(r.status)',
      timeoutMs: 2000,
    })
    const ask = await waitFor(box.sent, 'net-ask')
    expect(ask).toBeTruthy()
    box.feed({ kind: 'net-ask-reply', id: ask?.id, ok: true })
    // 沙箱接着会请宿主代发那一次请求
    const req = await waitFor(box.sent, 'net')
    expect(req?.url).toBe('https://example.com')
    box.feed({
      kind: 'net-reply',
      id: req?.id,
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'text/plain']],
      body: 'hi',
    })
    const done = await waitFor(box.sent, 'done')
    expect(done?.ok).toBe(true)
    expect(lines(box.sent)).toEqual(['200'])
  })

  it('DOM 与本地存储在这个沙箱里是拿不到的', async () => {
    const { sent } = await runSandbox(
      'console.log(typeof document, typeof indexedDB, typeof localStorage, typeof XMLHttpRequest)',
    )
    expect(lines(sent)[0]).toBe('undefined undefined undefined undefined')
  })
})

/** 造一段互不相同的源码（要用几段内容不同的代码来对指纹） */
const codeOf = (tag: string): string => '// ' + tag + '\nconsole.log("' + tag + '")'

describe('指纹与产物表', () => {
  it('指纹：同一段代码同一个键，改一个字或换个语言就换一个键', () => {
    const a = artifactKey('print(1)', 'python')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(artifactKey('print(1)', 'python')).toBe(a)
    expect(artifactKey('print(2)', 'python')).not.toBe(a)
    expect(artifactKey('print(1)', 'ruby')).not.toBe(a)
    expect(artifactKey('print(1)', null)).not.toBe(a)
  })

  it('不在 Electron 里（没有 Worker）时，运行给出一句能看懂的失败', async () => {
    const res = await runCompiledJs('console.log(1)')
    expect(res.ok).toBe(false)
    expect(res.lines[0]?.text).toContain('沙箱起不来')
  })
})

describe('伪编译的交货（api.code.save 落到这里）', () => {
  it('登一笔待编译 → 交货 → 产物按内容对得上，登记随之消失', async () => {
    const code = codeOf('py')
    const key = beginCompile(code, 'python')
    expect(isCompiling(key)).toBe(true)
    expect(artifactFor(key, code, 'python')).toBeUndefined()

    let notified = 0
    const off = subscribeArtifacts(() => {
      notified++
    })
    const r = await submitCompile({
      key,
      js: 'for (let i = 0; i < 3; i++) console.log(i)',
      note: '假设 range 是 0..2',
      model: 'm',
    })
    off()
    expect(r.ok).toBe(true)
    expect(notified).toBeGreaterThan(0)
    expect(isCompiling(key)).toBe(false)
    // 不在 Electron 里时落盘会失败，但**内存里那份产物仍然成立**（界面照旧亮起来）
    expect(artifactFor(key, code, 'python')?.note).toBe('假设 range 是 0..2')
  })

  it('内容对不上就不认（防指纹碰撞）：换一段代码来取，拿不到', async () => {
    const key = beginCompile(codeOf('A'), 'js')
    await submitCompile({ key, js: 'console.log(1)', note: '', model: '' })
    expect(artifactFor(key, codeOf('B'), 'js')).toBeUndefined()
  })

  it('key 对不上、js 为空、重复交货：都回一句能照着改的话，不抛异常', async () => {
    const bad = await submitCompile({ key: 'deadbeefdeadbeef', js: 'x', note: '', model: '' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('重新点一次')

    const key = beginCompile(codeOf('C'), null)
    const empty = await submitCompile({ key, js: '   ', note: '', model: '' })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error).toContain('js 不能为空')

    const first = await submitCompile({ key, js: 'console.log(1)', note: '', model: '' })
    expect(first.ok).toBe(true)
    const again = await submitCompile({ key, js: 'console.log(2)', note: '', model: '' })
    expect(again.ok).toBe(false)
  })

  it('交货之后表里不留东西', () => {
    expect(compilingCount()).toBe(0)
  })
})

describe('导师判定「无输出」（api.code.silent 落到这里）', () => {
  it('判定之后：登记消掉、没有产物——从此不可编译、不可运行', async () => {
    const code = 'type Chunk = { data: string; done: boolean }'
    const key = beginCompile(code, 'typescript')
    expect(isCompiling(key)).toBe(true)
    const r = await submitSilent({ key, reason: '只有类型定义，没有会被执行的语句' })
    expect(r.ok).toBe(true)
    expect(isCompiling(key)).toBe(false)
    expect(silentFor(key, code, 'typescript')?.reason).toBe('只有类型定义，没有会被执行的语句')
    // 「无输出」不是产物：那块代码没有可运行的东西（界面据此收起编译与运行两颗按钮）
    expect(artifactFor(key, code, 'typescript')).toBeUndefined()
  })

  it('内容对不上就不认（防指纹碰撞）：换一段代码来取，拿不到这个标记', async () => {
    const key = beginCompile(codeOf('S1'), 'js')
    await submitSilent({ key, reason: '探测' })
    expect(silentFor(key, codeOf('S2'), 'js')).toBeUndefined()
  })

  it('key 对不上时回一句能照着改的话，不抛异常', async () => {
    const bad = await submitSilent({ key: 'deadbeefdeadbeef', reason: '探测' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('重新点一次')
  })
})
