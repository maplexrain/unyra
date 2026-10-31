import { execFile } from 'node:child_process'
import { BrowserWindow, type Display } from 'electron'
import { queryWindowsViaHelper } from './doubleBackquoteShortcut'

export interface WindowRectItem {
  x: number
  y: number
  width: number
  height: number
  title?: string
}

const WIN32_FALLBACK_SCRIPT = `
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
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

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
                if (!IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;

                // 过滤 Cloaked 窗口（DWMWA_CLOAKED = 14）
                int cloaked = 0;
                DwmGetWindowAttribute(hWnd, 14, out cloaked, sizeof(int));
                if (cloaked != 0) return true;

                int exStyle = GetWindowLong(hWnd, -20);
                if ((exStyle & 0x00000080) != 0) return true; // WS_EX_TOOLWINDOW

                StringBuilder sbTitle = new StringBuilder(256);
                GetWindowText(hWnd, sbTitle, 256);
                string title = sbTitle.ToString().Trim();
                if (string.IsNullOrEmpty(title)) return true;

                StringBuilder sbCls = new StringBuilder(128);
                GetClassName(hWnd, sbCls, 128);
                string cls = sbCls.ToString();
                if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") return true;

                RECT r;
                int hr = DwmGetWindowAttribute(hWnd, 9, out r, Marshal.SizeOf(typeof(RECT)));
                if (hr != 0) GetWindowRect(hWnd, out r);
                int w = r.Right - r.Left;
                int h = r.Bottom - r.Top;
                if (w < 80 || h < 60) return true;

                list.Add(new WinItem { x = r.Left, y = r.Top, width = w, height = h, title = title });
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

  // 1. 优先通过已常驻后台的原生 screenHelper 在 1ms 内瞬时获取（零等待！）
  try {
    const fastList = await queryWindowsViaHelper(120)
    if (fastList && fastList.length > 0) {
      return mapRawRectsToDisplay(fastList, display, fallback)
    }
  } catch {}

  // 2. 次级兜底：调用快速 PowerShell 管道
  return new Promise<WindowRectItem[]>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN32_FALLBACK_SCRIPT],
      { timeout: 450, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          resolve(fallback)
          return
        }

        try {
          const raw = JSON.parse(stdout.trim())
          const arr = Array.isArray(raw) ? raw : [raw]
          resolve(mapRawRectsToDisplay(arr, display, fallback))
        } catch {
          resolve(fallback)
        }
      },
    )
  })
}

export function mapRawRectsToDisplay(
  arr: Array<{ x: number; y: number; width: number; height: number; title?: string }>,
  display: Display,
  fallback: WindowRectItem[],
): WindowRectItem[] {
  const { x: dx, y: dy, width: dw, height: dh } = display.bounds
  const scale = display.scaleFactor || 1
  const physDx = Math.round(dx * scale)
  const physDy = Math.round(dy * scale)
  const list: WindowRectItem[] = []

  for (const item of arr) {
    const rx = Math.round((item.x - physDx) / scale)
    const ry = Math.round((item.y - physDy) / scale)
    const rw = Math.round(item.width / scale)
    const rh = Math.round(item.height / scale)

    if (rx + rw <= 0 || ry + rh <= 0 || rx >= dw || ry >= dh) continue
    if (rw < 40 || rh < 30) continue

    list.push({
      x: rx,
      y: ry,
      width: rw,
      height: rh,
      title: item.title,
    })
  }

  list.push(...fallback)
  return list
}

export function getFallbackRects(display: Display): WindowRectItem[] {
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
