# ADR 0015 — Base de datos de los módulos

- Estado: aceptado (21/11/2026) · Incremento I4-4a

## Contexto

Los módulos necesitan persistencia. Para el MVP se eligió Supabase (Postgres gestionado) en el plan
gratuito: un proyecto `plataforma-mvp` (us-east-1). Hechos verificados en la documentación de Supabase:

- La conexión directa del plan gratuito es solo IPv6; desde Docker en la PC se usa el **Session pooler**
  (Supavisor, puerto 5432), que es IPv4.
- Supavisor acepta roles propios con LOGIN; el usuario es `<rol>.<project-ref>`.
- Cambiar la contraseña de un rol puede dejar conexiones fallando en Supavisor; un rol con `VALID UNTIL`
  vencido también falla.
- Dos proyectos gratuitos activos por cuenta; un proyecto sin actividad durante una semana se pausa.
- El usuario administrativo (`postgres`) **no es superusuario**: puede crear roles (CREATEROLE) pero no
  otorgar SUPERUSER, REPLICATION ni BYPASSRLS.

## Decisión

- El registry declara `datos.base: postgres` (lo controla Sistemas por PR).
- **Un esquema y un rol por módulo y entorno**, creados por el deployer de forma idempotente en cada
  despliegue: `tareas_piloto_staging` / `mod_tareas_piloto_staging`.
  - Rol sin privilegios (NOCREATEDB, NOCREATEROLE, NOINHERIT), límite de 10 conexiones,
    `VALID UNTIL 'infinity'`, `search_path` solo su esquema, `statement_timeout` de 30 s.
  - El esquema queda a nombre del administrador; el rol tiene USAGE y CREATE (crea y es dueño de sus
    tablas, pero no puede borrar el esquema ni dar permisos). `PUBLIC` no tiene acceso.
- **Contraseñas derivadas**, no guardadas: HMAC-SHA256 de `DB_CLAVE_MAESTRA` sobre el nombre del rol. Son
  estables (no hay rotación accidental) y distintas por rol. La clave maestra y la URL administrativa viven
  solo en `infra/local/deployer*.env` (fuera de Git).
- **Migraciones antes del corte**: el deployer corre `node dist/migrar.js` de la imagen nueva en un
  contenedor de un solo uso, con el rol del módulo y las mismas restricciones que el módulo. Si fallan, el
  pedido queda en `failure` y la versión anterior sigue atendiendo. Las migraciones van solo hacia adelante
  y tienen que ser compatibles con la versión anterior (conviven durante el cambio).
- El contenedor recibe `DATABASE_URL` (rol del módulo) y `DB_SCHEMA`. Las variables se pasan a Docker por
  el entorno del proceso, no como argumentos. Las URL de conexión se ocultan en logs y en GitHub.
- Probado contra Postgres 16 con un administrador **no superusuario** (como en Supabase): aislamiento entre
  módulos y entre entornos, sin acceso a `public`, sin poder crear roles ni esquemas ni borrar el propio.

## Consecuencias

- **Riesgo aceptado para el MVP:** staging y producción comparten instancia (separación lógica por esquema
  y rol, no física). En la versión corporativa van en instancias separadas.
- El proyecto gratuito se pausa tras una semana sin actividad: los módulos con base fallan hasta
  reactivarlo desde el panel (runbook).
- La región es us-east-1: unos 150 ms de ida y vuelta desde Rosario. Para la versión corporativa, una región
  más cercana (São Paulo).
- Sin backups en el plan gratuito; los datos del MVP son sintéticos (P7).
- Las tablas que crea un módulo son de su rol: si un módulo se retira, su esquema y rol se borran a mano.
- La plantilla 0.7.0 trae el cliente de Postgres y `dist/migrar.js`; un módulo con `datos.base` y sin ese
  archivo falla en la migración y no se despliega.
