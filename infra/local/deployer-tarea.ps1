# Corre un deployer (staging o production) con reinicio automatico y log diario (ADR 0017).
# Lo lanza la tarea programada que crea instalar-deployers.ps1; tambien se puede correr a mano.
# Texto en ASCII a proposito: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.
param([Parameter(Mandatory = $true)][ValidateSet('staging', 'production')][string]$Entorno)

$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$deployer = Join-Path $raiz 'apps\deployer'
$envFile = if ($Entorno -eq 'staging') { '../../infra/local/deployer.env' } else { '../../infra/local/deployer.production.env' }
$logs = Join-Path $PSScriptRoot 'estado\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function ArchivoLog { Join-Path $logs ("deployer-$Entorno-" + (Get-Date -Format 'yyyy-MM-dd') + '.log') }
function Log([string]$mensaje) {
  $linea = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') + " [tarea $Entorno] $mensaje`r`n"
  [IO.File]::AppendAllText((ArchivoLog), $linea, (New-Object System.Text.UTF8Encoding($false)))
}

while ($true) {
  # Retencion: 14 dias de logs por entorno.
  Get-ChildItem $logs -Filter "deployer-$Entorno-*.log" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -ErrorAction SilentlyContinue

  # Docker Desktop tarda en arrancar despues de iniciar sesion: sin Docker el deployer no sirve.
  $intentos = 0
  while ($true) {
    $version = cmd /c "docker info --format {{.ServerVersion}} 2>nul"
    if ($LASTEXITCODE -eq 0 -and $version) { break }
    if ($intentos % 12 -eq 0) { Log 'esperando a Docker' }
    $intentos++
    Start-Sleep -Seconds 5
  }

  if (-not (Test-Path (Join-Path $deployer 'dist\cli.js'))) {
    Log 'falta apps/deployer/dist/cli.js: correr pnpm --filter "@plataforma/deployer..." build'
    Start-Sleep -Seconds 60
    continue
  }

  $log = ArchivoLog
  Log 'iniciando'
  Push-Location $deployer
  try {
    # cmd para que la salida de node quede en UTF-8 tal cual (las redirecciones de PS 5.1 la pasan a UTF-16).
    cmd /c "node --env-file-if-exists=$envFile dist/cli.js >> `"$log`" 2>&1"
    $codigo = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  Log "termino con codigo $codigo; reinicio en 30 s"
  Start-Sleep -Seconds 30
}
