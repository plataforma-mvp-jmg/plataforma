# Runbook — promoción y rollback a producción

> Procedimiento operativo del MVP (I4-3, I4-5). Decisiones en ADR 0014 (promoción) y ADR 0015 (base).

## Principio

A producción se llega **por un solo camino**: el workflow **promover** del módulo, con el digest de una imagen
que ya estuvo sana en staging, la aprobación de otra persona y la verificación del deployer. Un rollback es una
promoción más, hacia un digest anterior: mismas aprobaciones, misma evidencia. No hay atajo de emergencia que
saltee la aprobación.

## Promover una versión nueva

1. Copiar el digest de staging: resumen del run de publicación del módulo, o
   `gh api "repos/<org>/<repo>/deployments?environment=staging&per_page=5" --jq '.[] | .payload.digest'`.
2. Actions → **promover** → Run workflow sobre `main` con ese digest (lo dispara quien pide el cambio).
3. Aprueban el PO (`aceptacion-negocio`, riesgo medio/alto) y Sistemas (`production`). Quien disparó el run no
   puede aprobar.
4. El deployer de producción verifica y despliega. El estado del deployment registra quién pidió y quién aprobó.

## Rollback

**Cuándo:** la versión nueva en producción falla y la corrección no está lista.

1. Ver qué estuvo antes en producción: el resumen del run de **promover** muestra los últimos despliegues
   exitosos; o
   `gh api "repos/<org>/<repo>/deployments?environment=production&task=deploy:plataforma&per_page=10" --jq '.[] | [.id, .payload.digest, .created_at] | @tsv'`.
2. Disparar **promover** con el **digest anterior**. El run lo marca como *Rollback*.
3. Aprobaciones como en cualquier promoción. Para que no dependa de una sola persona, el team `sistemas` tiene
   que tener más de un revisor (hoy, en el MVP, hay uno).
4. El deployer despliega la versión anterior en un puerto nuevo, comprueba `/health` y `/meta` y recién ahí retira
   la que falla. Si la anterior no arranca, sigue la actual y el pedido queda en `failure`.

**Tiempo esperado:** el de la aprobación más un ciclo del deployer (≈ 20 s) y la descarga de la imagen.

## Rollback con base de datos

Un rollback cambia la **imagen**, no la base. Las migraciones aplicadas por la versión nueva **quedan**:

- Por eso la regla de `AGENTS.md`: cada migración tiene que ser **compatible con la versión anterior** (agregar
  tablas o columnas nullable o con default; no borrar ni renombrar lo que la anterior usa). Con esa regla, la
  versión anterior funciona sobre el esquema nuevo y el rollback es seguro.
- La versión anterior no vuelve a migrar: su runner ve las migraciones nuevas como ya aplicadas y no hace nada
  (registra solo las que conoce).
- **No se puede volver a una versión anterior a la adopción de la base** (una imagen sin `dist/migrar.js`, por
  ejemplo de la plantilla < 0.7.0) en un módulo con `datos.base`: la migración falla y el deployer mantiene la
  versión actual. Es intencional: esa versión no sabe usar la base.
- **Si una migración no fue compatible** (por ejemplo, borró una columna que la versión anterior lee), el rollback
  de imagen no alcanza: la versión anterior va a fallar el health check y el deployer la va a rechazar,
  manteniendo la actual. Opciones, en orden:
  1. **Corregir hacia adelante:** una versión nueva con una migración que repare, por el circuito normal.
  2. Restaurar la base: **no disponible en el MVP** (plan gratuito de Supabase sin backups). En la versión
     corporativa, restauración a un punto en el tiempo con procedimiento aprobado.

## Verificación después de promover o volver atrás

```powershell
gh api "repos/<org>/<repo>/deployments?environment=production&per_page=1" --jq '.[0].id' | % { gh api "repos/<org>/<repo>/deployments/$_/statuses" --jq '.[0].description' }
Get-Content infra\local\estado\despliegues.production.json
curl.exe -s http://127.0.0.1:<puerto>/ready
```
