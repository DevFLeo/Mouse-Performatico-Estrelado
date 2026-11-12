using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace MpeNative
{
    /// <summary>
    /// M.P.E (Mouse Performatico Estrelado) - Subsistema Nativo de Integracao Direta do Windows (Win32).
    /// Opera em nivel de sistema operacional (user32.dll, dwmapi.dll, gdi32.dll) para:
    /// 1. Interceptar globalmente Shift + Ctrl + Alt + Botao Direito do Mouse sobre qualquer sistema.
    /// 2. Pre-capturar instantaneamente a imagem limpa do Sistema de Origem (Janela Ativa e Tela Inteira)
    ///    antes mesmo da renderizacao do HUD 3D (Zero Flicker / Latencia Zero).
    /// 3. Transferir prints e textos de um sistema diretamente para outro sistema aberto no Windows
    ///    (Ativacao Nativa de Janela + Injeção de Clipboard Ctrl+V + Disparo Automatico).
    /// </summary>
    internal static class MpeHook
    {
        private const int WH_MOUSE_LL = 14;
        private const int WM_RBUTTONDOWN = 0x0204;
        private const int WM_RBUTTONUP = 0x0205;

        private const int VK_SHIFT = 0x10;
        private const int VK_CONTROL = 0x11;
        private const int VK_MENU = 0x12;

        private const byte VK_C = 0x43;
        private const byte VK_V = 0x56;
        private const byte VK_RETURN = 0x0D;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const int SW_RESTORE = 9;
        private const int SW_SHOW = 5;
        private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

        private static LowLevelMouseProc _proc = HookCallback;
        private static IntPtr _hookID = IntPtr.Zero;
        private static bool _suppressNextRightUp = false;
        private static IntPtr _lastForegroundHwnd = IntPtr.Zero;
        private static string _cacheDir = "";

        private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);
        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
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

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

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
        private static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("dwmapi.dll")]
        private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [STAThread]
        public static void Main(string[] args)
        {
            try { SetProcessDPIAware(); } catch { }
            Console.OutputEncoding = Encoding.UTF8;
            Console.InputEncoding = Encoding.UTF8;

            try
            {
                string rootDir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", ".."));
                _cacheDir = Path.Combine(rootDir, "Capturas_MPE", ".cache");
                if (!Directory.Exists(_cacheDir))
                {
                    Directory.CreateDirectory(_cacheDir);
                }
            }
            catch
            {
                try
                {
                    _cacheDir = Path.Combine(Path.GetTempPath(), "MPE_PreCapture");
                    if (!Directory.Exists(_cacheDir)) Directory.CreateDirectory(_cacheDir);
                }
                catch { }
            }

            if (args.Length > 0)
            {
                HandleSingleCommand(args);
                return;
            }

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

        private static RECT GetAccurateWindowRect(IntPtr hWnd)
        {
            RECT r;
            if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) == 0)
            {
                if (r.Right > r.Left && r.Bottom > r.Top)
                {
                    return r;
                }
            }
            GetWindowRect(hWnd, out r);
            return r;
        }

        private static readonly object _snapLock = new object();

        /// <summary>
        /// Pre-captura em RAM (~5ms) o Sistema de Origem no exato momento em que o usuario
        /// aciona Shift + Ctrl + Alt + Botao Direito, e grava o PNG em background thread
        /// para nao bloquear o hook de mouse do Windows (zero lag na abertura do HUD).
        /// </summary>
        private static void CaptureOriginSnapshots(IntPtr originHwnd, RECT winRect, out string fullPath, out string winPath)
        {
            fullPath = Path.Combine(_cacheDir, "origin_fullscreen.png");
            winPath = Path.Combine(_cacheDir, "origin_window.png");

            string fPath = fullPath;
            string wPath = winPath;

            try
            {
                Rectangle screenBounds = Screen.PrimaryScreen.Bounds;
                Bitmap bmpFull = new Bitmap(screenBounds.Width, screenBounds.Height, PixelFormat.Format32bppArgb);
                using (Graphics g = Graphics.FromImage(bmpFull))
                {
                    g.CopyFromScreen(screenBounds.Left, screenBounds.Top, 0, 0, screenBounds.Size, CopyPixelOperation.SourceCopy);
                }

                ThreadPool.QueueUserWorkItem(delegate
                {
                    lock (_snapLock)
                    {
                        try
                        {
                            using (bmpFull)
                            {
                                bmpFull.Save(fPath, ImageFormat.Png);

                                int wLeft = Math.Max(screenBounds.Left, winRect.Left);
                                int wTop = Math.Max(screenBounds.Top, winRect.Top);
                                int wRight = Math.Min(screenBounds.Right, winRect.Right);
                                int wBottom = Math.Min(screenBounds.Bottom, winRect.Bottom);
                                int wWidth = wRight - wLeft;
                                int wHeight = wBottom - wTop;

                                if (wWidth > 80 && wHeight > 80)
                                {
                                    Rectangle cropRect = new Rectangle(wLeft - screenBounds.Left, wTop - screenBounds.Top, wWidth, wHeight);
                                    using (Bitmap bmpWin = bmpFull.Clone(cropRect, bmpFull.PixelFormat))
                                    {
                                        bmpWin.Save(wPath, ImageFormat.Png);
                                    }
                                }
                                else
                                {
                                    bmpFull.Save(wPath, ImageFormat.Png);
                                }
                            }
                        }
                        catch { }
                    }
                });
            }
            catch
            {
                fullPath = "";
                winPath = "";
            }
        }

        private static void ForceActivateWindow(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return;

            IntPtr fgHwnd = GetForegroundWindow();
            uint dummyPid;
            uint fgThread = GetWindowThreadProcessId(fgHwnd, out dummyPid);
            uint curThread = GetCurrentThreadId();

            if (IsIconic(hWnd))
            {
                ShowWindow(hWnd, SW_RESTORE);
            }
            else
            {
                ShowWindow(hWnd, SW_SHOW);
            }

            if (fgThread != curThread && fgThread != 0)
            {
                AttachThreadInput(curThread, fgThread, true);
                BringWindowToTop(hWnd);
                SetForegroundWindow(hWnd);
                AttachThreadInput(curThread, fgThread, false);
            }
            else
            {
                BringWindowToTop(hWnd);
                SetForegroundWindow(hWnd);
            }
        }

        private static string GetWindowTitle(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return "";
            StringBuilder sb = new StringBuilder(256);
            GetWindowText(hWnd, sb, 256);
            return sb.ToString().Replace("|", " ").Replace("\r", "").Replace("\n", "").Trim();
        }

        private static IntPtr FindSystemWindow(string query)
        {
            if (string.IsNullOrWhiteSpace(query)) return IntPtr.Zero;
            string qRaw = query.Trim().ToLowerInvariant();
            string qNormalized = qRaw.Replace("|", " ");

            // 1. Busca direta pelo titulo exato/parcial (incluindo "Eu | Você | Leonardo") nos processos
            foreach (Process p in Process.GetProcesses())
            {
                try
                {
                    if (p.MainWindowHandle == IntPtr.Zero) continue;
                    string title = p.MainWindowTitle ?? "";
                    string procName = p.ProcessName ?? "";
                    if (title.Contains("M.P.E") || title.Contains("Mouse Perform")) continue;

                    string titleLow = title.ToLowerInvariant();
                    string titleNorm = titleLow.Replace("|", " ");
                    string procLow = procName.ToLowerInvariant();

                    if (titleLow.Contains(qRaw) || titleNorm.Contains(qNormalized) || procLow.Contains(qRaw))
                    {
                        return p.MainWindowHandle;
                    }
                }
                catch { }
            }

            // 2. Busca profunda via EnumWindows para janelas secundarias ou UWP
            IntPtr found = IntPtr.Zero;
            EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
            {
                if (!IsWindowVisible(hWnd)) return true;
                string title = GetWindowTitle(hWnd);
                if (string.IsNullOrWhiteSpace(title)) return true;
                if (title.Contains("M.P.E") || title.Contains("Mouse Perform")) return true;

                string titleLow = title.ToLowerInvariant();
                if (titleLow.Contains(qRaw) || titleLow.Contains(qNormalized))
                {
                    found = hWnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);

            if (found != IntPtr.Zero) return found;

            // 3. Se o destino for a pasta/conversa do Telegram ("Eu | Você | Leonardo"), foca a janela do Telegram Desktop
            if (qRaw.Contains("leonardo") || qRaw.Contains("eu |") || qRaw.Contains("voce") || qRaw.Contains("você") || qRaw.Contains("telegram"))
            {
                foreach (Process p in Process.GetProcesses())
                {
                    try
                    {
                        if (p.MainWindowHandle == IntPtr.Zero) continue;
                        string procLow = (p.ProcessName ?? "").ToLowerInvariant();
                        string titleLow = (p.MainWindowTitle ?? "").ToLowerInvariant();
                        if (procLow.Contains("telegram") || titleLow.Contains("telegram"))
                        {
                            return p.MainWindowHandle;
                        }
                    }
                    catch { }
                }
            }

            return IntPtr.Zero;
        }

        private static void ListOpenWindowsJson()
        {
            List<string> items = new List<string>();
            HashSet<string> seen = new HashSet<string>();

            foreach (Process p in Process.GetProcesses())
            {
                try
                {
                    string procName = (p.ProcessName ?? "").Trim();
                    if (string.IsNullOrWhiteSpace(procName)) continue;

                    string title = (p.MainWindowTitle ?? "").Trim();
                    if (title.Contains("M.P.E") || title == "Program Manager") continue;

                    if (p.MainWindowHandle != IntPtr.Zero && !string.IsNullOrWhiteSpace(title))
                    {
                        string key = procName + "|" + title;
                        if (seen.Add(key))
                        {
                            string safeTitle = title.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "");
                            string safeProc = procName.Replace("\\", "\\\\").Replace("\"", "\\\"");
                            items.Add(string.Format("{{\"hwnd\":\"{0}\",\"process\":\"{1}\",\"title\":\"{2}\"}}", p.MainWindowHandle.ToInt64(), safeProc, safeTitle));
                        }
                    }
                }
                catch { }
            }

            string[][] defaults = new string[][] {
                new string[] { "Eu | Você | Leonardo", "Telegram (Pasta/Destino: Eu | Você | Leonardo)" },
                new string[] { "Telegram", "Telegram Desktop (tg://)" },
                new string[] { "WhatsApp", "WhatsApp Desktop" },
                new string[] { "Discord", "Discord" },
                new string[] { "Slack", "Slack" },
                new string[] { "Teams", "Microsoft Teams" },
                new string[] { "msedge", "Microsoft Edge" },
                new string[] { "chrome", "Google Chrome" },
                new string[] { "notepad", "Bloco de Notas (Notepad)" },
                new string[] { "mspaint", "Paint" },
                new string[] { "explorer", "Windows Explorer" }
            };

            foreach (string[] d in defaults)
            {
                if (seen.Add(d[0]))
                {
                    items.Add(string.Format("{{\"hwnd\":\"0\",\"process\":\"{0}\",\"title\":\"{1}\"}}", d[0], d[1]));
                }
            }

            Console.WriteLine("[" + string.Join(",", items.ToArray()) + "]");
            Console.Out.Flush();
        }

        private static void HandleSingleCommand(string[] args)
        {
            string cmd = args[0].ToUpperInvariant();

            if (cmd == "--LIST-WINDOWS")
            {
                ListOpenWindowsJson();
                return;
            }
            else if (cmd == "--CAPTURE-NOW" && args.Length > 1)
            {
                string outPath = args[1];
                try
                {
                    Rectangle screenBounds = Screen.PrimaryScreen.Bounds;
                    using (Bitmap bmp = new Bitmap(screenBounds.Width, screenBounds.Height, PixelFormat.Format32bppArgb))
                    {
                        using (Graphics g = Graphics.FromImage(bmp))
                        {
                            g.CopyFromScreen(screenBounds.Left, screenBounds.Top, 0, 0, screenBounds.Size, CopyPixelOperation.SourceCopy);
                        }
                        bmp.Save(outPath, ImageFormat.Png);
                    }
                    Console.WriteLine("CAPTURED_OK|" + outPath);
                }
                catch (Exception ex)
                {
                    Console.WriteLine("CAPTURE_ERR|" + ex.Message);
                }
                return;
            }
            else if (cmd == "--COPY-SELECTION" && args.Length > 1)
            {
                long hwndVal;
                if (long.TryParse(args[1], out hwndVal) && hwndVal != 0)
                {
                    IntPtr targetHwnd = new IntPtr(hwndVal);
                    ForceActivateWindow(targetHwnd);
                    Thread.Sleep(150);
                }
                SendCtrlKey(VK_C);
                Thread.Sleep(150);
                return;
            }
            else if (cmd == "--PASTE-AND-SEND")
            {
                bool autoSend = args.Length <= 1 || args[1] != "0";
                Thread.Sleep(620);
                SendCtrlKey(VK_V);
                if (autoSend)
                {
                    // Aguarda modal de preview de imagem (Telegram, WhatsApp, Discord, Teams) e confirma com Enter
                    Thread.Sleep(550);
                    SendReturnKey();
                }
                return;
            }
            else if (cmd == "--DELIVER-TO-SYSTEM" && args.Length > 1)
            {
                string targetQuery = args[1];
                bool autoSend = args.Length <= 2 || args[2] != "0";

                IntPtr targetHwnd = FindSystemWindow(targetQuery);
                if (targetHwnd != IntPtr.Zero)
                {
                    ForceActivateWindow(targetHwnd);
                    Thread.Sleep(450);
                    SendCtrlKey(VK_V);
                    if (autoSend)
                    {
                        Thread.Sleep(550);
                        SendReturnKey();
                    }
                    Console.WriteLine("DELIVERED_TO_WINDOW|" + GetWindowTitle(targetHwnd));
                }
                else
                {
                    Console.WriteLine("WINDOW_NOT_FOUND");
                }
                return;
            }
        }

        private static void SendReturnKey()
        {
            keybd_event(VK_RETURN, 0, 0, UIntPtr.Zero);
            Thread.Sleep(45);
            keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
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
                }
            }
            catch
            {
                Application.Exit();
            }
        }

        private static void SendCtrlKey(byte vKey)
        {
            keybd_event((byte)VK_SHIFT, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            keybd_event((byte)VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

            keybd_event((byte)VK_CONTROL, 0, 0, UIntPtr.Zero);
            keybd_event(vKey, 0, 0, UIntPtr.Zero);
            Thread.Sleep(45);
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
                        string winTitle = GetWindowTitle(_lastForegroundHwnd);
                        RECT r = GetAccurateWindowRect(_lastForegroundHwnd);
                        string rectStr = string.Format("{0},{1},{2},{3}", r.Left, r.Top, r.Right, r.Bottom);

                        string fullSnap, winSnap;
                        CaptureOriginSnapshots(_lastForegroundHwnd, r, out fullSnap, out winSnap);

                        _suppressNextRightUp = true;

                        Console.WriteLine(string.Format(
                            "TRIGGER_HUD|{0}|{1}|{2}|{3}|{4}|{5}|{6}",
                            hookStruct.pt.x,
                            hookStruct.pt.y,
                            _lastForegroundHwnd.ToInt64(),
                            rectStr,
                            fullSnap,
                            winSnap,
                            winTitle
                        ));
                        Console.Out.Flush();

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
