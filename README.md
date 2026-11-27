# plataforma

Plataforma de desarrollo gobernado: los creadores desarrollan módulos con IA dentro de los
controles de Sistemas (PR, revisión, CI, staging, aprobación y deploy), y los usuarios finales
los usan integrados en un único Shell.

> **MVP:** repo público con datos sintéticos únicamente. No contiene información corporativa.

## Requisitos

- Node.js 26 LTS (`.nvmrc`)
- pnpm vía Corepack. Desde Node 25 Corepack no viene incluido; en una consola de administrador:
  `npm install -g corepack@latest` y `corepack enable pnpm`
- Docker con Docker Compose

## Inicio rápido

```bash
pnpm install
pnpm verify                      # lint + tipos + tests + build
pnpm dev                         # API en http://localhost:3000/health
```

Con Docker:

```bash
cp infra/local/.env.example infra/local/.env   # completar PG_DEV_PASSWORD
docker compose -f infra/local/docker-compose.yml up --build
curl http://127.0.0.1:8080/health
```

## Endpoints de sistema (contrato E4)

| Endpoint | Respuesta |
|---|---|
| `GET /health` | Proceso vivo |
| `GET /ready` | Dependencias listas (503 si alguna falla) |
| `GET /meta` | Versión, commit, digest y entorno |

## Login con Google (I1-1)

1. Completar en `infra/local/.env`: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` y `SESSION_SECRET` (ver `.env.example`).
2. En Google Cloud, el URI de redirección autorizado debe ser `http://localhost:8080/auth/callback`.
3. `pnpm dev` y abrir `http://localhost:8080/auth/login?returnTo=/auth/me`.

| Endpoint | Qué hace |
|---|---|
| `GET /auth/login?returnTo=/ruta` | Redirige a Google (PKCE + state + nonce) |
| `GET /auth/callback` | Valida el login, crea la sesión y vuelve a `returnTo` |
| `GET /auth/me` | Usuario de la sesión (401 sin sesión) |
| `POST /auth/logout` | Cierra la sesión |

Sin `OIDC_CLIENT_ID` el login queda deshabilitado (`/auth/*` responde 503) y el resto de la API funciona.

> **Al actualizar:** compará tu `infra/local/.env` con `.env.example`; las variables nuevas
> no se agregan solas.

## JWT de plataforma (I1-2)

La API firma tokens ES256 de 5 minutos con `aud` por módulo (`modulo:<id>`) o `plataforma`.
Los módulos los verifican con `@plataforma/auth` contra `GET /.well-known/jwks.json`.

| Endpoint | Qué hace |
|---|---|
| `GET /.well-known/jwks.json` | Claves públicas (vigente y, en rotación, la anterior) |
| `GET /auth/token-diagnostico?aud=modulo:<id>` | **Solo `ENTORNO=local`.** Token y claims para el usuario logueado |

```ts
import { crearVerificador, tokenDeHeader } from '@plataforma/auth';
const verificar = crearVerificador({ jwksUrl: process.env.PLATFORM_JWKS_URL!, issuer: process.env.PLATFORM_ISSUER!, audiencia: 'modulo:<id>' });
const claims = await verificar(tokenDeHeader(req.headers.authorization) ?? '');
```

## Roles (I1-3)

1. `Copy-Item infra\local\roles.example.yaml infra\local\roles.local.yaml` (Git lo ignora).
2. Poner tu email de Google y los roles. La API relee el archivo al guardarlo; si queda inválido,
   mantiene la versión anterior y lo registra en el log. Si es inválido al arrancar, la API no inicia.
3. `GET /auth/me` muestra tus roles; el JWT lleva los roles del módulo de su `aud` y tus empresas.

## Gateway de módulos (I1-4)

`pnpm dev` levanta la API (8080) y el **módulo de ejemplo** (`apps/modulo-ejemplo`, 3101).
Con `GATEWAY_MODULOS=modulo-ejemplo=http://127.0.0.1:3101` en el `.env`, abrir
`http://localhost:8080/m/modulo-ejemplo/`.

En cada request a `/m/<id>/…` el gateway:

1. Verifica la sesión (sin sesión: redirige al login o responde 401).
2. Exige al menos un rol del usuario en ese módulo (si no: 403, la request no llega al módulo).
3. Emite un JWT de 5 minutos con `aud=modulo:<id>` y los roles de ese módulo.
4. Reenvía con `Authorization: Bearer …` y `x-correlation-id`; **quita la cookie de sesión** y
   cualquier `Authorization` del cliente, y descarta los `Set-Cookie` que devuelva el módulo.
5. Rechaza rutas que intentan salir del prefijo (`..`, `%2e%2e`, `%2f`) y responde 502 si el módulo no está disponible.

## Shell (I1-5)

`http://localhost:8080/` es la pantalla de los usuarios finales (React + Vite + Mantine, en
`apps/shell`). Muestra solo los módulos del **registry** (`registry/<id>.yaml`) que están montados
en el gateway y en los que el usuario tiene algún rol; cada módulo se abre dentro del Shell.

- `pnpm dev` compila el Shell y lo recompila al guardar (`vite build --watch`): recargá el navegador.
- El Shell se sirve con CSP estricta (solo mismo origen; nadie puede embeber la plataforma).
- Un `registry/<id>.yaml` inválido impide arrancar la API (se valida con Zod: sin emails ni URLs,
  PO ≠ responsable técnico en riesgo alto o SOX, datos personales ⇒ riesgo ≥ medio).

## Aprovisionamiento de módulos (I2-3)

Dar de alta un módulo es un PR que agrega `registry/<id>.yaml` con `repo: modulo-<id>`. Al mergearlo,
el workflow `aprovisionamiento` (ADR 0008):

1. crea `modulo-<id>` en la org (público, datos sintéticos) y da *Write* al team `sistemas`;
2. activa secret scanning, push protection y alertas de Dependabot;
3. protege `main` con el ruleset del riesgo (1 aprobación; 2 en riesgo alto);
4. crea los environments (`staging`, `aceptacion-negocio` en riesgo medio o alto, y `production`);
5. abre un PR con la plantilla (`plantilla-modulo` en el tag de la versión del registry);
6. cuando `main` ya tiene código, activa CodeQL y exige en el ruleset que no haya alertas altas.

Es idempotente: corre también una vez por día y se puede lanzar desde *Actions → aprovisionamiento → Run workflow*.

## Políticas de los módulos (I3)

`policies/catalogo.yaml` define qué se exige a cada módulo según su riesgo y `policy-check` lo
verifica en la CI del módulo (ADR 0009). Para probarlo a mano contra un módulo clonado:

```bash
pnpm --filter "@plataforma/policy-check..." build
node packages/policy-check/dist/cli.js --modulo ../modulo-x --plataforma . --repo modulo-x --pr-body pr.md
```

Una excepción se pide por PR a `policies/excepciones.yaml`, con justificación, mitigación y
vencimiento de hasta 90 días.

Los módulos corren todos sus controles con el workflow reutilizable
`.github/workflows/modulo-pr.yml`, fijado por SHA desde su `modulo-ci.yml` (ADR 0010). Al mergear en
`main`, `modulo-publicar.yml` prueba la imagen, la publica en GHCR por digest y firma las atestaciones
de procedencia y SBOM (ADR 0011).

## Configuración de GitHub (una vez)

El repo vive en la organización gratuita `plataforma-mvp-jmg` (ADR 0007): las GitHub Apps solo
pueden crear repos en organizaciones, y el aprovisionamiento de módulos (I2) lo necesita.

1. **Org:** permiso base *No permission*; los miembros no crean repos (solo owners y la App).
2. **Team `sistemas`:** solo revisores (MVP: `jmgarciarivoiro1-ops`); el autor **no** es miembro.
   Rol *Write* en el repo. Es el code owner de todo (`.github/CODEOWNERS`).
3. **Ruleset de `main`:** Settings → Rules → Rulesets → *Import a ruleset* → `github/rulesets/main-plataforma.json`.
4. **GitHub App `aprovisionamiento`** (ver ADR 0008): client ID en la variable y clave en el secreto del
   environment `aprovisionamiento`, restringido a `main`.
5. **Seguridad:** *Secret scanning*, *Push protection* y alertas de Dependabot.
   **Después de transferir un repo, verificarlas:** la transferencia las apaga.

## Cómo contribuir

Ver `AGENTS.md` (aplica a personas y a agentes de IA). Una historia por PR, tests primero,
`pnpm verify` en verde y aprobación de Sistemas.

## Deployer de staging (I4-2a)

`apps/deployer` despliega en el Docker local las imágenes que publica `modulo-publicar` (ADR 0012).
Solo acepta pedidos del workflow, de la imagen del propio módulo, por digest y con atestación válida.

1. Copiar `infra/local/deployer.env.example` a `infra/local/deployer.env` y completarlo.
2. `pnpm --filter @plataforma/deployer build && pnpm --filter @plataforma/deployer start`
3. Cada módulo publicado queda en `http://127.0.0.1:<puerto>`; el mapa está en `infra/local/estado/`.

### Base de datos de los módulos (I4-4)

Un módulo con `datos.base: postgres` en el registry recibe un esquema y un rol propios por entorno en el
Postgres de la plataforma (Supabase en el MVP). El deployer los crea, corre las migraciones de la imagen
nueva antes del corte y le pasa `DATABASE_URL` y `DB_SCHEMA` al contenedor (ADR 0015). Configurar
`DB_ADMIN_URL` y `DB_CLAVE_MAESTRA` en `infra/local/deployer*.env`.

### Producción (I4-3)

El módulo dispara **Actions → promover** con el digest que está en staging. GitHub pide las aprobaciones
según el riesgo (PO en `aceptacion-negocio` para medio/alto; Sistemas en `production`) y recién entonces se
crea el pedido. El deployer de producción verifica las aprobaciones por API (ADR 0014):

1. Copiar `infra/local/deployer.production.env.example` a `infra/local/deployer.production.env`.
2. `pnpm --filter @plataforma/deployer start:production`

Con `GATEWAY_MAPA_PATH` en el `.env`, la API monta esos módulos en `/m/<id>/` y los relee en caliente,
sin reiniciar (ADR 0013). El Shell los muestra a quien tenga rol en el módulo.

### Deployers como tareas programadas (I5)

Para no depender de una terminal abierta, los dos deployers pueden correr como tareas programadas que
arrancan al iniciar sesión (ADR 0017): esperan a Docker, se reinician solos si terminan y guardan logs
diarios en `infra/local/estado/logs/`.

1. Cerrar los deployers que estén abiertos a mano: dos deployers del mismo entorno tomarían los mismos pedidos.
2. `pnpm --filter "@plataforma/deployer..." build`
3. `.\infra\local\instalar-deployers.ps1 -Iniciar` (sin permisos de administrador).

Después de actualizar `plataforma`: recompilar y reiniciar las tareas
(`Stop-ScheduledTask` / `Start-ScheduledTask -TaskName "Plataforma MVP - deployer staging"`, ídem `production`).
Para quitarlas: `.\infra\local\instalar-deployers.ps1 -Desinstalar`.
