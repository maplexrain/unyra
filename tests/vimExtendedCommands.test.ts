// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  executeVimCommand,
  setGlobalTabOperations,
  setVimEditorBridge,
  type GlobalTabOperations,
} from '../src/lib/vimCommands'
import {
  buildOpenTargets,
  matchOpenTargets,
  setOpenTargetsProvider,
  type VimOpenTarget,
} from '../src/lib/vimOpenTargets'
import { VIM_COMMANDS_DATA } from '../src/components/learn/vim/vimCheatSheetData'
import { VIM_COMMANDS } from '../src/lib/vimCommandCatalog'

describe('扩展 Vim 命令与纯净阅读模式测试 (vimExtendedCommands)', () => {
  let pureState = false
  let switchedToEdit = false
  let switchedToView = false
  let wrapEnabled = false
  let openedUrl: string | null = null
  let activeTab: { id: string; title: string; kind: string; view?: string } | null = null

  const mockOps: GlobalTabOperations = {
    closeTab: () => {},
    closeOtherTabs: () => {},
    switchToEdit: () => {
      if (!activeTab) {
        return { success: false, message: '[当前无活动页签]' }
      }
      if (activeTab.kind === 'settings' || activeTab.kind === 'web') {
        return { success: false, message: '[当前页面内容不可编辑]' }
      }
      if (activeTab.view === 'source') {
        return { success: true, message: '[当前已是编辑模式]' }
      }
      switchedToEdit = true
      return { success: true, message: '[已切换至编辑模式]' }
    },
    switchToView: () => {
      if (!activeTab) {
        return { success: false, message: '[当前无活动页签]' }
      }
      if (activeTab.kind === 'settings' || activeTab.kind === 'web') {
        return { success: false, message: '[当前页面不支持浏览模式]' }
      }
      if (activeTab.view === 'preview') {
        return { success: true, message: '[当前已是浏览模式]' }
      }
      switchedToView = true
      return { success: true, message: '[已切换至浏览模式]' }
    },
    setPure: (p: boolean) => {
      pureState = p
    },
    isPure: () => pureState,
    togglePure: () => {
      pureState = !pureState
      return pureState
    },
    openWebTab: (url?: string) => {
      openedUrl = url ?? ''
    },
  }

  beforeEach(() => {
    pureState = false
    switchedToEdit = false
    switchedToView = false
    wrapEnabled = false
    openedUrl = null
    activeTab = null
    setGlobalTabOperations(mockOps)
    setVimEditorBridge({
      onSetWrap: (enable) => {
        wrapEnabled = enable
      },
      isWrapEnabled: () => wrapEnabled,
    })
  })

  describe(':edit / :e 切换为编辑模式', () => {
    it('当前无活动页签时报错', () => {
      activeTab = null
      const res = executeVimCommand(':edit')
      expect(res.success).toBe(false)
      expect(res.message).toContain('无活动页签')
    })

    it('当前页签不可编辑（如设置页签）时报错', () => {
      activeTab = {
        id: 'settings-1',
        title: '设置',
        kind: 'settings',
      }
      const res = executeVimCommand(':edit')
      expect(res.success).toBe(false)
      expect(res.message).toContain('不可编辑')
    })

    it('当前页签为预览态的笔记，成功切换为编辑模式', () => {
      activeTab = {
        id: 'note-1',
        title: '我的笔记',
        kind: 'note',
        view: 'preview',
      }
      const res = executeVimCommand(':edit')
      expect(res.success).toBe(true)
      expect(res.message).toContain('编辑模式')
      expect(switchedToEdit).toBe(true)
    })

    it('当前页签已处于编辑模式时给出反馈', () => {
      activeTab = {
        id: 'note-1',
        title: '我的笔记',
        kind: 'note',
        view: 'source',
      }
      const res = executeVimCommand(':e')
      expect(res.success).toBe(true)
      expect(res.message).toContain('已是编辑模式')
    })
  })

  describe(':view / :read 切换为浏览模式', () => {
    it('当前页签为源码态的笔记，成功切换为浏览模式', () => {
      activeTab = {
        id: 'note-1',
        title: '我的笔记',
        kind: 'note',
        view: 'source',
      }
      const res = executeVimCommand(':view')
      expect(res.success).toBe(true)
      expect(res.message).toContain('浏览模式')
      expect(switchedToView).toBe(true)
    })

    it(':read 别名同样能切换为浏览模式', () => {
      activeTab = {
        id: 'note-1',
        title: '我的笔记',
        kind: 'note',
        view: 'source',
      }
      const res = executeVimCommand(':read')
      expect(res.success).toBe(true)
      expect(switchedToView).toBe(true)
    })

    it('当前已是浏览模式给出提示', () => {
      activeTab = {
        id: 'note-1',
        title: '我的笔记',
        kind: 'note',
        view: 'preview',
      }
      const res = executeVimCommand(':view')
      expect(res.success).toBe(true)
      expect(res.message).toContain('已是浏览模式')
    })
  })

  describe(':wrap / :nowrap 控制自动换行', () => {
    it(':wrap 开启自动换行', () => {
      wrapEnabled = false
      const res = executeVimCommand(':wrap')
      expect(res.success).toBe(true)
      expect(res.message).toContain('开启自动换行')
      expect(wrapEnabled).toBe(true)
    })

    it(':nowrap 关闭自动换行', () => {
      wrapEnabled = true
      const res = executeVimCommand(':nowrap')
      expect(res.success).toBe(true)
      expect(res.message).toContain('关闭自动换行')
      expect(wrapEnabled).toBe(false)
    })

    it(':set wrap 与 :set nowrap 兼容标准 Vim 选项语法', () => {
      executeVimCommand(':set wrap')
      expect(wrapEnabled).toBe(true)
      executeVimCommand(':set nowrap')
      expect(wrapEnabled).toBe(false)
    })
  })

  describe('Vim 命令大全与唯一真实来源验证', () => {
    it('VIM_COMMANDS_DATA 自动包含所有 catalog 中的命令（单一来源一体化）', () => {
      for (const cmd of VIM_COMMANDS) {
        const item = VIM_COMMANDS_DATA.find((d) => d.id === `moji-${cmd.cmd}`)
        expect(item).toBeDefined()
        expect(item?.keys).toContain(`:${cmd.cmd}`)
      }
    })
  })

  describe(':browser / :web 打开网页页签', () => {
    it(':browser 不带参数打开空白/导航页签', () => {
      const res = executeVimCommand(':browser')
      expect(res.success).toBe(true)
      expect(res.message).toContain('打开浏览器页签')
      expect(openedUrl).toBe('')
    })

    it(':browser 携带完整 URL 参数打开对应网页', () => {
      const res = executeVimCommand(':browser https://github.com')
      expect(res.success).toBe(true)
      expect(openedUrl).toBe('https://github.com')
    })

    it(':web 缺少协议前缀时自动补齐 https://', () => {
      const res = executeVimCommand(':web www.baidu.com')
      expect(res.success).toBe(true)
      expect(openedUrl).toBe('https://www.baidu.com')
    })
  })

  describe(':fullscreen / :exitfullscreen 控制纯净阅读模式', () => {
    it(':fullscreen 进入纯净阅读模式', () => {
      pureState = false
      const res = executeVimCommand(':fullscreen')
      expect(res.success).toBe(true)
      expect(res.message).toContain('进入纯净阅读模式')
      expect(pureState).toBe(true)
    })

    it(':fs 别名同样能进入纯净阅读模式', () => {
      pureState = false
      const res = executeVimCommand(':fs')
      expect(res.success).toBe(true)
      expect(pureState).toBe(true)
    })

    it(':exitfullscreen 退出纯净阅读模式', () => {
      pureState = true
      const res = executeVimCommand(':exitfullscreen')
      expect(res.success).toBe(true)
      expect(res.message).toContain('退出纯净阅读模式')
      expect(pureState).toBe(false)
    })

    it(':unfs 别名同样能退出纯净阅读模式', () => {
      pureState = true
      const res = executeVimCommand(':unfs')
      expect(res.success).toBe(true)
      expect(pureState).toBe(false)
    })
  })

  describe(':open / :o 与拼音匹配检索 (vimOpenTargets)', () => {
    const executed: string[] = []

    const mockTargets: VimOpenTarget[] = [
      {
        id: 'target-1',
        title: '词性九类与判定方法',
        subtitle: '教学文档 · 英语语法',
        badge: '教学文档',
        kind: 'teaching',
        action: () => executed.push('target-1'),
      },
      {
        id: 'target-2',
        title: '英语语法',
        subtitle: '目标大纲',
        badge: '大纲导读',
        kind: 'outline',
        action: () => executed.push('target-2'),
      },
      {
        id: 'target-3',
        title: '定语从句复习笔记',
        subtitle: '笔记',
        badge: '笔记',
        kind: 'note',
        action: () => executed.push('target-3'),
      },
      {
        id: 'target-4',
        title: '设置',
        subtitle: '首选项与快捷键',
        badge: '设置',
        kind: 'settings',
        action: () => executed.push('target-4'),
      },
      {
        id: 'target-5',
        title: '模型与 API 用量',
        subtitle: 'Token 与费用统计',
        badge: '用量',
        kind: 'usage',
        action: () => executed.push('target-5'),
      },
    ]

    beforeEach(() => {
      executed.length = 0
      setOpenTargetsProvider(() => mockTargets)
    })

    it('matchOpenTargets 空查询返回全部目标', () => {
      const res = matchOpenTargets(mockTargets, '')
      expect(res.length).toBe(mockTargets.length)
    })

    it('matchOpenTargets 支持汉字直搜', () => {
      const res = matchOpenTargets(mockTargets, '定语')
      expect(res.length).toBe(1)
      expect(res[0].id).toBe('target-3')
    })

    it('matchOpenTargets 支持拼音首字母缩写检索', () => {
      // cx -> 词性九类与判定方法
      const res = matchOpenTargets(mockTargets, 'cx')
      expect(res.length).toBeGreaterThanOrEqual(1)
      expect(res[0].id).toBe('target-1')
    })

    it('matchOpenTargets 支持全拼检索', () => {
      // cixing -> 词性九类与判定方法
      const res = matchOpenTargets(mockTargets, 'cixing')
      expect(res.length).toBeGreaterThanOrEqual(1)
      expect(res[0].id).toBe('target-1')

      // shezhi -> 设置
      const res2 = matchOpenTargets(mockTargets, 'shezhi')
      expect(res2.length).toBeGreaterThanOrEqual(1)
      expect(res2[0].id).toBe('target-4')
    })

    it('executeVimCommand :open 执行匹配到的目标', () => {
      const res = executeVimCommand(':open cx')
      expect(res.success).toBe(true)
      expect(res.message).toContain('词性九类与判定方法')
      expect(executed).toEqual(['target-1'])
    })

    it('executeVimCommand :o 别名执行目标', () => {
      const res = executeVimCommand(':o shezhi')
      expect(res.success).toBe(true)
      expect(res.message).toContain('设置')
      expect(executed).toEqual(['target-4'])
    })

    it('executeVimCommand :open 未找到匹配目标时报错', () => {
      const res = executeVimCommand(':open xyz12345不存在')
      expect(res.success).toBe(false)
      expect(res.message).toContain('未找到')
      expect(executed.length).toBe(0)
    })

    it('executeVimCommand :open 不带参数提示输入关键词', () => {
      const res = executeVimCommand(':open')
      expect(res.success).toBe(false)
      expect(res.message).toContain('请输入要打开的目标')
    })

    it('buildOpenTargets 从 LearnStore 正确采集各类目标', () => {
      const dummyStore: any = {
        activeGoalId: 'g1',
        nodes: [
          {
            id: 'n1',
            goalId: 'g1',
            title: '英语核心词',
            notes: [{ name: '核心笔记' }],
            superdocs: [{ name: '语法大辞典' }],
          },
        ],
        fileNodes: [{ id: 'fn-1', goalId: 'g1', title: '参考资料', url: '/docs/ref.pdf' }],
        exams: [{ id: 'e1', goalId: 'g1', nodeId: 'n1', title: '阶段测试', attempts: [{ id: 'att-1', score: 95 }] }],
        videoNodes: [{ id: 'vn-1', goalId: 'g1', title: '生动讲解视频' }],
        docArea: {
          groups: [
            {
              id: 'g-1',
              tabs: [{ id: 't-1', ref: { kind: 'ws', nodeId: 'n1', seg: 'src/main.rs' } }],
            },
          ],
        },
      }

      let openedKind = ''
      const targets = buildOpenTargets({
        store: dummyStore,
        openTab: (ref) => {
          openedKind = ref.kind
        },
        openExam: () => {},
        openExamCopy: () => {},
        newExam: () => {},
      })

      // 验证包含了教学文档、大纲导读、笔记、考试记录、超级文档、视频、文件、项目文件、设置、用量、考试等各品类
      expect(targets.some((t) => t.kind === 'teaching')).toBe(true)
      expect(targets.some((t) => t.kind === 'outline')).toBe(true)
      expect(targets.some((t) => t.kind === 'guide')).toBe(true)
      expect(targets.some((t) => t.kind === 'note')).toBe(true)
      expect(targets.some((t) => t.kind === 'examRecord')).toBe(true)
      expect(targets.some((t) => t.kind === 'superdoc')).toBe(true)
      expect(targets.some((t) => t.kind === 'video')).toBe(true)
      expect(targets.some((t) => t.kind === 'file')).toBe(true)
      expect(targets.some((t) => t.kind === 'ws')).toBe(true)
      expect(targets.some((t) => t.kind === 'settings')).toBe(true)
      expect(targets.some((t) => t.kind === 'usage')).toBe(true)
      expect(targets.some((t) => t.kind === 'examWindow')).toBe(true)

      // 验证点击动作正常触发
      const noteTarget = targets.find((t) => t.kind === 'note')
      noteTarget?.action()
      expect(openedKind).toBe('note')
    })
  })
})
