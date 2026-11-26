# Monta o pacote MSIX da Microsoft Store a partir do mirante.exe já compilado (npx tauri build).
# A Store assina o pacote na publicação; aqui ele sai sem assinatura.
#
#   pwsh packaging/msix/build-msix.ps1 -Out out/Mirante-windows-x64.msix
#
# Identidade (Partner Center → Produto → Identidade do produto), pelas variáveis de ambiente
# MSIX_IDENTITY_NAME, MSIX_PUBLISHER e MSIX_PUBLISHER_DISPLAY_NAME. Sem elas, usa valores de teste.
param(
  [Parameter(Mandatory)] [string] $Out,
  [string] $Exe = "src-tauri/target/release/mirante.exe"
)
$ErrorActionPreference = "Stop"

$version = (Select-String -Path src-tauri/Cargo.toml -Pattern '^version = "(.+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
$name = if ($env:MSIX_IDENTITY_NAME) { $env:MSIX_IDENTITY_NAME } else { "Mirante.Teste" }
$publisher = if ($env:MSIX_PUBLISHER) { $env:MSIX_PUBLISHER } else { "CN=Mirante Teste" }
$display = if ($env:MSIX_PUBLISHER_DISPLAY_NAME) { $env:MSIX_PUBLISHER_DISPLAY_NAME } else { "José Ribamar" }

# makeappx e makepri vêm do Windows SDK (já instalado nos runners windows-latest)
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" |
  Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1
if (-not $sdk) { throw "makeappx.exe não encontrado (Windows SDK)" }
$bin = $sdk.Directory.FullName

$layout = Join-Path ([IO.Path]::GetTempPath()) "mirante-msix"
Remove-Item $layout -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $layout | Out-Null
Copy-Item $Exe (Join-Path $layout "mirante.exe")
Copy-Item packaging/msix/Assets (Join-Path $layout "Assets") -Recurse

# a Store exige versão com o quarto número 0
$manifest = (Get-Content packaging/msix/AppxManifest.xml -Raw -Encoding utf8).
  Replace("{{IDENTITY_NAME}}", $name).Replace("{{PUBLISHER}}", [Security.SecurityElement]::Escape($publisher)).
  Replace("{{PUBLISHER_DISPLAY_NAME}}", [Security.SecurityElement]::Escape($display)).Replace("{{VERSION}}", "$version.0")
[IO.File]::WriteAllText((Join-Path $layout "AppxManifest.xml"), $manifest, [Text.UTF8Encoding]::new($false))

$pri = Join-Path ([IO.Path]::GetTempPath()) "mirante-priconfig.xml"
& "$bin\makepri.exe" createconfig /cf $pri /dq pt-BR /o | Out-Host
& "$bin\makepri.exe" new /pr $layout /cf $pri /of (Join-Path $layout "resources.pri") /o | Out-Host
if ($LASTEXITCODE) { throw "makepri falhou" }

New-Item -ItemType Directory (Split-Path $Out) -Force | Out-Null
& "$bin\makeappx.exe" pack /d $layout /p $Out /o | Out-Host
if ($LASTEXITCODE) { throw "makeappx falhou" }
Write-Host "MSIX $version ($name) -> $Out"
