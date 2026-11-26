# Registra (o quita) dos tareas programadas que arrancan los deployers al iniciar sesion (ADR 0017).
#   .\infra\local\instalar-deployers.ps1             registra las tareas
#   .\infra\local\instalar-deployers.ps1 -Iniciar    registra y las arranca ahora
#   .\infra\local\instalar-deployers.ps1 -Desinstalar
# No pide permisos de administrador: las tareas corren con el usuario actual y solo con la sesion iniciada,
# que es cuando corre Docker Desktop. Texto en ASCII a proposito (PowerShell 5.1 sin BOM).
param([switch]$Iniciar, [switch]$Desinstalar)

$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'deployer-tarea.ps1'
$usuario = "$env:USERDOMAIN\$env:USERNAME"

foreach ($entorno in 'staging', 'production') {
  $nombre = "Plataforma MVP - deployer $entorno"
  if ($Desinstalar) {
    Stop-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $nombre -Confirm:$false -ErrorAction SilentlyContinue
    "quitada: $nombre"
    continue
  }
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
