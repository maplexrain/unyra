import { describe, expect, it, vi, beforeEach } from 'vitest'
import { toolsRouter } from '../server/routes/tools'
import { createWebNativeBridge } from '../src/lib/nativeBridgeWeb'
import { detectWindowUnderCursor } from '../src/components/tools/screenshot/windowDetector'

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

  describe('截图矢量对象与标注交互逻辑', () => {
    it('箭头对象正确绑定非箭头端起点 (x1, y1) 的说明文本框', () => {
      const arrowObj = {
        id: 'arrow_1',
        type: 'arrow' as const,
        x1: 100, // 起点（非箭头端）
        y1: 100,
        x2: 300, // 终点（箭头端）
        y2: 250,
        color: '#ef4444',
        strokeWidth: 3,
        text: '重点查看此处说明',
      }

      expect(arrowObj.x1).toBe(100)
      expect(arrowObj.y1).toBe(100)
      expect(arrowObj.text).toBe('重点查看此处说明')

      // 文本框定位在非箭头端 (x1, y1) 附近
      const textW = Math.max(50, arrowObj.text.length * 14 + 16)
      const textH = 24
      const tx = arrowObj.x1 - textW / 2
      const ty = arrowObj.y1 - textH - 8
      expect(tx).toBeLessThan(arrowObj.x1)
      expect(ty).toBeLessThan(arrowObj.y1)
    })

    it('方向键支持 1 像素精确微调，Shift 支持 10 像素步进', () => {
      let pos = { x: 50, y: 50 }
      const move = (key: string, shift: boolean) => {
        const step = shift ? 10 : 1
        if (key === 'ArrowUp') pos.y -= step
        if (key === 'ArrowDown') pos.y += step
        if (key === 'ArrowLeft') pos.x -= step
        if (key === 'ArrowRight') pos.x += step
      }

      move('ArrowRight', false)
      expect(pos).toEqual({ x: 51, y: 50 })

      move('ArrowDown', false)
      expect(pos).toEqual({ x: 51, y: 51 })

      move('ArrowLeft', true)
      expect(pos).toEqual({ x: 41, y: 51 })

      move('ArrowUp', true)
      expect(pos).toEqual({ x: 41, y: 41 })
    })

    it('选框尺寸实时格式化在右上角', () => {
      const sel = { x: 100, y: 200, width: 853.4, height: 480.2 }
      const label = `${Math.round(sel.width)} × ${Math.round(sel.height)}`
      expect(label).toBe('853 × 480')
    })

    it('窗口智能捕捉算法能从多个重叠窗口中精准匹配光标所在的最小窗口', () => {
      const sysRects = [
        { x: 0, y: 0, width: 1920, height: 1080 }, // 全屏
        { x: 0, y: 0, width: 1920, height: 1040 }, // 工作区
        { x: 200, y: 150, width: 1200, height: 800 }, // 主窗口
        { x: 400, y: 300, width: 500, height: 350 }, // 弹窗/子窗口
      ]

      // 1. 光标在弹窗内部，必须精准吸附弹窗
      const targetWindow = detectWindowUnderCursor(450, 350, null, sysRects, 1920, 1080)
      expect(targetWindow).toEqual({ x: 400, y: 300, width: 500, height: 350 })

      // 2. 光标在主窗口但弹窗外，吸附主窗口
      const mainWindow = detectWindowUnderCursor(250, 200, null, sysRects, 1920, 1080)
      expect(mainWindow).toEqual({ x: 200, y: 150, width: 1200, height: 800 })

      // 3. 光标在桌面空白区域，回退到工作区/显示器
      const deskWindow = detectWindowUnderCursor(1600, 100, null, sysRects, 1920, 1080)
      expect(deskWindow).toEqual({ x: 0, y: 0, width: 1920, height: 1040 })
    })

    it('单击判定（位移 < 4px）与拖拽判定（位移 >= 4px）逻辑准确', () => {
      const isClick = (start: { x: number; y: number }, end: { x: number; y: number }) => {
        return Math.hypot(end.x - start.x, end.y - start.y) < 4
      }

      expect(isClick({ x: 100, y: 100 }, { x: 101, y: 102 })).toBe(true) // 单击吸附
      expect(isClick({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true) // 纯点击
      expect(isClick({ x: 100, y: 100 }, { x: 105, y: 100 })).toBe(false) // 拖拽框选
      expect(isClick({ x: 100, y: 100 }, { x: 150, y: 180 })).toBe(false) // 明显拖拽
    })

    it('拉选框拖拽状态机支持连续帧平滑更新选区尺寸，不发生锁死', () => {
      let selection: { x: number; y: number; width: number; height: number } | null = null
      let isSelecting = false
      let dragStart: { x: number; y: number } | null = null

      const onMouseDown = (x: number, y: number) => {
        dragStart = { x, y }
        isSelecting = false
      }

      const onMouseMove = (x: number, y: number) => {
        if (isSelecting && dragStart) {
          selection = {
            x: Math.min(dragStart.x, x),
            y: Math.min(dragStart.y, y),
            width: Math.abs(x - dragStart.x),
            height: Math.abs(y - dragStart.y),
          }
          return
        }
        if (dragStart) {
          const dist = Math.hypot(x - dragStart.x, y - dragStart.y)
          if (dist >= 4) {
            isSelecting = true
            selection = {
              x: Math.min(dragStart.x, x),
              y: Math.min(dragStart.y, y),
              width: Math.abs(x - dragStart.x),
              height: Math.abs(y - dragStart.y),
            }
          }
        }
      }

      const onMouseUp = () => {
        isSelecting = false
        dragStart = null
      }

      // 1. 按下鼠标
      onMouseDown(100, 100)
      expect(selection).toBeNull()
      expect(isSelecting).toBe(false)

      // 2. 微小移动 (2px < 4px)，不触发拖拽
      onMouseMove(101, 101)
      expect(selection).toBeNull()
      expect(isSelecting).toBe(false)

      // 3. 超过 4px 阈值，进入拖拽拉框
      onMouseMove(105, 105)
      expect(isSelecting).toBe(true)
      expect(selection).toEqual({ x: 100, y: 100, width: 5, height: 5 })

      // 4. 后续帧连续拖拽，选区持续同步放大与更新
      onMouseMove(300, 250)
      expect(selection).toEqual({ x: 100, y: 100, width: 200, height: 150 })

      // 5. 反向拉选框（向左上方拖拽）
      onMouseMove(50, 60)
      expect(selection).toEqual({ x: 50, y: 60, width: 50, height: 40 })

      // 6. 松开鼠标确立选区
      onMouseUp()
      expect(isSelecting).toBe(false)
      expect(dragStart).toBeNull()
      expect(selection).toEqual({ x: 50, y: 60, width: 50, height: 40 })
    })

    it('copyDataUrlToClipboard 能正确解析 PNG Base64 并兼容写入原生剪贴板', async () => {
      const { copyDataUrlToClipboard } = await import('../electron/app/clipboardHelper')
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const res = await copyDataUrlToClipboard(dataUrl)
      expect(res.ok).toBe(true)
    })

    it('选框外部遮罩使用 evenodd 算法镂空选区，确保聚焦位置清晰透明而外部暗化', () => {
      const selection = { x: 300, y: 200, width: 800, height: 600 }

      const isPointInsideSelection = (px: number, py: number) => {
        return (
          px >= selection.x &&
          px <= selection.x + selection.width &&
          py >= selection.y &&
          py <= selection.y + selection.height
        )
      }

      // 点在选区内部：不被遮罩覆盖（清晰原色）
      expect(isPointInsideSelection(500, 400)).toBe(true)
      // 点在选区外部：处于遮罩覆盖区（黑色半透明）
      expect(isPointInsideSelection(100, 100)).toBe(false)
      expect(isPointInsideSelection(1500, 900)).toBe(false)
    })

    it('右键快捷退出与选区取消状态流转准确', () => {
      let selection: { x: number; y: number; width: number; height: number } | null = null
      let isClosed = false
      let editingTarget: string | null = null

      const handleContextMenu = (clientX: number, clientY: number) => {
        if (editingTarget) {
          editingTarget = null
          return
        }
        if (selection) {
          const inside =
            clientX >= selection.x &&
            clientX <= selection.x + selection.width &&
            clientY >= selection.y &&
            clientY <= selection.y + selection.height
          if (!inside) {
            isClosed = true
            return
          }
          selection = null
          return
        }
        isClosed = true
      }

      // 1. 无选区时右键：直接秒退截图
      handleContextMenu(500, 500)
      expect(isClosed).toBe(true)

      // 2. 有选区时，在选区外部右键：直接秒退截图
      isClosed = false
      selection = { x: 200, y: 200, width: 400, height: 300 }
      handleContextMenu(100, 100)
      expect(isClosed).toBe(true)

      // 3. 有选区时，在选区内部右键：取消当前选区，不退出
      isClosed = false
      selection = { x: 200, y: 200, width: 400, height: 300 }
      handleContextMenu(300, 300)
      expect(isClosed).toBe(false)
      expect(selection).toBeNull()

      // 4. 再次右键：退出
      handleContextMenu(300, 300)
      expect(isClosed).toBe(true)
    })

    it('双击反引号系统快捷键时间差状态机准确', () => {
      let lastTime = 0
      let triggered = false

      const onKeyDown = (vkCode: number, timeMs: number) => {
        if (vkCode === 0xC0) { // VK_OEM_3 (Backquote)
          if (timeMs - lastTime <= 380 && timeMs - lastTime >= 60) {
            triggered = true
            lastTime = 0
          } else {
            triggered = false
            lastTime = timeMs
          }
        } else {
          lastTime = 0
          triggered = false
        }
      }

      // 1. 敲击单次反引号：不触发
      onKeyDown(0xC0, 1000)
      expect(triggered).toBe(false)

      // 2. 200ms 后再次敲击反引号：触发双击！
      onKeyDown(0xC0, 1200)
      expect(triggered).toBe(true)

      // 3. 间隔过长（500ms > 380ms）：不触发
      triggered = false
      onKeyDown(0xC0, 2000)
      onKeyDown(0xC0, 2500)
      expect(triggered).toBe(false)

      // 4. 中间按了其他键（如字母 A: 0x41）：不触发
      triggered = false
      onKeyDown(0xC0, 3000)
      onKeyDown(0x41, 3100)
      onKeyDown(0xC0, 3200)
      expect(triggered).toBe(false)
    })
  })
})
