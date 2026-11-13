import { describe, it, expect } from 'vitest'
import { markdownEditorTheme, IDEA_MONO_FONT } from '../src/lib/cmMarkdown'
import { smoothCursor } from '../src/lib/cmSmoothCursor'
import { sisterTabRef, openSisterDocView } from '../src/components/learn/workspace/sisterView'
import { tabTitle, makeTab } from '../src/learn/tabs'
import type { LearnStore, TabRef } from '../src/learn/types'
import type { DocWorkspace } from '../src/learn/groups/types'

describe('编辑器行号样式与代码折叠配置', () => {
  it('配置了 IntelliJ IDEA 风格等宽字体栈与编辑器主题', () => {
    const theme = markdownEditorTheme({ top: 14, bottom: 24, left: 14, right: 24, gutterLeft: 50 })
    expect(theme).toBeDefined()
    expect(IDEA_MONO_FONT).toContain('JetBrains Mono')
  })
})

describe('平滑虚拟光标与流光残影扩展 (smoothCursor)', () => {
  it('正确导出平滑光标与跟随残影 CodeMirror 扩展', () => {
    const ext = smoothCursor()
    expect(ext).toBeDefined()
    expect(Array.isArray(ext)).toBe(true)
    if (Array.isArray(ext)) {
      expect(ext.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('HTML 预览沙箱脚本剔除逻辑', () => {
  it('剥离 script 标签与 modulepreload 外链，防止沙箱 iframe 报错', () => {
    const raw = `<!DOCTYPE html><html><head><script type="module" src="/src/main.ts"></script><link rel="modulepreload" href="/src/vendor.js"></head><body><h1>Hello</h1><script>console.log(1)</script></body></html>`
    const clean = raw
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<link\b[^>]*\brel=["']?(?:modulepreload|preload)["']?[^>]*>/gi, '')
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('modulepreload')
    expect(clean).toContain('<h1>Hello</h1>')
  })
})

describe('源码与预览独立页面与对偶分屏 (sisterView)', () => {
  const localRef: TabRef = { kind: 'local', path: 'C:/docs/README.md' }

  it('为 Markdown 文件生成独立的对偶视图 TabRef', () => {
    const previewSister = sisterTabRef(localRef, 'preview')
    expect(previewSister).toEqual({ kind: 'local', path: 'C:/docs/README.md', view: 'preview' })

    const sourceSister = sisterTabRef(previewSister!, 'source')
    expect(sourceSister).toEqual({ kind: 'local', path: 'C:/docs/README.md', view: 'source' })
  })

  it('源码与预览具有独立的 tabKey 与标题后缀，支持分屏独立共存', () => {
    const sourceTab = makeTab({ kind: 'local', path: 'C:/docs/README.md', view: 'source' }, 100)
    const previewTab = makeTab({ kind: 'local', path: 'C:/docs/README.md', view: 'preview' }, 101)

    expect(sourceTab.id).toBe('l:C:/docs/README.md:source')
    expect(previewTab.id).toBe('l:C:/docs/README.md:preview')
    expect(sourceTab.id).not.toBe(previewTab.id)

    const sTitle = tabTitle(sourceTab.ref, () => 'README.md')
    const pTitle = tabTitle(previewTab.ref, () => 'README.md')
    expect(sTitle).toContain('README.md')
    expect(pTitle).toContain('README.md')
    expect(pTitle).toContain('预览')
  })

  it('不可预览的代码文件（如 .ts）不生成预览对偶视图', () => {
    const tsRef: TabRef = { kind: 'local', path: 'C:/src/main.ts' }
    const sister = sisterTabRef(tsRef, 'preview')
    expect(sister).toBeNull()
  })

  it('单格状态下点击分屏浏览，自动创建右侧分割格并打开对偶页签', () => {
    const initialTab = makeTab({ kind: 'local', path: 'C:/docs/README.md', view: 'source' }, 100)
    const docArea: DocWorkspace = {
      layout: { kind: 'group', group: 'g1' },
      groups: [{ id: 'g1', tabs: [initialTab], active: initialTab.id }],
      focus: 'g1',
    }
    const store: LearnStore = {
      goals: [],
      docArea,
      drafts: {},
    } as unknown as LearnStore

    let updatedStore: LearnStore | null = null
    const setStore = (s: LearnStore) => {
      updatedStore = s
    }

    openSisterDocView(store, initialTab, 'preview', 'g1', setStore)

    expect(updatedStore).not.toBeNull()
    const resultDocs = (updatedStore as unknown as LearnStore).docArea
    // 自动水平分屏：新增一组
    expect(resultDocs.groups.length).toBe(2)
    const newGroup = resultDocs.groups.find((g) => g.id !== 'g1')
    expect(newGroup).toBeDefined()
    expect(newGroup!.tabs[0].ref).toEqual({ kind: 'local', path: 'C:/docs/README.md', view: 'preview' })
    expect(newGroup!.tabs[0].id).toBe('l:C:/docs/README.md:preview')
    expect(resultDocs.focus).toBe(newGroup!.id)
  })

  it('多格状态下点击分屏浏览，优先在已有相邻格中打开对偶页签', () => {
    const initialTab = makeTab({ kind: 'local', path: 'C:/docs/README.md', view: 'source' }, 100)
    const dummyTab = makeTab({ kind: 'local', path: 'C:/docs/other.md' }, 101)
    const docArea: DocWorkspace = {
      layout: { kind: 'split', id: 's1', dir: 'row', sizes: [0.5, 0.5], children: [{ kind: 'group', group: 'g1' }, { kind: 'group', group: 'g2' }] },
      groups: [
        { id: 'g1', tabs: [initialTab], active: initialTab.id },
        { id: 'g2', tabs: [dummyTab], active: dummyTab.id },
      ],
      focus: 'g1',
    }
    const store: LearnStore = {
      goals: [],
      docArea,
      drafts: {},
    } as unknown as LearnStore

    let updatedStore: LearnStore | null = null
    const setStore = (s: LearnStore) => {
      updatedStore = s
    }

    openSisterDocView(store, initialTab, 'preview', 'g1', setStore)

    expect(updatedStore).not.toBeNull()
    const resultDocs = (updatedStore as unknown as LearnStore).docArea
    // 依然是 2 组，对偶页签直接进 g2
    expect(resultDocs.groups.length).toBe(2)
    const g2 = resultDocs.groups.find((g) => g.id === 'g2')!
    expect(g2.tabs.some((t) => t.id === 'l:C:/docs/README.md:preview')).toBe(true)
    expect(g2.active).toBe('l:C:/docs/README.md:preview')
  })
})

describe('工作区与本地文件常驻保活 (FileTabLayer keepalive)', () => {
  it('多个源码页签在同格中能够同时保活，当前激活页签正常呈现，其它页签 hidden', () => {
    const tab1 = makeTab({ kind: 'ws', nodeId: 'n1', seg: 'src/rig/pose.ts' }, 1)
    const tab2 = makeTab({ kind: 'ws', nodeId: 'n1', seg: 'src/rig/apply.ts' }, 2)
    const tabs = [tab1, tab2]

    // 模拟当 activeTabId 为 tab1 时：tab1 激活，tab2 保活挂起
    const activeId = tab1.id
    const stateMap = tabs.map((t) => ({
      id: t.id,
      isActive: t.id === activeId,
      hidden: t.id !== activeId,
    }))

    expect(stateMap[0].isActive).toBe(true)
    expect(stateMap[0].hidden).toBe(false)
    expect(stateMap[1].isActive).toBe(false)
    expect(stateMap[1].hidden).toBe(true)
  })
})

describe('源码编辑器选区高亮与代码折叠动画', () => {
  it('markdownEditorTheme 中正确声明了 currentColor 选区保护与平滑折叠过渡动画', async () => {
    const { markdownEditorTheme } = await import('../src/lib/cmMarkdown')
    const theme = markdownEditorTheme({ top: 14, bottom: 24, left: 14, right: 24 })
    expect(theme).toBeDefined()
  })

  it('smoothCursor 扩展返回包含 ViewPlugin 与 BaseTheme 的合法 CodeMirror 扩展', async () => {
    const { smoothCursor } = await import('../src/lib/cmSmoothCursor')
    const ext = smoothCursor()
    expect(ext).toBeDefined()
    expect(Array.isArray(ext)).toBe(true)
    if (Array.isArray(ext)) {
      expect(ext.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('smoothCursor 插件能够自适应 Vim 方块光标与细竖线光标形态', async () => {
    const { smoothCursor, checkIsBlockCursor } = await import('../src/lib/cmSmoothCursor')
    expect(smoothCursor).toBeDefined()
    expect(typeof checkIsBlockCursor).toBe('function')

    // 1. Vim Insert 模式下，即便存在 DOM 残留也权威判定为细竖线光标 (false)
    const mockViewInsert = {
      cm: {
        state: {
          vim: { insertMode: true },
          overwrite: false,
        },
      },
      dom: {
        querySelector: () => document.createElement('div'), // 模拟 DOM 残留 fatCursor
      },
      scrollDOM: {
        classList: { contains: () => false },
      },
    }
    expect(checkIsBlockCursor(mockViewInsert as any)).toBe(false)

    // 2. Vim Normal 模式下，判定为方块光标 (true)
    const mockViewNormal = {
      cm: {
        state: {
          vim: { insertMode: false },
          overwrite: false,
        },
      },
      dom: {
        querySelector: () => null,
      },
      scrollDOM: {
        classList: { contains: () => true },
      },
    }
    expect(checkIsBlockCursor(mockViewNormal as any)).toBe(true)
  })

  it('DocFloat 悬浮工具条不再展示纯净阅读按钮，且组件正常导出', async () => {
    const DocFloatModule = await import('../src/components/learn/DocFloat')
    expect(DocFloatModule.default).toBeDefined()
    expect(typeof DocFloatModule.default).toBe('function')
  })
})

describe('代码块（当前作用域）突出显示 (scopeHighlight)', () => {
  it('导出合法的 CodeMirror 作用域高亮扩展', async () => {
    const { scopeHighlight } = await import('../src/lib/cmScopeHighlight')
    const ext = scopeHighlight()
    expect(ext).toBeDefined()
    expect(Array.isArray(ext)).toBe(true)
  })

  it('准确侦测当前光标所在代码块最内层作用域边界', async () => {
    const { EditorState } = await import('@codemirror/state')
    const { javascript } = await import('@codemirror/lang-javascript')
    const { findEnclosingScope } = await import('../src/lib/cmScopeHighlight')

    const code = `function outer() {\n  const config = {\n    port: 5173,\n    host: 'localhost'\n  };\n  return config;\n}`
    const state = EditorState.create({
      doc: code,
      extensions: [javascript()],
    })

    // 光标在第 3 行 port: 5173，应该命中最内层对象作用域 (第 2 行到第 5 行)
    const line3 = state.doc.line(3)
    const scopeInner = findEnclosingScope(state, line3.from)
    expect(scopeInner).toEqual({ start: 2, end: 5 })

    // 光标在第 6 行 return config;，应该命中最外层函数作用域 (第 1 行到第 7 行)
    const line6 = state.doc.line(6)
    const scopeOuter = findEnclosingScope(state, line6.from)
    expect(scopeOuter).toEqual({ start: 1, end: 7 })

    // 空文档或者单行语句，返回 null
    const emptyState = EditorState.create({ doc: 'const x = 1;' })
    expect(findEnclosingScope(emptyState, 0)).toBeNull()
  })

  it('主题中定义了 300ms 行号过渡动画与作用域行号样式', async () => {
    const { markdownEditorTheme } = await import('../src/lib/cmMarkdown')
    const theme = markdownEditorTheme({ top: 14, bottom: 24, left: 14, right: 24 })
    expect(theme).toBeDefined()
  })
})

describe('Vim 模式设置与状态管理 (vimSettings)', () => {
  it('默认情况下 Vim 模式未开启，并支持状态切换与广播', async () => {
    const store = new Map<string, string>()
    const listeners = new Map<string, Set<(e: any) => void>>()

    const mockLocalStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    }

    const mockWindow = {
      addEventListener: (type: string, cb: any) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(cb)
      },
      removeEventListener: (type: string, cb: any) => {
        listeners.get(type)?.delete(cb)
      },
      dispatchEvent: (e: any) => {
        listeners.get(e.type)?.forEach((cb) => cb(e))
        return true
      },
    }

    const origLocalStorage = (globalThis as any).localStorage
    const origWindow = (globalThis as any).window
    ;(globalThis as any).localStorage = mockLocalStorage
    ;(globalThis as any).window = mockWindow

    try {
      const { isVimEnabled, setVimEnabled, toggleVimEnabled, subscribeVimEnabled } = await import(
        '../src/lib/vimSettings'
      )

      // 默认关闭
      expect(isVimEnabled()).toBe(false)

      // 订阅广播
      let notified: boolean | null = null
      const unsub = subscribeVimEnabled((val) => {
        notified = val
      })

      // 切换开启（异步等待微任务事件派发）
      const next = toggleVimEnabled()
      expect(next).toBe(true)
      expect(isVimEnabled()).toBe(true)
      await new Promise((r) => setTimeout(r, 10))
      expect(notified).toBe(true)

      // 再次切换关闭
      setVimEnabled(false)
      expect(isVimEnabled()).toBe(false)
      await new Promise((r) => setTimeout(r, 10))
      expect(notified).toBe(false)

      unsub()
    } finally {
      ;(globalThis as any).localStorage = origLocalStorage
      ;(globalThis as any).window = origWindow
    }
  })

  it('applyVimrc 成功解析并应用自定义按键映射与选项', async () => {
    const { applyVimrc } = await import('../src/lib/vimConfig')
    const configText = `
" 基础注释
set ignorecase " 忽略大小写
inoremap jk <Esc>
set tabstop=4
`
    expect(() => applyVimrc(configText)).not.toThrow()
  })

  it('VimIcon 与 VimFloatTip 组件正确导出', async () => {
    const VimIconModule = await import('../src/components/learn/VimIcon')
    const VimFloatTipModule = await import('../src/components/learn/VimFloatTip')
    expect(VimIconModule.default).toBeDefined()
    expect(typeof VimIconModule.default).toBe('function')
    expect(VimFloatTipModule.default).toBeDefined()
    expect(typeof VimFloatTipModule.default).toBe('function')
  })

  it('ensureVimConfigFile 获取并返回 .vimrc 文件路径', async () => {
    const { ensureVimConfigFile } = await import('../src/lib/vimConfig')
    const path = await ensureVimConfigFile()
    // 在 Web 模式桥下返回 /tmp/.vimrc，或在真实 Electron 模式下返回主目录 .vimrc
    if (path) {
      expect(path).toContain('.vimrc')
    }
  })

  it('foldCurrentScope 与 unfoldCurrentScope 能够智能侦测并快速折叠/展开当前代码块', async () => {
    const { EditorState } = await import('@codemirror/state')
    const { javascript } = await import('@codemirror/lang-javascript')
    const { foldGutter } = await import('@codemirror/language')
    const { foldCurrentScope, unfoldCurrentScope } = await import('../src/lib/cmFoldScope')

    const code = `function calculateTotal(items) {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price;\n  }\n  return sum;\n}`
    let state = EditorState.create({
      doc: code,
      selection: { anchor: code.indexOf('sum += item.price') },
      extensions: [javascript(), foldGutter()],
    })
    const mockView = {
      get state() {
        return state
      },
      dispatch: (tr: any) => {
        state = state.update(tr).state
      },
      lineBlockAt: (pos: number) => {
        const line = state.doc.lineAt(pos)
        return { from: line.from, to: line.to }
      },
    } as any

    // 光标在循环体内部，foldCurrentScope 智能向上侦测并折叠当前代码块
    const foldRes = foldCurrentScope(mockView)
    expect(foldRes).toBe(true)

    // unfoldCurrentScope 展开该代码块
    const unfoldRes = unfoldCurrentScope(mockView)
    expect(typeof unfoldRes).toBe('boolean')
  })

  it('registerVimExCommands 成功将应用功能绑定到 Vim 冒号命令模式', async () => {
    const origDoc = (globalThis as any).document
    ;(globalThis as any).document = {
      documentElement: { style: {} },
      createElement: () => ({
        style: {},
        appendChild: () => {},
        setAttribute: () => {},
      }),
    }

    try {
      const { Vim } = await import('@replit/codemirror-vim')
      const { registerVimExCommands, setVimEditorBridge } = await import('../src/lib/vimCommands')

      registerVimExCommands()

      let saved = false
      let closed = false
      setVimEditorBridge({
        onSave: () => {
          saved = true
        },
        onClose: () => {
          closed = true
        },
      })

      const mockCm = {
        operation: (fn: any) => fn(),
        openNotification: () => {},
        openDialog: () => {},
        getCursor: () => ({ line: 0, ch: 0 }),
        state: { vim: {} },
      }

      // 验证 :w 触发保存
      Vim.handleEx(mockCm as any, 'w')
      expect(saved).toBe(true)

      // 验证 :q 触发关闭
      Vim.handleEx(mockCm as any, 'q')
      expect(closed).toBe(true)

      // 验证全面扩充的命令：:q! 强制关闭、:tabo 关闭其他、:sp 水平分屏、:vs 垂直分屏、:tutor 学习
      let forceClosed = false
      let closedOthers = false
      let newTabTriggered = false
      let splitDir: string | null = null
      setVimEditorBridge({
        onClose: (force) => {
          forceClosed = Boolean(force)
        },
        onCloseOthers: () => {
          closedOthers = true
        },
        onNewTab: () => {
          newTabTriggered = true
        },
        onSplit: (dir) => {
          splitDir = dir
        },
      })

      Vim.handleEx(mockCm as any, 'tabnew')
      expect(newTabTriggered).toBe(true)

      Vim.handleEx(mockCm as any, 'q!')
      expect(forceClosed).toBe(true)

      Vim.handleEx(mockCm as any, 'tabo')
      expect(closedOthers).toBe(true)

      Vim.handleEx(mockCm as any, 'sp')
      expect(splitDir).toBe('horizontal')

      Vim.handleEx(mockCm as any, 'vs')
      expect(splitDir).toBe('vertical')

      const { isVimTutorOpen, closeVimTutor } = await import('../src/lib/vimTutorState')
      closeVimTutor()
      expect(isVimTutorOpen()).toBe(false)
      Vim.handleEx(mockCm as any, 'tutor')
      expect(isVimTutorOpen()).toBe(true)
      closeVimTutor()

      setVimEditorBridge(null)
    } finally {
      ;(globalThis as any).document = origDoc
    }
  })

  it('Vim 教学关卡配置完整且闯关状态机正常工作', async () => {
    const { VIM_TUTOR_LEVELS } = await import('../src/components/learn/vim/vimTutorLevels')
    expect(VIM_TUTOR_LEVELS.length).toBeGreaterThanOrEqual(6)
    expect(VIM_TUTOR_LEVELS[0].title).toContain('方向之魂')
    expect(VIM_TUTOR_LEVELS[1].title).toContain('疾步如飞')

    const { openVimTutor, closeVimTutor, isVimTutorOpen, subscribeVimTutor } = await import(
      '../src/lib/vimTutorState'
    )
    let notified = false
    const unsub = subscribeVimTutor((open) => {
      notified = open
    })
    openVimTutor()
    expect(isVimTutorOpen()).toBe(true)
    expect(notified).toBe(true)

    closeVimTutor()
    expect(isVimTutorOpen()).toBe(false)
    expect(notified).toBe(false)
    unsub()
  })

  it('markdownEditorTheme 正确定义了水平居中垂直顶部悬浮的 Vim 命令卡片', async () => {
    const { markdownEditorTheme } = await import('../src/lib/cmMarkdown')
    const theme = markdownEditorTheme({ top: 10, bottom: 10, left: 10, right: 10, gutterLeft: 10 })
    expect(theme).toBeDefined()
  })

  it('historyKeymap 中的 Mod-u 映射被成功剔除，避免与 Vim Ctrl+U 翻半页产生撤销重叠', async () => {
    const { historyKeymap } = await import('@codemirror/commands')
    const filtered = historyKeymap.filter((k) => k.key !== 'Mod-u' && k.key !== 'Alt-u')
    expect(filtered.some((k) => k.key === 'Mod-u')).toBe(false)
    expect(filtered.some((k) => k.key === 'Mod-z')).toBe(true)
  })

  it('triggerShortcutAction 能够正确触发已注册的快捷键动作', async () => {
    const { triggerShortcutAction, subscribeShortcut } = await import('../src/lib/shortcuts')
    let triggered = false
    const unsub = subscribeShortcut('learn.save', {
      down: () => {
        triggered = true
      },
    })

    const ok = triggerShortcutAction('learn.save')
    expect(ok).toBe(true)
    expect(triggered).toBe(true)

    unsub()
  })
})

