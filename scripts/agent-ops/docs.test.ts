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
import { loadAgentSettings, saveAgentSettings } from '../../src/agent/settings'
import { createExecuteTool, plainLineOf } from '../../src/agent/tools'
import { makePermissionOps } from '../../src/agent/permissions'
import { createMemory, createMemoryOps } from '../../src/learn/memory'
import { emptySchedule } from '../../src/learn/schedule'
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

  /*
   * 节点宇宙（v2）：api.node 四函数 + 对象门面。行为主线——
   * list 查全图 → get 取对象 → help() 现查 → content 读 / editContent 整份写回 → connect 连线。
   */
  /** 探针回执 = 结果 JSON + 「本次调用」尾巴：只取 JSON 段 */
  const jsonOf = (r: { content: string }): unknown => JSON.parse(r.content.slice(0, r.content.indexOf('\n本次调用')))
  const rList = await h.run("((api)=>{ const l = await api.node.list(); return { entry: l.goal.entry, docUuid: l.nodes.find((n)=>n.title==='极限').uuid, noteCount: l.nodes.find((n)=>n.title==='极限').notes.length } })")
  ok(rList.ok && rList.content.includes('"docUuid"') && rList.content.includes('entry:n1'), 'node.list 列出全图（带 uuid 与挂件清单）', rList.content.slice(0, 240))
  const listJson = jsonOf(rList) as { docUuid: string }
  const docUuid = listJson.docUuid
  const outlineUuidOf = 'o:' + docUuid

  const rGet = await h.run("((api)=>{ const n = await api.node.get(" + JSON.stringify(docUuid) + "); return { kind: n.kind, title: n.title, ups: n.relations.filter((r)=>r.type==='up').length } })")
  ok(rGet.ok && rGet.content.includes('"kind":"doc"') && rGet.content.includes('极限'), 'node.get 取到节点对象（身份 + 关系快照）', rGet.content.slice(0, 200))

  const rHelp = await h.run("((api)=>{ const n = await api.node.get(" + JSON.stringify(docUuid) + "); const h = await n.help(); return { desc: h.description.slice(0, 6), hasEdit: !!h.edit, hasConn: !!h.connection } })")
  ok(rHelp.ok && rHelp.content.includes('hasEdit":true') && rHelp.content.includes('hasConn":true'), '对象上的 help() 回三段自述（description/edit/connection）', rHelp.content.slice(0, 200))

  const rContent = await h.run("((api)=>{ const n = await api.node.get(" + JSON.stringify(docUuid) + "); const c = await n.content; return { title: c.title, chars: c.teaching.length, status: c.status } })")
  ok(rContent.ok && rContent.content.includes('极限') && rContent.content.includes('"chars"'), 'await n.content 读到整份快照（含正文与状态）', rContent.content.slice(0, 200))

  const keepTeaching = h.store().nodes.find((n) => n.id === childId)?.docs.teaching ?? ''
  const newTeaching = '# 极限（节点宇宙版）\n\n先从数列极限讲起。'
  const rEdit = await h.run("((api)=>{ const n = await api.node.get(" + JSON.stringify(docUuid) + "); const c = await n.content; return await n.editContent({ ...c, teaching: " + JSON.stringify(newTeaching) + " }) })")
  ok(rEdit.ok && h.store().nodes.find((n) => n.id === childId)?.docs.teaching === newTeaching, 'editContent 整份写回（先读后写、落进 store）', rEdit.content.slice(0, 160))

  const rEditMissing = await h.run("((api)=>{ const n = await api.node.get(" + JSON.stringify(docUuid) + "); return await n.editContent({ title: '极限' }) })")
  ok(!rEditMissing.ok && rEditMissing.content.includes('description'), '缺字段被拦（整份替换，缺了等于清空）', rEditMissing.content.slice(0, 160))

  // 排版提醒挂在整篇写入教学文档的回执上（节点 editContent 与 files.* 的镜像同步共用同一判定）：
  // 整篇写入教学文档且毫无排版痕迹时，回执点一句
  const plainDoc = '这一段讲解只有最朴素的段落。'.repeat(40)
  const rPlain = await h.run("((api)=>{ const n = await api.node.get(" + JSON.stringify(docUuid) + "); const c = await n.content; return await n.editContent({ title: c.title, description: c.description, status: c.status, teaching: " + JSON.stringify(plainDoc) + " }) })")
  ok(rPlain.ok && rPlain.content.includes('排版痕迹'), '整篇写入的教学文档没有排版痕迹时，回执点一句排版提醒', rPlain.content.slice(0, 200))

  // 写回共享 fixture（后面的用例还要在它上面找东西）
  const keepDesc = h.store().nodes.find((n) => n.id === childId)?.description ?? ''
  await h.run("((api)=>{ const n = await api.node.get(" + JSON.stringify(docUuid) + "); const c = await n.content; return await n.editContent({ title: '极限', description: " + JSON.stringify(keepDesc) + ", teaching: " + JSON.stringify(keepTeaching) + ", status: c.status }) })")
  ok(h.store().nodes.find((n) => n.id === childId)?.docs.teaching === keepTeaching, '共享 fixture 的教学文档已原样写回', undefined)

  // 笔记节点：建（create 即挂）→ 读 → 写
  const rNote = await h.run("((api)=>{ const r = await api.node.create({ kind: 'note', title: '错题本', under: " + JSON.stringify(docUuid) + " }); const n = await api.node.get(r.uuid); await n.editContent({ text: '第一道错题' }); const c = await n.content; return { uuid: r.uuid, text: c.text } })")
  ok(
    rNote.ok &&
      rNote.content.includes('第一道错题') &&
      h.store().nodes.find((n) => n.id === childId)?.notes.some((n) => n.name === '错题本'),
    'create 挂件即挂上（under=文档 uuid），editContent 落正文',
    rNote.content.slice(0, 160),
  )
  const noteUuid = (jsonOf(rNote) as { uuid: string }).uuid

  // 大纲节点：get("o:"+uuid) → editContent 整份写 → content 读回
  const rOutline = await h.run("((api)=>{ const o = await api.node.get(" + JSON.stringify(outlineUuidOf) + "); const w = await o.editContent({ intro: '探针路线', children: [{ title: '子甲', summary: '先学' }] }); const rd = await o.content; return { wrote: w.ok, count: rd.children.length, key: rd.children[0].key } })")
  ok(rOutline.ok && rOutline.content.includes('"count":1') && rOutline.content.includes('子甲'), '大纲对象：editContent 整份落盘、content 读回对象', rOutline.content.slice(0, 200))

  // 连接：唯一可手工组合「大纲 → 文档」——建子文档挂上去，重复连与挂件连都被拒
  const rCreateDoc = await h.run("((api)=>{ const r = await api.node.create({ kind: 'doc', title: '夹逼定理', under: " + JSON.stringify(outlineUuidOf) + " }); return r })")
  ok(rCreateDoc.ok && rCreateDoc.content.includes('夹逼定理'), 'node.create 建文档挂在大纲之下', rCreateDoc.content.slice(0, 160))
  const subUuid = (jsonOf(rCreateDoc) as { uuid: string }).uuid
  ok(h.store().edges.some((e) => e.from === childId && e.to === subUuid), '新文档的树边真的落了')
  const rConnect = await h.run("((api)=>{ const o = await api.node.get(" + JSON.stringify(outlineUuidOf) + "); const d = await api.node.get(" + JSON.stringify(docUuid) + "); return await o.connect(d, 'down') })")
  ok(!rConnect.ok && rConnect.content.includes('已经连着'), '重复连接被拒（带人话）', rConnect.content.slice(0, 160))
  const rBadConnect = await h.run("((api)=>{ const o = await api.node.get(" + JSON.stringify(outlineUuidOf) + "); const n = await api.node.get(" + JSON.stringify(noteUuid) + "); return await o.connect(n, 'down') })")
  ok(!rBadConnect.ok && rBadConnect.content.includes('笔记'), '挂件不能手工连（归属自动生成）', rBadConnect.content.slice(0, 160))

  // 固定接口：创建带 portKey = 创建即认领（点目标项建文档的同一条路）；getPortData 拉回整条
  const rClaimCreate = await h.run("((api)=>{ const o = await api.node.get(" + JSON.stringify(outlineUuidOf) + "); const c = await o.content; return await api.node.create({ kind: 'doc', title: '认领甲', under: " + JSON.stringify(outlineUuidOf) + ", portKey: c.children[0].key }) })")
  ok(rClaimCreate.ok && rClaimCreate.content.includes('认领了目标项'), 'node.create 带 portKey 创建即认领', rClaimCreate.content.slice(0, 200))
  const claimUuid = (jsonOf(rClaimCreate) as { uuid: string }).uuid
  ok(h.store().edges.some((e) => e.from === childId && e.to === claimUuid && !!e.portKey), '认领落在树边上（下游侧有效）')
  const rPorts = await h.run("((api)=>{ const d = await api.node.get(" + JSON.stringify(claimUuid) + "); const data = await d.getPortData(); const up = d.relations.find((r) => r.type === 'up'); return { data, portKey: up && up.portKey } })")
  ok(rPorts.ok && rPorts.content.includes('子甲') && rPorts.content.includes('先学') && rPorts.content.includes('"portKey"'), 'getPortData 拉到整条（key/label/data），manifest 关系带 portKey', rPorts.content.slice(0, 240))
  const rPortTaken = await h.run("((api)=>{ const o = await api.node.get(" + JSON.stringify(outlineUuidOf) + "); const c = await o.content; const made = await api.node.create({ kind: 'doc', title: '抢口乙' }); const d2 = await api.node.get(made.uuid); return await d2.connect(o, 'up', c.children[0].key) })")
  ok(!rPortTaken.ok && rPortTaken.content.includes('一个接口只认领一个下游'), '一个接口只认领一个下游（人话拒绝）', rPortTaken.content.slice(0, 200))
  const rPortFree = await h.run("((api)=>{ const o = await api.node.get(" + JSON.stringify(outlineUuidOf) + "); const d = await api.node.get(" + JSON.stringify(claimUuid) + "); const un = await d.disconnect(o); const c = await o.content; const made = await api.node.create({ kind: 'doc', title: '补位丙' }); const d2 = await api.node.get(made.uuid); const re = await d2.connect(o, 'up', c.children[0].key); const gone = await d.getPortData(); return { un: un.ok, re: re.ok, gone } })")
  ok(rPortFree.ok && rPortFree.content.includes('"re":true') && rPortFree.content.includes('"gone":[]'), '剪线解除认领：接口空出来可被别人认领，原文档 getPortData 归零', rPortFree.content.slice(0, 240))
  const rBadPort = await h.run("((api)=>{ const o = await api.node.get(" + JSON.stringify(outlineUuidOf) + "); const made = await api.node.create({ kind: 'doc', title: '问口丁' }); const d = await api.node.get(made.uuid); return await d.connect(o, 'up', '没有这个口') })")
  ok(!rBadPort.ok && rBadPort.content.includes('可认领的'), '不存在的接口报出可认领清单', rBadPort.content.slice(0, 200))

  const rRename = await h.run("((api)=>{ const n = await api.node.get(" + JSON.stringify(subUuid) + "); const c = await n.content; return await n.editContent({ ...c, title: '夹逼定理（正式）' }) })")
  ok(rRename.ok && h.store().nodes.some((n) => n.title === '夹逼定理（正式）'), '改名走 editContent（title 在 content 里）', rRename.content.slice(0, 160))
  const rDupName = await h.run("((api)=>{ const n = await api.node.get(" + JSON.stringify(subUuid) + "); const c = await n.content; return await n.editContent({ ...c, title: '极限' }) })")
  ok(!rDupName.ok && rDupName.content.includes('已经有'), '同名改名被拒绝', rDupName.content.slice(0, 160))

  const rDel = await h.run("((api)=>{ return await api.node.delete(" + JSON.stringify(subUuid) + ") })")
  ok(rDel.ok && !h.store().nodes.some((n) => n.title === '夹逼定理（正式）'), 'node.delete 删掉文档（删谁只删谁，行为在服务层）', rDel.content.slice(0, 160))
  const rDelNote = await h.run("((api)=>{ return await api.node.delete(" + JSON.stringify(noteUuid) + ") })")
  ok(rDelNote.ok && !(h.store().nodes.find((n) => n.id === childId)?.notes ?? []).some((n) => n.name === '错题本'), 'node.delete 删掉挂件只删它自己', rDelNote.content.slice(0, 160))

  const rUnknown = await h.run("((api)=>{ return await api.node.invoke(" + JSON.stringify(docUuid) + ", '没有这个成员', []) })")
  ok(!rUnknown.ok && rUnknown.content.includes('content / editContent'), '未知成员被拒并列出五件套清单', rUnknown.content.slice(0, 200))

  const rOldGraph = await h.run('((api)=>{ return await api.graph.list() })')
  ok(!rOldGraph.ok && rOldGraph.content.includes('api.node.list()'), '旧 api 名给出新写法（graph.list → node.list）', rOldGraph.content.slice(0, 200))

  // 删谁只删谁（用户定的）：删大纲 = 清空计划（文档与树边不动）；删文档只删自己，下游断线成游离
  const rDelOutline = await h.run("((api)=>{ return await api.node.delete(" + JSON.stringify(outlineUuidOf) + ") })")
  ok(rDelOutline.ok && !h.store().nodes.find((n) => n.id === childId)?.outline, 'node.delete 删大纲 = 清空计划（文档还在、树边不动）', rDelOutline.content.slice(0, 200))
  const rMid = await h.run("((api)=>{ return await api.node.create({ kind: 'doc', title: '中游', under: " + JSON.stringify(docUuid) + " }) })")
  const midUuid = rMid.ok ? (jsonOf(rMid) as { uuid?: string }).uuid : undefined
  ok(!!midUuid && h.store().nodes.some((n) => n.id === midUuid), '中游文档建出来', rMid.content.slice(0, 120))
  const rLeaf = await h.run("((api)=>{ return await api.node.create({ kind: 'doc', title: '下游', under: 'o:" + midUuid + "' }) })")
  const leafUuid = rLeaf.ok ? (jsonOf(rLeaf) as { uuid?: string }).uuid : undefined
  ok(!!leafUuid, '下游挂在「中游」的大纲之下（under 认 o: 前缀）', rLeaf.content.slice(0, 160))
  const rDelMid = await h.run("((api)=>{ return await api.node.delete(" + JSON.stringify(midUuid ?? '') + ") })")
  ok(
    rDelMid.ok && !h.store().nodes.some((n) => n.id === midUuid) &&
      h.store().nodes.some((n) => n.id === leafUuid) &&
      !h.store().edges.some((e) => e.from === midUuid),
    '删「中游」只删它自己：「下游」断线成游离、不删除', rDelMid.content.slice(0, 240),
  )

  // 独立实体与换绑（用户定的）：不给 under = 游离；剪线 = 解绑不删内容；connect = 绑回
  const rFree = await h.run("((api)=>{ return await api.node.create({ kind: 'note', title: '散记' }) })")
  const freeUuid = rFree.ok ? (jsonOf(rFree) as { uuid?: string }).uuid : undefined
  ok(
    !!freeUuid && !(h.store().nodes.some((n) => (n.notes ?? []).some((x) => x.id === freeUuid))) &&
      !!h.store().detached?.g1?.notes.some((n) => n.id === freeUuid),
    '不给 under 建的是游离笔记（独立实体，在池子里不在任何文档名下）', rFree.content.slice(0, 200),
  )
  const rWrite = await h.run("((api)=>{ return await api.node.invoke(" + JSON.stringify(freeUuid) + ", 'editContent', [{ text: '剪线也不删我' }]) })")
  ok(rWrite.ok, '游离笔记照样能写（内容跟实体走，跟绑定无关）', rWrite.content.slice(0, 160))
  const rBindBack = await h.run("((api)=>{ return await api.node.invoke(" + JSON.stringify(docUuid) + ", 'connect', [" + JSON.stringify(freeUuid) + ", 'down']) })")
  ok(
    rBindBack.ok && (h.store().nodes.find((n) => n.id === childId)?.notes ?? []).some((n) => n.id === freeUuid) &&
      !(h.store().detached?.g1?.notes ?? []).some((n) => n.id === freeUuid),
    'connect 绑回文档之下（从池子里挪进宿主，id 不变）', rBindBack.content.slice(0, 200),
  )
  const rUnbind = await h.run("((api)=>{ return await api.node.invoke(" + JSON.stringify(docUuid) + ", 'disconnect', [" + JSON.stringify(freeUuid) + "]) })")
  const unbound = rUnbind.ok && (h.store().detached?.g1?.notes ?? []).find((n) => n.id === freeUuid)
  ok(
    !!unbound && unbound.content === '剪线也不删我' && !(h.store().nodes.find((n) => n.id === childId)?.notes ?? []).some((n) => n.id === freeUuid),
    'disconnect 剪线 = 解绑：实体进池子、内容原样（什么都不删）', rUnbind.content.slice(0, 200),
  )
  const rOldDoc = await h.run('((api)=>{ return await api.doc.read("") })')
  ok(!rOldDoc.ok && rOldDoc.content.includes('api.node.get'), '旧 api 名给出新写法（doc.read → 节点对象）', rOldDoc.content.slice(0, 200))

  /*
   * TypeScript 沙箱：body 可以直接写 TS——类型标注、接口在进 Worker 前被剥掉。
   * 这条同时证明转译发生在宿主侧（探针的 fakeRunner 也走同一条 compileBody）。
   */
  const rTs = await h.run("((api: { node: { get(uuid: string): Promise<{ content: unknown; help(): { edit: string } }> } }) => { interface P { uuid: string } const p: P = { uuid: " + JSON.stringify(docUuid) + " }; const n = await api.node.get(p.uuid); const h = await n.help(); return { editHead: h.edit.slice(0, 2) } })")
  ok(rTs.ok && rTs.content.includes('editHead'), 'execute 的 body 可以直接写 TypeScript（类型/接口被剥掉后执行）', rTs.content.slice(0, 200))

  const r18 = await h.run('((api)=>{ return await api.node.get("根本没有的uuid") })')
  ok(!r18.ok && r18.content.includes('没有'), 'uuid 找不到时给出可读原因', r18.content.slice(0, 160))
}

/* ---------- 4. api 名单与实现必须一致 ---------- */

/**
 * 沙箱里的 api 名单（sandboxWorker 注入给运行时的那份）必须与 buildApi 真的注册了的对上：
 * 名单里有、实现里没有 → 模型调了只会得到「沙箱里没有这个 api」，
 * 而提示词却写着它可用。这正是上一次沙箱翻车的形态，所以专门测一遍。
 */
export async function apiNameTests() {
  const calls: Record<string, string> = {
    // 节点对象通道：多态内容读写的入口（行为用例见 toolTests 的「节点对象」一节）
    // 节点宇宙：四条传输 + invoke 代调用（行为用例见 toolTests 的「节点宇宙」一节）
    'node.list': '',
    'node.get': "'微积分'",
    'node.create': "{ kind: 'note', title: '探针笔记', under: '微积分' }",
    'node.delete': "'探针笔记'",  // 删上一行建出来的那份笔记（找不到也回执，同样证明 api 在）
    'node.invoke': "'微积分', 'help', []",
    // 写正文前的一页纸与收尾仪式（行为用例在 tests/agentApiLoopSave.test.ts；
    // finish 不带 content/state/memory/delivery = 各步跳过，只证明注册与守卫路径在）
    'node.brief': "'微积分'",
    'node.finish': "'微积分', { open: false }",
    // 持久化函数（创建/列表/删除/调用）
    'method.list': '',
    'method.create': "{ name: '探针函数', code: '((api)=>{ return 1 })' }",
    'method.delete': "'探针函数'",
    'method.call': "'探针函数', 21",
    // 自描述能力索引
    'help': '',
    // 工作流触发：只排队（真起那一轮的是宿主，探针里就是下面那个桩）
    'wf.invoke': "'compact'",
    'wf.list': '',
    'wf.get': "'recall'",
    // 伪编译交货：key 是宿主发出去的那串（探针这里没有待编译登记，走的是「key 对不上」那条路）
    'code.save': "{ key: '0123456789abcdef', js: 'console.log(1)', note: '探针' }",
    'code.silent': "{ key: '0123456789abcdef', reason: '探针：只有定义' }",
    // 人机协作与界面：宿主能力是桩（见下面 createExecuteTool 的注入）
    'wait': '0',
    'ask': "{ title: '确认', questions: [{ type: 'short', prompt: '怎么继续？' }] }",
    'tiktok': '',
    'ui.toast': "'你好'",
    'ui.point': "{ line: 1 }",
    'ui.scroll': "{ to: 'top' }",
    'ui.screenshot': '',
    'ui.superdoc': "'微积分', '探针文档'",
    // ui.dom 走进程内直调通道：回调在宿主拿到门面（真沙箱由 Worker 侧建门面，行为一致）
    'ui.dom': "async (root) => ({ e: await root.exists('p'), c: await root.count('p') })",
    // 网络搜索与网页抓取（基于 DeepSeek 官方 Search API 与 Fetch API）
    'fetch': "{ url: 'https://example.com/a' }",
    'web.search': "{ query: '勾股定理' }",
    // 看图（顶层 api）：宿主给一份桩——只问「名字真的注册了吗」，
    // 取图 / 落库 / 挂下一跳的真行为在渲染层（learn/see，要 DOM 与原生桥，Node 探针跑不了）
    'see': "'https://example.com/pic.png'",
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
    // 引用 chip：生成（当场对 store 验证可定位）与交付前自查（见 learn/ops/chip）
    'chip.build': "{ type: 'doc' }",
    'chip.check': "'看：#[{type:\"doc\", path:\"微积分\"}]'",
    // 交付账：只查「名字真的注册了吗」，登记与落库由宿主管（见 useAgent 的 turnDelivery）
    'delivery.submit': "{ files: [{ path: '探针/文档', action: 'updated' }], sources: [{ title: '示例规范', url: 'https://example.com/spec' }] }",
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
    'browser.logs': "'w:probe'",
    'browser.logDetail': "'w:probe', 1",
    'browser.fetch': "'w:probe', 'https://example.com/api'",
    'browser.record': "'w:probe', 'stop'",
    'browser.text': "'w:probe', { ref: 1 }",
    'browser.scroll': "'w:probe', { by: 800 }",
    'browser.waitFor': "'w:probe', { selector: '.done' }",
    // 外部 MCP 服务：探针里给一份假的宿主（真实现见 agent/mcp/ops）
    'mcp.list': '',
    'mcp.discover': "'探针服务'",
    'mcp.call': "'探针服务', 'probe_tool', { q: 'hello' }",
    // 基础文件系统：真实路径操作（Node 探针下回假桩，真机走主进程 IPC）
    'files.read': "''",
    'files.write': "'', '内容'",
    'files.edit': "'', { content: '新内容' }",
    'files.list': "''",
    'files.stat': "''",
    'files.mkdir': "''",
    'files.copy': "'', ''",
    'files.move': "'', ''",
    'files.delete': "''",
    // 基础系统进程任务
    'process.create': "{ command: 'node' }",
    'process.start': "'proc_test'",
    'process.status': "'proc_test'",
    'process.output': "'proc_test'",
    'process.stop': "'proc_test'",
    'process.list': '',
    'process.get': "'proc_test'",
    'process.delete': "'proc_test'",
    // 专业技能系统
    'skill.paths': "''",
    'skill.list': '',
    'skill.read': "'test-skill'",
    'skill.run': "'test-skill', 'test.js'",
    'skill.write': "{ id: 'test-skill', name: '测试' }",
    'skill.delete': "'test-skill'",
    // 视频资源与选集信息
    'video.list': '',
    'video.get': "'v-probe'",
    // 项目路径（已声明 project 节点的真实路径读写）：名单检查只问「api 在不在」；
    // 探针里没有真实声明，tree/read 等回「没有这个项目节点」的回执同样证明注册路径在
    'project.list': '',
    'project.tree': "'p1'",
    'project.read': "'p1', 'a.txt'",
    'project.write': "'p1', 'a.txt', '内容'",
    'project.edit': "'p1', 'a.txt', { content: '新内容' }",
    'project.mkdir': "'p1', 'dir'",
    'project.move': "'p1', 'a.txt', 'b.txt'",
    'project.copy': "'p1', 'a.txt', 'c.txt'",
    'project.delete': "'p1', 'a.txt'",
    // 路径放行（导师专用）：宿主给真实现（makePermissionOps + 专用桩 ask 总是选「放行」）——
    // Node 探针里设置只在内存（uid 为空，writeUserSettings 不落盘）
    'permission.list': '',
    'permission.revoke': "'C:/probe/not-allowed'",
    'permission.request': "{ path: 'C:/probe-approval', reason: '探针：外部数据集' }",
    // 名单扩张后补上的那批（数据面回归 api 组）：这批只问「名字真的注册了吗」，
    // 行为断言由各自领域的小节覆盖（examTests / methodAndSdocTests / workflowTests / workspaceTests …）
    'node.createTree': "{ tree: [{ title: '临时树节点' }] }",
    'state.read': "''",
    'state.update': "'', { mastery: 60, note: '探针' }",
    'state.mistake': "'', { pattern: '探针错法' }",
    'state.forget': "'', '探针错法'",
    'state.check': "'', { kind: 'probe', score: 80 }",
    'tmp.set': "{ key: 'probe', value: 1 }",
    'tmp.get': "'probe'",
    'tmp.has': "'probe'",
    'tmp.del': "'probe'",
    'tmp.list': '',
    'tmp.clear': '',
    'exam.read': "''",
    'exam.grade': '{ passed: true }',
    'exam.rotateSheet': '{ sheetIndex: 0, degrees: 90 }',
    'exam.previewCrop': "{ questionId: 'q1', box: [100, 50, 450, 950] }",
    'exam.cropAnswer': "{ questionId: 'q1', box: [100, 50, 450, 950] }",
    'exam.explain': "{ content: '探针讲解' }",
    'exam.delete': '{}',
    'res.list': '',
    'res.info': "'probe-uuid'",
    'res.read': "'probe-uuid'",
    'res.create': "{ name: '探针资源', ext: 'md', content: '# 探针' }",
    'res.update': "'probe-uuid', { description: '探针' }",
    'res.delete': "'probe-uuid'",
    'res.refs': "''",
    'workspace.list': "''",
    'workspace.read': "''",
    'workspace.write': "{ path: '探针.txt', content: '探针' }",
    'userInfo.get': '',
    'userInfo.update': "{ nickname: '探针用户' }",
    'reading.get': "''",
    'reading.list': '',
    'reading.day': "''",
    'attention.get': "''",
    'focus.status': '',
    'wf.create': "{ name: '探针流程', instruction: '第一步' }",
    'wf.remove': "'探针流程'",
    'web.fetch': "{ url: 'https://example.com/a' }",
    // 记忆：名单检查按注册表顺序跑（list / get 排在 create 之前），所以 store 里先种了一条
    // uuid 固定的工作记忆（见下面的 seedMemory）；这里只问「这五条真的注册了吗」
    'memory.list': '',
    'memory.get': "'probe-memory'",
    'memory.create': "{ type: 'work', title: '探针记忆二', content: '探针：再记一条' }",
    'memory.update': "'probe-memory', { content: '探针：改过的记忆' }",
    'memory.delete': "'probe-memory'",
    // 一页纸记忆（行为用例在 tests/agentApiLoopSave.test.ts）
    'memory.context': "{ scope: 'work' }",
    // 日程：同样先种一条 id 固定的（见 seedSchedule），create 之外的几条才有真对象可改
    'schedule.list': '',
    'schedule.create': "{ title: '探针新日程', time: '23:30', remindBefore: 5 }",
    'schedule.update': "'probe-schedule', { time: '22:00' }",
    'schedule.complete': "'probe-schedule'",
    'schedule.remove': "'probe-schedule'",
  }
  let s = staticStore()
  /*
   * 名单检查是按**注册表顺序**跑的（list → get → create → update → delete），
   * 而 memory.get / schedule.update 排在自己的 create 之前。先各料一条 uuid / id 固定的，
   * 这几条才真的读到、改到东西，而不是只证明「名字注册了」。
   */
  const seedAt = Date.now() + 3_600_000
  s = createMemory(s, { type: 'work', goalId, title: '探针记忆', content: '探针：极限讲完了' }, 'probe-memory')
  s = {
    ...s,
    schedule: {
      ...emptySchedule(),
      items: [{ id: 'probe-schedule', title: '探针日程', startAt: seedAt, remindAt: seedAt, createAt: Date.now(), updateAt: Date.now() }],
    },
  }
  let tmpStore: Record<string, unknown> = {}
  let sawTmpWrite = false
  /** wf.invoke 的落点：真宿主是 useAgent 的队列（本轮收口后另起一轮），这里只记下交给它的是哪一条 */
  let sawInvoke = ''
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
    // 项目路径同样给一份假的：名单检查只问「这九个 api 在不在」；真实现与授权口径在 learn/ops/project
    projectIo: {
      send: async (req) => {
        const path = String((req as { path?: unknown }).path ?? '')
        switch ((req as { op?: string }).op) {
          case 'list':
            return { ok: true as const, op: 'list' as const, path, entries: [] }
          case 'stat':
            return { ok: true as const, op: 'stat' as const, path, exists: false, stat: null }
          case 'read':
            return { ok: true as const, op: 'read' as const, content: '', encoding: 'utf8', size: 0 }
          case 'write':
            return { ok: true as const, op: 'write' as const, path, bytesWritten: 0 }
          case 'edit':
            return { ok: true as const, op: 'edit' as const, path, modified: false }
          default:
            return { ok: true as const, op: (req as { op: 'mkdir' | 'move' | 'copy' | 'delete' }).op, path }
        }
      },
    },
    // 读网页与搜索同样给一份假的：名单检查只问「这两个 api 在不在」
    web: {
      fetch: async (arg: unknown) => ({ title: '示例页', content: '# 示例页\n\n正文' }),
      search: async (queryOrArgs: unknown) => ({
        results: [{ rank: 1, title: '勾股定理 - 百度百科', url: 'https://example.com/pyth', snippet: '直角三角形边长关系' }],
      }),
    },
    // 画像同样给一份假的：名单检查只问「这个名字真的注册了吗」
    userInfo: {
      read: () => ({ ...emptyProfile(), nickname: '探针用户' }),
      update: async (patch) => ({ ...emptyProfile(), nickname: '探针用户', ...patch }),
    },
    tmp: () => ({ nodeId: childId, entries: tmpStore as never, onChange: (next) => { tmpStore = next; if (Object.keys(next).length) sawTmpWrite = true } }),
    // wf.invoke：接受排队就是成功（真起那一轮的是宿主）
    invokeWorkflow: (id) => { sawInvoke = id; return { ok: true } },
    // 桩：这一组只查「名字真的注册了吗」，行为由 examTests 与用例各自覆盖
    exam: {
      create: () => ({ ok: true, content: '（桩）' }),
      explain: () => ({ ok: true, content: '（桩）' }),
      read: () => ({ ok: true, content: '（桩）' }),
      grade: () => ({ ok: true, content: '（桩）' }),
      rotateSheet: () => ({ ok: true, content: '（桩）' }),
      previewCrop: () => ({ ok: true, content: '（桩）' }),
      cropAnswer: () => ({ ok: true, content: '（桩）' }),
      remove: () => ({ ok: true, content: '（桩）' }),
    },
  })
  // 人机协作与界面那一组：wait / ask / tiktok / ui 都是桩（行为由界面接线保证），
  // memory 用真的 createMemoryOps（它是纯 store 逻辑，Node 里就能跑）
  let sawToast = ''
  let sawScroll: unknown = null
  let sawOpenSuper: string | null = null
  // browser 桩：名单检查只问「这九个 api 在不在」，行为断言看下面的 sawBrowserXxx
  let sawBrowserOpen = ''
  let sawBrowserDom = ''
  let sawBrowserActivate = ''
  let sawBrowserClose = ''
  // mcp 桩：同样只问「这三个 api 在不在」，行为断言看下面的 sawMcpCall
  let sawMcpCall = ''
  const stubRoot = { querySelectorAll: () => [] } as unknown as Element
  const tool = createExecuteTool({
    ...ops,
    runSandbox: fakeRunner,
    memory: createMemoryOps({ getLatest: () => s, set: (n) => { s = n }, goalId: () => goalId }),
    wait: async () => {},
    ask: async () => ({ ok: true, cancelled: false, answers: [] }),
    tiktok: async () => {},
    // 看图（顶层 api）：桩——行为断言在渲染层，这里只证明 api 存在且能通
    see: async () => ({ ok: true, uuid: 'see-probe', name: '探针图', note: '（桩）图片已附在你的下一步里', images: [] }),
    // 交付账：桩——名单检查只问「这个 api 在不在」，真正的登记与落库在宿主（useAgent 收口）
    delivery: { submit: () => ({ ok: true, files: 0, sources: 0 }) },
    ui: {
      toast: (msg) => { sawToast = msg },
      point: () => ({ located: false }),
      scroll: (req) => { sawScroll = req },
      capture: async () => ({ ok: true, images: [] }),
      domRoot: () => stubRoot,
      openSuper: ({ name }) => { sawOpenSuper = name; return { opened: true } },
    },
    browser: {
      open: async (url: string) => { sawBrowserOpen = url; return { tabId: 'w:probe', url } },
      tabs: () => ({ tabs: [{ tabId: 'w:probe', url: 'https://example.com', title: '示例页', active: true, group: 'g1' }] }),
      activate: (tabId: string) => { sawBrowserActivate = tabId; return { ok: true } },
      close: (tabId: string) => { sawBrowserClose = tabId; return { ok: true } },
      snapshot: async () => ({ elements: [{ ref: 1, role: 'button', name: '提交' }] }),
      point: async () => ({ ok: true }),
      dom: async (_tabId: string | undefined, ref: number, op: string) => { sawBrowserDom = ref + ':' + op; return { ok: true } },
      read: async () => ({ ok: true, uuid: 'deadbeef', url: 'https://example.com', title: '示例页', chars: 3, text: '正文' }),
      capture: async () => ({ ok: true, note: '（桩）', images: [] }),
      logs: async () => ({ lines: ['[n1] GET https://example.com/api → 200'], shown: 1, totalConsole: 0, totalNetwork: 1, latestSeq: 1, truncated: false }),
      logDetail: async (_tabId: string, seq: number) => ({ detail: { kind: 'network', seq, method: 'GET', url: 'https://example.com/api', status: 200, type: 'XHR' } }),
      fetch: async () => ({ status: 200, body: '{"ok":true}' }),
      record: async (_tabId: string, action: string) =>
        action === 'start' ? { ok: true as const, action: 'start' as const, since: 0 } : { lines: [], shown: 0, totalConsole: 0, totalNetwork: 0, latestSeq: 0, truncated: false, action: 'stop' as const },
      text: async () => ({ text: '正文', chars: 2 }),
      scroll: async () => ({ ok: true as const, scrollY: 800, scrollHeight: 4000, viewport: 900, atBottom: false, atTop: false }),
      waitFor: async () => ({ ok: true as const, matched: 'selector' as const, waitedMs: 250, url: 'https://example.com' }),
    },
    // 外部 MCP 服务：桩（名单检查只问「这三个 api 在不在」；真行为见 tests/agentSkillsAndMcp.test.ts）
    mcp: {
      list: () => ({
        ok: true,
        servers: [{ id: 'probe-srv', name: '探针服务', transport: 'sse', status: 'idle', tools: [{ name: 'probe_tool', description: '探针工具' }] }],
      }),
      discover: async () => ({ ok: true, servers: [{ id: 'probe-srv', name: '探针服务', ok: true, tools: [{ name: 'probe_tool' }] }] }),
      call: async (server: string, tool: string, args?: unknown) => {
        sawMcpCall = server + ':' + tool + ':' + JSON.stringify(args ?? {})
        return { ok: true, server, tool, content: '（桩）外部结果' }
      },
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
    // 路径放行：真实现（agent/permissions）+ 专用桩 ask（总是选「放行」），审批闭环在探针里走通
    permission: makePermissionOps({
      ask: async () => ({
        ok: true,
        cancelled: false,
        answers: [{ id: 'approve', type: 'single', prompt: '放行？', picked: ['放行'], pickedIds: ['yes'] }],
      }),
    }),
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

  // 新 api 的行为抽两条钉住：ui.dom 的门面真的可用
  ok(sawToast === '你好' && !!sawScroll, 'ui.toast / ui.scroll 都到了宿主')
  ok(sawInvoke === 'compact', 'wf.invoke 把要触发的那一条交给了宿主（按 id 交出去）', sawInvoke)
  ok(sawOpenSuper === '探针文档', 'ui.superdoc 把要开的文档名递给了宿主', sawOpenSuper)
  // __help 三级：组 / 单条 / 根。假沙箱把它们当普通调用转回宿主，execute 的 callApi 兜底渲染
  const groupHelp = await tool.run({ description: '组 help', body: '((api)=>{ return await api.node.__help() })' }, { nodeId: childId, goalId })
  ok(groupHelp.ok && groupHelp.content.includes('node.get'), 'api.node.__help() 列出组内 api', groupHelp.content.slice(0, 150))
  const apiHelp = await tool.run({ description: '单条 help', body: '((api)=>{ return await api.node.get.__help() })' }, { nodeId: childId, goalId })
  ok(apiHelp.ok && apiHelp.content.includes('示例：') && apiHelp.content.includes('api.node.get'), 'api.node.get.__help() 带签名与示例', apiHelp.content.slice(0, 150))
  const rootHelp = await tool.run({ description: '根 help', body: '((api)=>{ return await api.__help() })' }, { nodeId: childId, goalId })
  ok(rootHelp.ok && rootHelp.content.includes('api.node') && rootHelp.content.includes('api.<组>.<api>.__help()'), 'api.__help() 是组总览并教用法', rootHelp.content.slice(0, 150))
  const bogusHelp = await tool.run({ description: '不存在的组', body: '((api)=>{ return await api.nope.__help() })' }, { nodeId: childId, goalId })
  ok(bogusHelp.content.includes('await api.__help()'), '查不存在的组给出指路而不是空话', bogusHelp.content.slice(0, 120))
  ok(
    sawBrowserOpen === 'https://example.com' &&
      sawBrowserDom === '1:click' &&
      sawBrowserActivate === 'w:probe' &&
      sawBrowserClose === 'w:probe',
    'browser 这一组真的到了宿主（开站 / dom 操作 / 切页签 / 关页签）',
    { sawBrowserOpen, sawBrowserDom },
  )
  ok(
    sawMcpCall === '探针服务:probe_tool:{"q":"hello"}',
    'mcp 这一组真的到了宿主（服务 / 工具 / 参数原样递过去）',
    sawMcpCall,
  )
  // permission 这一组走的是真实现（agent/permissions + 桩 ask 总是批准）：
  // 名单检查里 permission.request 已经过一次审批——这里钉「agent-用户-系统」的闭环：
  // 批准由宿主落进放行配置（Node 里是内存份），清单查得到、重复放行不再弹、撤销真的撤。
  const permList = await tool.run({ description: '放行清单', body: '((api)=>{ return await api.permission.list() })' }, { nodeId: childId, goalId })
  ok(permList.ok && permList.content.includes('C:/probe-approval'), '批准过的目录出现在 permission.list 里', permList.content.slice(0, 220))
  const permAgain = await tool.run({ description: '重复放行', body: "((api)=>{ return await api.permission.request({ path: 'C:/probe-approval' }) })" }, { nodeId: childId, goalId })
  ok(permAgain.ok && permAgain.content.includes('alreadyAccessible'), '已在作用域内时不再弹审批', permAgain.content.slice(0, 200))
  const permRevoke = await tool.run({ description: '撤销放行', body: "((api)=>{ return await api.permission.revoke('C:/probe-approval') })" }, { nodeId: childId, goalId })
  ok(permRevoke.ok && permRevoke.content.includes('"removed"'), 'permission.revoke 撤掉已放行的目录', permRevoke.content.slice(0, 200))
  // ui.point 的行号定位：源文行要先剥成渲染文本里找得到的纯文字——
  // agent 实测拿原始源文行去搜渲染结果，除了纯散文行一律 located:false
  ok(plainLineOf('## 微积分基本定理') === '微积分基本定理', '标题行剥掉井号', plainLineOf('## 微积分基本定理'))
  ok(plainLineOf('- [导数](moji:learn "变化率") 是基础') === '导数 是基础', '链接行只留链接文字', plainLineOf('- [导数](moji:learn "变化率") 是基础'))
  ok(plainLineOf('1. **重点**：看 `这里`') === '重点：看 这里', '强调与行内代码剥掉标记', plainLineOf('1. **重点**：看 `这里`'))
  // 选配的组没注入时应当不存在——用另起一个不带 exam 的工具来验，别和上面那份混着用
  const bare = createExecuteTool({ ...ops, exam: undefined, runSandbox: fakeRunner })
  const exam = await bare.run({ description: '名单检查', body: '((api)=>{ return await api.exam.read() })' }, { nodeId: childId, goalId })
  ok(exam.content.includes('沙箱里没有这个 api'), '没注入 exam 时它确实不存在', exam.content.slice(0, 120))

  // 子代理的 api 白名单（apiAllow）是通道口的硬校验，不是提示词君子协定：
  // 名单外的组当场被拒（报错里写明开放了哪些组），名单内的组照常放行。
  // 触发口挂上之后还能钉一条：被拒的调用进不了 log，也就不会报模块 key。
  const deniedModules: string[] = []
  const sub = createExecuteTool({ ...ops, runSandbox: fakeRunner, apiAllow: ['web', 'tmp'], onPromptModule: (k) => deniedModules.push(k) })
  const denied = await sub.run({ description: '越权取节点', body: '((api)=>{ return await api.node.list() })' }, { nodeId: childId, goalId })
  ok(!denied.ok && denied.content.includes('只开放了'), 'apiAllow 名单外的组当场被拒', denied.content.slice(0, 160))
  ok(!deniedModules.includes('node'), '被 apiAllow 拒掉的调用不触发注入', deniedModules)
  const allowed = await sub.run({ description: '搜索', body: "((api)=>{ return await api.web.search('勾股定理') })" }, { nodeId: childId, goalId })
  ok(allowed.ok && (allowed.content.includes('baidu') || allowed.content.includes('百度百科') || allowed.content.includes('勾股定理')) && deniedModules.includes('web'), 'apiAllow 名单内的组照常放行并触发注入', { content: allowed.content.slice(0, 120), keys: deniedModules })

  // 动态提示词注入的触发口（learn/ai/promptModules）：execute 只负责「报 key」——
  // 组触发按本次编排里真实调过的组报（被 apiAllow 拒的组进不了 log，也就不报），
  // 内容触发在写入参数上嗅探 plot 围栏与动画标记。去重与落库在宿主（useAgent）。
  const sawModules: string[] = []
  const modTool = createExecuteTool({ ...ops, runSandbox: fakeRunner, onPromptModule: (k) => sawModules.push(k) })
  await modTool.run({ description: '组触发', body: "((api)=>{ return await api.web.search('探针') })" }, { nodeId: childId, goalId })
  ok(sawModules.includes('web'), '调用 web 组把模块 key 报给了宿主', sawModules)
  await modTool.run(
    { description: '内容触发', body: "((api)=>{ return await api.node.invoke('n2', 'editContent', [{ teaching: '看图：\\n\\n```plot\\n{ \"data\": [] }\\n```' }]) })" },
    { nodeId: childId, goalId },
  )
  ok(sawModules.includes('plot-forms'), '写入 plot 围栏把数据形态模块报给了宿主', sawModules)

  // 引用 chip 的行为（learn/ops/chip）：build 生成必带 nodeId（点得开的保证）、
  // 编造的 path 拒绝生成、check 把坏 chip 逐颗点出来。
  const chipOk = await tool.run({ description: 'chip', body: "((api)=>{ return await api.chip.build({ type: 'doc', path: '微积分' }) })" }, { nodeId: childId, goalId })
  ok(chipOk.ok && chipOk.content.includes('nodeId') && chipOk.content.includes('n1'), 'chip.build 生成的 chip 带 nodeId（点得开的保证）', chipOk.content.slice(0, 180))
  const chipBad = await tool.run({ description: 'chip', body: "((api)=>{ return await api.chip.build({ type: 'doc', path: '【不存在】/教学' }) })" }, { nodeId: childId, goalId })
  ok(!chipBad.ok, 'chip.build 对编造的 path 拒绝生成', chipBad.content.slice(0, 160))
  const chipCk = await tool.run(
    { description: 'chip', body: "((api)=>{ return await api.chip.check('看：#[{type:\"doc\", path:\"不存在\"}]') })" },
    { nodeId: childId, goalId },
  )
  ok(chipCk.ok && chipCk.content.includes('"invalid":1'), 'chip.check 把定位不到的 chip 点出来', chipCk.content.slice(0, 220))
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
