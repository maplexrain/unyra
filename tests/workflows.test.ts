/**
 * 工作流登记表的单元用例：三级分级、同名覆盖、模板渲染、读回校验。
 *
 * 它的错误形态是「agent 登记了工作流，列表里却看不到 / 触发时指令占位符没被换」——
 * 这些都不报错，用户只会觉得「导师没听懂」。分级放错层则直接决定别的目标能不能用。
 */
import { describe, expect, it } from 'vitest'

import { emptyDocs } from '../src/learn/groups'
import { buildState } from '../src/learn/files'
import type { LearnStore } from '../src/learn/types'
import {
  BUILTIN_EFFORT,
  builtinWorkflowRows,
  findWorkflow,
  listWorkflowRows,
  normalizeWorkflowEfforts,
  normalizeWorkflowEntries,
  removeWorkflow,
  renderWorkflowInstruction,
  resolveWorkflowEffort,
  setWorkflowEffort,
  upsertWorkflow,
  workflowModules,
  workflowPrep,
  WORKFLOW_NAME_MAX,
} from '../src/learn/workflows'

const AT = 1700000000000

const store = (workflows?: LearnStore['workflows']): LearnStore => ({
  version: 2,
  nodes: [],
  edges: [],
  goals: [],
  conversations: [],
  exams: [],
  tmp: {},
  resources: {},
  activeGoalId: null,
  activeNodeId: null,
  activeConversationId: null,
  // 文档区：一组、没有页签（分割与分组见 learn/groups）
  docArea: emptyDocs(),
  drafts: {},
  docScroll: {},
  localFiles: [],
  ...(workflows ? { workflows } : {}),
})

describe('内置工作流', () => {
  it('十四个内置都在：开讲、学习大纲、生成大纲、回忆、探针、出卷、阅卷、了解、超级实验室、伪编译、压缩上下文、打卡、复习、浏览器操作', () => {
    const rows = builtinWorkflowRows()
    expect(rows.map((r) => r.id)).toEqual([
      'teach-node',
      'goal-outline',
      'outline',
      'recall',
      'probe',
      'exam',
      'exam-grade',
      'explain',
      'superlab',
      'code-compile',
      'compact',
      'checkin',
      'review',
      'browser-use',
    ])
    for (const r of rows) {
      expect(r.tier).toBe('builtin')
      expect(r.instruction.trim()).not.toBe('')
    }
    // 浏览器操作是看图干活的快流程：推荐档钉在 low（用户仍可在设置里覆盖）
    expect(BUILTIN_EFFORT['browser-use']).toBe('low')
  })

  it('问询类（开讲/出卷/超级实验室/打卡）触发前响铃切主位；阅卷不能从列表直接跑', () => {
    const rows = builtinWorkflowRows()
    const byId = new Map(rows.map((r) => [r.id, r]))
    // 第一步是「用 api.ask 问用户」的，都要 prep: 'ask'——表单压在输入框上方，
    // 用户盯着文档时既听不见也看不见，这两下让它被看见
    expect(byId.get('teach-node')?.prep).toBe('ask')
    expect(byId.get('superlab')?.prep).toBe('ask')
    // 出卷也进了这一档：类型与难度改由导师问用户（这次重构把界面上的选择拿掉了），
    // 于是它没有占位符、也从列表里可跑
    expect(byId.get('exam')?.prep).toBe('ask')
    expect(byId.get('exam')?.params).toBeUndefined()
    // 阅卷必须先有人交卷：从列表里空跑只会得到「没有需要讲解的考试」
    expect(byId.get('exam-grade')?.runnable).toBe(false)
    // 复习的 titles / stage / focus 只有顶栏的复习面板知道（到期阶段与合并组），列表里不开放
    expect(byId.get('review')?.runnable).toBe(false)
    expect(byId.get('review')?.prep).toBe('ask')
    expect(byId.get('review')?.params).toEqual(['titles', 'stage', 'focus'])
    expect(byId.get('recall')?.params).toContain('title')
    // 伪编译由代码块菜单触发（代码、语言、key 都是它给的），列表里没有可跑的入口；
    // 它的交付物在对话里，所以是 'show'——**响铃但不切主位**
    expect(byId.get('code-compile')?.runnable).toBe(false)
    expect(byId.get('code-compile')?.prep).toBe('show')
    expect(byId.get('code-compile')?.params).toEqual(['language', 'key', 'code'])
  })

  it('触发前只做响铃：带 prep 的响，没带的不响；主栏一概不动', () => {
    // 'ask'：第一步是一张压在输入框上方的表单，用户盯着文档时听不见——响一声提醒他
    expect(workflowPrep('ask')).toEqual({ beep: true })
    // 'show'（伪编译 / 了解）：交付物就在他盯着的地方，响一声让他知道结果在对话里
    expect(workflowPrep('show')).toEqual({ beep: true })
    // 没有 prep 的（回忆 / 探针 / 大纲 / 压缩 / 阅卷）：连铃都不响——那是用户自己点出来的
    expect(workflowPrep(undefined)).toEqual({ beep: false })
    // 内置表里对得上：会响铃的就是带 prep 的那几条
    const beeping = builtinWorkflowRows()
      .filter((r) => workflowPrep(r.prep).beep)
      .map((r) => r.id)
    expect(beeping).toEqual([
      'teach-node',
      'outline',
      'exam',
      'explain',
      'superlab',
      'code-compile',
      'checkin',
      'review',
    ])
    // 切主位那一条规矩随 api.ui.switchMain 一起撤了：谁都不许动用户的主栏
    expect(builtinWorkflowRows().some((r) => 'takeMain' in workflowPrep(r.prep))).toBe(false)
  })

  it('伪编译指令：三个占位符都被换掉，代码与围栏都在（这段文本是给模型看的）', () => {
    const row = builtinWorkflowRows().find((r) => r.id === 'code-compile')
    expect(row).toBeTruthy()
    const text = renderWorkflowInstruction(row?.instruction ?? '', {
      language: 'python',
      key: 'abc123def456',
      code: 'print(sum(xs))',
    })
    expect(text).toContain('语言标记：python')
    expect(text).toContain('key：abc123def456')
    expect(text).toContain('print(sum(xs))')
    // 占位符一个都不许剩下：剩下的会被模型当成正文抄进产物里
    expect(text).not.toContain('{{')
    // 代码块围栏要真的在（它是模型分辨「哪一段是待编译的代码」的凭据）
    expect(text).toContain('```')
    // 交货那条 api 必须点名，否则模型只会把代码贴在对话里
    expect(text).toContain('api.code.save')
    // 「没有输出就立刻停下」是这条工作流的第零步，而且点名了停下来的那条 api
    expect(text).toContain('第零步')
    expect(text).toContain('api.code.silent')
    expect(text.indexOf('api.code.silent')).toBeLessThan(text.indexOf('api.code.save'))
    // 主栏归用户：指令里不该再出现任何「切主位」的说法（那条 api 已经撤了）
    expect(text).not.toContain('switchMain')
  })

  it('了解指令：三个占位符都被换掉，交货那条 api 点名了、而且不打断他', () => {
    const row = builtinWorkflowRows().find((r) => r.id === 'explain')
    expect(row).toBeTruthy()
    // 词条、序号、选段都由触发方补齐：缺一样它就会去猜，而猜错的后果是注解标错地方
    expect(row?.params).toEqual(['term', 'occurrence', 'snippet'])
    expect(row?.runnable).toBe(false)
    expect(row?.prep).toBe('show')
    const text = renderWorkflowInstruction(row?.instruction ?? '', {
      term: '夹逼定理',
      occurrence: 2,
      snippet: '用夹逼定理可以求这个极限',
    })
    expect(text).toContain('夹逼定理')
    expect(text).toContain('2')
    expect(text).toContain('用夹逼定理可以求这个极限')
    // 占位符一个都不许剩下：剩下的会被模型当成正文抄进注解里
    expect(text).not.toContain('{{')
    // 交货那条 api 必须点名，否则模型只会把解释贴在对话里、正文上什么都不出现
    expect(text).toContain('api.doc.annotate')
    // 解释要挂在用户盯着的那段文字旁边，别把视线拽到对话栏（同伪编译）
    expect(text).not.toContain('switchMain')
  })
})

describe('登记与三级分级', () => {
  it('create 缺省落目标级；tier: global 落全局层', () => {
    const a = upsertWorkflow(store(), 'goal', 'g1', { name: '流程甲', instruction: '第一步' }, AT)
    expect(a.ok).toBe(true)
    if (!a.ok) return
    expect(a.store.workflows?.byGoal?.g1).toHaveLength(1)
    expect(a.store.workflows?.global).toHaveLength(0)

    const b = upsertWorkflow(a.store, 'global', 'g1', { name: '流程乙', instruction: '第二步' }, AT + 1)
    expect(b.ok).toBe(true)
    if (!b.ok) return
    expect(b.store.workflows?.global).toHaveLength(1)
    expect(b.store.workflows?.global?.[0].name).toBe('流程乙')
  })

  it('同名同级是覆盖（大小写不敏感）；不同级互不干扰', () => {
    let s = store()
    const r1 = upsertWorkflow(s, 'goal', 'g1', { name: '摸底', instruction: 'v1' }, AT)
    if (!r1.ok) return
    s = r1.store
    const r2 = upsertWorkflow(s, 'goal', 'g1', { name: '摸底', instruction: 'v2' }, AT + 1)
    if (!r2.ok) return
    s = r2.store
    expect(r2.updated).toBe(true)
    expect(s.workflows?.byGoal?.g1).toHaveLength(1)
    expect(s.workflows?.byGoal?.g1?.[0].instruction).toBe('v2')
    // 目标级已有的名字，全局层可以另有一条（查找顺序：内置 → 全局 → 目标级）
    const r3 = upsertWorkflow(s, 'global', 'g1', { name: '摸底', instruction: '全局版' }, AT + 2)
    if (!r3.ok) return
    s = r3.store
    const found = findWorkflow(s, 'g1', '摸底')
    expect(found?.tier).toBe('global')
  })

  it('校验：缺名、缺指令、名字超长都会被拒并给出原因', () => {
    expect(upsertWorkflow(store(), 'goal', 'g1', { instruction: 'x' }, AT).ok).toBe(false)
    expect(upsertWorkflow(store(), 'goal', 'g1', { name: '甲' }, AT).ok).toBe(false)
    const long = upsertWorkflow(store(), 'goal', 'g1', { name: '甲'.repeat(WORKFLOW_NAME_MAX + 1), instruction: 'x' }, AT)
    expect(long.ok).toBe(false)
    if (long.ok) return
    expect(long.error).toContain('最长')
  })
})

describe('查找与列表', () => {
  it('按 id 或名字都能找到（大小写不敏感），内置优先', () => {
    let s = store()
    const r = upsertWorkflow(s, 'goal', 'g1', { name: '开讲（自定义）', instruction: 'x' }, AT)
    if (!r.ok) return
    s = r.store
    // 与内置「开讲」不同名，id 查找有效
    expect(findWorkflow(s, 'g1', r.entry.id)?.name).toBe('开讲（自定义）')
    // 名字查找大小写不敏感
    expect(findWorkflow(s, 'g1', '开讲（自定义）'.toUpperCase())?.id).toBe(r.entry.id)
    // 内置按 id 与名字都找得到
    expect(findWorkflow(s, 'g1', 'teach-node')?.tier).toBe('builtin')
    expect(findWorkflow(s, 'g1', '开讲')?.tier).toBe('builtin')
  })

  it('listWorkflowRows 的目标级只属于给定目标；goalId 为空时没有目标级', () => {
    let s = store()
    const r1 = upsertWorkflow(s, 'goal', 'g1', { name: '目标一级', instruction: 'x' }, AT)
    if (!r1.ok) return
    s = r1.store
    const r2 = upsertWorkflow(s, 'global', 'g1', { name: '全局级', instruction: 'x' }, AT + 1)
    if (!r2.ok) return
    s = r2.store
    const withGoal = listWorkflowRows(s, 'g1')
    expect(withGoal.filter((r) => r.tier === 'goal').map((r) => r.name)).toEqual(['目标一级'])
    const withoutGoal = listWorkflowRows(s, null)
    expect(withoutGoal.some((r) => r.tier === 'goal')).toBe(false)
    expect(withoutGoal.some((r) => r.name === '全局级')).toBe(true)
  })
})

describe('删除与模板渲染', () => {
  it('removeWorkflow 按 id 删（全局与各级目标都找一遍）；没有就原样返回', () => {
    let s = store()
    const r = upsertWorkflow(s, 'global', 'g1', { name: '要删的', instruction: 'x' }, AT)
    if (!r.ok) return
    s = r.store
    const next = removeWorkflow(s, r.entry.id)
    expect(next.workflows?.global).toHaveLength(0)
    expect(removeWorkflow(s, '不存在的 id')).toBe(s)
  })

  it('renderWorkflowInstruction 换掉占位符；没给的占位符原样留下（不静默吞掉）', () => {
    expect(renderWorkflowInstruction('讲讲「{{title}}」，{{kind}} 卷', { title: '极限' })).toBe(
      '讲讲「极限」，{{kind}} 卷',
    )
    expect(renderWorkflowInstruction('没有占位符', undefined)).toBe('没有占位符')
    expect(renderWorkflowInstruction('{{kind}}', { kind: 'quiz' })).toBe('quiz')
  })
})

describe('读回校验 normalizeWorkflowEntries', () => {
  it('形状不对的丢掉、同名的只认第一份、id 缺失补一个', () => {
    const items = normalizeWorkflowEntries([
      { id: 'a', name: '甲', instruction: 'x' },
      { name: '缺指令' },
      { name: '甲', instruction: '重复的' },
      { name: '乙', instruction: 'y', createdAt: 1, updatedAt: 2 },
      '不是对象',
    ])
    expect(items.map((i) => i.name)).toEqual(['甲', '乙'])
    expect(items[1].id).not.toBe('')
    expect(items[1].createdAt).toBe(1)
  })

  it('不是数组给空', () => {
    expect(normalizeWorkflowEntries(null)).toEqual([])
    expect(normalizeWorkflowEntries('x')).toEqual([])
  })
})

describe('思考档位（三态配置）', () => {
  it('解析：内置没配走推荐档，登记没配跟随聊天；chat 用滑条值，固定档原样', () => {
    const created = upsertWorkflow(store(), 'global', 'g1', { name: '自定义甲', instruction: 'x' }, AT)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const rows = listWorkflowRows(created.store, 'g1')
    const teach = rows.find((x) => x.id === 'teach-node')
    const custom = rows.find((x) => x.id === created.entry.id)
    // 推荐档不冒充用户配置：行上没配就是没配（BUILTIN_EFFORT 才是推荐值的家）
    expect(teach?.effort).toBeUndefined()
    expect(custom?.effort).toBeUndefined()
    if (!teach || !custom) return
    // 内置没配 → 推荐档：开讲 high、超级实验室 max（表里最重的一档）
    expect(resolveWorkflowEffort(teach, 'max')).toBe('high')
    const superlab = rows.find((x) => x.id === 'superlab')
    if (superlab) expect(resolveWorkflowEffort(superlab, 'low')).toBe('max')
    // 登记的没配 → 跟随聊天；显式 'chat' 同
    expect(resolveWorkflowEffort(custom, 'medium')).toBe('medium')
    expect(resolveWorkflowEffort({ ...custom, effort: 'chat' }, 'low')).toBe('low')
    // 固定档原样
    expect(resolveWorkflowEffort({ ...custom, effort: 'max' }, 'low')).toBe('max')
  })

  it('配置与删除：setWorkflowEffort 落在全局 efforts 表；删工作流连键一起删；未知 id 原样返回', () => {
    const created = upsertWorkflow(store(), 'global', 'g1', { name: '自定义乙', instruction: 'x' }, AT)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // 内置也能配，列表行上立刻看得见
    const withBuiltin = setWorkflowEffort(created.store, 'probe', 'max')
    expect(withBuiltin.workflows?.efforts?.probe).toBe('max')
    expect(listWorkflowRows(withBuiltin, null).find((x) => x.id === 'probe')?.effort).toBe('max')
    // 登记的配了再删，键不残留（留键成幽灵）
    const withCustom = setWorkflowEffort(withBuiltin, created.entry.id, 'low')
    expect(withCustom.workflows?.efforts?.[created.entry.id]).toBe('low')
    const removed = removeWorkflow(withCustom, created.entry.id)
    expect(removed.workflows?.efforts?.[created.entry.id]).toBeUndefined()
    expect(removed.workflows?.efforts?.probe).toBe('max')
    // 未知 id / 空 id：原样返回（同一引用，没有假动作）
    expect(setWorkflowEffort(withBuiltin, 'wf_notexist', 'low')).toBe(withBuiltin)
    expect(setWorkflowEffort(withBuiltin, '', 'low')).toBe(withBuiltin)
  })

  it('读回校验 normalizeWorkflowEfforts：值不合法与幽灵键都剪掉', () => {
    const valid = new Set(['teach-node', 'wf_x'])
    const out = normalizeWorkflowEfforts(
      { 'teach-node': 'chat', wf_x: 'high', wf_ghost: 'low', nope: 'medium', wf_bad: 'ultra' },
      valid,
    )
    expect(out).toEqual({ 'teach-node': 'chat', wf_x: 'high' })
    expect(normalizeWorkflowEfforts(null, valid)).toEqual({})
  })

  it('落盘往返：buildState 写 efforts，空表不写；登记 / 覆盖不丢已有的配置', () => {
    const base = setWorkflowEffort(store(), 'teach-node', 'chat')
    const written = buildState(base)
    expect((written.workflows as { efforts?: Record<string, string> }).efforts).toEqual({ 'teach-node': 'chat' })
    // 空表不写：「这个字段存在」本身就是声明的那条纪律
    expect(buildState(store()).workflows).toBeUndefined()
    const r = upsertWorkflow(base, 'global', 'g1', { name: '丙', instruction: 'x' }, AT)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.store.workflows?.efforts?.['teach-node']).toBe('chat')
  })
  it('写教学文档的两条内置工作流，配方在动笔之前就注入（doc-html）', () => {
    const rows = builtinWorkflowRows()
    // 「开讲」与新目标的「学习大纲」是仅有的两条会写教学文档的内置工作流。
    // 它们必须带 promptModule：靠 doc.* 写入触发只会晚一轮，第一份文档就永远是纯 HTML 草稿。
    for (const id of ['teach-node', 'goal-outline']) {
      const row = rows.find((r) => r.id === id)
      expect(row, id).toBeTruthy()
      expect(row?.promptModule, id).toBe('doc-html')
      expect(workflowModules(row!).map((m) => m.key), id).toEqual(['doc-html'])
    }
    // 其余内置条目照旧：没配 promptModule 也没有 prompt 的就是空
    const probe = rows.find((r) => r.id === 'probe')!
    expect(workflowModules(probe)).toEqual([])
  })
})
