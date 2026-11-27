#!/bin/bash
# PreToolUse (Bash): bloquea comandos que saltean los controles de la plataforma.
# Complementa las reglas deny de managed-settings.json, que solo miran el comienzo del comando:
# acá se revisa el comando entero (encadenados con &&, ;, |, subshells). Salida 2 = bloquear.
set -u
entrada=$(timeout 2 cat 2>/dev/null || true)
cmd=$(printf '%s' "$entrada" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$cmd" ] && exit 0

bloquear() {
  echo "Bloqueado por la plataforma: $1. Comando: $cmd" >&2
  exit 2
}

# Separador de palabras: inicio, espacio o cualquier operador de shell.
s='(^|[[:space:];&|()`])'

[[ "$cmd" =~ ${s}git[[:space:]]+push([[:space:]].*)?[[:space:]](--force|-f|--force-with-lease|--mirror|--delete|-d)([[:space:]=]|$) ]] && bloquear "push forzado o que borra ramas"
[[ "$cmd" =~ ${s}git[[:space:]]+push([[:space:]].*)?[[:space:]]\+ ]] && bloquear "push forzado (refspec con +)"
[[ "$cmd" =~ ${s}git[[:space:]]+push([[:space:]].*)?[[:space:]:/](main|master)([[:space:]]|$) ]] && bloquear "push directo a main: los cambios entran por PR"
[[ "$cmd" =~ ${s}git[[:space:]]+(-c[[:space:]]+[^[:space:]]+[[:space:]]+)*config([[:space:]].*)?(credential|url\.|core\.hooksPath|core\.sshCommand) ]] && bloquear "cambiar credenciales o la configuración de git"
[[ "$cmd" =~ ${s}gh[[:space:]]+(pr[[:space:]]+(merge|review)|workflow|run|api|auth|secret|variable|repo[[:space:]]+(edit|delete)|ruleset) ]] && bloquear "esa operación de GitHub la hace una persona o la plataforma"
[[ "$cmd" =~ ${s}(curl|wget|nc|ncat|ssh|scp)([[:space:]]|$) ]] && bloquear "salida a internet no declarada (SEG-16)"
[[ "$cmd" =~ (GH_TOKEN|GITHUB_TOKEN|ANTHROPIC_API_KEY|\.config/gh|\.claude/\.credentials) ]] && bloquear "acceso a credenciales"
[[ "$cmd" =~ ${s}(printenv|env)([[:space:]]|$) ]] && bloquear "listar variables de entorno expone credenciales"
# Escritura sobre archivos que gobierna Sistemas por fuera de las herramientas de edición.
if [[ "$cmd" =~ (\.github/|CODEOWNERS|modulo\.yaml|/etc/claude-code|/opt/plataforma|\.claude/|\.claude[[:space:]]|\.claude$|AGENTS\.md|CLAUDE\.md|CLAUDE\.local\.md) ]] \
   && [[ "$cmd" =~ ([>]|${s}(tee|sed[[:space:]]+-i|perl[[:space:]]+-i|rm|mv|cp|chmod|chown|truncate|install|ln|git[[:space:]]+(rm|mv|checkout|restore))[[:space:]]) ]]; then
  bloquear "los archivos de .github/, CODEOWNERS, modulo.yaml, las instrucciones de la IA (.claude/, AGENTS.md, CLAUDE.md) y la configuración del Studio los cambia Sistemas"
fi
exit 0
