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
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYUP = 0x0105;
    private const int SRCCOPY = 0x00CC0020;
    private const uint WM_INPUTLANGCHANGEREQUEST = 0x0050;
    private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (IntPtr)(-4);

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static LowLevelKeyboardProc _proc = HookCallback;
    private static IntPtr _hookID = IntPtr.Zero;

    // 当前全局截图热键：Windows 虚拟键码 + 修饰位掩码（1 Ctrl / 2 Shift / 4 Alt / 8 Win）。
    // 由 Electron 主进程通过 stdin 的 SETKEY 命令动态更新，默认 F1。
    private static volatile int _hotkeyVk = 0x70;
    private static volatile int _hotkeyMods = 0;
    private static readonly HashSet<int> _downKeys = new HashSet<int>();

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

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetKeyboardLayout(uint idThread);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

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
                } else if (line == "IME_GET") {
                    HandleImeGet();
                } else if (line.StartsWith("IME_SET ")) {
                    HandleImeSet(line.Substring(8).Trim());
                } else if (line.StartsWith("SETKEY ")) {
                    // "SETKEY <vk> <mods>"：热键由渲染层当前绑定下发；调整只换匹配条件，不拦按键
                    string[] parts = line.Substring(7).Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 2) {
                        int vk, mods;
                        if (int.TryParse(parts[0], out vk) && int.TryParse(parts[1], out mods)) {
                            _hotkeyVk = vk;
                            _hotkeyMods = mods;
                        }
                    }
                } else if (line == "EXIT") {
                    Environment.Exit(0);
                }
            }
            // 父进程关闭 stdin（父进程退出 / 崩溃 / 重启），助手自动退出，绝不残留孤儿进程锁定文件
            Environment.Exit(0);
        });
        stdInThread.IsBackground = true;
        stdInThread.Start();

        // 注册全局键盘低级钩子（系统级截图热键监听，无条件放行所有按键）
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
        if (nCode >= 0) {
            int msg = wParam.ToInt32();
            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) {
                int vkCode = Marshal.ReadInt32(lParam);
                // 过滤系统级自动重复：按住热点键不应连续开十几个截图窗口
                if (!_downKeys.Contains(vkCode)) {
                    _downKeys.Add(vkCode);
                    if (MatchesHotkey(vkCode)) {
                        Console.WriteLine("TRIGGER");
                        Console.Out.Flush();
                    }
                }
            } else if (msg == WM_KEYUP || msg == WM_SYSKEYUP) {
                _downKeys.Remove(Marshal.ReadInt32(lParam));
            }
        }
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }

    private static bool IsKeyDown(int vk) {
        return (GetAsyncKeyState(vk) & 0x8000) != 0;
    }

    /// <summary>
    /// 判断这次 keydown 是否命中当前截图热键。修饰键用全局异步状态读取，
    /// 因此热键在任意前台窗口都成立，且改键后旧组合会立即失效。
    /// </summary>
    private static bool MatchesHotkey(int vkCode) {
        if (vkCode != _hotkeyVk) return false;

        int mods = 0;
        if (IsKeyDown(0x11) || IsKeyDown(0xA2) || IsKeyDown(0xA3)) mods |= 1; // Ctrl
        if (IsKeyDown(0x10) || IsKeyDown(0xA0) || IsKeyDown(0xA1)) mods |= 2; // Shift
        if (IsKeyDown(0x12) || IsKeyDown(0xA4) || IsKeyDown(0xA5)) mods |= 4; // Alt
        if (IsKeyDown(0x5B) || IsKeyDown(0x5C)) mods |= 8; // Win

        return mods == _hotkeyMods;
    }

    /// <summary>
    /// 读回**前台窗口所在线程**当前的键盘布局（HKL）。认前台而不是自己：
    /// 助手是被隐藏的子进程，此刻持有焦点的是宿主（归一）窗口——vim 输入法自动切换
    /// 就靠它记住「进普通模式前用户用的哪套输入法」。
    /// </summary>
    private static void HandleImeGet() {
        try {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) {
                Console.WriteLine("IME_ERR:NoForegroundWindow");
                Console.Out.Flush();
                return;
            }
            uint pid;
            uint tid = GetWindowThreadProcessId(hwnd, out pid);
            IntPtr hkl = tid != 0 ? GetKeyboardLayout(tid) : IntPtr.Zero;
            if (hkl == IntPtr.Zero) {
                Console.WriteLine("IME_ERR:NoLayout");
                Console.Out.Flush();
                return;
            }
            Console.WriteLine("IME:" + (hkl.ToInt64() & 0xFFFFFFFFL).ToString());
            Console.Out.Flush();
        } catch (Exception ex) {
            Console.WriteLine("IME_ERR:" + ex.Message);
            Console.Out.Flush();
        }
    }

    /// <summary>
    /// 给前台窗口换键盘布局（WM_INPUTLANGCHANGEREQUEST）：切到英文直通（0x04090409）
    /// 或恢复之前记下的那枚 HKL。异步投递即刻应答——布局装没装成功由上层 IME_GET 复核，
    /// 没装这份布局时系统会忽略请求（无害）。
    /// </summary>
    private static void HandleImeSet(string value) {
        try {
            long hkl = long.Parse(value.Trim());
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) {
                Console.WriteLine("IME_ERR:NoForegroundWindow");
                Console.Out.Flush();
                return;
            }
            PostMessage(hwnd, WM_INPUTLANGCHANGEREQUEST, IntPtr.Zero, (IntPtr)hkl);
            Console.WriteLine("IME_OK");
            Console.Out.Flush();
        } catch (Exception ex) {
            Console.WriteLine("IME_ERR:" + ex.Message);
            Console.Out.Flush();
        }
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
