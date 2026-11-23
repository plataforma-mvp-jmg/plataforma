# ADR 0014 — Promoción a producción con aprobación verificada

- Estado: aceptado (21/11/2026) · Incremento I4-3

## Contexto

Producción exige segregación de funciones (SOX): quien pide un cambio no puede aprobarlo, y tiene que
quedar evidencia de quién aprobó qué. Hechos verificados en I4-1 e I4-2a:

- Un deployment creado por la API **no** pasa por las reglas de protección del environment.
- Las reglas sí frenan a un **job** que usa el environment, hasta que apruebe un revisor requerido; con
  `prevent_self_review`, quien disparó el run no puede aprobarlo.
- `GET /repos/{o}/{r}/actions/runs/{id}/approvals` devuelve las aprobaciones de un run (estado, usuario y
  environments), y `GET …/runs/{id}` informa el workflow reutilizable usado (`referenced_workflows`), quién
  lo disparó (`triggering_actor`), el evento y la rama.
- GitHub crea además un deployment propio por cada job que usa un environment.

## Decisión

- **Pedido:** workflow reutilizable `modulo-promover.yml`, llamado por el módulo **fijado por SHA** desde un
  `workflow_dispatch` sobre `main`, con el digest a promover.
  1. `preparar`: lee el riesgo del registry (main de la plataforma) y comprueba que el digest tuvo un
     despliegue exitoso en staging (aviso temprano).
  2. `negocio` (riesgo medio/alto): environment `aceptacion-negocio`, lo aprueba el PO.
  3. `producción (pedido de despliegue)`: environment `production` (team `sistemas`, sin autoaprobación).
     Recién aprobado crea el deployment con `{imagen, digest, run_id}` y `task: deploy:plataforma`.
- **Verificación en el deployer de producción** (no confía en el pedido, consulta todo por API):
  1. creador `github-actions[bot]`, imagen del módulo por digest y `run_id` presente;
  2. el run usa `<org>/plataforma/.github/workflows/modulo-promover.yml`, es `workflow_dispatch` sobre
     `main` y no terminó con error;
  3. **cada environment requerido por el riesgo tiene una aprobación de alguien distinto de quien disparó
     el run**; ninguna revisión rechazada;
  4. el pedido se creó **mientras corría el job de producción de ese run** (otro workflow del repo que
     copie el `run_id` fuera de esa ventana queda afuera);
  5. ningún despliegue exitoso anterior usó el mismo run (cada aprobación vale una vez);
  6. el **mismo digest** tuvo un despliegue exitoso en staging;
  7. la misma atestación que exige staging.
- **Evidencia:** el estado del deployment en GitHub registra quién pidió, quién aprobó y el run; el mapa de
  producción guarda aprobadores y run.
- Los dos entornos filtran por `task: deploy:plataforma`; los deployments automáticos de GitHub se ignoran.
- Un proceso del deployer por entorno (`start:production`, `deployer.production.env`), con otro rango de
  puertos (4500–4599) y otro mapa. Misma GitHub App.

## Consecuencias

- Riesgo residual aceptado para el MVP: un workflow del propio módulo con `deployments: write` podría crear
  un pedido con el `run_id` aprobado **durante** los segundos en que corre el job de producción. Lo acota
  la revisión obligatoria de Sistemas sobre `.github/` (CODEOWNERS) y la ventana del job; se cierra con
  *required workflows* de organización (Fase 1.5) o firmando el pedido.
- En el MVP no hay instancia de la API para producción: el mapa de producción queda escrito y verificado,
  y el Shell sigue mostrando staging.
- La revisión simulada (cuenta `jmgarciarivoiro1-ops`) no es evidencia SOX: demuestra el mecanismo.
- Los pedidos de staging de módulos en la plantilla 0.5.0 (sin `task`) dejan de procesarse hasta pasar a
  la 0.6.0.

## Rollback (I4-5, 23/11/2026)

- Un rollback es una promoción a un digest anterior por el mismo workflow, con las mismas aprobaciones y la
  misma verificación. No se agrega un camino de emergencia que saltee la aprobación.
- El deployer y el workflow buscan el despliegue exitoso en staging **en todo el historial** (paginado, hasta
  1000 despliegues), no solo en los últimos 30: el digest anterior es justamente uno viejo.
- El resumen del run de promover muestra los últimos despliegues exitosos de producción y marca el pedido como
  *Rollback* si el digest ya estuvo en producción.
- Con base de datos, el rollback no deshace migraciones; la regla de migraciones compatibles con la versión
  anterior es lo que lo hace seguro. Procedimiento en `docs/runbook-produccion.md`.
