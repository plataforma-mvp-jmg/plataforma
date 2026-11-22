// I4-4: base de cada módulo en el Postgres de la plataforma (Supabase en el MVP, ADR 0015).
// Un esquema y un rol por módulo y entorno; el rol solo puede usar su esquema. La contraseña del rol
// se deriva de una clave maestra local (HMAC), así no se guarda en ningún lado ni se rota sin querer.
import { createHmac } from 'node:crypto';
import type { Entorno } from './tipos.js';

export interface NombresBase {
  esquema: string;
  rol: string;
}

const SUFIJO: Record<Entorno, string> = { staging: 'staging', production: 'produccion' };

/** `tareas-piloto` en producción → esquema `tareas_piloto_produccion`, rol `mod_tareas_piloto_produccion`. */
export function nombresBase(id: string, entorno: Entorno): NombresBase {
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(id)) throw new Error(`id de módulo inválido para la base: ${id}`);
  const esquema = `${id.replace(/-/g, '_')}_${SUFIJO[entorno]}`;
  return { esquema, rol: `mod_${esquema}` };
}

/** Contraseña del rol: HMAC-SHA256 de la clave maestra sobre el nombre del rol (64 hex). */
export function contrasenaRol(rol: string, claveMaestra: string): string {
  if (!/^[0-9a-f]{32,}$/i.test(claveMaestra)) throw new Error('DB_CLAVE_MAESTRA inválida (mínimo 32 caracteres hexadecimales)');
  return createHmac('sha256', claveMaestra).update(`plataforma:rol:${rol}`).digest('hex');
}

/**
 * Sentencias idempotentes para dejar el rol y el esquema como tienen que estar. Los nombres salen de
 * `nombresBase` (solo [a-z0-9_]) y la contraseña es hexadecimal: no hay texto del usuario en el SQL.
 */
export function sentenciasAprovisionar(n: NombresBase, contrasena: string): string[] {
  if (!/^[a-z0-9_]+$/.test(n.esquema) || !/^[a-z0-9_]+$/.test(n.rol) || !/^[0-9a-f]+$/.test(contrasena)) {
    throw new Error('nombres o contraseña fuera del formato esperado');
  }
  const rol = `"${n.rol}"`;
  const esquema = `"${n.esquema}"`;
  return [
    // La contraseña se fija SOLO al crear el rol. Volver a asignarla (aunque sea la misma) genera un verificador
    // SCRAM nuevo, y el pooler de Supabase (Supavisor) sigue un rato con el anterior en caché: las conexiones
    // del módulo fallan con "password authentication failed" (pasó en I4-4, ADR 0015).
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${n.rol}') THEN CREATE ROLE ${rol} LOGIN PASSWORD '${contrasena}'; END IF; END $$`,
    // Sin privilegios especiales; VALID UNTIL infinity evita el error de Supavisor con roles vencidos.
    // SUPERUSER, REPLICATION y BYPASSRLS no se tocan: el usuario administrativo de Supabase no es superusuario,
    // no puede otorgarlos y un rol nuevo nace sin ellos.
    `ALTER ROLE ${rol} WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 10 VALID UNTIL 'infinity'`,
    // El esquema queda a nombre del administrador; el rol del módulo lo usa y crea sus tablas, pero no puede
    // borrarlo ni dar permisos sobre él.
    `CREATE SCHEMA IF NOT EXISTS ${esquema}`,
    `REVOKE ALL ON SCHEMA ${esquema} FROM PUBLIC`,
    `GRANT USAGE, CREATE ON SCHEMA ${esquema} TO ${rol}`,
    // Solo su esquema: el search_path no incluye public.
    `ALTER ROLE ${rol} SET search_path = ${esquema}`,
    `ALTER ROLE ${rol} SET statement_timeout = '30s'`,
  ];
}

/** URL del módulo: mismo host que la administrativa; usuario `rol.<project-ref>` si es el pooler de Supabase. */
export function urlModulo(urlAdmin: string, rol: string, contrasena: string): string {
  const u = new URL(urlAdmin);
  const [, ref] = decodeURIComponent(u.username).split('.');
  u.username = encodeURIComponent(ref ? `${rol}.${ref}` : rol);
  u.password = contrasena;
  return u.toString();
}

/** Saca cualquier URL de conexión de un texto (errores, salidas de migración) antes de loguearlo. */
export function sinCredenciales(texto: string): string {
  return texto.replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, 'postgresql://<oculta>');
}
