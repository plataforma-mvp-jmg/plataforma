# ADR 0019 — Imagen del workspace del Studio (I5-1)

- Estado: aceptado (27/11/2026) · Incremento I5 (Studio con IA)
- Base: ADR-046 (Claude Code con settings administrados) y ADR-049 (la IA nunca mergea, aprueba ni despliega) del doc 05.

## Contexto

En I5 cada creador trabaja en un contenedor con code-server y Claude Code (docs 05 y 13). Hace falta una
imagen con versiones fijas y controles que el usuario no pueda cambiar desde adentro.

**[Hechos, documentación de Claude Code]**
- En Linux, los settings administrados se leen de `/etc/claude-code/managed-settings.json` y se aplican
  por encima de los del usuario, el proyecto y la línea de comandos.
- `allowManagedPermissionRulesOnly` hace que se ignoren las reglas de permisos de cualquier otra fuente,
  `allowManagedHooksOnly` hace lo mismo con los hooks, y `permissions.disableBypassPermissionsMode: "disable"`
  impide el modo que saltea los permisos.
- Un hook `PreToolUse` recibe la llamada como JSON por stdin (`tool_input.command`, `tool_input.file_path`).
  Si sale con código 2, la llamada se bloquea y la IA ve el mensaje.

## Decisión

`infra/workspace/` en `plataforma`:

- **Dockerfile:**
  - `codercom/code-server:4.146.0` y Node 26 (el de la plataforma) fijados por digest;
  - Claude Code `2.1.332`, corepack `0.36.0` y `gh` `2.106.0` (con verificación de hash), instalados como root;
  - usuario `coder` sin permisos de root.
- **`managed-settings.json`** (root, `0444`):
  - solo reglas y hooks administrados, sin modo bypass;
  - **deny:** leer `.env`, secretos, `~/.ssh` y las credenciales de `gh`; editar `.github/`, `modulo.yaml` y `CODEOWNERS`; `git push --force`; `gh pr merge|review`, `gh workflow|run|api|auth|secret`; `curl` y `wget`;
  - **ask:** `git push`, `pnpm add` y `gh pr create`.
- **Hooks** (root, `0555`), porque las reglas `Bash(...)` solo miran el comienzo del comando:
  - `bash-guard.sh` revisa el comando entero, incluidos los encadenados: push forzado o directo a `main`, cambios en la configuración de git, operaciones de GitHub reservadas a personas, salida a internet, acceso a credenciales y escritura sobre los archivos de Sistemas;
  - `path-guard.sh` bloquea editar `.github/`, `CODEOWNERS`, `modulo.yaml`, `.env*` y **migraciones ya existentes** (las nuevas se permiten).
- **`probar-hooks.sh`:** 50 casos (que bloquee lo que debe y deje pasar lo legítimo). Corre en el `docker build`: si falla, la imagen no se construye. La CI de `plataforma` construye la imagen y verifica que los settings y los hooks no sean escribibles por el usuario.

## Consecuencias

- Son controles **preventivos** (capa ① del doc 05). Un comando suficientemente ofuscado puede escapar
  a un hook basado en patrones. Lo que **garantiza** sigue siendo:
  - el token de la GitHub App del workspace (I5-2), sin permiso sobre workflows ni administración;
  - el ruleset (PR obligatorio, aprobación de Sistemas, el último push lo aprueba otra persona);
  - la CI.
- **Probado en la PC:** el build corre las 50 pruebas en verde. El usuario `coder` no puede crear ni
  sobrescribir archivos en `/etc/claude-code` ni actualizar Claude Code (`npm install -g` falla).
- **[A validar en I5-3, con sesión iniciada]:**
  - que Claude Code aplique los settings administrados (por ejemplo, que rechace editar `.github/`);
  - que `DISABLE_AUTOUPDATER=1` evite el intento de actualización.
- La salida de red restringida (SEG-16, doc 05) no está en la imagen: va en la red del contenedor (I5-3).
- Actualizar Claude Code o code-server es un PR que cambia el `ARG` o el digest y pasa por la CI.
