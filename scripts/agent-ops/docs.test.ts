/**
 * 探针分组：文档 / 节点 / 执行器的 api 面（原文件第 3、4 节与第 6 节的 res.* 部分）。
 *
 * - toolTests（第 3 节）：用假沙箱执行器把 buildApi + learn/agentOps 整条路跑通；
 * - apiNameTests（第 4 节）：沙箱注入的 api 名单必须与真的注册了的对上，并与 api 目录对账；
 * - resourceApiTests（第 6 节后半）：res.* 的行为——图片只走图像通道、引用保护、指纹去重。
 *
 * 共享 fixture（ok / baseStore / harness / fakeRunner / staticStore / fakeResourceIo 与四个 uuid 常量）在 ./harness。
 */
import { createAgentOps } from '../../src/learn/agentOps'
import { createExecuteTool, plainLineOf } from '../../src/agent/tools'
import { createMindOps } from '../../src/learn/mind'
import { SANDBOX_API_NAMES } from '../../src/agent/sandboxWorker'
import { SANDBOX_API_CATALOG } from '../../src/agent/apiCatalog'
import { emptyProfile } from '../../src/user/types'
import { findByHash, findResource, hashOfText, resourcesOf } from '../../src/learn/static'
import {
  MD_REL,
  MD_UUID,
  PNG_REL,
  PNG_UUID,
  baseStore,
  childId,
  fakeResourceIo,
  fakeRunner,
  fakeWorkspaceIo,
  goalId,
  harness,
  ok,
  rootId,
  staticStore,
} from './harness'

/* ---------- 3. execute 工具（假沙箱执行器）的行为（执行器与 harness 本身见 ./harness） ---------- */
export async function toolTests() {
  const h = harness(baseStore(), childId)
  const r1 = await h.run('((api)=>{ const d = await api.doc.read(""); return { path: d.path, chars: d.chars, head: d.content.slice(0, 4) } })')
  ok(r1.ok && r1.content.includes('微积分/极限/教学'), 'doc.read("") 读当前节点教学文档', r1.content)
  const r2 = await h.run('((api)=>{ await api.doc.write("笔记", "新的笔记"); return (await api.doc.read("笔记")).content })')
  ok(r2.ok && r2.content.startsWith('新的笔记'), 'doc.write("笔记") 写当前节点笔记', r2.content)
  ok(
    h.store().nodes.find((n) => n.id === childId)?.notes[0]?.content === '新的笔记',
    '写入落到 store（写的是原来那份「笔记」）',
    h.store().nodes.find((n) => n.id === childId)?.notes[0]?.content,
  )
  const r3 = await h.run('((api)=>{ await api.doc.append("笔记", "第二段"); return (await api.doc.read("笔记")).content })')
  ok(r3.ok && r3.content.startsWith('新的笔记\n\n第二段'), 'doc.append 空行分隔', JSON.stringify(r3.content))
  const rNew = await h.run('((api)=>{ await api.doc.write("笔记/错题本", "第一道错题"); return { names: (await api.node.read("")).docs.map((d)=>d.文档) } })')
  ok(
    rNew.ok &&
      h.store().nodes.find((n) => n.id === childId)?.notes.some((n) => n.name === '错题本'),
    '写不存在的笔记会新建一份（名字就是它给的）',
    rNew.content,
  )
  ok(
    h.store().nodes.find((n) => n.id === childId)?.notes.length === 2,
    '新笔记是追加，不是覆盖原来那份',
    h.store().nodes.find((n) => n.id === childId)?.notes.map((n) => n.name),
  )
  const rBoth = await h.run('((api)=>{ const a = await api.doc.read("笔记"); const b = await api.doc.read("笔记/错题本"); return { a: a.content, b: b.content } })')
  ok(
    rBoth.ok && rBoth.content.includes('新的笔记\\n\\n第二段') && rBoth.content.includes('第一道错题'),
    '「笔记」与「笔记/错题本」各自读到自己那份',
    rBoth.content.slice(0, 200),
  )
  const r4 = await h.run('((api)=>{ return await api.doc.replace("", { start: 0, end: 2, content: "改", expected: "不对的内容" }) })')
  ok(!r4.ok && r4.content.includes('位置校验失败') && r4.content.includes('没有生效'), 'expected 不符时工具级失败，并说清是哪个 api 没生效', r4.content.slice(0, 200))
  const r5 = await h.run('((api)=>{ await api.doc.write("微积分/笔记", "目标自己的笔记"); return (await api.doc.read("微积分/笔记")).content })')
  ok(r5.ok && r5.content.startsWith('目标自己的笔记'), '跨节点写笔记（path 指名）', r5.content)
  const r6 = await h.run('((api)=>{ const l = await api.node.list(); return { count: l.count, paths: l.nodes.map((n)=>n.path) } })')
  ok(r6.ok && r6.content.includes('微积分/极限'), 'node.list 列出目标内节点', r6.content)
  const r7 = await h.run('((api)=>{ const c = await api.node.create({ parent: "极限", title: "夹逼定理", description: "一句话" }); return c })')
  ok(r7.ok && r7.content.includes('已创建节点「夹逼定理」'), 'node.create 建下级节点', r7.content)
  const created = h.store().nodes.find((n) => n.title === '夹逼定理')
  ok(!!created && created.goalId === goalId, '新节点归属目标', created)
  ok(h.store().edges.some((e) => e.from === childId && e.to === created?.id), '新节点挂在请求的父节点下')
  // 显式路径是新口径：不写 parent、或从「当前」出发，一律被拒（不再隐式建在当前节点下）
  const r7a = await h.run('((api)=>{ return await api.node.create({ title: "无parent节点" }) })')
  ok(!r7a.ok && r7a.content.includes('parent'), 'node.create 不写 parent 被拒', r7a.content.slice(0, 160))
  const r7b = await h.run('((api)=>{ return await api.node.create({ parent: "当前", title: "当前下的节点" }) })')
  ok(!r7b.ok && r7b.content.includes('当前'), 'parent 写「当前」也被拒', r7b.content.slice(0, 160))
  // node.move：换父节点 = 摘掉旧父线挂到新父节点之下；根不能移、挂到自己下级成环也被拒
  const rMove = await h.run('((api)=>{ return await api.node.move("夹逼定理", "微积分") })')
  ok(
    rMove.ok &&
      h.store().edges.some((e) => e.from === rootId && e.to === created?.id) &&
      !h.store().edges.some((e) => e.from === childId && e.to === created?.id),
    'node.move 换父节点（旧父线摘掉）',
    rMove.content,
  )
  const rMoveRoot = await h.run('((api)=>{ return await api.node.move("微积分", "夹逼定理") })')
  ok(!rMoveRoot.ok && rMoveRoot.content.includes('总目标'), '目标的根不能移动', rMoveRoot.content.slice(0, 160))
  const rCycle = await h.run('((api)=>{ await api.node.create({ parent: "极限", title: "环测试" }); return await api.node.move("极限", "环测试") })')
  ok(!rCycle.ok && rCycle.content.includes('环'), '不能把节点挂到它自己的下级之下', rCycle.content.slice(0, 160))
  const r8 = await h.run('((api)=>{ const t = await api.node.title("夹逼定理"); await api.node.rename("夹逼定理", "夹逼定理（正式）"); const t2 = await api.node.title("夹逼定理（正式）"); return { before: t.title, after: t2.title } })')
  ok(r8.ok && r8.content.includes('夹逼定理（正式）'), 'node.title / node.rename（改名后路径仍能找到）', r8.content)
  const r9 = await h.run('((api)=>{ return await api.node.rename("夹逼定理（正式）", "极限") })')
  ok(!r9.ok && r9.content.includes('已经有叫'), '同名改名被拒绝', r9.content.slice(0, 160))
  const r10 = await h.run('((api)=>{ return await api.node.delete("微积分") })')
  ok(!r10.ok && r10.content.includes('学习目标本身'), '不能删学习目标', r10.content.slice(0, 160))
  const r11 = await h.run('((api)=>{ return await api.node.delete("夹逼定理（正式）") })')
  ok(r11.ok && !h.store().nodes.some((n) => n.title === '夹逼定理（正式）'), 'node.delete 删掉节点', r11.content)
  const r12 = await h.run('((api)=>{ const f = await api.doc.find("", "极限"); return { matches: f.matches, first: f.hits[0] } })')
  ok(r12.ok && r12.content.includes('"start"'), 'doc.find 只回位置', r12.content)
  const r13 = await h.run('((api)=>{ return await api.description.update("只有内容的老写法") })')
  ok(r13.ok && h.store().nodes.find((n) => n.id === childId)?.description === '只有内容的老写法', 'description.update 单参数兼容旧写法', r13.content)
  const r14 = await h.run('((api)=>{ return await api.note.read() })')
  ok(!r14.ok && r14.content.includes('doc.read'), '旧 api 名给出新写法', r14.content.slice(0, 200))
  const r15 = await h.run('((api)=>{ return await api.exam.read() })')
  ok(!r15.ok && r15.content.includes('沙箱里没有这个 api'), '未注入 exam 时该组不存在', r15.content.slice(0, 160))
  const r16 = await h.run('((api)=>{ await api.doc.write("", "# 正文"); await api.node.update("", { status: "mastered" }); return "ok" })')
  ok(r16.ok && h.store().nodes.find((n) => n.id === childId)?.status === 'mastered', 'node.update 能改状态', r16.content)
  const r17 = await h.run('((api)=>{ return (await api.node.read("")).docs })')
  ok(r17.ok && r17.content.includes('教学文档'), 'node.read 回各文档字数', r17.content)
  const r18 = await h.run('((api)=>{ return await api.doc.read("根本没有的节点") })')
  ok(r18.ok === false && r18.content.includes('没有'), 'path 找不到时给出可读原因', r18.content.slice(0, 160))
  // outline：整份写入 → 读回，key 由标题自动生成；两侧全空被拒（清空不是写入的活）
  const rOut = await h.run('((api)=>{ const w = await api.outline.write("", { intro: "这一层的路线", children: [{ title: "子目标甲", summary: "先学这个" }, { title: "子目标乙", summary: "后学这个" }] }); const rd = await api.outline.read(""); return { wrote: w.ok, count: rd.children.length, key: rd.children[0].key } })')
  ok(rOut.ok && rOut.content.includes('"count":2') && rOut.content.includes('子目标甲'), 'outline.write → outline.read 整份往返，key 自动生成', rOut.content.slice(0, 240))
  ok(h.store().nodes.find((n) => n.id === childId)?.outline?.children.length === 2, '大纲真的落在节点上')
  const rOutEmpty = await h.run('((api)=>{ return await api.outline.write("", { intro: "", children: [] }) })')
  ok(!rOutEmpty.ok && rOutEmpty.content.includes('空'), '导语与子目标全空的大纲被拒', rOutEmpty.content.slice(0, 140))
}

/* ---------- 4. api 名单与实现必须一致 ---------- */

/**
 * 沙箱里的 api 名单（sandboxWorker 注入给运行时的那份）必须与 buildApi 真的注册了的对上：
 * 名单里有、实现里没有 → 模型调了只会得到「沙箱里没有这个 api」，
 * 而提示词却写着它可用。这正是上一次沙箱翻车的形态，所以专门测一遍。
 */
export async function apiNameTests() {
  const calls: Record<string, string> = {
    'doc.read': "''",
    'doc.readRange': "'', 0, 5",
    'doc.find': "'', '极限'",
    'doc.write': "'', '# 临时测试'",
    'doc.replace': "'', { start: 0, end: 1, content: 'x' }",
    'doc.append': "'', '附言'",
    'doc.annotate': "{ term: '极限', body: '临时注解' }",
    'node.list': '',
    'node.read': "''",
    'node.create': "{ parent: '微积分', title: '临时节点' }",
    'node.title': "''",
    'node.rename': "'', '临时节点'",
    'node.update': "'', { description: '临时描述' }",
    'node.delete': "''",
    // 迁移：把刚建的临时节点挂到根之下（它已在根之下时回一句「已经在」，同样证明 api 在）
    'node.move': "'临时节点', '微积分'",
    // 大纲：读回 null 或整份对象都行（这一步只问「api 在不在」；行为在 toolTests 里钉）
    'outline.read': "'微积分'",
    'outline.write': "'微积分', { intro: '探针导语', children: [{ title: '探针子目标', summary: '探针' }] }",
    'description.read': "''",
    'description.update': "'', '临时描述'",
    'tmp.set': "{ key: 'k', value: 1 }",
    'tmp.get': "'k'",
    'tmp.has': "'k'",
    'tmp.del': "'k'",
    'tmp.list': '',
    'tmp.clear': '',
    'res.list': '',
    'res.info': "'" + PNG_UUID + "'",
    'res.read': "'" + MD_UUID + "'",
    'res.create': "{ name: '临时资源', ext: 'txt', content: 'x' }",
    'res.update': "'" + MD_UUID + "', { description: '临时描述' }",
    'res.delete': "'" + MD_UUID + "'",
    'res.refs': '',
    // state 这一组：先写一个错法再删掉，正好把 mistake 与 forget 两条路都走一遍
    'state.read': '',
    'state.update': "{ mastery: 60 }",
    'state.mistake': "'临时错法'",
    'state.forget': "'临时错法'",
    'state.check': "{ kind: 'probe', score: 60 }",
    // exam 这一组以前整组跳过，于是「名单里有、实现里没有」正好漏在它身上；
    // 现在给它一份桩依赖，四个方法一起点名（delete 的判据另有 examDeleteBlock 的用例）
    'exam.create': "{ kind: 'quiz', questions: [{ type: 'truefalse', stem: '临时题', answer: ['true'] }] }",
    'exam.read': '',
    'exam.grade': "{ summary: '临时', passed: false }",
    'exam.explain': "{ content: '错在把无穷小当成 0。' }",
    'exam.delete': '',
    // 长期记忆：走真的 createMindOps（纯 store 逻辑），写一条再删一条
    'mind.list': '',
    'mind.read': "'探针主题'",
    'mind.write': "{ key: '探针主题', text: '记住的事' }",
    'mind.delete': "'探针主题'",
    'mind.clear': '',
    // 持久化函数：create 先建（call 才有东西可调），delete 收尾；代码先过一遍编译校验
    'method.create': "{ name: '探针函数', code: '((api, n) => n * 2)' }",
    'method.list': '',
    'method.call': "'探针函数', 21",
    'method.delete': "'探针函数'",
    // 超级文档：write 先写一份，read/delete 才有的可操作
    'sdoc.list': "'微积分'",
    'sdoc.write': "'微积分', '探针文档', '<p>探针</p>'",
    'sdoc.read': "'微积分', '探针文档'",
    'sdoc.delete': "'微积分', '探针文档'",
    // 工作流：create 登记（list 才有的看、remove 才有的删），走真的 createWorkflowOps
    'wf.list': '',
    'wf.create': "{ name: '探针流程', instruction: '第一步：api.tiktok()；第二步：return \"ok\"' }",
    'wf.remove': "'探针流程'",
    // 伪编译交货：key 是宿主发出去的那串（探针这里没有待编译登记，走的是「key 对不上」那条路）
    'code.save': "{ key: '0123456789abcdef', js: 'console.log(1)', note: '探针' }",
    'code.silent': "{ key: '0123456789abcdef', reason: '探针：只有定义' }",
    // 学习者画像：宿主是一份内存画像（见下面 userInfoTests 的行为用例）
    'userInfo.get': '',
    'userInfo.update': "{ education: '本科' }",
    // 人机协作与界面：宿主能力是桩（见下面 createExecuteTool 的注入）
    'wait': '0',
    'ask': "{ title: '确认', questions: [{ type: 'short', prompt: '怎么继续？' }] }",
    'iwanna': "['先读文档', '再写笔记']",
    'tiktok': '',
    'ui.switchMain': "'agent'",
    'ui.toast': "'你好'",
    'ui.point': "{ line: 1 }",
    'ui.scroll': "{ to: 'top' }",
    'ui.screenshot': '',
    'ui.superdoc': "'微积分', '探针文档'",
    // ui.dom 走进程内直调通道：回调在宿主拿到门面（真沙箱由 Worker 侧建门面，行为一致）
    'ui.dom': "async (root) => ({ e: await root.exists('p'), c: await root.count('p') })",
    /*
     * 学习过程那一组：全是纯 store 逻辑，Node 里就能真跑。
     * 顺序有意：settle 先记一次结果（checkin.status 才有「今天已经打过卡」可看）。
     * 番茄钟那一组只有只读的 status（开始、停止、改时长都是用户按顶栏那颗按钮）。
     */
    'reading.list': '',
    'reading.day': "''",
    'reading.get': "''",
    'attention.get': "''",
    'checkin.settle': "{ correct: 3, total: 4, threshold: 3, passed: true }",
    'checkin.status': '',
    // 间隔复习：record 在没有计划的节点上会说明「计划由系统建」，正好核对报错文案
    'review.read': "''",
    'review.record': "{ complete: true }",
    'review.merge': "{ nodeIds: [] }",
    'review.extend': "{ focus: '收敛与有界' }",
    'review.adjust': "{ action: 'postpone', days: 2 }",
    'pomodoro.status': '',
    // 读网页：抓取要网络、落盘要磁盘，探针里给一份假的实现（真链路见 tests/webPage.test.ts）
    'web.webFetch': "'https://example.com/a'",
    'web.read': "'deadbeef', '一级标题'",
    // 多引擎搜索：同样给假的（解析与引擎表在 tests/webSerp.test.ts 里钉）
    'web.search': "'勾股定理', { engine: 'baidu' }",
    // 子代理管理（导师专用）：宿主是桩；这组断言只问「api 在不在」——
    // 并发、等待与介入的行为在 tests/subagent.test.ts 里钉
    'subagent.create': "{ key: 'probe', name: '探针代理', system: '探针用的子代理定义，长度足以通过校验。' }",
    'subagent.run': "{ agent: 'probe', task: '探针任务' }",
    'subagent.wait': "{ seconds: 1 }",
    'subagent.view': "'probe'",
    'subagent.intervene': "'probe', '换条路走'",
    'subagent.interrupt': "'probe'",
    'subagent.resume': "'probe'",
    'subagent.delete': "'probe'",
    // 上下文压缩：真实现（纯 store 逻辑）——摘要太短会被拒，所以这里给一段够长的
    'compact': "{ summary: '极限的直觉与夹逼定理都讲完了，学习者复述时漏了有界性，已经纠正并记进错题；下一步看导数的定义。', tasks: ['把「导数」那一节的第三节补完'] }",
    // 工作区目录：真实文件在主进程，探针给一份假的（见 fakeWorkspaceIo）
    'workspace.list': "''",
    'workspace.read': "'极限/要点.md'",
    'workspace.write': "{ path: '极限/要点.md', content: '# 要点' }",
    // 内置浏览器：webview 元素在真实渲染层，探针给一份假的宿主（见下面 browser 桩）
    'browser.open': "'https://example.com'",
    'browser.tabs': '',
    'browser.activate': "'w:probe'",
    'browser.close': "'w:probe'",
    'browser.snapshot': "''",
    'browser.point': "'w:probe', { ref: 1 }",
    'browser.dom': "'w:probe', 1, 'click'",
    'browser.read': "''",
    'browser.capture': "''",
  }
  let s = staticStore()
  let tmpStore: Record<string, unknown> = {}
  let sawTmpWrite = false
  // 资源那一组要磁盘：给它一份假的，名单检查才走得通（见 fakeResourceIo）
  const { io: resIo } = fakeResourceIo(
    new Map<string, string>([[MD_REL, '# 速查']]),
    new Map<string, string>([[PNG_REL, 'AAAB']]),
  )
  const ops = createAgentOps({
    getLatest: () => s,
    set: (n) => { s = n },
    nodeId: () => childId,
    goalId: () => goalId,
    resourceIo: resIo,
    // 工作区同样给一份假的：名单检查只问「这三个 api 在不在」
    workspaceIo: fakeWorkspaceIo().io,
    // 读网页同样给一份假的：名单检查只问「这三个 api 在不在」
    web: {
      fetch: async (url: string) => ({ ok: true, uuid: 'deadbeef', url, title: '示例页', chars: 3, text: '正文' }),
      read: async (uuid: string, path?: string) => ({ ok: true, uuid, ...(path ? { section: path } : {}) }),
      search: async (query: string, opts?: Record<string, unknown>) => ({
        ok: true,
        engine: opts?.engine ?? 'baidu',
        query,
        results: [{ rank: 1, title: '勾股定理 - 百度百科', url: 'https://example.com/pyth', snippet: '直角三角形边长关系' }],
      }),
    },
    // 画像同样给一份假的：名单检查只问「这个名字真的注册了吗」
    userInfo: {
      read: () => ({ ...emptyProfile(), nickname: '探针用户' }),
      update: async (patch) => ({ ...emptyProfile(), nickname: '探针用户', ...patch }),
    },
    tmp: () => ({ nodeId: childId, entries: tmpStore as never, onChange: (next) => { tmpStore = next; if (Object.keys(next).length) sawTmpWrite = true } }),
    // 桩：这一组只查「名字真的注册了吗」，行为由 examTests 与用例各自覆盖
    exam: {
      create: () => ({ ok: true, content: '（桩）' }),
      explain: () => ({ ok: true, content: '（桩）' }),
      read: () => ({ ok: true, content: '（桩）' }),
      grade: () => ({ ok: true, content: '（桩）' }),
      remove: () => ({ ok: true, content: '（桩）' }),
    },
  })
  // 人机协作与界面那一组：wait / ask / iwanna / tiktok / ui 都是桩（行为由界面接线保证），
  // mind 用真的 createMindOps（它是纯 store 逻辑，Node 里就能跑）
  let sawIwanna: string[] | null = null
  let sawMain = ''
  let sawToast = ''
  let sawScroll: unknown = null
  let sawOpenSuper: string | null = null
  // browser 桩：名单检查只问「这九个 api 在不在」，行为断言看下面的 sawBrowserXxx
  let sawBrowserOpen = ''
  let sawBrowserDom = ''
  let sawBrowserActivate = ''
  let sawBrowserClose = ''
  const stubRoot = { querySelectorAll: () => [] } as unknown as Element
  const tool = createExecuteTool({
    ...ops,
    runSandbox: fakeRunner,
    mind: createMindOps({ getLatest: () => s, set: (n) => { s = n }, goalId: () => goalId }),
    wait: async () => {},
    ask: async () => ({ ok: true, cancelled: false, answers: [] }),
    iwanna: (items) => { sawIwanna = items },
    tiktok: async () => {},
    ui: {
      switchMain: (main) => { sawMain = main },
      toast: (msg) => { sawToast = msg },
      point: () => ({ located: false }),
      scroll: (req) => { sawScroll = req },
      capture: async () => ({ ok: true, images: [] }),
      domRoot: () => stubRoot,
      openSuper: ({ name }) => { sawOpenSuper = name; return { opened: true } },
    },
    browser: {
      open: async (url: string) => { sawBrowserOpen = url; return { tabId: 'w:probe', url } },
      tabs: () => [{ tabId: 'w:probe', url: 'https://example.com', title: '示例页', active: true, group: 'g1' }],
      activate: (tabId: string) => { sawBrowserActivate = tabId; return { ok: true } },
      close: (tabId: string) => { sawBrowserClose = tabId; return { ok: true } },
      snapshot: async () => ({ elements: [{ ref: 1, role: 'button', name: '提交' }] }),
      point: async () => ({ ok: true }),
      dom: async (_tabId: string | undefined, ref: number, op: string) => { sawBrowserDom = ref + ':' + op; return { ok: true } },
      read: async () => ({ ok: true, uuid: 'deadbeef', url: 'https://example.com', title: '示例页', chars: 3, text: '正文' }),
      capture: async () => ({ ok: true, note: '（桩）', images: [] }),
    },
    // 子代理管理：桩（并发、等待与介入的行为由 tests/subagent.test.ts 用假流钉住）
    subagent: {
      create: () => ({ ok: true, key: 'probe', name: '探针代理' }),
      run: () => ({ ok: true, agent: 'probe', note: '已启动' }),
      resume: () => ({ ok: true, agent: 'probe' }),
      intervene: () => ({ ok: true, agent: 'probe', queued: 1 }),
      interrupt: () => ({ ok: true, agent: 'probe' }),
      view: () => ({ ok: true, agent: 'probe', status: 'idle', recent: [] }),
      remove: () => ({ ok: true, agent: 'probe' }),
      wait: async () => ({ deliveries: [], running: [] }),
    },
  })
  for (const name of SANDBOX_API_NAMES) {
    const args = calls[name]
    if (args === undefined) {
      ok(false, '名单里的 ' + name + ' 没有测试用例（新增 api 时补一条）')
      continue
    }
    const body = '((api)=>{ return await api.' + name + '(' + args + ') })'
    const r = await tool.run({ description: '名单检查', body }, { nodeId: childId, goalId })
    if (name === 'ui.superdoc' && !r.ok) console.log('DEBUG ui.superdoc →', r.content.slice(0, 300))
    ok(!r.content.includes('沙箱里没有这个 api'), '名单里的 ' + name + ' 真的存在', r.content.slice(0, 120))
  }
  // 目录对账：设置 → 开发者里那份「api 上下文管理」（agent/apiCatalog）是手工维护的第二份名单，
  // 漏跟的后果很安静——页面上列着一条不存在的 api，或者新加的 api 谁也不知道它存在。
  const catalogNames = SANDBOX_API_CATALOG.flatMap((g) => g.items.map((i) => i.name))
  const nameSet = new Set<string>(SANDBOX_API_NAMES)
  for (const n of catalogNames) ok(nameSet.has(n), 'api 目录里的 ' + n + ' 真的在沙箱名单里')
  for (const n of SANDBOX_API_NAMES) ok(catalogNames.includes(n), '沙箱名单里的 ' + n + ' 在 api 目录里有一条')
  ok(catalogNames.length === nameSet.size, '目录与名单的条数一致（没有重复、没有漏）', { catalog: catalogNames.length, names: nameSet.size })

  // 新 api 的行为抽两条钉住：iwanna 真的把计划递给了宿主，ui.dom 的门面真的可用
  ok(!!sawIwanna && sawIwanna.length === 2, 'iwanna 把计划递给了宿主（界面据此渲染预告清单）', sawIwanna)
  ok(sawMain === 'agent' && sawToast === '你好' && !!sawScroll, 'ui.switchMain / ui.toast / ui.scroll 都到了宿主')
  ok(sawOpenSuper === '探针文档', 'ui.superdoc 把要开的文档名递给了宿主', sawOpenSuper)
  ok(
    sawBrowserOpen === 'https://example.com' &&
      sawBrowserDom === '1:click' &&
      sawBrowserActivate === 'w:probe' &&
      sawBrowserClose === 'w:probe',
    'browser 这一组真的到了宿主（开站 / dom 操作 / 切页签 / 关页签）',
    { sawBrowserOpen, sawBrowserDom },
  )
  // ui.point 的行号定位：源文行要先剥成渲染文本里找得到的纯文字——
  // agent 实测拿原始源文行去搜渲染结果，除了纯散文行一律 located:false
  ok(plainLineOf('## 微积分基本定理') === '微积分基本定理', '标题行剥掉井号', plainLineOf('## 微积分基本定理'))
  ok(plainLineOf('- [导数](moji:learn "变化率") 是基础') === '导数 是基础', '链接行只留链接文字', plainLineOf('- [导数](moji:learn "变化率") 是基础'))
  ok(plainLineOf('1. **重点**：看 `这里`') === '重点：看 这里', '强调与行内代码剥掉标记', plainLineOf('1. **重点**：看 `这里`'))
  // tmp 这一组真的能用（上面每次调用都走了一遍）
  ok(sawTmpWrite, 'tmp 这一组真的能写进暂存区（clear 之后也留有痕迹）', Object.keys(tmpStore).length)
  // 选配的组没注入时应当不存在——用另起一个不带 exam 的工具来验，别和上面那份混着用
  const bare = createExecuteTool({ ...ops, exam: undefined, runSandbox: fakeRunner })
  const exam = await bare.run({ description: '名单检查', body: '((api)=>{ return await api.exam.read() })' }, { nodeId: childId, goalId })
  ok(exam.content.includes('沙箱里没有这个 api'), '没注入 exam 时它确实不存在', exam.content.slice(0, 120))

  // 子代理的 api 白名单（apiAllow）是通道口的硬校验，不是提示词君子协定：
  // 名单外的组当场被拒（报错里写明开放了哪些组），名单内的组照常放行。
  const sub = createExecuteTool({ ...ops, runSandbox: fakeRunner, apiAllow: ['web', 'tmp'] })
  const denied = await sub.run({ description: '越权读文档', body: '((api)=>{ return await api.doc.read("") })' }, { nodeId: childId, goalId })
  ok(!denied.ok && denied.content.includes('只开放了'), 'apiAllow 名单外的组当场被拒', denied.content.slice(0, 160))
  const allowed = await sub.run({ description: '搜索', body: "((api)=>{ return await api.web.search('勾股定理') })" }, { nodeId: childId, goalId })
  ok(allowed.ok && allowed.content.includes('baidu'), 'apiAllow 名单内的组照常放行', allowed.content.slice(0, 160))
}

/* ---------- 6. 资源库（static）：res.* 的行为（分节标题与 fixture 见 ./harness） ---------- */
export async function resourceApiTests() {
  const files = new Map<string, string>([[MD_REL, '# 速查\n\n' + 'x'.repeat(50)]])
  const images = new Map<string, string>([[PNG_REL, 'AAAB']])
  const { io, removed } = fakeResourceIo(files, images)
  let s = staticStore()
  const ops = createAgentOps({ getLatest: () => s, set: (n) => { s = n }, nodeId: () => childId, goalId: () => goalId, resourceIo: io })
  const tool = createExecuteTool({ ...ops, runSandbox: fakeRunner })
  const run = (body: string) => tool.run({ description: '测试', body }, { nodeId: childId, goalId })

  const l = await run('((api)=>{ const l = await api.res.list(); return { count: l.count, first: l.resources[0] } })')
  // 工具结果里的对象是 safeJson 序列化的（没有空格），断言要按那个形状写
  ok(l.ok && l.content.includes('题图.png') && l.content.includes('"refs":0'), 'res.list 回清单与引用数', l.content.slice(0, 220))

  const rt = await run("((api)=>{ const r = await api.res.read('" + MD_UUID + "'); return { kind: r.kind, chars: r.chars, head: r.content.slice(0, 4) } })")
  ok(rt.ok && rt.content.includes('"kind":"text"') && rt.content.includes('# 速查'), 'res.read 文本回正文', rt.content.slice(0, 220))

  // 图片：返回值里绝不能有 base64，图片挂在工具结果的 images 上
  const ri = await run("((api)=>{ const r = await api.res.read('" + PNG_UUID + "'); return { kind: r.kind, noteLen: r.note.length } })")
  ok(ri.ok && !ri.content.includes('AAAB') && !ri.content.includes('base64'), 'res.read 图片不把 base64 交给模型', ri.content.slice(0, 220))
  ok(ri.images?.length === 1 && ri.images[0].id === PNG_UUID && ri.images[0].rel === PNG_REL, '图片挂在工具结果的 images 上', ri.images)
  ok(ri.content.includes('附上了 1 张图片'), '回执里点明图片在下一跳', ri.content.slice(-90))

  const rm = await run("((api)=>{ return await api.res.read('不存在的uuid') })")
  ok(!rm.ok && rm.content.includes('没有这条资源'), '未知 uuid 给可读原因', rm.content.slice(0, 180))

  const ru = await run("((api)=>{ return await api.res.update('" + PNG_UUID + "', { name: '第二题插图', description: '来自课本 P42' }) })")
  const after = findResource(s, goalId, PNG_UUID)!
  ok(ru.ok && after.name === '第二题插图' && after.description === '来自课本 P42', 'res.update 改名称与描述（描述由 AI 写）', after)
  ok(after.updatedAt > after.createdAt, '修改日期跟着动', [after.createdAt, after.updatedAt])

  const rc = await run("((api)=>{ return await api.res.update('" + MD_UUID + "', { content: '# 新速查' }) })")
  ok(rc.ok && files.get(MD_REL) === '# 新速查', 'res.update 改文本内容，文件真的写下去', files.get(MD_REL))
  ok(findResource(s, goalId, MD_UUID)!.bytes === new TextEncoder().encode('# 新速查').length, '字节数跟着更新')
  const rb = await run("((api)=>{ return await api.res.update('" + PNG_UUID + "', { content: '想改二进制' }) })")
  ok(!rb.ok && rb.content.includes('二进制资源'), '二进制资源的内容改不动', rb.content.slice(0, 180))

  const rn = await run("((api)=>{ return await api.res.create({ name: '错题清单', ext: 'md', content: '- 第一题' }) })")
  const created = resourcesOf(s, goalId).find((r) => r.name === '错题清单')
  ok(rn.ok && !!created && created.type === 'text', 'res.create 新建文本资源并登记', created)
  ok(!!created && files.get('docs/微积分/static/' + created.uuid + '.md') === '- 第一题', '新资源真的落盘')
  const rn2 = await run("((api)=>{ return await api.res.create({ name: '图', ext: 'png', content: 'x' }) })")
  ok(!rn2.ok && rn2.content.includes('只能新建文本'), 'res.create 拒绝二进制后缀', rn2.content.slice(0, 180))

  // 被引用扫描 + 删除保护
  s = { ...s, nodes: s.nodes.map((n) => (n.id === childId ? { ...n, docs: { ...n.docs, teaching: '![题图](moji:static/' + PNG_UUID + ')' } } : n)) }
  const rf = await run("((api)=>{ const r = await api.res.refs('" + PNG_UUID + "'); return { count: r.count, node: r.refs[0].node } })")
  ok(rf.ok && rf.content.includes('"count":1') && rf.content.includes('微积分/极限'), 'res.refs 说出谁在引用它', rf.content.slice(0, 220))
  const rd = await run("((api)=>{ return await api.res.delete('" + PNG_UUID + "') })")
  ok(!rd.ok && rd.content.includes('还被') && resourcesOf(s, goalId).some((r) => r.uuid === PNG_UUID), '被引用时拒绝删除', rd.content.slice(0, 220))
  const rd2 = await run("((api)=>{ return await api.res.delete('" + PNG_UUID + "', { force: true }) })")
  ok(rd2.ok && !resourcesOf(s, goalId).some((r) => r.uuid === PNG_UUID), 'force 之后清单里没有它了', rd2.content.slice(0, 180))
  ok(removed.includes(PNG_REL), '文件也真的删了', removed)

  const rall = await run('((api)=>{ return await api.res.refs() })')
  ok(rall.ok && rall.content.includes('"unreferenced"'), 'res.refs() 是一次全量扫描', rall.content.slice(0, 180))

  // 指纹与去重：同样的内容不该存第二份
  const h1 = await hashOfText('同样的一段内容')
  const h2 = await hashOfText('同样的一段内容')
  ok(h1 === h2 && h1.length > 0, '相同内容指纹相同', h1)
  ok((await hashOfText('另一段')) !== h1, '不同内容指纹不同')
  const reuse = await run("((api)=>{ return await api.res.create({ name: '错题清单副本', ext: 'md', content: '- 第一题' }) })")
  ok(reuse.ok && reuse.content.includes('"reused":true'), 'res.create 撞上已有内容时直接复用', reuse.content.slice(0, 220))
  ok(
    resourcesOf(s, goalId).filter((r) => r.hash === (created?.hash ?? '')).length === 1,
    '清单里同样的内容只留一条',
    resourcesOf(s, goalId).map((r) => r.name),
  )
  ok(findByHash(s, goalId, created?.hash ?? '')?.uuid === created?.uuid, 'findByHash 能按内容找回那条资源')
  const listed = await run('((api)=>{ return await api.res.list() })')
  ok(listed.ok && listed.content.includes('"hash":"'), 'res.list 带指纹前缀（够认出重复）', listed.content.slice(0, 200))
}
