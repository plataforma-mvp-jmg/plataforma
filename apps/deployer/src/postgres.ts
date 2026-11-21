// Ejecuta el aprovisionamiento contra el Postgres real con la conexión administrativa.
import pg from 'pg';
import { contrasenaRol, nombresBase, sentenciasAprovisionar, sinCredenciales, urlModulo } from './base.js';
import type { BaseModulo, Entorno, ProveedorBase } from './tipos.js';

export function crearProveedorBase(o: { urlAdmin: string; claveMaestra: string; entorno: Entorno }): ProveedorBase {
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
      return { esquema: n.esquema, url: urlModulo(o.urlAdmin, n.rol, contrasena) };
    },
  };
}
