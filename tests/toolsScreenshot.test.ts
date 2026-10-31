import { describe, expect, it, vi, beforeEach } from 'vitest'
import { toolsRouter } from '../server/routes/tools'
import { createWebNativeBridge } from '../src/lib/nativeBridgeWeb'

describe('实用工具箱后端与原生桥 (Tools & Screenshot)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('服务端路由 /api/tools', () => {
    it('/api/tools/record 接口返回录屏占位信息', async () => {
      const res = await toolsRouter.request('/record')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('ok', false)
      expect(data).toHaveProperty('message', '录屏工具占位中')
    })

    it('/api/tools/capture-screen 接口返回结构符合 ScreenCaptureResult 契约', async () => {
      const res = await toolsRouter.request('/capture-screen')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('ok')
      if (data.ok) {
        expect(typeof data.dataUrl).toBe('string')
        expect(data.dataUrl.startsWith('data:image/')).toBe(true)
      } else {
        expect(typeof data.error).toBe('string')
      }
    })
  })

  describe('WebNativeBridge tools 适配层', () => {
    it('createWebNativeBridge 暴露完整 tools 接口', () => {
      const bridge = createWebNativeBridge()
      expect(bridge.tools).toBeDefined()
      expect(typeof bridge.tools?.captureScreen).toBe('function')
      expect(typeof bridge.tools?.copyImage).toBe('function')
      expect(typeof bridge.tools?.saveImage).toBe('function')
      expect(typeof bridge.tools?.startRecord).toBe('function')
    })

    it('startRecord 返回占位提示', async () => {
      const bridge = createWebNativeBridge()
      const res = await bridge.tools?.startRecord?.()
      expect(res?.ok).toBe(false)
      if (res && !res.ok) {
        expect(res.error).toContain('占位')
      }
    })

    it('captureScreen 调用服务端接口并能正常解析返回', async () => {
      const bridge = createWebNativeBridge()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await bridge.tools?.captureScreen()
      expect(result?.ok).toBe(true)
      if (result?.ok) {
        expect(result.dataUrl).toContain('data:image/png;base64')
      }
    })
  })

  describe('拾色器色彩格式转换算法验证', () => {
    const rgbToHsl = (r: number, g: number, b: number): string => {
      const rNorm = r / 255
      const gNorm = g / 255
      const bNorm = b / 255
      const max = Math.max(rNorm, gNorm, bNorm)
      const min = Math.min(rNorm, gNorm, bNorm)
      let h = 0
      let s = 0
      const l = (max + min) / 2

      if (max !== min) {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        switch (max) {
          case rNorm:
            h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)
            break
          case gNorm:
            h = (bNorm - rNorm) / d + 2
            break
          case bNorm:
            h = (rNorm - gNorm) / d + 4
            break
        }
        h = Math.round(h * 60)
      }
      return `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
    }

    const toHex = (r: number, g: number, b: number) => {
      const pad = (v: number) => v.toString(16).padStart(2, '0').toUpperCase()
      return `#${pad(r)}${pad(g)}${pad(b)}`
    }

    it('正确将 RGB 转换为 HEX 与 HSL', () => {
      // 纯红
      expect(toHex(255, 0, 0)).toBe('#FF0000')
      expect(rgbToHsl(255, 0, 0)).toBe('hsl(0, 100%, 50%)')

      // 纯蓝
      expect(toHex(0, 0, 255)).toBe('#0000FF')
      expect(rgbToHsl(0, 0, 255)).toBe('hsl(240, 100%, 50%)')

      // 白色与黑色
      expect(toHex(255, 255, 255)).toBe('#FFFFFF')
      expect(rgbToHsl(255, 255, 255)).toBe('hsl(0, 0%, 100%)')
      expect(toHex(0, 0, 0)).toBe('#000000')
      expect(rgbToHsl(0, 0, 0)).toBe('hsl(0, 0%, 0%)')
    })
  })
})
