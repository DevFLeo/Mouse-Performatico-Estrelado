using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

namespace MpeNative
{
    /// <summary>
    /// Executável Nativo Principal (MPE.exe) do Mouse Performático Estrelado.
    /// Inicia o motor gráfico 3D diretamente no Windows sem utilizar localhost ou abrir terminal.
    /// Caso o M.P.E já esteja ativo em segundo plano, aciona imediatamente a interface 3D.
    /// </summary>
    internal static class MpeLauncher
    {
        [STAThread]
        public static void Main(string[] args)
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
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
