# ADR 0020 — Token de GitHub del workspace: GitHub App propia, 1 hora, un solo repo

- Estado: aceptado (pendiente la prueba T8 contra GitHub real)
- Fecha: 2026-11-27
- Relacionados: ADR 0017 (deployer), ADR 0019 (imagen del workspace), R-7, SEG-16

## Contexto

El workspace (code-server + Claude Code, ADR 0019) necesita empujar ramas y abrir PRs en el repo
del módulo que se está desarrollando. Darle un PAT del Citizen Developer expondría todos sus repos y
sus permisos de aprobación; darle la App del deployer mezclaría funciones (el deployer escribe
deployments y estados, el workspace escribe código).

## Decisión

1. **GitHub App separada `plataforma-mvp-jmg-workspace`** con permisos `contents: write`,
   `pull_requests: write` y `metadata: read`. Sin `workflows`, `administration`, `secrets`,
   `actions` ni `deployments`.
2. **Un token por workspace, acotado a un repo**: `POST /app/installations/{id}/access_tokens` con
   `repositories: [repo]` y los permisos pedidos (`crearEmisorTokensRepo` en `@plataforma/github`).
   El emisor **verifica la respuesta** y descarta el token si alcanza otro repo o trae un permiso
   no pedido. Vida: 1 hora (fija de GitHub); el workspace manager lo renueva.
3. **Qué repo** lo decide una regla única (`repoParaWorkspace` en `@plataforma/contracts`): el
   módulo existe en el registry, su repo es `modulo-<id>`, no es `plataforma` ni
   `plantilla-modulo`, y su estado no es `deprecado` ni `retirado`.
4. **La App no aprueba ni mergea**: aunque `pull_requests: write` permite llamar al merge, los
   rulesets exigen aprobación de un code owner independiente, checks y CodeQL. La identidad del
   bot nunca es code owner.
5. La clave privada vive solo en `C:\Users\PC\.plataforma\workspace.pem` (fuera del repo) y la
   usa el servidor; el contenedor del workspace solo recibe el token de 1 hora.

## Consecuencias

- La App está instalada en *All repositories* para que el aprovisionador no tenga que instalarla en
  cada módulo nuevo. Por eso el acotamiento a un repo es responsabilidad del servidor (puntos 2 y 3):
  quien tenga la clave puede pedir un token para `plataforma`. Riesgo aceptado para el MVP;
  mitigación futura: instalación en repos seleccionados, agregados por el aprovisionador.
- Los commits del agente quedan firmados por `plataforma-mvp-jmg-workspace[bot]`; el autor humano
  se registra como co-autor y como solicitante del PR (GOB-06 sigue usando el autor del PR).
  **A resolver en I5-3:** el PR lo abre el bot, así que policy-check verá al bot como autor; hay que
  decidir si el PR lo abre la persona (con su sesión) o si el bot declara al solicitante.
- Defensa en capas con el workspace: hooks y managed settings bloquean `.github/**` en la máquina;
  el token, además, no tiene permiso `workflows`, así que GitHub rechaza ese cambio aunque se evada
  la capa local.

## Verificación (T8)

`node packages/github/scripts/t8-token-workspace.mjs modulo-tareas-piloto` comprueba, con la App
real: sin acceso a `plataforma` ni a la plantilla; crea rama; rechaza escribir en
`.github/workflows`; commitea en su rama; rechaza escribir directo en `main`; abre PR; no puede
mergear; limpia (cierra el PR y borra la rama).
