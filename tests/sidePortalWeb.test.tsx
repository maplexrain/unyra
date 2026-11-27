// @vitest-environment happy-dom
/**
 * `:side` / `:fixside` 里的网页页签必须真的渲染 webview 层，而不是只画一张占位卡。
 *
 * 这里把 WebTabLayer 换成一个探针：只要 SidePortalPane 真的把网页分支交给它，
 * 就能从探针属性上看到原 tab id、URL 与 meta 映射；占位卡则在 DOM 里留下
 * 「外部浏览器打开」这类只在旧占位卡上出现的文案。
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GroupBodyCtx } from '../src/components/learn/workspace/GroupBodyCtx'
import type { LearnTab } from '../src/learn/types'

vi.mock('../src/components/learn/web/WebTabLayer', () => ({
  default: (props: {
    tabs: Array<{ id: string; ref: { url: string } }>
    activeId: string | null
    meta: Record<string, { url?: string }>
    hidden: boolean
  }) => (
    <div
      data-testid="web-layer"
      data-active-id={props.activeId ?? ''}
      data-url={props.tabs[0]?.ref.url ?? ''}
      data-meta-url={props.meta[props.activeId ?? '']?.url ?? ''}
      data-hidden={String(props.hidden)}
    />
  ),
}))

import { SidePortalPane } from '../src/components/learn/workspace/SidePortalPane'

const webTab: LearnTab = {
  id: 'web:example',
  ref: { kind: 'web', url: 'https://example.com/', key: 'k1' },
  createdAt: 0,
}

function makeCtx(patch: Partial<GroupBodyCtx> = {}): GroupBodyCtx {
  return {
    store: { goals: [], favorites: [], nodes: {} },
    webMeta: { 'web:example': { url: 'https://example.com/', title: 'Example' } },
    patchWebMeta: vi.fn(),
    commitWebUrl: vi.fn(),
    pendingJumpsRef: { current: new Map() },
    isUrlFavorite: () => false,
    toggleUrlFavorite: vi.fn(),
    ...patch,
  } as unknown as GroupBodyCtx
}

function renderPane(
  mode: 'side' | 'fixside' = 'side',
  ctx = makeCtx(),
  webMountedElsewhere = false,
): string {
  return renderToStaticMarkup(
    <SidePortalPane
      ctx={ctx}
      targetTab={webTab}
      mode={mode}
      webMountedElsewhere={webMountedElsewhere}
      onClose={() => {}}
      onSwap={() => {}}
    />,
  )
}

describe('side 里的网页页签', () => {
  it('side 模式把网页交给 WebTabLayer，沿用原 tab id', () => {
    const html = renderPane('side')

    expect(html).toContain('data-testid="web-layer"')
    expect(html).toContain('data-active-id="web:example"')
    expect(html).toContain('data-url="https://example.com/"')
    expect(html).toContain('data-meta-url="https://example.com/"')
    expect(html).not.toContain('外部浏览器打开')
    expect(html).not.toContain('切到页签')
  })

  it('fixside 模式沿用同一个 tab id，不再生成第二枚 guest', () => {
    const html = renderPane('fixside')

    expect(html).toContain('data-testid="web-layer"')
    expect(html).toContain('data-active-id="web:example"')
    expect(html).not.toContain('外部浏览器打开')
  })

  it('side 与 fixside 指向同一网页时，side 只留占位，不再挂第二枚 guest', () => {
    const html = renderPane('side', makeCtx(), true)

    expect(html).not.toContain('data-testid="web-layer"')
    expect(html).toContain('此网页在固定外侧栏中')
  })
})
