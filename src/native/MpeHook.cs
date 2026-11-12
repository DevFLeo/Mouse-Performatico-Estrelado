using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace MpeNative
{
    /// <summary>
    /// M.P.E (Mouse Performático Estrelado) - Daemon Nativo Win32 de Baixa Latência.
    /// Monitora em nível de kernel/user32 o gatilho global:
    /// Shift + Ctrl + Alt + Botão Direito do Mouse (WM_RBUTTONDOWN)
    /// Sem consumir CPU (Event-Driven Message Loop) e suprimindo o menu de contexto nativo.
    /// </summary>
    internal static class MpeHook
    {
        private const int WH_MOUSE_LL = 14;
        private const int WM_RBUTTONDOWN = 0x0204;
        private const int WM_RBUTTONUP = 0x0205;

        private const int VK_SHIFT = 0x10;
        private const int VK_CONTROL = 0x11;
        private const int VK_MENU = 0x12; // ALT

        private const byte VK_C = 0x43;
        private const byte VK_V = 0x56;
        private const byte VK_RETURN = 0x0D;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        private static LowLevelMouseProc _proc = HookCallback;
        private static IntPtr _hookID = IntPtr.Zero;
        private static bool _suppressNextRightUp = false;
        private static IntPtr _lastForegroundHwnd = IntPtr.Zero;

        private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSLLHOOKSTRUCT
        {
            public POINT pt;
            public uint mouseData;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [STAThread]
        public static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.InputEncoding = Encoding.UTF8;

            // Modo utilitário de execução única via linha de comando (ex: capturar seleção de texto ou colar no Telegram)
            if (args.Length > 0)
            {
                HandleSingleCommand(args);
                return;
            }

            // Thread assíncrona para escutar comandos vindos do processo principal via STDIN
            Thread stdinThread = new Thread(ListenStdin)
            {
                IsBackground = true
            };
            stdinThread.Start();

            _hookID = SetHook(_proc);
            Console.WriteLine("MPE_HOOK_READY");
            Console.Out.Flush();

            Application.Run();
            UnhookWindowsHookEx(_hookID);
        }

        private static void HandleSingleCommand(string[] args)
        {
            string cmd = args[0].ToUpperInvariant();
            if (cmd == "--COPY-SELECTION" && args.Length > 1)
            {
                long hwndVal;
                if (long.TryParse(args[1], out hwndVal) && hwndVal != 0)
                {
                    IntPtr targetHwnd = new IntPtr(hwndVal);
                    SetForegroundWindow(targetHwnd);
                    Thread.Sleep(120);
                }
                SendCtrlKey(VK_C);
                Thread.Sleep(150);
                return;
            }
            else if (cmd == "--PASTE-AND-SEND")
            {
                Thread.Sleep(600);
                SendCtrlKey(VK_V);
                Thread.Sleep(450);
                keybd_event(VK_RETURN, 0, 0, UIntPtr.Zero);
                Thread.Sleep(40);
                keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                return;
            }
        }

        private static void ListenStdin()
        {
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    string trimmed = line.Trim();
                    if (trimmed == "QUIT" || trimmed == "EXIT")
                    {
                        Application.Exit();
                        break;
                    }
                    else if (trimmed.StartsWith("COPY_FROM_LAST"))
                    {
                        if (_lastForegroundHwnd != IntPtr.Zero)
                        {
                            SetForegroundWindow(_lastForegroundHwnd);
                            Thread.Sleep(120);
                        }
                        SendCtrlKey(VK_C);
                        Thread.Sleep(120);
                        Console.WriteLine("SELECTION_COPIED");
                        Console.Out.Flush();
                    }
                }
            }
            catch
            {
                Application.Exit();
            }
        }

        private static void SendCtrlKey(byte vKey)
        {
            // Libera modificadores caso ainda estejam pressionados
            keybd_event((byte)VK_SHIFT, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            keybd_event((byte)VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

            keybd_event((byte)VK_CONTROL, 0, 0, UIntPtr.Zero);
            keybd_event(vKey, 0, 0, UIntPtr.Zero);
            Thread.Sleep(35);
            keybd_event(vKey, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            keybd_event((byte)VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        private static IntPtr SetHook(LowLevelMouseProc proc)
        {
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                return SetWindowsHookEx(WH_MOUSE_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
            }
        }

        private static bool IsKeyDown(int vKey)
        {
            return (GetAsyncKeyState(vKey) & 0x8000) != 0;
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int msg = wParam.ToInt32();

                if (msg == WM_RBUTTONDOWN)
                {
                    bool shift = IsKeyDown(VK_SHIFT);
                    bool ctrl = IsKeyDown(VK_CONTROL);
                    bool alt = IsKeyDown(VK_MENU);

                    if (shift && ctrl && alt)
                    {
                        MSLLHOOKSTRUCT hookStruct = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                        _lastForegroundHwnd = GetForegroundWindow();
                        _suppressNextRightUp = true;

                        Console.WriteLine(string.Format("TRIGGER_HUD|{0}|{1}|{2}", hookStruct.pt.x, hookStruct.pt.y, _lastForegroundHwnd.ToInt64()));
                        Console.Out.Flush();

                        // Suprime o clique direito padrão para não abrir o menu de contexto do Windows
                        return (IntPtr)1;
                    }
                }
                else if (msg == WM_RBUTTONUP && _suppressNextRightUp)
                {
                    _suppressNextRightUp = false;
                    return (IntPtr)1;
                }
            }

            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }
    }
}
