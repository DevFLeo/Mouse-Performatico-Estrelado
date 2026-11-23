using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
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

        private sealed class MiniJsonParser
        {
            private readonly string _src;
            private int _pos;

            private MiniJsonParser(string src)
            {
                _src = src ?? "";
                _pos = 0;
            }

            public static Dictionary<string, object> ParseObject(string json)
            {
                if (string.IsNullOrEmpty(json)) return null;
                MiniJsonParser parser = new MiniJsonParser(json);
                parser.SkipWhitespace();
                if (parser._pos < parser._src.Length && parser._src[parser._pos] == '\uFEFF')
                {
                    parser._pos++;
                    parser.SkipWhitespace();
                }
                if (parser._pos >= parser._src.Length || parser._src[parser._pos] != '{')
                {
                    return null;
                }
                Dictionary<string, object> root = parser.ParseObjectValue();
                parser.SkipWhitespace();
                if (parser._pos != parser._src.Length)
                {
                    throw new FormatException("Trailing characters after JSON document.");
                }
                return root;
            }

            private void SkipWhitespace()
            {
                while (_pos < _src.Length)
                {
                    char c = _src[_pos];
                    if (c == ' ' || c == '\t' || c == '\r' || c == '\n')
                    {
                        _pos++;
                    }
                    else
                    {
                        break;
                    }
                }
            }

            private char Peek()
            {
                if (_pos >= _src.Length) throw new FormatException("Unexpected end of JSON.");
                return _src[_pos];
            }

            private object ParseValue()
            {
                SkipWhitespace();
                char c = Peek();
                if (c == '{') return ParseObjectValue();
                if (c == '[') return ParseArrayValue();
                if (c == '"') return ParseString();
                if (c == 't') return ParseLiteral("true", true);
                if (c == 'f') return ParseLiteral("false", false);
                if (c == 'n') return ParseLiteral("null", null);
                if (c == '-' || (c >= '0' && c <= '9')) return ParseNumber();
                throw new FormatException("Unexpected token in JSON.");
            }

            private Dictionary<string, object> ParseObjectValue()
            {
                if (_src[_pos] != '{') throw new FormatException("Expected '{'.");
                _pos++;
                Dictionary<string, object> dict = new Dictionary<string, object>(StringComparer.Ordinal);
                SkipWhitespace();
                if (_pos < _src.Length && _src[_pos] == '}')
                {
                    _pos++;
                    return dict;
                }

                while (true)
                {
                    SkipWhitespace();
                    if (Peek() != '"') throw new FormatException("Expected string key.");
                    string key = ParseString();
                    SkipWhitespace();
                    if (Peek() != ':') throw new FormatException("Expected ':'.");
                    _pos++;
                    object val = ParseValue();
                    dict[key] = val;
                    SkipWhitespace();
                    char next = Peek();
                    if (next == '}')
                    {
                        _pos++;
                        return dict;
                    }
                    if (next != ',') throw new FormatException("Expected ',' or '}'.");
                    _pos++;
                }
            }

            private List<object> ParseArrayValue()
            {
                if (_src[_pos] != '[') throw new FormatException("Expected '['.");
                _pos++;
                List<object> list = new List<object>();
                SkipWhitespace();
                if (_pos < _src.Length && _src[_pos] == ']')
                {
                    _pos++;
                    return list;
                }

                while (true)
                {
                    object val = ParseValue();
                    list.Add(val);
                    SkipWhitespace();
                    char next = Peek();
                    if (next == ']')
                    {
                        _pos++;
                        return list;
                    }
                    if (next != ',') throw new FormatException("Expected ',' or ']'.");
                    _pos++;
                }
            }

            private string ParseString()
            {
                if (_src[_pos] != '"') throw new FormatException("Expected '\"'.");
                _pos++;
                StringBuilder sb = new StringBuilder();
                while (_pos < _src.Length)
                {
                    char c = _src[_pos++];
                    if (c == '"') return sb.ToString();
                    if (c < 0x20) throw new FormatException("Unescaped control char in JSON string.");
                    if (c == '\\')
                    {
                        if (_pos >= _src.Length) throw new FormatException("Unterminated escape.");
                        char esc = _src[_pos++];
                        switch (esc)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'u':
                                if (_pos + 4 > _src.Length) throw new FormatException("Invalid unicode escape.");
                                string hex = _src.Substring(_pos, 4);
                                int codePoint;
                                if (!int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out codePoint))
                                {
                                    throw new FormatException("Invalid unicode hex.");
                                }
                                sb.Append((char)codePoint);
                                _pos += 4;
                                break;
                            default:
                                throw new FormatException("Invalid escape character.");
                        }
                    }
                    else
                    {
                        sb.Append(c);
                    }
                }
                throw new FormatException("Unterminated JSON string.");
            }

            private object ParseLiteral(string literal, object value)
            {
                if (_pos + literal.Length > _src.Length ||
                    string.Compare(_src, _pos, literal, 0, literal.Length, StringComparison.Ordinal) != 0)
                {
                    throw new FormatException("Invalid JSON literal.");
                }
                _pos += literal.Length;
                return value;
            }

            private object ParseNumber()
            {
                int start = _pos;
                if (_src[_pos] == '-') _pos++;
                if (_pos >= _src.Length) throw new FormatException("Invalid JSON number.");
                if (_src[_pos] == '0')
                {
                    _pos++;
                }
                else if (_src[_pos] >= '1' && _src[_pos] <= '9')
                {
                    while (_pos < _src.Length && _src[_pos] >= '0' && _src[_pos] <= '9') _pos++;
                }
                else
                {
                    throw new FormatException("Invalid JSON number.");
                }

                bool isFloat = false;
                if (_pos < _src.Length && _src[_pos] == '.')
                {
                    isFloat = true;
                    _pos++;
                    if (_pos >= _src.Length || _src[_pos] < '0' || _src[_pos] > '9')
                    {
                        throw new FormatException("Invalid JSON fraction.");
                    }
                    while (_pos < _src.Length && _src[_pos] >= '0' && _src[_pos] <= '9') _pos++;
                }

                if (_pos < _src.Length && (_src[_pos] == 'e' || _src[_pos] == 'E'))
                {
                    isFloat = true;
                    _pos++;
                    if (_pos < _src.Length && (_src[_pos] == '+' || _src[_pos] == '-')) _pos++;
                    if (_pos >= _src.Length || _src[_pos] < '0' || _src[_pos] > '9')
                    {
                        throw new FormatException("Invalid JSON exponent.");
                    }
                    while (_pos < _src.Length && _src[_pos] >= '0' && _src[_pos] <= '9') _pos++;
                }

                string rawNum = _src.Substring(start, _pos - start);
                if (!isFloat)
                {
                    long lVal;
                    if (long.TryParse(rawNum, NumberStyles.Integer, CultureInfo.InvariantCulture, out lVal))
                    {
                        return lVal;
                    }
                }
                double dVal;
                if (double.TryParse(rawNum, NumberStyles.Float, CultureInfo.InvariantCulture, out dVal))
                {
                    return dVal;
                }
                throw new FormatException("Invalid JSON number value.");
            }
        }

        private static string QuoteWindowsArg(string arg)
        {
            if (string.IsNullOrEmpty(arg)) return "\"\"";
            bool needsQuotes = false;
            for (int i = 0; i < arg.Length; i++)
            {
                char c = arg[i];
                if (c == ' ' || c == '\t' || c == '"')
                {
                    needsQuotes = true;
                    break;
                }
            }
            if (!needsQuotes) return arg;

            StringBuilder sb = new StringBuilder();
            sb.Append('"');
            int backslashes = 0;
            for (int i = 0; i < arg.Length; i++)
            {
                char c = arg[i];
                if (c == '\\')
                {
                    backslashes++;
                }
                else if (c == '"')
                {
                    sb.Append('\\', backslashes * 2 + 1);
                    sb.Append('"');
                    backslashes = 0;
                }
                else
                {
                    if (backslashes > 0)
                    {
                        sb.Append('\\', backslashes);
                        backslashes = 0;
                    }
                    sb.Append(c);
                }
            }
            if (backslashes > 0)
            {
                sb.Append('\\', backslashes * 2);
            }
            sb.Append('"');
            return sb.ToString();
        }

        private static string FormatCommandLineArgs(string[] args)
        {
            if (args == null || args.Length == 0) return "--launch-ui";
            string[] quoted = new string[args.Length];
            for (int i = 0; i < args.Length; i++)
            {
                quoted[i] = QuoteWindowsArg(args[i]);
            }
            return string.Join(" ", quoted);
        }

        private static string ResolveConfigPath(string baseDir, string[] args)
        {
            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    string arg = args[i] ?? "";
                    if (arg.StartsWith("--config-path=", StringComparison.OrdinalIgnoreCase))
                    {
                        return arg.Substring("--config-path=".Length).Trim('"', '\'');
                    }
                    if (string.Equals(arg, "--config-path", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                    {
                        return (args[i + 1] ?? "").Trim('"', '\'');
                    }
                }
            }

            string envPath = Environment.GetEnvironmentVariable("MPE_CONFIG_PATH");
            if (!string.IsNullOrEmpty(envPath))
            {
                return envPath.Trim('"', '\'');
            }

            string cleanBase = (baseDir ?? "").TrimEnd('\\');
            string cfgPath = Path.Combine(cleanBase, "codigo", "mpe.config.json");
            if (File.Exists(cfgPath)) return cfgPath;
            cfgPath = Path.Combine(cleanBase, "mpe.config.json");
            return cfgPath;
        }

        private static bool ShouldAutoEnableStartup(string baseDir, string[] args)
        {
            try
            {
                string cfgPath = ResolveConfigPath(baseDir, args);
                if (string.IsNullOrEmpty(cfgPath) || !File.Exists(cfgPath)) return false;

                string raw = File.ReadAllText(cfgPath, Encoding.UTF8);
                Dictionary<string, object> root = MiniJsonParser.ParseObject(raw);
                if (root == null) return false;

                object consentObj;
                if (!root.TryGetValue("consent", out consentObj)) return false;
                Dictionary<string, object> consentDict = consentObj as Dictionary<string, object>;
                if (consentDict == null) return false;

                object acceptedObj;
                if (!consentDict.TryGetValue("accepted", out acceptedObj)) return false;
                if (!(acceptedObj is bool) || !(bool)acceptedObj) return false;

                object permsObj;
                if (consentDict.TryGetValue("permissions", out permsObj))
                {
                    Dictionary<string, object> permsDict = permsObj as Dictionary<string, object>;
                    if (permsDict != null)
                    {
                        object bgObj;
                        if (permsDict.TryGetValue("backgroundExecution", out bgObj))
                        {
                            if (!(bgObj is bool) || !(bool)bgObj) return false;
                        }
                    }
                }

                object systemObj;
                if (root.TryGetValue("system", out systemObj))
                {
                    Dictionary<string, object> systemDict = systemObj as Dictionary<string, object>;
                    if (systemDict != null)
                    {
                        object startObj;
                        if (systemDict.TryGetValue("startWithWindows", out startObj))
                        {
                            if (startObj is bool && !(bool)startObj) return false;
                        }
                    }
                }

                return true;
            }
            catch
            {
                return false;
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
                if (ShouldAutoEnableStartup(baseDir, args))
                {
                    ConfigureWindowsStartup(baseDir, true);
                }
                else
                {
                    EnsureStartMenuAndTaskbarShortcuts(baseDir);
                }

                string codigoDir = Path.Combine(baseDir.TrimEnd('\\'), "codigo");
                string appDir = Directory.Exists(codigoDir) ? codigoDir : baseDir.TrimEnd('\\');
                string mpeAppExe = Path.Combine(appDir, "node_modules", "electron", "dist", "MPE-App.exe");
                string electronExe = File.Exists(mpeAppExe)
                    ? mpeAppExe
                    : Path.Combine(appDir, "node_modules", "electron", "dist", "electron.exe");
                if (!File.Exists(electronExe))
                {
                    string altMpeApp = Path.Combine(baseDir.TrimEnd('\\'), "node_modules", "electron", "dist", "MPE-App.exe");
                    electronExe = File.Exists(altMpeApp)
                        ? altMpeApp
                        : Path.Combine(baseDir.TrimEnd('\\'), "node_modules", "electron", "dist", "electron.exe");
                }

                string passedArgs = FormatCommandLineArgs(args);

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
