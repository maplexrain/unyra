// @vitest-environment happy-dom
/**
 * 图片预览必须挂到 body：消息流/面板里的 overflow、transform 会裁掉 fixed 覆盖层，
 * 预览不属于任何一条消息的 DOM。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { PendingLightbox } from '../src/components/agent/panel/Images'

describe('图片预览层', () => {
  it('通过 portal 挂到 body，而不是留在会被 overflow 裁切的容器里', () => {
    const clipping = document.createElement('div')
    clipping.style.overflow = 'hidden'
    const host = document.createElement('div')
    clipping.appendChild(host)
    document.body.appendChild(clipping)
    const root = createRoot(host)
    const onClose = vi.fn()
    const image = {
      id: 'p1',
      name: '截图',
      bytes: 1234,
      file: new File([''], '截图.png', { type: 'image/png' }),
      previewUrl: 'blob:test',
    }
    act(() => {
      root.render(createElement(PendingLightbox, { image, onClose }))
    })

    expect(host.querySelector('[data-image-lightbox]')).toBeNull()
    const frame = document.body.querySelector('[data-image-lightbox]')
    expect(frame).not.toBeNull()
    expect(frame?.className).toContain('fixed')
    expect(frame?.className).toContain('z-[80]')

    act(() => {
      ;(frame as HTMLElement).click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => {
      root.unmount()
    })
    clipping.remove()
  })
})
