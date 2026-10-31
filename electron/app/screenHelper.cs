using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class ScreenHelper {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int VK_OEM_3 = 0xC0; // 反引号 / 波浪号
    private const int SRCCOPY = 0x00CC0020;
    private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (IntPtr)(-4);

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static LowLevelKeyboardProc _proc = HookCallback;
    private static IntPtr _hookID = IntPtr.Zero;
    private static long _lastTime = 0;

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll")]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

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

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int pt_x;
        public int pt_y;
    }

    public class WindowItem {
        public int x { get; set; }
        public int y { get; set; }
        public int width { get; set; }
        public int height { get; set; }
        public string title { get; set; }
    }

    public static void Main(string[] args) {
        try {
            Console.OutputEncoding = Encoding.UTF8;
        } catch {}

        try {
            if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) {
                SetProcessDPIAware();
            }
        } catch {
            try { SetProcessDPIAware(); } catch {}
        }

        // 启动 stdin 读取线程，响应实时的 SNAP、WINDOWS 与 EXIT 请求
        Thread stdInThread = new Thread(() => {
            string line;
            while ((line = Console.ReadLine()) != null) {
                line = line.Trim();
                if (line.StartsWith("SNAP ")) {
                    HandleSnap(line.Substring(5).Trim());
                } else if (line == "WINDOWS") {
                    string json = GetWindowsJson();
                    Console.WriteLine("WINJSON:" + json);
                    Console.Out.Flush();
                } else if (line == "EXIT") {
                    Environment.Exit(0);
                }
            }
        });
        stdInThread.IsBackground = true;
        stdInThread.Start();

        // 注册全局键盘低级钩子（系统级双击反引号监听，无条件放行所有按键）
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule) {
            _hookID = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
        }

        Console.WriteLine("READY");
        Console.Out.Flush();

        // 保持消息泵
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {}

        if (_hookID != IntPtr.Zero) {
            UnhookWindowsHookEx(_hookID);
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)) {
            int vkCode = Marshal.ReadInt32(lParam);
            if (vkCode == VK_OEM_3) {
                long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (now - _lastTime <= 400 && now - _lastTime >= 60) {
                    Console.WriteLine("TRIGGER");
                    Console.Out.Flush();
                    _lastTime = 0;
                } else {
                    _lastTime = now;
                }
            } else {
                _lastTime = 0;
            }
        }
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }

    private static void HandleSnap(string param) {
        // 参数格式：x y w h filePath
        try {
            string[] parts = param.Split(new char[] { ' ' }, 5);
            if (parts.Length < 5) {
                Console.WriteLine("SNAP_ERR:Invalid parameters");
                Console.Out.Flush();
                return;
            }
            int x = int.Parse(parts[0]);
            int y = int.Parse(parts[1]);
            int w = int.Parse(parts[2]);
            int h = int.Parse(parts[3]);
            string filePath = parts[4].Trim();

            // 1. BitBlt 高速物理全屏采集（15ms 内完成，100% 杜绝 WebRTC 崩溃与黑屏）
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);

            IntPtr hdcSrc = GetDC(IntPtr.Zero);
            IntPtr hdcDest = CreateCompatibleDC(hdcSrc);
            IntPtr hBitmap = CreateCompatibleBitmap(hdcSrc, w, h);
            IntPtr hOld = SelectObject(hdcDest, hBitmap);
            BitBlt(hdcDest, 0, 0, w, h, hdcSrc, x, y, SRCCOPY);
            SelectObject(hdcDest, hOld);

            using (Bitmap bmp = Image.FromHbitmap(hBitmap)) {
                bmp.Save(filePath, ImageFormat.Png);
            }

            DeleteObject(hBitmap);
            DeleteDC(hdcDest);
            ReleaseDC(IntPtr.Zero, hdcSrc);

            // 2. 同步瞬时获取窗口列表（天然保持 Windows 原生 Z-order，从顶层到底层）
            string winJson = GetWindowsJson();
            Console.WriteLine("SNAP_OK:" + winJson);
            Console.Out.Flush();
        } catch (Exception ex) {
            Console.WriteLine("SNAP_ERR:" + ex.Message);
            Console.Out.Flush();
        }
    }

    private static string GetWindowsJson() {
        var list = new List<WindowItem>();
        try {
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero) {
                SetThreadDesktop(hDesk);
                EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                    if (!IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;

                    // 1. 过滤 Cloaked 窗口（Windows 10/11 后台挂起应用与隐形工作区）
                    int cloaked = 0;
                    DwmGetWindowAttribute(hWnd, 14, out cloaked, sizeof(int));
                    if (cloaked != 0) return true;

                    // 2. 过滤无边框透明工具窗
                    int exStyle = GetWindowLong(hWnd, -20); // GWL_EXSTYLE
                    if ((exStyle & 0x00000080) != 0) return true; // WS_EX_TOOLWINDOW

                    // 3. 过滤无标题幽灵背景窗口（顶级交互窗口必有标题）
                    StringBuilder sbTitle = new StringBuilder(256);
                    GetWindowText(hWnd, sbTitle, 256);
                    string title = sbTitle.ToString().Trim();
                    if (string.IsNullOrEmpty(title)) return true;

                    StringBuilder sbCls = new StringBuilder(128);
                    GetClassName(hWnd, sbCls, 128);
                    string cls = sbCls.ToString();
                    if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") return true;

                    // 4. 获取无阴影真实视口外框
                    RECT r;
                    int hr = DwmGetWindowAttribute(hWnd, 9, out r, Marshal.SizeOf(typeof(RECT)));
                    if (hr != 0) GetWindowRect(hWnd, out r);
                    int w = r.Right - r.Left;
                    int h = r.Bottom - r.Top;
                    if (w < 80 || h < 60) return true;

                    // EnumDesktopWindows 自身天然按 Z-order（从最上层到最下层）枚举
                    list.Add(new WindowItem { x = r.Left, y = r.Top, width = w, height = h, title = title });
                    return true;
                }, IntPtr.Zero);
            }
        } catch {}

        // 手工极速序列化 JSON
        StringBuilder sb = new StringBuilder();
        sb.Append("[");
        for (int i = 0; i < list.Count; i++) {
            if (i > 0) sb.Append(",");
            var it = list[i];
            sb.Append("{\"x\":").Append(it.x).Append(",\"y\":").Append(it.y)
              .Append(",\"width\":").Append(it.width).Append(",\"height\":").Append(it.height)
              .Append("}");
        }
        sb.Append("]");
        return sb.ToString();
    }
}
