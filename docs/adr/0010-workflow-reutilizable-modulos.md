# ADR 0010 — Workflow reutilizable de controles para los módulos

- Estado: aceptado (15/11/2026) · Incremento I3-2

## Contexto

Si cada módulo define su propia CI, un cambio en su repo puede debilitar los controles. Los controles
tienen que ser los mismos en todos los módulos y cambiar solo por decisión de Sistemas.

## Decisión

- `plataforma/.github/workflows/modulo-pr.yml` (`workflow_call`) con los controles obligatorios:
  copia de auth, lint, tipos, tests con cobertura, build, **policy-check**, gitleaks y osv-scanner.
- Cada módulo lo llama **fijado por SHA** desde `.github/workflows/modulo-ci.yml`, y un job propio
  `resumen` exige que haya pasado (es el check obligatorio del ruleset). Cambiar el SHA es un PR
  aprobado por Sistemas (CODEOWNERS sobre `.github/`).
- El workflow ejecuta sus propios comandos (`eslint`, `tsc`, `vitest --coverage` con `json-summary`)
  en lugar de los scripts del `package.json` del módulo, y borra `coverage/` antes de los tests.
- **Versión de los datos:** el código y el catálogo de políticas salen de `plataforma` en el SHA
  fijado (`job.workflow_repository` y `job.workflow_sha`, contexto disponible en github.com desde
  abril de 2026). El registry y las excepciones salen de `main`: un alta nueva o una excepción
  aprobada se aplican sin cambiar el SHA, y las excepciones vencidas dejan de valer por fecha.
- `resumen-ci.json` queda como artefacto (30 días) con archivo, línea y sugerencia para la IA.

## Consecuencias

- Actualizar los controles de todos los módulos = PR en `plataforma` + PR por módulo con el SHA nuevo
  (lo puede automatizar Dependabot o el aprovisionador más adelante).
- **Límite conocido:** en un PR, GitHub ejecuta el workflow del propio PR; quien edite
  `modulo-ci.yml` podría quitar la llamada. Lo cubre la revisión obligatoria de Sistemas sobre
  `.github/`. Los *required workflows* a nivel organización (rulesets de org) requieren un plan pago:
  se evalúan en la Fase 1.5.
- La configuración de lint, tipos y cobertura sigue en el repo del módulo (con CODEOWNERS); moverla a
  paquetes compartidos de `plataforma` queda para cuando se publiquen (GitHub Packages, Fase 1.5).
- `actionlint` 1.7.12 todavía no conoce `job.workflow_*` y da avisos falsos en esas líneas.

## Actualización (21/11/2026, después de I4-4)

Agregar `datos.base` al registry bloqueó los PR de todos los módulos: los controles fijados por SHA
validaban el registry vivo (`main`) con un esquema viejo y estricto (`Unrecognized key: "base"`).
Desde entonces `policy-check` usa `cargarRegistryTolerante`: valida solo lo que necesita (id, repo,
estado, riesgo), tolera campos nuevos e ignora con un aviso los archivos de otros módulos que no pueda
leer. La validación estricta del registry sigue en la CI de plataforma y en la API. Regla: un campo
nuevo en el registry tiene que ser opcional para los consumidores fijados.
