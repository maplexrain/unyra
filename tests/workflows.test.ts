/**
 * 工作流登记表的单元用例：三级分级、同名覆盖、模板渲染、读回校验。
 *
 * 它的错误形态是「agent 登记了工作流，列表里却看不到 / 触发时指令占位符没被换」——
 * 这些都不报错，用户只会觉得「导师没听懂」。分级放错层则直接决定别的目标能不能用。
 */
import { describe, expect, it } from 'vitest'

import { emptyDocs } from '../src/learn/groups'
import { WORKFLOWS_GUIDE } from '../src/learn/ai/workflowsGuide'
import { buildState } from '../src/learn/files'
import type { LearnStore } from '../src/learn/types'
import {
  builtinWorkflowRows,
  findWorkflow,
  listWorkflowRows,
  normalizeWorkflowEntries,
  removeWorkflow,
  renderWorkflowInstruction,
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
  it('内置工作流都在：开讲、生成大纲、出卷、阅卷、了解、超级实验室、修复函数图像、压缩上下文、浏览器操作、生成互动课堂（伪编译已退役）', () => {
    const rows = builtinWorkflowRows()
    expect(rows.map((r) => r.id)).toEqual([
      'teach-node',
      'outline',
      'outline-guide',
      'classroom',
      'exam',
      'exam-grade',
      'explain',
      'superlab',
      'plot-fix',
      'compact',
      'browser-use',
    ])
    for (const r of rows) {
      expect(r.tier).toBe('builtin')
      expect(r.instruction.trim()).not.toBe('')
    }
  })

  it('生成大纲：指令是标准函数调用，规程在系统提示词的 WORKFLOWS_GUIDE 里', () => {
    const row = builtinWorkflowRows().find((r) => r.id === 'outline')
    expect(row).toBeTruthy()
    expect(row?.params).toEqual(['target'])

    const text = renderWorkflowInstruction(row!.instruction, { target: '极限的定义' })
    expect(text).toBe('## 使用「生成大纲」工作流。\n- 目标节点: 极限的定义')

    // 内置规程随全量静态提示词在场（不再走模块注入）：大纲的落盘形状与层级规矩必须可见
    expect(WORKFLOWS_GUIDE).toContain('大纲编写与规划')
    expect(WORKFLOWS_GUIDE).toContain('editContent({ intro, children, guide })')
    expect(WORKFLOWS_GUIDE).toContain('直接子层级')
  })

  it('问询类（开讲/出卷/超级实验室）触发前响铃；阅卷不能从列表直接跑', () => {
    const rows = builtinWorkflowRows()
    const byId = new Map(rows.map((r) => [r.id, r]))
    // 第一步是「用 api.ask 问用户」的，都要 prep: 'ask'——表单压在输入框上方，
    // 用户盯着文档时既听不见也看不见，这两下让它被看见
    expect(byId.get('teach-node')?.prep).toBe('ask')
    expect(byId.get('superlab')?.prep).toBe('ask')
    // 出卷也进了这一档：类型与难度改由导师问用户（这次重构把界面上的选择拿掉了），
    // 于是它没有占位符、也从列表里可跑
    expect(byId.get('exam')?.prep).toBe('ask')
    expect(byId.get('exam')?.params).toEqual(['target'])
    // 阅卷必须先有人交卷：从列表里空跑只会得到「没有需要讲解的考试」
    expect(byId.get('exam-grade')?.runnable).toBe(false)
    // 修复函数图像由错误卡片触发（报错、区间、原文都由触发方算好），同样不可空跑；
    // 修复结果直接落在文档里，'show' 响一声即可
    expect(byId.get('plot-fix')?.runnable).toBe(false)
    expect(byId.get('plot-fix')?.prep).toBe('show')
    expect(byId.get('plot-fix')?.params).toEqual(['target', 'nodeTitle', 'reason', 'range', 'start', 'end', 'source'])
  })

  it('触发前只做响铃：带 prep 的响，没带的不响；主栏一概不动', () => {
    // 'ask'：第一步是一张压在输入框上方的表单，用户盯着文档时听不见——响一声提醒他
    expect(workflowPrep('ask')).toEqual({ beep: true })
    // 'show'（伪编译 / 了解）：交付物就在他盯着的地方，响一声让他知道结果在对话里
    expect(workflowPrep('show')).toEqual({ beep: true })
    // 没有 prep 的（大纲 / 压缩 / 阅卷 / 浏览器操作）：连铃都不响——那是用户自己点出来的
    expect(workflowPrep(undefined)).toEqual({ beep: false })
    // 内置表里对得上：会响铃的就是带 prep 的那几条
    const beeping = builtinWorkflowRows()
      .filter((r) => workflowPrep(r.prep).beep)
      .map((r) => r.id)
    expect(beeping).toEqual([
      'teach-node',
      'outline',
      'outline-guide',
      'classroom',
      'exam',
      'explain',
      'superlab',
      'plot-fix',
    ])
    // 切主位那一条规矩随 api.ui.switchMain 一起撤了：谁都不许动用户的主栏
    expect(builtinWorkflowRows().some((r) => 'takeMain' in workflowPrep(r.prep))).toBe(false)
  })

  it('了解指令：标准函数调用（四个参数整行列出），规程在 WORKFLOWS_GUIDE 里', () => {
    const row = builtinWorkflowRows().find((r) => r.id === 'explain')
    expect(row).toBeTruthy()
    // 目标节点、词条、序号与选段都由触发方补齐：缺一样它就会去猜，而猜错的后果是注解标错地方
    expect(row?.params).toEqual(['target', 'term', 'occurrence', 'snippet'])
    expect(row?.runnable).toBe(false)
    expect(row?.prep).toBe('show')
    const text = renderWorkflowInstruction(row?.instruction ?? '', {
      target: 'n1',
      term: '夹逼定理',
      occurrence: 2,
      snippet: '用夹逼定理可以求这个极限',
    })
    expect(text).toContain('## 使用「了解」工作流。')
    expect(text).toContain('- 目标节点: n1')
    expect(text).toContain('- 词条: 夹逼定理')
    expect(text).toContain('- 出现序号: 2')
    expect(text).toContain('- 选中原文: 用夹逼定理可以求这个极限')
    // 占位符一个都不许剩下：剩下的会被模型当成正文抄进注解里
    expect(text).not.toContain('{{')
    // 交货动作在规程里：注解走文档节点 content 的 annotations 字段（editContent 写回）
    expect(WORKFLOWS_GUIDE).toContain('c.annotations')
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

  it('renderWorkflowInstruction 换掉占位符；没给的参数整行省略（可选参数的标准语义）', () => {
    const NL = String.fromCharCode(10)
    expect(
      renderWorkflowInstruction('## 使用「X」工作流。' + NL + '- 标题: {{title}}' + NL + '- 类型: {{kind}}', { title: '极限' }),
    ).toBe('## 使用「X」工作流。' + NL + '- 标题: 极限')
    expect(renderWorkflowInstruction('没有占位符', undefined)).toBe('没有占位符')
    // 参数表整个没来 = 每个占位符都没等到：参数行逐行省，绝不把 {{占位符}} 原样发给模型
    expect(
      renderWorkflowInstruction('## 使用「X」工作流。' + NL + '- 标题: {{title}}', undefined),
    ).toBe('## 使用「X」工作流。')
    expect(renderWorkflowInstruction('{{kind}}', { kind: 'quiz' })).toBe('quiz')
    // 参数值里就算真有双大括号也不会被误当成占位符剔掉（判据是「参数表里没有的」占位符）
    const braces = 'a' + '{{x}}' + 'b'
    expect(renderWorkflowInstruction('代码：{{code}}', { code: braces })).toContain('{{x}}')
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

describe('思考档位唯一性（三态配置已删）', () => {
  it('工作流行不再带档位字段；state.json 也不再写 efforts（旧键读回即弃、下次落盘消失）', () => {
    for (const r of builtinWorkflowRows()) expect('effort' in r).toBe(false)
    expect(buildState(store()).workflows).toBeUndefined()
  })
  it('写教学文档的配方随系统提示词静态在场；内置工作流不再注入规程模块', () => {
    const rows = builtinWorkflowRows()
    // 内置条目一律不带 promptModule（规程全在 WORKFLOWS_GUIDE，2026-11 全量静态重构）
    for (const r of rows) expect('promptModule' in r).toBe(false)
    // 排版配方（doc-html）随系统提示词在场——首份文档就不是纯文本草稿（v0.5.8 踩过）
    expect(WORKFLOWS_GUIDE).toContain('文档排版与视觉呈现')
    // workflowModules 只服务登记工作流的 prompt 字段；内置条目现在是空
    const teach = rows.find((r) => r.id === 'teach-node')!
    expect(workflowModules(teach)).toEqual([])
    const withPrompt = workflowModules({ id: 'wf1', name: '课前摸底', prompt: '第一步：摸底' })
    expect(withPrompt.map((m) => m.key)).toEqual(['wf:wf1'])
  })
})
