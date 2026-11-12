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

Write-Host "[M.P.E] Binarios nativos compilados com sucesso:"
Write-Host "  -> $hookOut"
Write-Host "  -> $launcherOut"
