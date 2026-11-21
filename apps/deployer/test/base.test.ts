import { describe, expect, it } from 'vitest';
import { contrasenaRol, nombresBase, sentenciasAprovisionar, sinCredenciales, urlModulo } from '../src/base.js';

const MAESTRA = 'a1'.repeat(24);

describe('base de los módulos (I4-4)', () => {
  it('esquema y rol por módulo y entorno', () => {
    expect(nombresBase('tareas-piloto', 'staging')).toEqual({ esquema: 'tareas_piloto_staging', rol: 'mod_tareas_piloto_staging' });
    expect(nombresBase('tareas-piloto', 'production')).toEqual({ esquema: 'tareas_piloto_produccion', rol: 'mod_tareas_piloto_produccion' });
    expect(() => nombresBase('X; drop', 'staging')).toThrow('id de módulo inválido');
  });

  it('la contraseña se deriva: siempre la misma para el rol, distinta entre roles y entre claves', () => {
    const a = contrasenaRol('mod_x_staging', MAESTRA);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(contrasenaRol('mod_x_staging', MAESTRA)).toBe(a);
    expect(contrasenaRol('mod_x_produccion', MAESTRA)).not.toBe(a);
    expect(contrasenaRol('mod_x_staging', 'b2'.repeat(24))).not.toBe(a);
    expect(() => contrasenaRol('mod_x_staging', 'corta')).toThrow('DB_CLAVE_MAESTRA inválida');
  });

  it('sentencias: rol sin privilegios, esquema propio, sin public en el search_path', () => {
    const sql = sentenciasAprovisionar(nombresBase('tareas-piloto', 'staging'), 'ab12').join('\n');
    expect(sql).toContain('CREATE ROLE "mod_tareas_piloto_staging" LOGIN');
    expect(sql).toContain('LOGIN NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 10');
    expect(sql).toContain("VALID UNTIL 'infinity'");
    expect(sql).toContain('GRANT USAGE, CREATE ON SCHEMA "tareas_piloto_staging" TO "mod_tareas_piloto_staging"');
    expect(sql).toContain('REVOKE ALL ON SCHEMA "tareas_piloto_staging" FROM PUBLIC');
    expect(sql).toContain('SET search_path = "tareas_piloto_staging"');
    expect(() => sentenciasAprovisionar({ esquema: 'x"; drop', rol: 'r' }, 'ab')).toThrow('fuera del formato');
    expect(() => sentenciasAprovisionar({ esquema: 'x', rol: 'r' }, "ab'; --")).toThrow('fuera del formato');
  });

  it('URL del módulo: usuario rol.<ref> en el pooler de Supabase; rol solo en conexión directa', () => {
    const pooler = new URL(urlModulo('postgresql://postgres.abcref:p%40ss@aws-1.pooler.supabase.com:5432/postgres', 'mod_x_staging', 'ff00'));
    expect(pooler.username).toBe('mod_x_staging.abcref');
    expect(pooler.password).toBe('ff00');
    expect(pooler.host).toBe('aws-1.pooler.supabase.com:5432');
    expect(pooler.pathname).toBe('/postgres');
    expect(new URL(urlModulo('postgresql://postgres:x@localhost:5432/postgres', 'mod_x_staging', 'ff00')).username).toBe('mod_x_staging');
  });

  it('saca las URL de conexión de los textos que van al log', () => {
    expect(sinCredenciales('falló postgresql://u.ref:clave@host:5432/postgres por timeout')).toBe('falló postgresql://<oculta> por timeout');
    expect(sinCredenciales("url 'postgres://a:b@c/d'")).toBe("url 'postgresql://<oculta>'");
  });
});
