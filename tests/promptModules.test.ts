/**
 * 提示词模块与首轮系统提示词的单元用例（见 src/learn/ai/promptModules.ts）。
 *
 * 钉的是这套架构的四个关键面：
 * 1. **注册表自洽**：内容形态模块（doc-html / plot-forms / rich-animation）key 唯一、文本非空；
 * 2. **去重判据**：只认活着的消息（retired 的不算——压缩后模块必须能重新注入）；
 * 3. **模块消息形态**：声明归 assistant 边（hidden + inject: 'prompt'），promptModule 供去重；
 * 4. **系统提示词的体积纪律**：API 速查由注册表生成「签名 + 边界」紧凑版（不是全量手册），
 *    工作流规程集中在 WORKFLOWS_GUIDE——锁住它防止内容悄悄膨胀回去。
 */
import { describe, expect, it } from 'vitest'

import type { ConversationMessage } from '../src/agent/types'
import { buildWorkSystem } from '../src/learn/ai/workSystem'
import {
  PROMPT_MODULES,
  missingPromptModules,
  promptModuleMessage,
  promptModuleTitleOf,
} from '../src/learn/ai/promptModules'

const AT = 1700000000000

const userMsg = (extra: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: Math.random().toString(36).slice(2),
  role: 'user',
  parts: [{ type: 'text', text: '你好' }],
  ts: AT,
  ...extra,
})

describe('模块注册表（内容形态规范）', () => {
  it('三份内容形态模块在场：key 唯一、标题与文本都非空，且没有任何模块还在教 iwanna（它已删除）', () => {
    const keys = PROMPT_MODULES.map((m) => m.key).sort()
    expect(keys).toEqual(['doc-html', 'plot-forms', 'rich-animation'])
    for (const m of PROMPT_MODULES) {
      expect(m.title.trim()).not.toBe('')
      expect(m.text.trim().length).toBeGreaterThan(80)
      expect(m.text).not.toContain('iwanna')
    }
  })

  it('doc-html 不再承载图表与静态配方：图表分流与 component 围栏动态获取', () => {
    const docHtml = PROMPT_MODULES.find((m) => m.key === 'doc-html')!
    // 图表一律走围栏（各有专节），HTML 配方不手写 SVG / 柱状图——体积纪律
    expect(docHtml.text).toContain('```plot')
    expect(docHtml.text).toContain('```pisc')
    expect(docHtml.text).toContain('```mermaid')
    // 静态配方已撤出，改为 ```component 围栏与 api.design.component 动态查询
    expect(docHtml.text).toContain('```component')
    expect(docHtml.text).toContain('api.design.component.list')
  })

  it('旧规程模块已退役（2026-11 全量静态重构：规程在 WORKFLOWS_GUIDE，不在注册表）', () => {
    for (const key of ['browser', 'web', 'res', 'exam', 'teach-method', 'outline-method', 'workspace', 'method', 'code', 'compact', 'subagent', 'ui', 'schedule', 'sdoc']) {
      expect(PROMPT_MODULES.some((m) => m.key === key), key).toBe(false)
    }
  })
})

describe('promptModuleTitleOf（界面显示）', () => {
  it('已知模块给标题；登记工作流的 prompt 模块给通用名；未知 key 回 null', () => {
    expect(promptModuleTitleOf('doc-html')).toBe('文档排版与视觉呈现')
    expect(promptModuleTitleOf('plot-forms')).toBe('函数图像的数据形态')
    expect(promptModuleTitleOf('rich-animation')).toBe('富媒体动画写法')
    expect(promptModuleTitleOf('wf:abc')).toBe('工作流规程')
    // 老对话的历史残留（已退役的模块 key）回 null，调用方回退 key 本身
    expect(promptModuleTitleOf('browser')).toBeNull()
    expect(promptModuleTitleOf('不存在的')).toBeNull()
  })
})

describe('去重判据', () => {
  it('消息级标记（工作流轮开始注入的形态）算已注入', () => {
    const msgs = [userMsg({ promptModule: 'wf:abc' })]
    expect(missingPromptModules(msgs, ['wf:abc', 'wf:abc', 'doc-html'])).toEqual(['doc-html'])
  })

  it('回复里的 prompt-module 片段（mid-loop 边界注入的形态）也算已注入', () => {
    const msgs = [
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [{ type: 'prompt-module' as const, key: 'doc-html', text: '规范全文' }],
        ts: AT,
      },
    ]
    expect(missingPromptModules(msgs, ['doc-html', 'plot-forms'])).toEqual(['plot-forms'])
  })

  it('retired 的不算数：被压缩折掉的模块要能重新注入（两种形态同一条规矩）', () => {
    const msgs = [
      userMsg({ promptModule: 'doc-html', retired: true }),
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [{ type: 'prompt-module' as const, key: 'plot-forms', text: '规范全文' }],
        ts: AT,
        retired: true,
      },
    ]
    expect(missingPromptModules(msgs, ['doc-html', 'plot-forms'])).toEqual(['doc-html', 'plot-forms'])
  })

  it('普通用户消息与没有标记的隐藏消息都不影响判定', () => {
    const msgs = [userMsg(), userMsg({ hidden: true, mark: '回忆' })]
    expect(missingPromptModules(msgs, ['doc-html', 'plot-forms'])).toEqual(['doc-html', 'plot-forms'])
  })
})

describe('模块消息', () => {
  it('隐藏 assistant 消息（提示词=声明归 assistant 边）：mark 是过程组文案、promptModule 供去重、正文是模块全文', () => {
    const mod = PROMPT_MODULES.find((m) => m.key === 'doc-html')!
    const m = promptModuleMessage(mod, 'uuid-1', AT)
    expect(m.role).toBe('assistant')
    expect(m.hidden).toBe(true)
    expect(m.promptModule).toBe('doc-html')
    expect(m.mark).toContain('文档排版与视觉呈现')
    expect(m.parts[0]).toEqual({ type: 'text', text: mod.text })
  })
})

describe('work 系统提示词（紧凑静态注入；role 不再背执行细节）', () => {
  const system = buildWorkSystem('tutor')

  it('沙箱 API 速查由注册表生成：签名 + 一句话作用在场，全量手册的旧标题不在', () => {
    // 导师 work 的领域面：节点 / 日程 / 工作区都在
    expect(system).toContain('api.node — 节点宇宙')
    expect(system).toContain('api.schedule')
    expect(system).toContain('api.work')
    expect(system).toContain('api.host — 宿主交付')
    expect(system).not.toContain('api.chat')
    expect(system).toContain('api.workspace')
    // 团队分工：联网与浏览器归调研员、判卷归命题官——这些组不在导师 work 的速查里
    expect(system).not.toContain('#### api.exam')
    expect(system).not.toContain('#### api.classroom')
    expect(system).not.toContain('#### api.browser')
    // 具体签名在场（完整用法边界与 trap 走 __help，不首屏铺开）
    expect(system).toContain('node.list()')
    expect(system).toContain('node.get(uuid)')
    expect(system).toContain('workspace.write')
    expect(system).toContain('只在压缩轮调用')
    expect(system).toContain('先读后写')
    // 全量手册（示例围栏堆砌）已退役——瘦身验收线
    expect(system).not.toContain('沙箱全部 API 完整参考手册与示例')
    expect(system).not.toContain('示例代码：')
  })

  it('工作流规程按声部分工拼进系统提示词（教学主线在导师、课件实验分给设计师）', () => {
    expect(system).toContain('教学文档生成')
    expect(system).toContain('大纲编写与规划')
    expect(system).toContain('长会话交接摘要')
    // 分出去的域：导师 work 的规程节里不再出现
    expect(system).not.toContain('【出卷】试卷命题（exam）')
    expect(system).not.toContain('【超级实验室】可交互超级文档（superlab）')
    expect(system).toContain('api.node.finish')
    const examiner = buildWorkSystem('examiner')
    expect(examiner).toContain('试卷命题')
    expect(examiner).toContain('api.exam.grade')
    expect(examiner).not.toContain('api.classroom.schema')
    const designer = buildWorkSystem('designer')
    expect(designer).toContain('超级实验室')
    expect(designer).toContain('api.classroom.schema')
  })

  it('排版配方与语法指南在场（component 围栏与动态 api 版）', () => {
    expect(system).toContain('排版层级与基础规范')
    expect(system).toContain('```component')
    // 旧排版指南已整体替掉，不能再与新 content_layout 并存
    expect(system).not.toContain('### 结构化教学排版组件')
    expect(system).not.toContain('## 文档排版与视觉呈现')
    expect(system).toContain('api.design.component.list')
    expect(system).toContain('```plot')
    expect(system).toContain('```quote')
    expect(system).toContain('```mermaid')
    expect(system).toContain('```videos')
  })

  it('引用与交付登记的 SSOT 段在场：chip 生成 / 文档引证 / delivery 账各说一遍', () => {
    expect(system).toContain('引用与交付登记纪律')
    expect(system).toContain('api.chip.build')
    expect(system).toContain('## 📚 参考资料与权威来源')
    expect(system).toContain('api.delivery.submit')
  })

  it('每轮必用的核心纪律与原则完整在场', () => {
    expect(system).toContain('execute')
    expect(system).toContain('rexecute')
    expect(system).toContain('写操作失败不抛异常')
    expect(system).toContain('应用数据一律走速查列出的 api 组')
    expect(system).toContain('userInfo.get()')
    expect(system).toContain('按名直接调用')
    expect(system).toContain('需求解耦')
    expect(system).not.toContain('iwanna')
  })

  it('非固定组改为紧凑签名，不再内嵌完整 group usage', () => {
    const marker = '工作区是用户交付物的落点'
    expect(system).not.toContain(marker)
    expect(system).toContain('workspace.list')
  })

  it('所有内容生成声部（tutor / examiner / designer）共用排版指南与 component 语法', () => {
    const tutor = buildWorkSystem('tutor')
    const examiner = buildWorkSystem('examiner')
    const designer = buildWorkSystem('designer')
    for (const sys of [tutor, examiner, designer]) {
      expect(sys).toContain('```component')
      expect(sys).toContain('api.design.component.list')
      expect(sys).toContain('排版层级与基础规范')
    }
  })
})
