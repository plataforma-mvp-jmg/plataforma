# ADR 0017 — Deployers como tareas programadas de Windows

- Estado: aceptado (26/11/2026) · Incremento I5

## Contexto

Los deployers de staging y producción (ADR 0012 y 0014) corrían en primer plano, abiertos a mano en una
terminal. Si la terminal se cerraba o la PC se reiniciaba, los pedidos quedaban pendientes hasta que alguien
los volviera a levantar (no se pierden: el deployer los toma al volver).

Restricción: **Docker Desktop en Windows solo corre con la sesión del usuario iniciada.** Un servicio de
Windows que arranca antes del login no tendría Docker. Para tenerlo habría que reemplazar Docker Desktop
por Docker Engine en WSL y usar un envoltorio de servicios de terceros (por ejemplo, WinSW): más
componentes para mantener en una PC que es solo el entorno del MVP.

## Decisión

Dos **tareas programadas** del usuario (Programador de tareas de Windows), una por entorno, que arrancan al
iniciar sesión. Decisión del responsable del área.

- `infra/local/deployer-tarea.ps1 -Entorno staging|production`:
  - espera a que Docker responda;
  - corre el deployer compilado con su archivo de entorno;
  - si termina por cualquier motivo, lo vuelve a lanzar a los 30 s;
  - guarda la salida en `infra/local/estado/logs/deployer-<entorno>-<fecha>.log` (fuera de Git), con 14 días de retención.
- `infra/local/instalar-deployers.ps1 [-Iniciar] [-Desinstalar]` registra o quita las tareas:
  - usuario actual, `Interactive` y sin elevación;
  - sin límite de tiempo (Windows corta a las 72 h por defecto);
  - una sola instancia y 3 reintentos si la tarea misma falla.
- No requiere instalar nada ni permisos de administrador.

## Consecuencias

- **Arranque solo:** los deployers arrancan con la sesión y se recuperan solos de una caída del proceso.
- **Sin sesión no hay deploys:** con la sesión cerrada no corren, igual que Docker. Los pedidos esperan.
  Es aceptable en el MVP; en la versión corporativa los deployers corren en el servidor o servicio de
  contenedores elegido (doc 09), no en una PC.
- **Compilación:** las tareas usan `apps/deployer/dist`. Después de actualizar `plataforma` hay que
  recompilar (`pnpm --filter "@plataforma/deployer..." build`) y reiniciar las tareas
  (`Stop-ScheduledTask` y `Start-ScheduledTask`, o cerrar y volver a abrir la sesión).
- **No correr dos deployers del mismo entorno a la vez** (uno a mano y otro por la tarea): los dos
  tomarían los mismos pedidos. Antes de instalar las tareas hay que cerrar los que estén abiertos a mano.
- **Secretos:** siguen en `infra/local/deployer*.env`, fuera de Git; la tarea corre con el mismo usuario
  que ya los lee, así que no cambia su exposición.
