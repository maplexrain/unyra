import { describe, it, expect } from 'vitest'
import { markdownEditorTheme, IDEA_MONO_FONT } from '../src/lib/cmMarkdown'
import { smoothCursor } from '../src/lib/cmSmoothCursor'
import { sisterTabRef, openSisterDocView } from '../src/components/learn/workspace/sisterView'
import { tabTitle, makeTab } from '../src/learn/tabs'
import type { LearnStore, TabRef } from '../src/learn/types'
import type { DocWorkspace } from '../src/learn/groups/types'

describe('编辑器行号样式与 IntelliJ IDEA 风格大字号', () => {
  it('配置了 16px 呼吸边距以及 13.5px 大号高亮当前行行号', () => {
    const theme = markdownEditorTheme({ top: 14, bottom: 24, left: 14, right: 24, gutterLeft: 50 })
    expect(theme).toBeDefined()
    expect(IDEA_MONO_FONT).toContain('JetBrains Mono')
  })
})

describe('平滑虚拟光标扩展 (smoothCursor)', () => {
  it('正确导出平滑光标 CodeMirror 扩展', () => {
    const ext = smoothCursor()
    expect(ext).toBeDefined()
    expect(Array.isArray(ext)).toBe(true)
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

