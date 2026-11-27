#!/bin/bash
# PreToolUse (Edit|Write|MultiEdit|NotebookEdit): bloquea cambios en archivos que gobierna Sistemas.
# Salida 2 = bloquear (el mensaje de stderr lo ve la IA). Control preventivo: lo que garantiza es la CI,
# el ruleset y el token de la GitHub App sin permiso sobre workflows (ADR 0019).
set -u
entrada=$(timeout 2 cat 2>/dev/null || true)
ruta=$(printf '%s' "$entrada" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
dir=$(printf '%s' "$entrada" | jq -r '.cwd // empty' 2>/dev/null)
[ -z "$ruta" ] && exit 0
case "$ruta" in /*) ;; *) ruta="${dir:-$PWD}/$ruta" ;; esac
# Normaliza ./ y ../ sin exigir que el archivo exista.
ruta=$(realpath -m -- "$ruta")
base=$(basename -- "$ruta")

bloquear() {
  echo "Bloqueado por la plataforma: $1 ($ruta). Si hace falta cambiarlo, pedilo en la descripción del PR para que lo haga Sistemas." >&2
  exit 2
}

case "/$ruta/" in */.github/*) bloquear "los workflows y la configuración de .github/ los cambia Sistemas" ;; esac
[ "$base" = "CODEOWNERS" ] && bloquear "CODEOWNERS lo cambia Sistemas"
# Instrucciones y configuración de la IA del módulo (prueba real de I5-1: la IA creó .claude/settings.json).
case "/$ruta/" in */.claude/*) bloquear "la configuración de Claude Code del proyecto la define Sistemas" ;; esac
case "$base" in AGENTS.md|CLAUDE.md|CLAUDE.local.md) bloquear "las instrucciones para la IA las cambia Sistemas" ;; esac
[ "$base" = "modulo.yaml" ] && bloquear "el manifiesto del módulo lo cambia Sistemas"
case "$base" in .env|.env.*) bloquear "los archivos .env no se tocan desde el Studio" ;; esac
# Migraciones ya existentes: solo se agregan nuevas (regla 8 de AGENTS.md).
case "/$ruta" in */migraciones/*)
  [ -e "$ruta" ] && bloquear "una migración existente no se edita; agregá una nueva"
  ;;
esac
exit 0
