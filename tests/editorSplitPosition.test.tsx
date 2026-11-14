// @vitest-environment happy-dom
/**
 * 分栏实时预览的**位置口径**（LiveSplitPreview）：
 * - 默认**编辑在左、预览在右**（2026-11-14 改：原先预览在左）；
 * - 对调广播（:preview switch / 双击分割线）互换两列；
 * - 旧持久化记录（无 v 标记）迁移：对调标记一次性回默认——旧默认下没对调过的文件
 *   直接拿新默认；手动对调到「编辑在左」的文件视觉不变。开合与比例原样保留。
 *   （v2 起「对调」的基准换成编辑在左，落盘记录带 v:2 标记区分新旧语义。）
 */
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import LiveSplitPreview from '../src/components/learn/editor/LiveSplitPreview'
import { swapEditorPreview } from '../src/components/learn/editor/previewBus'

/** 渲一份开着分栏的 LiveSplitPreview（children 是编辑器桩） */
async function renderSplit(key: string) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <LiveSplitPreview value="# 标题" ext=".md" storageKey={key}>
        <div data-testid="editor-stub">EDITOR_STUB</div>
      </LiveSplitPreview>,
    )
  })
  return { host, root }
}

/** 分栏容器里的两个正文列（跳过中间的分割条），按 DOM 顺序 */
function bodyPanes(host: HTMLElement): [HTMLElement, HTMLElement] {
  const container = host.firstElementChild as HTMLElement
  const panes = Array.from(container.children).filter(
    (el) => el.getAttribute('role') !== 'separator',
  ) as HTMLElement[]
  expect(panes.length).toBe(2)
  return [panes[0], panes[1]]
}

const editorIn = (pane: HTMLElement) => Boolean(pane.querySelector('[data-testid="editor-stub"]'))

async function close(host: HTMLElement, root: ReturnType<typeof createRoot>) {
  await act(async () => {
    root.unmount()
  })
  host.remove()
}

describe('分栏默认位置与对调 (LiveSplitPreview)', () => {
  it('默认**编辑在左、预览在右**（2026-11-14 口径：原先预览在左）', async () => {
    localStorage.removeItem('moji:split-preview:pos-default')
    const { host, root } = await renderSplit('pos-default')
    const [first, second] = bodyPanes(host)
    expect(editorIn(first)).toBe(true)
    // 预览栏的识别子：Markdown 渲染容器（「实时对照预览」角标已摘除，不再是识别子）
    expect(second.querySelector('.note-preview')).not.toBeNull()
    await close(host, root)
  })

  it('对调广播互换两列；落盘记录带 v2 标记（新语义：对调 = 预览在左）', async () => {
    localStorage.removeItem('moji:split-preview:pos-swap')
    const { host, root } = await renderSplit('pos-swap')
    expect(editorIn(bodyPanes(host)[0])).toBe(true)

    await act(async () => {
      swapEditorPreview()
    })
    const [first, second] = bodyPanes(host)
    expect(editorIn(first)).toBe(false)
    expect(second.querySelector('[data-testid="editor-stub"]')).not.toBeNull()

    const saved = JSON.parse(localStorage.getItem('moji:split-preview:pos-swap') ?? '{}')
    expect(saved.v).toBe(2)
    expect(saved.isSwapped).toBe(true)
    await close(host, root)
  })

  it('旧记录（无 v 标记）迁移：对调标记一次性回默认，开合与比例保留——手动对调到编辑在左的文件视觉不变', async () => {
    // 旧语义 isSwapped=true = 从「预览在左」对调成编辑在左（用户眼前的布局）
    localStorage.setItem(
      'moji:split-preview:pos-legacy',
      JSON.stringify({ isOpen: true, splitRatio: 62, isSwapped: true }),
    )
    const { host, root } = await renderSplit('pos-legacy')
    const [first] = bodyPanes(host)
    // 视觉不变：编辑还在左；比例原样保留（源码栏永远 splitRatio%）
    expect(editorIn(first)).toBe(true)
    expect(first.getAttribute('style')).toContain('62%')
    // 迁移落盘：v2 记录 isSwapped=false（新语义的编辑在左）
    const saved = JSON.parse(localStorage.getItem('moji:split-preview:pos-legacy') ?? '{}')
    expect(saved.v).toBe(2)
    expect(saved.isSwapped).toBe(false)
    await close(host, root)
  })

  it('v2 记录尊重对调标记：isSwapped=true = 预览在左', async () => {
    localStorage.setItem(
      'moji:split-preview:pos-v2',
      JSON.stringify({ isOpen: true, splitRatio: 50, isSwapped: true, v: 2 }),
    )
    const { host, root } = await renderSplit('pos-v2')
    const [first] = bodyPanes(host)
    expect(editorIn(first)).toBe(false)
    expect(first.querySelector('.note-preview')).not.toBeNull()
    await close(host, root)
  })
})
