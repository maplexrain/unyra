import { Hono } from 'hono'

export const toolsRouter = new Hono()

toolsRouter.get('/capture-screen', async (c) => {
  // 1. 如果在 Electron 混合环境下运行微服务，优先使用 desktopCapturer
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron')
    if (electron?.desktopCapturer?.getSources) {
      const primaryDisplay = electron.screen?.getPrimaryDisplay?.()
      const width = primaryDisplay?.bounds?.width || 1920
      const height = primaryDisplay?.bounds?.height || 1080
      const scale = primaryDisplay?.scaleFactor || 1
      const sources = await electron.desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
      })
      if (sources && sources[0]?.thumbnail && !sources[0].thumbnail.isEmpty()) {
        return c.json({ ok: true, dataUrl: sources[0].thumbnail.toDataURL() })
      }
    }
  } catch {
    // 纯 Node.js 服务环境
  }

  // 2. Windows 平台：使用 PowerShell 高清截屏
  if (process.platform === 'win32') {
    try {
      const { execFile } = await import('node:child_process')
      const script = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height;
$g = [System.Drawing.Graphics]::FromImage($bmp);
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size);
$ms = New-Object System.IO.MemoryStream;
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);
$g.Dispose();
$bmp.Dispose();
$str = [Convert]::ToBase64String($ms.ToArray());
$ms.Dispose();
Write-Output $str;
`
      const res = await new Promise<{ ok: boolean; dataUrl?: string; error?: string }>((resolve) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
          { maxBuffer: 40 * 1024 * 1024, timeout: 6000 },
          (err, stdout) => {
            if (err) {
              resolve({ ok: false, error: err.message })
              return
            }
            const raw = stdout ? stdout.trim().split('\n').pop()?.trim() || '' : ''
            if (raw.length > 500) {
              resolve({ ok: true, dataUrl: `data:image/png;base64,${raw}` })
            } else {
              resolve({ ok: false, error: '截图数据为空' })
            }
          },
        )
      })
      return c.json(res)
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : '截图服务异常' })
    }
  }

  return c.json({ ok: false, error: '服务端未能截取桌面，请使用浏览器屏幕共享' })
})

toolsRouter.get('/record', (c) => {
  return c.json({ ok: false, message: '录屏工具占位中' })
})
