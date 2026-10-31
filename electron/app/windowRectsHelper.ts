import { execFile } from 'node:child_process'
import { BrowserWindow, type Display } from 'electron'

export interface WindowRectItem {
  x: number
  y: number
  width: number
  height: number
  title?: string
}

const WIN32_ENUM_SCRIPT = `
$sig = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class WinRectDetector {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public class WinItem {
        public int x { get; set; }
        public int y { get; set; }
        public int width { get; set; }
        public int height { get; set; }
        public string title { get; set; }
    }

    public static WinItem[] Detect() {
        var list = new List<WinItem>();
        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
        if (hDesk != IntPtr.Zero) {
            SetThreadDesktop(hDesk);
            EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                if (IsWindowVisible(hWnd) && !IsIconic(hWnd)) {
                    RECT r;
                    int hr = DwmGetWindowAttribute(hWnd, 9, out r, Marshal.SizeOf(typeof(RECT)));
                    if (hr != 0) {
                        GetWindowRect(hWnd, out r);
                    }
                    int w = r.Right - r.Left;
                    int h = r.Bottom - r.Top;
                    if (w >= 40 && h >= 40) {
                        var sbCls = new StringBuilder(128);
                        GetClassName(hWnd, sbCls, 128);
                        string cls = sbCls.ToString();
                        if (cls != "Progman" && cls != "WorkerW" && cls != "Shell_TrayWnd") {
                            var sbTitle = new StringBuilder(256);
                            GetWindowText(hWnd, sbTitle, 256);
                            list.Add(new WinItem { x = r.Left, y = r.Top, width = w, height = h, title = sbTitle.ToString() });
                        }
                    }
                }
                return true;
            }, IntPtr.Zero);
        }
        return list.ToArray();
    }
}
"@
try {
    Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue
    $items = [WinRectDetector]::Detect()
    if ($items -and $items.Length -gt 0) {
        $json = $items | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
    }
} catch {}
`

export async function detectSystemWindowRects(
  display: Display,
): Promise<WindowRectItem[]> {
  const fallback = getFallbackRects(display)
  if (process.platform !== 'win32') {
    return fallback
  }

  return new Promise<WindowRectItem[]>((resolve) => {
    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        resolve(fallback)
      }
    }, 700)

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN32_ENUM_SCRIPT],
      { timeout: 650, windowsHide: true },
      (err, stdout) => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)

        if (err || !stdout || !stdout.trim()) {
          resolve(fallback)
          return
        }

        try {
          const raw = JSON.parse(stdout.trim())
          const arr: Array<{ x: number; y: number; width: number; height: number; title?: string }> = Array.isArray(raw)
            ? raw
            : [raw]

          const { x: dx, y: dy, width: dw, height: dh } = display.bounds
          const scale = display.scaleFactor || 1

          const list: WindowRectItem[] = []

          // 1. 系统实际窗口（按 Z-order，最上层在最前）
          for (const item of arr) {
            const rx = Math.round((item.x - dx) / scale)
            const ry = Math.round((item.y - dy) / scale)
            const rw = Math.round(item.width / scale)
            const rh = Math.round(item.height / scale)

            if (rx + rw <= 0 || ry + rh <= 0 || rx >= dw || ry >= dh) {
              continue
            }
            if (rw < 30 || rh < 30) {
              continue
            }

            list.push({
              x: rx,
              y: ry,
              width: rw,
              height: rh,
              title: item.title,
            })
          }

          // 2. 兜底追加：应用内可见窗口与系统工作区/屏幕整体
          list.push(...fallback)
          resolve(list)
        } catch {
          resolve(fallback)
        }
      },
    )
  })
}

function getFallbackRects(display: Display): WindowRectItem[] {
  const res: WindowRectItem[] = []
  if (display.workArea) {
    res.push({
      x: Math.max(0, display.workArea.x - display.bounds.x),
      y: Math.max(0, display.workArea.y - display.bounds.y),
      width: display.workArea.width,
      height: display.workArea.height,
      title: 'WorkArea',
    })
  }
  res.push({
    x: 0,
    y: 0,
    width: display.bounds.width,
    height: display.bounds.height,
    title: 'Screen',
  })
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.isVisible() && !w.isMinimized()) {
      const b = w.getBounds()
      res.push({
        x: Math.max(0, b.x - display.bounds.x),
        y: Math.max(0, b.y - display.bounds.y),
        width: b.width,
        height: b.height,
        title: w.getTitle(),
      })
    }
  }
  return res
}
