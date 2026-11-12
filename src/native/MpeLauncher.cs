using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
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
    /// Executável Nativo Principal (MPE.exe) do Mouse Performático Estrelado.
    /// Inicia o motor gráfico 3D diretamente no Windows sem utilizar localhost ou abrir terminal.
    /// Registra também o aplicativo em "Aplicativos de inicialização" do Windows (Gerenciador de Tarefas).
    /// </summary>
    internal static class MpeLauncher
    {
        private const string RUN_SUBKEY = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string APPROVED_SUBKEY = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
        private const string APP_REG_NAME = "M.P.E - Mouse Performatico Estrelado";
        private const string LEGACY_REG_NAME = "MPE_MousePerformaticoEstrelado";

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

            try
            {
                string startupFolder = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
                if (!string.IsNullOrEmpty(startupFolder) && Directory.Exists(startupFolder))
                {
                    string lnkPath = Path.Combine(startupFolder, "M.P.E - Mouse Performatico Estrelado.lnk");
                    if (enable)
                    {
                        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                        if (shellType != null)
                        {
                            object shell = Activator.CreateInstance(shellType);
                            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                            Type scType = shortcut.GetType();
                            scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { exePath });
                            scType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { "--startup" });
                            scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { baseDir.TrimEnd('\\') });
                            scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "M.P.E - Mouse Performatico Estrelado (DevFLeo)" });
                            string icoPath = Path.Combine(baseDir.TrimEnd('\\'), "assets", "icon.ico");
                            if (File.Exists(icoPath))
                            {
                                scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { icoPath });
                            }
                            scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                        }
                    }
                    else if (File.Exists(lnkPath))
                    {
                        File.Delete(lnkPath);
                    }
                }
            }
            catch
            {
                // Ignora caso a pasta Startup nao permita escrita
            }
        }

        private static bool ShouldAutoEnableStartup(string baseDir)
        {
            try
            {
                string cfgPath = Path.Combine(baseDir.TrimEnd('\\'), "mpe.config.json");
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
                }

                // Ao abrir o MPE.exe, garante o registro em "Aplicativos de inicializacao" do Windows caso habilitado no JSON
                if (ShouldAutoEnableStartup(baseDir))
                {
                    ConfigureWindowsStartup(baseDir, true);
                }

                string electronExe = Path.Combine(baseDir, "node_modules", "electron", "dist", "electron.exe");

                string passedArgs = args != null && args.Length > 0
                    ? string.Join(" ", args)
                    : "--launch-ui";

                if (File.Exists(electronExe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = electronExe,
                        Arguments = string.Format("\"{0}\" {1}", baseDir.TrimEnd('\\'), passedArgs),
                        WorkingDirectory = baseDir,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    Process.Start(psi);
                }
                else
                {
                    // Fallback para npx electron caso electron.exe esteja em cache global
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = string.Format("/c npx electron \"{0}\" {1}", baseDir.TrimEnd('\\'), passedArgs),
                        WorkingDirectory = baseDir,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    Process.Start(psi);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Falha ao inicializar o M.P.E (Mouse Performático Estrelado):\n" + ex.Message,
                    "M.P.E - Erro de Inicialização",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
