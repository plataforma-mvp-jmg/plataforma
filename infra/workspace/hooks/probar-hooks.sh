#!/bin/bash
# Pruebas de los hooks. Corren en el build de la imagen: si un hook no bloquea lo que debe
# (o bloquea lo que no debe), la imagen no se construye.
set -u
dir=$(cd "$(dirname "$0")" && pwd)
fallas=0
tmp=$(mktemp -d)
mkdir -p "$tmp/migraciones" && touch "$tmp/migraciones/0001_notas.sql"

bash_() { jq -nc --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c},cwd:"/home/coder/proyecto"}' | "$dir/bash-guard.sh" 2>/dev/null; echo $?; }
edit_() { jq -nc --arg f "$1" --arg d "$tmp" '{tool_name:"Edit",tool_input:{file_path:$f},cwd:$d}' | "$dir/path-guard.sh" 2>/dev/null; echo $?; }

esperar() { # descripcion, esperado, obtenido
  if [ "$2" != "$3" ]; then echo "FALLA: $1 (esperado $2, obtenido $3)"; fallas=$((fallas + 1)); fi
}

# Bash: bloquea (2)
for c in \
  'git push --force origin rama' 'git push -f' 'git push origin +rama' 'git push origin main' \
  'git push origin HEAD:main' 'pnpm test && git push origin main' 'git push --delete origin rama' \
  'gh pr merge 3 --squash' 'gh pr review 3 --approve' 'gh workflow run promover' 'gh api repos/x/y' \
  'gh auth token' 'gh run rerun 1' 'curl https://example.com' 'wget http://x' 'echo $GH_TOKEN' \
  'printenv' 'cat ~/.config/gh/hosts.yml' 'echo x > .github/workflows/ci.yml' \
  'sed -i s/a/b/ .github/workflows/modulo-ci.yml' 'rm CODEOWNERS' 'cp otro.yaml modulo.yaml' \
  'git config credential.helper store' '(cd x; curl http://y)' 'git rm .github/workflows/ci.yml'
do esperar "bash bloquea: $c" 2 "$(bash_ "$c")"; done

# Bash: permite (0)
for c in \
  'pnpm verify' 'git status' 'git add -A && git commit -m "feat: x"' 'git push origin feat/notas-filtro' \
  'git push -u origin feat/x' 'gh pr create --title x --body-file pr.md' 'gh pr view 3' \
  'cat .github/workflows/modulo-ci.yml' 'grep -r rol docs/' 'git diff main' 'ls migraciones'
do esperar "bash permite: $c" 0 "$(bash_ "$c")"; done

# Edición: bloquea (2)
for f in '.github/workflows/modulo-ci.yml' "$tmp/.github/dependabot.yml" 'CODEOWNERS' '.github/CODEOWNERS' \
  'modulo.yaml' '.env' '.env.local' 'migraciones/0001_notas.sql' 'src/../.github/x.yml'
do esperar "edición bloquea: $f" 2 "$(edit_ "$f")"; done

# Edición: permite (0)
for f in 'src/api/rutas.ts' 'tests/unit/notas.test.ts' 'docs/funcional/README.md' 'migraciones/0002_nueva.sql' 'README.md'
do esperar "edición permite: $f" 0 "$(edit_ "$f")"; done

rm -rf "$tmp"
if [ "$fallas" -gt 0 ]; then echo "$fallas prueba(s) de hooks fallaron"; exit 1; fi
echo "hooks: todas las pruebas pasaron"
