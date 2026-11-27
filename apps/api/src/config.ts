// P1: toda la configuración llega por variables de entorno y se valida al arrancar.
import { z } from 'zod';

const vacioComoIndefinido = (v: unknown): unknown => (v === '' ? undefined : v);
const opcional = <T extends z.ZodType>(s: T) => z.preprocess(vacioComoIndefinido, s.optional());

const esquema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // 127.0.0.1 por defecto: en la PC la API no queda expuesta a la red local. Docker usa 0.0.0.0.
    HOST: z.string().default('127.0.0.1'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    ENTORNO: z.enum(['local', 'staging', 'production']).default('local'),
    // Datos de /meta: los inyecta el pipeline al construir la imagen (P5).
    APP_VERSION: z.string().default('0.0.0-dev'),
    APP_COMMIT: z.string().default('desconocido'),
    APP_DIGEST: z.string().default('desconocido'),

    // Identidad (I1-1). Si falta OIDC_CLIENT_ID, el login queda deshabilitado (503).
    PLATFORM_URL_PUBLICA: z.url().default('http://localhost:8088'),
    OIDC_ISSUER: z.url().default('https://accounts.google.com'),
    OIDC_CLIENT_ID: opcional(z.string().min(1)),
    OIDC_CLIENT_SECRET: opcional(z.string().min(1)),
    OIDC_DOMINIO_REQUERIDO: opcional(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'dominio inválido')),
    SESSION_SECRET: opcional(z.string().min(32, 'debe tener al menos 32 caracteres')),
    SESSION_TTL_MIN: z.coerce.number().int().min(5).max(1440).default(480),

    // JWT de plataforma (I1-2). Sin clave privada se usa una efímera (solo ENTORNO=local).
    PLATFORM_ISSUER: z.url().default('http://localhost:8088'),
    PLATFORM_JWT_PRIVATE_JWK: opcional(z.string().min(1)),
    PLATFORM_JWT_PUBLIC_JWK_ANTERIOR: opcional(z.string().min(1)),

    // Roles (I1-3). MVP: YAML local fuera del repo; Fase 1.5: Google Workspace.
    ROLES_PROVEEDOR: z.enum(['yaml']).default('yaml'),
    ROLES_YAML_PATH: z.string().min(1).default('../../infra/local/roles.local.yaml'),

    // Gateway (I1-4): `id=http://host:puerto,...`. Vacío: ningún módulo montado.
    GATEWAY_MODULOS: z.string().default(''),
    // I4-2b: mapa que escribe el deployer (infra/local/estado/despliegues.<entorno>.json). Se relee en caliente.
    GATEWAY_MAPA_PATH: opcional(z.string().min(1)),
    GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),

    // Shell y registry (I1-5). Rutas relativas a apps/api (donde corre `pnpm dev`).
    REGISTRY_DIR: z.string().min(1).default('../../registry'),
    SHELL_DIR: z.string().min(1).default('../shell/dist'),
  })
  .superRefine((c, ctx) => {
    if (c.OIDC_CLIENT_ID && (!c.OIDC_CLIENT_SECRET || !c.SESSION_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_CLIENT_ID'],
        message: 'con OIDC_CLIENT_ID también son obligatorios OIDC_CLIENT_SECRET y SESSION_SECRET',
      });
    }
    if (c.ENTORNO !== 'local' && !c.PLATFORM_JWT_PRIVATE_JWK) {
      ctx.addIssue({
        code: 'custom',
        path: ['PLATFORM_JWT_PRIVATE_JWK'],
        message: 'obligatoria fuera de ENTORNO=local (una clave efímera invalidaría los tokens al reiniciar)',
      });
    }
  });

export type Config = z.infer<typeof esquema>;

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const resultado = esquema.safeParse(env);
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${detalle}`);
  }
  return resultado.data;
}

/** true si el login está configurado (cliente OIDC + secreto de sesión). */
export function authHabilitada(c: Config): boolean {
  return Boolean(c.OIDC_CLIENT_ID && c.OIDC_CLIENT_SECRET && c.SESSION_SECRET);
}

/** Cookies con atributo Secure salvo en http://localhost. */
export function cookiesSeguras(c: Config): boolean {
  return !c.PLATFORM_URL_PUBLICA.startsWith('http://localhost') && !c.PLATFORM_URL_PUBLICA.startsWith('http://127.0.0.1');
}
