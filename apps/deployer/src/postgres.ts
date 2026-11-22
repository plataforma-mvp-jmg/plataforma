// Ejecuta el aprovisionamiento contra el Postgres real con la conexión administrativa.
import pg from 'pg';
import { contrasenaRol, nombresBase, sentenciasAprovisionar, sinCredenciales, urlModulo } from './base.js';
import type { BaseModulo, Entorno, ProveedorBase } from './tipos.js';

export function crearProveedorBase(o: { urlAdmin: string; claveMaestra: string; entorno: Entorno; esperaMs?: number }): ProveedorBase {
  return {
    async asegurar(id: string): Promise<BaseModulo> {
      const n = nombresBase(id, o.entorno);
      const contrasena = contrasenaRol(n.rol, o.claveMaestra);
      const cliente = new pg.Client({ connectionString: o.urlAdmin, connectionTimeoutMillis: 15_000, statement_timeout: 30_000 });
      try {
        await cliente.connect();
        await cliente.query('BEGIN');
        for (const sql of sentenciasAprovisionar(n, contrasena)) await cliente.query(sql);
        await cliente.query('COMMIT');
      } catch (err) {
        await cliente.query('ROLLBACK').catch(() => undefined);
        // Sin `cause`: el error original puede traer la URL de conexión.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(`no se pudo preparar la base: ${sinCredenciales((err as Error).message)}`);
      } finally {
        await cliente.end().catch(() => undefined);
      }
      const url = urlModulo(o.urlAdmin, n.rol, contrasena);
      await probarConexion(url, o.esperaMs ?? 5000);
      return { esquema: n.esquema, url };
    },
  };
}

/**
 * Comprueba que el rol del módulo entra, con reintentos acotados ante `28P01`. Supavisor guarda en caché el
 * verificador de cada rol por nombre: si un rol se recrea (o se le cambió la contraseña), el primer intento puede
 * fallar aunque la contraseña sea correcta, y la falla refresca la caché (ADR 0015). Pocos intentos: muchas
 * fallas seguidas abren el circuit breaker del pooler.
 */
async function probarConexion(url: string, esperaMs: number, intentos = 3): Promise<void> {
  for (let i = 1; ; i++) {
    const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
    try {
      await c.connect();
      await c.query('SELECT 1');
      return;
    } catch (err) {
      const codigo = (err as { code?: string }).code;
      if (codigo !== '28P01' || i >= intentos) {
        // eslint-disable-next-line preserve-caught-error
        throw new Error(`el rol del módulo no puede conectarse: ${sinCredenciales((err as Error).message)}`);
      }
      await new Promise((r) => setTimeout(r, esperaMs));
    } finally {
      await c.end().catch(() => undefined);
    }
  }
}
