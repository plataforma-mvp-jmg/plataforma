// Prueba contra un Postgres real. Corre solo con PG_PRUEBA_URL (conexión de un superusuario de una base
// descartable). En la CI no hay Postgres: se omite.
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { crearProveedorBase } from '../src/postgres.js';

const URL_PRUEBA = process.env.PG_PRUEBA_URL ?? '';
const MAESTRA = 'c3'.repeat(24);

async function como<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// Supabase en us-east-1: cada sentencia es un viaje de ida y vuelta, por eso el plazo amplio.
describe.skipIf(URL_PRUEBA === '')('aprovisionamiento real en Postgres', { timeout: 90_000 }, () => {
  it('crea esquema y rol, es idempotente y aísla módulos y entornos', async () => {
    const staging = crearProveedorBase({ urlAdmin: URL_PRUEBA, claveMaestra: MAESTRA, entorno: 'staging' });
    const produccion = crearProveedorBase({ urlAdmin: URL_PRUEBA, claveMaestra: MAESTRA, entorno: 'production' });
    const a = await staging.asegurar('prueba-aaa');
    expect(await staging.asegurar('prueba-aaa')).toEqual(a); // idempotente, misma contraseña
    const b = await staging.asegurar('prueba-bbb');
    const aProd = await produccion.asegurar('prueba-aaa');

    await como(a.url, async (c) => {
      await c.query('CREATE TABLE IF NOT EXISTS tareas (id int primary key)');
      await c.query('INSERT INTO tareas VALUES (1) ON CONFLICT DO NOTHING');
      expect((await c.query('SELECT current_schema() AS s')).rows[0].s).toBe('prueba_aaa_staging');
      await expect(c.query('CREATE TABLE public.intrusa (id int)')).rejects.toThrow(/permission denied/);
      await expect(c.query('CREATE ROLE otro')).rejects.toThrow(/permission denied/);
      await expect(c.query('CREATE SCHEMA otro')).rejects.toThrow(/permission denied/);
      await expect(c.query('DROP SCHEMA prueba_aaa_staging CASCADE')).rejects.toThrow(/must be owner/);
    });
    // Otro módulo y el mismo módulo en producción no ven los datos de staging.
    await como(b.url, (c) => expect(c.query('SELECT * FROM prueba_aaa_staging.tareas')).rejects.toThrow(/permission denied/));
    await como(aProd.url, (c) => expect(c.query('SELECT * FROM prueba_aaa_staging.tareas')).rejects.toThrow(/permission denied/));
  });
});
