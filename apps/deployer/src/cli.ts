// Deployer local del MVP: un proceso por entorno que consulta GitHub cada INTERVALO_SEG.
//   pnpm --filter @plataforma/deployer start   (lee infra/local/deployer.env, fuera de Git)
import { readFileSync } from 'node:fs';
import { cargarRegistry } from '@plataforma/contracts';
import { crearClienteGitHub, crearProveedorTokenApp } from '@plataforma/github';
import { z } from 'zod';
import { crearVerificadorAtestacion } from './atestacion.js';
import { modulosDesplegables, procesarModulo } from './ciclo.js';
import { crearDocker } from './docker.js';
import { crearMapa } from './mapa.js';
import { crearProveedorBase } from './postgres.js';
import { crearSalud } from './salud.js';

const c = z
  .object({
    ORG: z.string().regex(/^[A-Za-z0-9-]+$/),
    ENTORNO: z.enum(['staging', 'production']),
    DEPLOYER_CLIENT_ID: z.string().min(1),
    DEPLOYER_CLAVE_PATH: z.string().min(1),
    REGISTRY_DIR: z.string().default('../../registry'),
    MAPA_PATH: z.string().min(1),
    PUERTOS: z.string().regex(/^\d+-\d+$/),
    INTERVALO_SEG: z.coerce.number().int().min(10).default(20),
    MODULO_PLATFORM_JWKS_URL: z.url(),
    MODULO_PLATFORM_ISSUER: z.string().min(1),
    // I4-4: conexión administrativa (Session pooler de Supabase) y clave para derivar las contraseñas de los roles.
    DB_ADMIN_URL: z.string().regex(/^postgres(ql)?:\/\//, 'debe ser una URL postgresql://').optional(),
    DB_CLAVE_MAESTRA: z.string().regex(/^[0-9a-f]{32,}$/i, 'mínimo 32 caracteres hexadecimales').optional(),
  })
  .refine((v) => !v.DB_ADMIN_URL === !v.DB_CLAVE_MAESTRA, 'DB_ADMIN_URL y DB_CLAVE_MAESTRA van juntas')
  .parse(process.env);

const [desde, hasta] = c.PUERTOS.split('-').map(Number) as [number, number];
const token = crearProveedorTokenApp({
  clientId: c.DEPLOYER_CLIENT_ID,
  clavePrivada: readFileSync(c.DEPLOYER_CLAVE_PATH, 'utf8'),
  org: c.ORG,
  permisos: { deployments: 'write', actions: 'read', metadata: 'read' },
});
const log = (m: string) => process.stdout.write(`${new Date().toISOString()} [${c.ENTORNO}] ${m}\n`);
const ctx = {
  org: c.ORG,
  entorno: c.ENTORNO,
  gh: crearClienteGitHub({ token }),
  docker: crearDocker(),
  atestacion: crearVerificadorAtestacion({ org: c.ORG, workflowFirmante: `${c.ORG}/plataforma/.github/workflows/modulo-publicar.yml`, token }),
  salud: crearSalud(),
  mapa: crearMapa(c.MAPA_PATH),
  rangoPuertos: [desde, hasta] as [number, number],
  envModulo: { PLATFORM_JWKS_URL: c.MODULO_PLATFORM_JWKS_URL, PLATFORM_ISSUER: c.MODULO_PLATFORM_ISSUER },
  ...(c.DB_ADMIN_URL && c.DB_CLAVE_MAESTRA ? { base: crearProveedorBase({ urlAdmin: c.DB_ADMIN_URL, claveMaestra: c.DB_CLAVE_MAESTRA, entorno: c.ENTORNO }) } : {}),
  log,
};

let activo = true;
for (const senal of ['SIGINT', 'SIGTERM'] as const) process.on(senal, () => (activo = false));
log(`deployer iniciado: ${c.ORG}, puertos ${c.PUERTOS}, cada ${c.INTERVALO_SEG} s, base ${c.DB_ADMIN_URL ? new URL(c.DB_ADMIN_URL).hostname : 'sin configurar'}`);
while (activo) {
  for (const m of modulosDesplegables(cargarRegistry(c.REGISTRY_DIR))) {
    try {
      const r = await procesarModulo(m, ctx);
      if (r.estado !== 'sin_pedidos') log(`${r.modulo}: ${r.estado}${r.detalle ? ` (${r.detalle})` : ''}`);
    } catch (err) {
      log(`${m.id}: no se pudo consultar GitHub (${(err as Error).message})`);
    }
  }
  for (let s = 0; s < c.INTERVALO_SEG && activo; s++) await new Promise((r) => setTimeout(r, 1000));
}
log('deployer detenido');
