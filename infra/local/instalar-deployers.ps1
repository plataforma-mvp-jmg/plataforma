# Registra (o quita) dos tareas programadas que arrancan los deployers al iniciar sesion (ADR 0017).
#   .\infra\local\instalar-deployers.ps1             registra las tareas
#   .\infra\local\instalar-deployers.ps1 -Iniciar    registra y las arranca ahora
#   .\infra\local\instalar-deployers.ps1 -Reiniciar  detiene tareas y procesos node del deployer y las vuelve a arrancar
#   .\infra\local\instalar-deployers.ps1 -Desinstalar
# No pide permisos de administrador: las tareas corren con el usuario actual y solo con la sesion iniciada,
# que es cuando corre Docker Desktop. Texto en ASCII a proposito (PowerShell 5.1 sin BOM).
param([switch]$Iniciar, [switch]$Reiniciar, [switch]$Desinstalar)

$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'deployer-tarea.ps1'
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$tareas = 'staging', 'production' | ForEach-Object { "Plataforma MVP - deployer $_" }

function Detener {
  # Stop-ScheduledTask corta el powershell de la tarea pero NO el node que lanzo: queda huerfano, con la
  # configuracion vieja, y un deployer nuevo tomaria los mismos pedidos. Por eso se cortan tambien los node.
  foreach ($nombre in $tareas) { Stop-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*deployer*.env*dist/cli.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "detenido node $($_.ProcessId)" }
}

if ($Reiniciar) {
  Detener
  foreach ($nombre in $tareas) { Start-ScheduledTask -TaskName $nombre; "iniciada: $nombre" }
  return
}

if ($Desinstalar) {
  Detener
  foreach ($nombre in $tareas) {
    Unregister-ScheduledTask -TaskName $nombre -Confirm:$false -ErrorAction SilentlyContinue
    "quitada: $nombre"
  }
  return
}

foreach ($entorno in 'staging', 'production') {
  $nombre = "Plataforma MVP - deployer $entorno"
  $accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Entorno $entorno" `
    -WorkingDirectory $PSScriptRoot
  $disparador = New-ScheduledTaskTrigger -AtLogOn -User $usuario
  # Sin limite de tiempo (por defecto Windows corta a las 72 h), una sola instancia y reinicio si la tarea falla.
  $ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $ajustes `
    -Principal $principal -Force `
    -Description "Deployer de $entorno de la plataforma (pull de GitHub). Logs en infra/local/estado/logs." | Out-Null
  "registrada: $nombre"
  if ($Iniciar) {
    Start-ScheduledTask -TaskName $nombre
    "iniciada: $nombre"
  }
}
