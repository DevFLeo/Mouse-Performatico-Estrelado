using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("M.P.E - Mouse Performatico Estrelado")]
[assembly: AssemblyDescription("M.P.E - Mouse Performatico Estrelado")]
[assembly: AssemblyCompany("DevFLeo")]
[assembly: AssemblyProduct("M.P.E - Mouse Performatico Estrelado")]
[assembly: AssemblyCopyright("Copyright (c) DevFLeo")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace MpeNative
{
    /// <summary>
    /// Executavel Nativo Principal (MPE.exe) do Mouse Performatico Estrelado.
    /// - Garante identidade nativa do Windows (AppUserModelID + RelaunchCommand no atalho .lnk)
    ///   para que ao fixar na Barra de Tarefas o Windows mantenha o nome/icone M.P.E e abra o app real.
    /// - Inicia o motor grafico 3D diretamente no Windows sem abrir terminal.
    /// - Registra o aplicativo em "Aplicativos de inicializacao" do Windows.
    /// </summary>
    internal static class MpeLauncher
    {
        private const string RUN_SUBKEY = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string APPROVED_SUBKEY = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
        private const string APP_REG_NAME = "M.P.E - Mouse Performatico Estrelado";
        private const string LEGACY_REG_NAME = "MPE_MousePerformaticoEstrelado";
        private const string APP_USER_MODEL_ID = "DevFLeo.MousePerformaticoEstrelado";
        private const uint SHCNE_ASSOCCHANGED = 0x08000000;
        private const uint SHCNF_IDLIST = 0x0000;

        [DllImport("shell32.dll")]
        private static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PROPVARIANT pvar);

        [StructLayout(LayoutKind.Sequential)]
        private struct PROPERTYKEY
        {
            public Guid fmtid;
            public uint pid;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROPVARIANT
        {
            public ushort vt;
            public ushort wReserved1;
            public ushort wReserved2;
            public ushort wReserved3;
            public IntPtr pwszVal;
            public IntPtr extra;
        }

        [ComImport]
        [Guid("00021401-0000-0000-C000-000000000046")]
        private class ShellLink
        {
        }

        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("000214F9-0000-0000-C000-000000000046")]
        private interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cchMaxPath, IntPtr pfd, uint fFlags);
            void GetIDList(out IntPtr ppidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMaxName);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cchMaxPath);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cchMaxPath);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
            void GetHotkey(out ushort pwHotkey);
            void SetHotkey(ushort wHotkey);
            void GetShowCmd(out int piShowCmd);
            void SetShowCmd(int iShowCmd);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cchIconPath, out int piIcon);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
            void Resolve(IntPtr hwnd, uint fFlags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
        }

        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("0000010b-0000-0000-C000-000000000046")]
        private interface IPersistFile
        {
            void GetClassID(out Guid pClassID);
            [PreserveSig]
            int IsDirty();
            void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
            void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, [MarshalAs(UnmanagedType.Bool)] bool fRemember);
            void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
            void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
        }

        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        private interface IPropertyStore
        {
            void GetCount(out uint cProps);
            void GetAt(uint iProp, out PROPERTYKEY pkey);
            void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
            void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
            void Commit();
        }

        private static void SetPropertyString(IPropertyStore store, Guid fmtid, uint pid, string value)
        {
            PROPERTYKEY key = new PROPERTYKEY { fmtid = fmtid, pid = pid };
            PROPVARIANT pv = new PROPVARIANT
            {
                vt = 31, // VT_LPWSTR
                pwszVal = Marshal.StringToCoTaskMemUni(value ?? "")
            };
            try
            {
                store.SetValue(ref key, ref pv);
            }
            finally
            {
                PropVariantClear(ref pv);
            }
        }

        private static string ResolveIconPath(string baseDir, string exePath)
        {
            string icoPath = Path.Combine(baseDir.TrimEnd('\\'), "codigo", "assets", "icon.ico");
            if (File.Exists(icoPath)) return icoPath;
            icoPath = Path.Combine(baseDir.TrimEnd('\\'), "assets", "icon.ico");
            if (File.Exists(icoPath)) return icoPath;
            return exePath;
        }

        private static void CreateAppShortcutWithAumid(string lnkPath, string exePath, string args, string workingDir, string icoPath)
        {
            IShellLinkW link = (IShellLinkW)new ShellLink();
            link.SetPath(exePath);
            link.SetArguments(args ?? "");
            link.SetWorkingDirectory(workingDir);
            link.SetDescription(APP_REG_NAME);
            if (!string.IsNullOrEmpty(icoPath) && File.Exists(icoPath))
            {
                link.SetIconLocation(icoPath, 0);
            }

            IPropertyStore propStore = (IPropertyStore)link;
            Guid appUserModelGuid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
            string relaunchCmd = string.Format("\"{0}\" --launch-ui", exePath);
            string relaunchIcon = string.Format("{0},0", !string.IsNullOrEmpty(icoPath) && File.Exists(icoPath) ? icoPath : exePath);

            // PKEY_AppUserModel_ID (5), RelaunchCommand (2), RelaunchIconResource (3), RelaunchDisplayNameResource (4)
            SetPropertyString(propStore, appUserModelGuid, 5, APP_USER_MODEL_ID);
            SetPropertyString(propStore, appUserModelGuid, 2, relaunchCmd);
            SetPropertyString(propStore, appUserModelGuid, 3, relaunchIcon);
            SetPropertyString(propStore, appUserModelGuid, 4, APP_REG_NAME);
            propStore.Commit();

            IPersistFile persistFile = (IPersistFile)link;
            persistFile.Save(lnkPath, true);
        }

        private static void EnsureStartMenuAndTaskbarShortcuts(string baseDir)
        {
            string cleanBase = baseDir.TrimEnd('\\');
            string exePath = Path.Combine(cleanBase, "MPE.exe");
            string icoPath = ResolveIconPath(cleanBase, exePath);
            bool updated = false;

            try
            {
                string programsFolder = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                if (!string.IsNullOrEmpty(programsFolder) && Directory.Exists(programsFolder))
                {
                    string progLnk = Path.Combine(programsFolder, APP_REG_NAME + ".lnk");
                    CreateAppShortcutWithAumid(progLnk, exePath, "--launch-ui", cleanBase, icoPath);
                    updated = true;
                }
            }
            catch
            {
                // Ignora se bloqueado por politica local
            }

            // Repara eventual atalho quebrado "Electron.lnk" fixado na Barra de Tarefas apontando para o electron.exe deste projeto
            try
            {
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                string taskBarDir = Path.Combine(appData, @"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar");
                if (Directory.Exists(taskBarDir))
                {
                    string projectElectronExe1 = Path.GetFullPath(Path.Combine(cleanBase, "codigo", "node_modules", "electron", "dist", "electron.exe"));
                    string projectElectronExe2 = Path.GetFullPath(Path.Combine(cleanBase, "node_modules", "electron", "dist", "electron.exe"));
                    foreach (string lnk in Directory.GetFiles(taskBarDir, "*.lnk"))
                    {
                        try
                        {
                            IShellLinkW existing = (IShellLinkW)new ShellLink();
                            ((IPersistFile)existing).Load(lnk, 0);
                            StringBuilder targetSb = new StringBuilder(520);
                            existing.GetPath(targetSb, targetSb.Capacity, IntPtr.Zero, 0);
                            StringBuilder argsSb = new StringBuilder(520);
                            existing.GetArguments(argsSb, argsSb.Capacity);
                            string target = targetSb.ToString();
                            string fullTarget = string.IsNullOrEmpty(target) ? "" : Path.GetFullPath(target);
                            string fileName = Path.GetFileName(lnk);

                            bool pointsToProjectElectron =
                                !string.IsNullOrEmpty(fullTarget) &&
                                (string.Equals(fullTarget, projectElectronExe1, StringComparison.OrdinalIgnoreCase) ||
                                 string.Equals(fullTarget, projectElectronExe2, StringComparison.OrdinalIgnoreCase) ||
                                 (fileName.StartsWith("Electron", StringComparison.OrdinalIgnoreCase) &&
                                  (fullTarget.IndexOf(cleanBase, StringComparison.OrdinalIgnoreCase) >= 0 ||
                                   argsSb.ToString().IndexOf(cleanBase, StringComparison.OrdinalIgnoreCase) >= 0)));

                            if (pointsToProjectElectron)
                            {
                                string repairedPath = Path.Combine(taskBarDir, APP_REG_NAME + ".lnk");
                                CreateAppShortcutWithAumid(repairedPath, exePath, "--launch-ui", cleanBase, icoPath);
                                if (!string.Equals(lnk, repairedPath, StringComparison.OrdinalIgnoreCase) && File.Exists(lnk))
                                {
                                    File.Delete(lnk);
                                }
                                updated = true;
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }

            if (updated)
            {
                try { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero); } catch { }
            }
        }

        private static void ConfigureWindowsStartup(string baseDir, bool enable)
        {
            string exePath = Path.Combine(baseDir.TrimEnd('\\'), "MPE.exe");
            string cmdValue = string.Format("\"{0}\" --startup", exePath);

            try
            {
                using (RegistryKey runKey = Registry.CurrentUser.OpenSubKey(RUN_SUBKEY, true))
                {
                    if (runKey != null)
                    {
                        runKey.DeleteValue(LEGACY_REG_NAME, false);
                        if (enable)
                        {
                            runKey.SetValue(APP_REG_NAME, cmdValue, RegistryValueKind.String);
                        }
                        else
                        {
                            runKey.DeleteValue(APP_REG_NAME, false);
                        }
                    }
                }

                using (RegistryKey appKey = Registry.CurrentUser.CreateSubKey(APPROVED_SUBKEY))
                {
                    if (appKey != null)
                    {
                        appKey.DeleteValue(LEGACY_REG_NAME, false);
                        if (enable)
                        {
                            byte[] enabledBytes = new byte[] { 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
                            appKey.SetValue(APP_REG_NAME, enabledBytes, RegistryValueKind.Binary);
                        }
                        else
                        {
                            appKey.DeleteValue(APP_REG_NAME, false);
                        }
                    }
                }
            }
            catch
            {
                // Ignora caso politica local bloqueie chave de registro
            }

            EnsureStartMenuAndTaskbarShortcuts(baseDir);

            // Remove atalho redundante da pasta Startup caso exista (evita duplicacao no Gerenciador de Tarefas do Windows)
            try
            {
                string startupFolder = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
                if (!string.IsNullOrEmpty(startupFolder) && Directory.Exists(startupFolder))
                {
                    string lnkPath = Path.Combine(startupFolder, APP_REG_NAME + ".lnk");
                    if (File.Exists(lnkPath))
                    {
                        File.Delete(lnkPath);
                    }
                }
            }
            catch { }
        }

        private static bool ShouldAutoEnableStartup(string baseDir)
        {
            try
            {
                string cfgPath = Path.Combine(baseDir.TrimEnd('\\'), "codigo", "mpe.config.json");
                if (!File.Exists(cfgPath))
                {
                    cfgPath = Path.Combine(baseDir.TrimEnd('\\'), "mpe.config.json");
                }
                if (!File.Exists(cfgPath)) return true;
                string raw = File.ReadAllText(cfgPath);
                if (raw.Contains("\"startWithWindows\": false")) return false;
                return true;
            }
            catch
            {
                return true;
            }
        }

        [STAThread]
        public static void Main(string[] args)
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;

                if (args != null && args.Length > 0)
                {
                    if (args[0] == "--enable-startup")
                    {
                        ConfigureWindowsStartup(baseDir, true);
                        return;
                    }
                    if (args[0] == "--disable-startup")
                    {
                        ConfigureWindowsStartup(baseDir, false);
                        return;
                    }
                    if (args[0] == "--ensure-shortcuts")
                    {
                        EnsureStartMenuAndTaskbarShortcuts(baseDir);
                        return;
                    }
                }

                // Ao abrir o MPE.exe, garante o registro em "Aplicativos de inicializacao" e atalho com AppUserModelID
                if (ShouldAutoEnableStartup(baseDir))
                {
                    ConfigureWindowsStartup(baseDir, true);
                }
                else
                {
                    EnsureStartMenuAndTaskbarShortcuts(baseDir);
                }

                string codigoDir = Path.Combine(baseDir.TrimEnd('\\'), "codigo");
                string appDir = Directory.Exists(codigoDir) ? codigoDir : baseDir.TrimEnd('\\');
                string electronExe = Path.Combine(appDir, "node_modules", "electron", "dist", "electron.exe");
                if (!File.Exists(electronExe))
                {
                    electronExe = Path.Combine(baseDir.TrimEnd('\\'), "node_modules", "electron", "dist", "electron.exe");
                }

                string passedArgs = args != null && args.Length > 0
                    ? string.Join(" ", args)
                    : "--launch-ui";

                try
                {
                    string logsDir = Path.Combine(appDir, "logs");
                    if (!Directory.Exists(logsDir)) Directory.CreateDirectory(logsDir);
                    File.AppendAllText(Path.Combine(logsDir, "mpe_launcher.log"),
                        DateTime.Now.ToString("s") + " [MpeLauncher] Args: " + passedArgs + " | Exe: " + electronExe + " | Exists: " + File.Exists(electronExe) + Environment.NewLine);
                }
                catch { }

                if (File.Exists(electronExe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = electronExe,
                        Arguments = string.Format("\"{0}\" {1}", appDir, passedArgs),
                        WorkingDirectory = appDir,
                        UseShellExecute = true
                    };
                    Process.Start(psi);
                }
                else
                {
                    // Fallback para npx electron caso electron.exe esteja em cache global
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = string.Format("/c npx electron \"{0}\" {1}", appDir, passedArgs),
                        WorkingDirectory = appDir,
                        UseShellExecute = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    Process.Start(psi);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Falha ao inicializar o M.P.E (Mouse Performatico Estrelado):\n" + ex.Message,
                    "M.P.E - Erro de Inicializacao",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
