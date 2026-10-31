import { spawn, type ChildProcess } from 'node:child_process'

let hookProcess: ChildProcess | null = null
let triggerCallback: (() => void) | null = null
let isStarting = false

const HOOK_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class DoubleBackquoteHook {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int VK_OEM_3 = 0xC0; // 反引号 / 波浪号按键 (\` / ~)

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static LowLevelKeyboardProc _proc = HookCallback;
    private static IntPtr _hookID = IntPtr.Zero;
    private static long _lastTime = 0;

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

    public static void Start() {
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule) {
            _hookID = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
        }
        Console.WriteLine("HOOK_READY");
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {}
        UnhookWindowsHookEx(_hookID);
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)) {
            int vkCode = Marshal.ReadInt32(lParam);
            if (vkCode == VK_OEM_3) {
                long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (now - _lastTime <= 380 && now - _lastTime >= 60) {
                    Console.WriteLine("DOUBLE_BACKQUOTE");
                    _lastTime = 0;
                } else {
                    _lastTime = now;
                }
            } else {
                // 按了其他按键，重置双击间隔判定
                _lastTime = 0;
            }
        }
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }
}
"@
[DoubleBackquoteHook]::Start()
`

/**
 * 启动全局双击反引号 (\`) 快捷键监听器：
 * - 纯底层低级键盘钩子，无条件调用 CallNextHookEx，绝不拦截/吃掉按键消息；
 * - 用户在任何软件正常输入反引号或波浪号 100% 毫无影响；
 * - 只有在 380ms 内快速连续敲击两次反引号时，触发截图。
 */
export function startDoubleBackquoteShortcut(onTrigger: () => void): void {
  triggerCallback = onTrigger
  if (process.platform !== 'win32' || hookProcess || isStarting) {
    return
  }

  isStarting = true
  try {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', HOOK_SCRIPT],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    )

    hookProcess = proc

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      if (text.includes('DOUBLE_BACKQUOTE')) {
        try {
          triggerCallback?.()
        } catch (err) {
          console.error('[DoubleBackquoteShortcut] trigger callback error:', err)
        }
      }
    })

    proc.on('exit', () => {
      hookProcess = null
      isStarting = false
    })

    proc.on('error', (err) => {
      console.warn('[DoubleBackquoteShortcut] hook process error:', err)
      hookProcess = null
      isStarting = false
    })
  } catch (e) {
    console.warn('[DoubleBackquoteShortcut] spawn hook failed:', e)
    isStarting = false
  }
}

/**
 * 停止并释放全局快捷键钩子
 */
export function stopDoubleBackquoteShortcut(): void {
  triggerCallback = null
  if (hookProcess) {
    try {
      hookProcess.kill()
    } catch {}
    hookProcess = null
  }
  isStarting = false
}
