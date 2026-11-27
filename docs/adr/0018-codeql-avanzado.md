# ADR 0018 — CodeQL con configuración avanzada en los módulos

- Estado: propuesto (27/11/2026) · Consolidación de I4. Se acepta después de la prueba en `plantilla-modulo`.
- Modifica la ADR del I3-3 (CodeQL por defecto activado por el aprovisionador).

## Contexto

Desde I3-3, el aprovisionador activa la **configuración por defecto** de CodeQL en cada módulo, y el ruleset
exige sus resultados (`code_scanning`: alertas altas o críticas, o errores, bloquean el merge).

Hallazgo del 26/11/2026: la configuración por defecto **no analizó** los PRs de Dependabot de ningún módulo
(check `CodeQL: neutral — 2 configurations not found`, sin jobs `Analyze`). Con aprobación y `resumen` en
verde, GitHub respondía *"the base branch policy prohibits the merge"*. Hubo que reabrir cada PR desde la
cuenta autor para que corriera el análisis. Con Dependabot agrupado, eso pasaría todas las semanas.

**[Hecho, documentación de GitHub]** Para Dependabot se recomienda analizar con el evento `pull_request`:
con ese evento, code scanning siempre acepta la subida de resultados.

## Decisión

Decisión del responsable del área: **CodeQL con configuración avanzada**, como un control más de la plataforma.

- Workflow reutilizable `.github/workflows/modulo-codeql.yml` en `plataforma`. Cada módulo lo llama
  **fijado por SHA** desde `modulo-ci.yml`, igual que `modulo-pr` y `modulo-publicar` (ADR 0010).
- Lenguajes `javascript-typescript` y `actions`, sin compilación, con la suite por defecto (la misma que
  usaba la configuración por defecto, para no abrir alertas nuevas por el cambio).
- **Mismas categorías** que la configuración por defecto (`/language:<lenguaje>`): los PRs se comparan contra
  los análisis que ya tiene `main`.
- La configuración por defecto se **desactiva**: si queda activa, GitHub rechaza la subida de resultados
  de un workflow.
- El ruleset no cambia: sigue exigiendo resultados de CodeQL.

## Orden de transición (por repo)

1. Desactivar la configuración por defecto.
2. Mergear el PR que agrega la llamada a `modulo-codeql.yml`. El análisis de ese PR ya lo hace el workflow.

Entre el paso 1 y el 2, un PR de otro tema queda sin análisis y no se puede mergear. Por eso los dos pasos
se hacen seguidos.

## Consecuencias

- Los PRs de Dependabot se analizan y se pueden mergear sin intervención.
- La versión de CodeQL la fija la plataforma (acción por SHA, actualizada por Dependabot en `plataforma`),
  no GitHub por su cuenta.
- El aprovisionador deja de activar la configuración por defecto y pasa a desactivarla (PR aparte, después de la prueba).
- Riesgo: un módulo que no llame al workflow queda sin análisis y, con la regla `code_scanning`, sin poder
  mergear. Es un fallo seguro (bloquea, no deja pasar), y `modulo-ci.yml` lo protege CODEOWNERS.
