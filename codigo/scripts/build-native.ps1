$ErrorActionPreference = "Stop"

$CodeDir = Split-Path -Parent $PSScriptRoot
$RootDir = Split-Path -Parent $CodeDir
$AssetsDir = Join-Path $CodeDir "assets"
$NativeBinDir = Join-Path $CodeDir "src\native\bin"

if (!(Test-Path $AssetsDir)) { New-Item -ItemType Directory -Path $AssetsDir | Out-Null }
if (!(Test-Path $NativeBinDir)) { New-Item -ItemType Directory -Path $NativeBinDir | Out-Null }

# 1. Gerar ícone Dourado & Preto (icon.png e icon.ico) programaticamente via System.Drawing
Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 6, 6, 9))

$goldPenOuter = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 212, 175, 55), 6)
$goldPenInner = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 243, 198, 99), 3)
$bluePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 92, 122, 214), 2)
$goldBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 243, 198, 99))

# Anéis concêntricos e excêntricos do Astrolábio M.P.E
$g.DrawEllipse($goldPenOuter, 16, 16, 224, 224)
$g.DrawEllipse($goldPenInner, 38, 38, 180, 180)
$g.DrawEllipse($goldPenInner, 64, 52, 140, 140)
$g.DrawEllipse($bluePen, 96, 108, 72, 72)

# Linhas vetoriais estelares
$g.DrawLine($goldPenInner, 132, 144, 68, 56)
$g.DrawLine($bluePen, 132, 144, 178, 66)
$g.DrawLine($goldPenInner, 132, 144, 48, 148)

# Nós estelares
$g.FillEllipse($goldBrush, 60, 48, 16, 16)
$g.FillEllipse($goldBrush, 170, 58, 16, 16)
$g.FillEllipse($goldBrush, 40, 140, 16, 16)
$g.FillEllipse($goldBrush, 124, 136, 16, 16)

$pngPath = Join-Path $AssetsDir "icon.png"
$icoPath = Join-Path $AssetsDir "icon.ico"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Criar arquivo .ICO válido com payload PNG 256x256
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
# ICONDIR header
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]1)
# ICONDIRENTRY
$bw.Write([Byte]0)   # 256 width
$bw.Write([Byte]0)   # 256 height
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Close()
$fs.Close()
$g.Dispose()
$bmp.Dispose()

Write-Host "[M.P.E] Icones gerados em assets/icon.ico e assets/icon.png"

# 2. Compilar MpeHook.exe e MPE.exe com o compilador nativo C# do Windows
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (!(Test-Path $csc)) {
    $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

$hookSrc = Join-Path $CodeDir "src\native\MpeHook.cs"
$hookOut = Join-Path $NativeBinDir "MpeHook.exe"
& $csc /nologo /optimize+ /target:exe /out:$hookOut $hookSrc

$launcherSrc = Join-Path $CodeDir "src\native\MpeLauncher.cs"
$launcherOut = Join-Path $RootDir "MPE.exe"
& $csc /nologo /optimize+ /target:winexe /win32icon:$icoPath /out:$launcherOut $launcherSrc

# 3. Gerar MPE-App.exe (copia de electron.exe com identidade/icone do M.P.E no Gerenciador de Tarefas)
$electronDist = Join-Path $CodeDir "node_modules\electron\dist"
$electronExe = Join-Path $electronDist "electron.exe"
$mpeAppExe = Join-Path $electronDist "MPE-App.exe"
if (Test-Path $electronExe) {
    Copy-Item -Path $electronExe -Destination $mpeAppExe -Force
    Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class MpePeBrander {
    private delegate bool EnumResNameProc(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, IntPtr lParam);
    private delegate bool EnumResLangProc(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, ushort wIDLanguage, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hFile, uint dwFlags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr hModule);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumResourceNames(IntPtr hModule, IntPtr lpszType, EnumResNameProc lpEnumFunc, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumResourceLanguages(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, EnumResLangProc lpEnumFunc, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindResourceEx(IntPtr hModule, IntPtr lpType, IntPtr lpName, ushort wLanguage);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LoadResource(IntPtr hModule, IntPtr hResInfo);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LockResource(IntPtr hResData);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SizeofResource(IntPtr hModule, IntPtr hResInfo);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool UpdateResource(IntPtr hUpdate, IntPtr lpType, IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResource(IntPtr hUpdate, bool fDiscard);

    private static byte[] ReadRes(IntPtr hMod, int typeId, IntPtr nameId, ushort lang) {
        IntPtr hRes = FindResourceEx(hMod, new IntPtr(typeId), nameId, lang);
        if (hRes == IntPtr.Zero) return null;
        uint sz = SizeofResource(hMod, hRes);
        if (sz == 0) return null;
        IntPtr hLoaded = LoadResource(hMod, hRes);
        IntPtr ptr = LockResource(hLoaded);
        byte[] buf = new byte[sz];
        Marshal.Copy(ptr, buf, 0, (int)sz);
        return buf;
    }

    public static void ApplyBranding(string sourceExe, string targetExe) {
        IntPtr hSrc = LoadLibraryEx(sourceExe, IntPtr.Zero, 2);
        if (hSrc == IntPtr.Zero) throw new Exception("Nao foi possivel carregar " + sourceExe);
        try {
            var icons = new List<Tuple<IntPtr, byte[]>>();
            byte[] groupIcon = null;
            byte[] versionInfo = null;

            EnumResourceNames(hSrc, new IntPtr(3), (hm, lt, ln, lp) => {
                EnumResourceLanguages(hm, lt, ln, (hm2, lt2, ln2, lang, lp2) => {
                    var data = ReadRes(hm2, 3, ln2, lang);
                    if (data != null) icons.Add(Tuple.Create(ln2, data));
                    return false;
                }, IntPtr.Zero);
                return true;
            }, IntPtr.Zero);

            EnumResourceNames(hSrc, new IntPtr(14), (hm, lt, ln, lp) => {
                EnumResourceLanguages(hm, lt, ln, (hm2, lt2, ln2, lang, lp2) => {
                    groupIcon = ReadRes(hm2, 14, ln2, lang);
                    return false;
                }, IntPtr.Zero);
                return false;
            }, IntPtr.Zero);

            EnumResourceNames(hSrc, new IntPtr(16), (hm, lt, ln, lp) => {
                EnumResourceLanguages(hm, lt, ln, (hm2, lt2, ln2, lang, lp2) => {
                    versionInfo = ReadRes(hm2, 16, ln2, lang);
                    return false;
                }, IntPtr.Zero);
                return false;
            }, IntPtr.Zero);

            IntPtr hUpd = BeginUpdateResource(targetExe, false);
            if (hUpd == IntPtr.Zero) throw new Exception("BeginUpdateResource falhou em " + targetExe);
            bool ok = true;
            try {
                if (versionInfo != null) {
                    ok = ok && UpdateResource(hUpd, new IntPtr(16), new IntPtr(1), 1033, versionInfo, (uint)versionInfo.Length);
                }
                foreach (var ic in icons) {
                    ok = ok && UpdateResource(hUpd, new IntPtr(3), ic.Item1, 1033, ic.Item2, (uint)ic.Item2.Length);
                }
                if (groupIcon != null) {
                    ok = ok && UpdateResource(hUpd, new IntPtr(14), new IntPtr(1), 1033, groupIcon, (uint)groupIcon.Length);
                }
            } finally {
                if (!EndUpdateResource(hUpd, !ok)) {
                    throw new Exception("EndUpdateResource falhou em " + targetExe);
                }
            }
        } finally {
            FreeLibrary(hSrc);
        }
    }
}
"@
    [MpePeBrander]::ApplyBranding($launcherOut, $mpeAppExe)
    Write-Host "  -> $mpeAppExe (identidade M.P.E aplicada)"
}

Write-Host "[M.P.E] Binarios nativos compilados com sucesso:"
Write-Host "  -> $hookOut"
Write-Host "  -> $launcherOut"
