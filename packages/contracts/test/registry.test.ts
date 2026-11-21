import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cargarRegistry, cargarRegistryTolerante } from '../src/index.js';

const base = `id: mod-a
nombre: Módulo A
objetivo: Probar el registry.
area: Sistemas
empresas: [acopio]
duenos: { product_owner: po-a, responsable_tecnico: rt-a }
repo: modulo-mod-a
plantilla: plantilla-modulo@0.1.0
estado: en_desarrollo
riesgo: bajo
criticidad: baja
sox: { en_alcance: false, justificacion: Prueba. }
datos: { clasificacion: interna, datos_personales: false }
agente: { habilitado: false }
menu: { seccion: Sistemas, orden: 1 }
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'registry-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('cargarRegistry', () => {
  it('carga el registry real del repo', () => {
    const r = cargarRegistry(join(process.cwd(), '../../registry'));
    expect(r.map((m) => m.id)).toContain('modulo-ejemplo');
  });

  it('carpeta inexistente → vacío', () => {
    expect(cargarRegistry(join(dir, 'no-existe'))).toEqual([]);
  });

  it('acepta "plataforma" como repo de un módulo de referencia', () => {
    writeFileSync(join(dir, 'mod-a.yaml'), base.replace('repo: modulo-mod-a', 'repo: plataforma'));
    expect(cargarRegistry(dir)[0]?.repo).toBe('plataforma');
  });

  it('I4-4: acepta datos.base postgres', () => {
    writeFileSync(join(dir, 'mod-a.yaml'), base.replace('datos_personales: false }', 'datos_personales: false, base: postgres }'));
    expect(cargarRegistry(dir)[0]?.datos.base).toBe('postgres');
  });

  it('carga un módulo válido', () => {
    writeFileSync(join(dir, 'mod-a.yaml'), base);
    expect(cargarRegistry(dir)[0]).toMatchObject({ id: 'mod-a', riesgo: 'bajo' });
  });

  it.each([
    ['id distinto del archivo', 'otro.yaml', base],
    ['email en un campo', 'mod-a.yaml', base.replace('po-a', 'po@empresa.test')],
    ['URL en un campo', 'mod-a.yaml', base.replace('repo: modulo-mod-a', 'repo: https://github.com/x/y')],
    ['clave desconocida', 'mod-a.yaml', `${base}extra: 1\n`],
    ['motor de base no homologado', 'mod-a.yaml', base.replace('datos_personales: false }', 'datos_personales: false, base: mysql }')],
    ['datos personales con riesgo bajo', 'mod-a.yaml', base.replace('datos_personales: false', 'datos_personales: true')],
    ['repo con otro nombre', 'mod-a.yaml', base.replace('repo: modulo-mod-a', 'repo: modulo-otro')],
    ['plantilla con otro formato', 'mod-a.yaml', base.replace('plantilla-modulo@0.1.0', 'otra@1')],
    [
      'riesgo alto con PO = responsable técnico',
      'mod-a.yaml',
      base.replace('riesgo: bajo', 'riesgo: alto').replace('rt-a', 'po-a'),
    ],
  ])('rechaza: %s', (_c, archivo, contenido) => {
    writeFileSync(join(dir, archivo), contenido);
    expect(() => cargarRegistry(dir)).toThrow(/Registry inválido/);
  });
});

describe('cargarRegistryTolerante (consumidores fijados por SHA)', () => {
  let d: string;
  beforeEach(() => {
    d = mkdtempSync(join(tmpdir(), 'reg-tol-'));
  });

  it('tolera campos que todavía no conoce e ignora archivos rotos de otros módulos', () => {
    writeFileSync(join(d, 'mod-a.yaml'), base.replace('datos_personales: false }', 'datos_personales: false, base: postgres, campo_futuro: 1 }') + 'otro_campo_futuro: x\n');
    writeFileSync(join(d, 'mod-b.yaml'), 'id: mod-b\nrepo: [roto');
    writeFileSync(join(d, 'mod-c.yaml'), 'id: mod-c\nrepo: modulo-mod-c\n');
    writeFileSync(join(d, 'otro-nombre.yaml'), base.replace('id: mod-a', 'id: mod-x'));
    const r = cargarRegistryTolerante(d);
    expect(r.modulos.map((m) => [m.id, m.repo, m.riesgo, m.estado])).toEqual([['mod-a', 'modulo-mod-a', 'bajo', 'en_desarrollo']]);
    expect(r.invalidos).toEqual(['mod-b.yaml', 'mod-c.yaml', 'otro-nombre.yaml']);
    // El estricto, en cambio, rechaza el registry entero.
    expect(() => cargarRegistry(d)).toThrow(/Registry inválido/);
  });

  it('sin carpeta, vacío', () => {
    expect(cargarRegistryTolerante(join(d, 'no-existe'))).toEqual({ modulos: [], invalidos: [] });
  });
});

describe('esquemaManifiesto', () => {
  it('valida el manifiesto de la plantilla y rechaza roles duplicados o campos extra', async () => {
    const { esquemaManifiesto } = await import('../src/index.js');
    const ok = { id: 'notas', version: '0.1.0', roles: [{ id: 'lector', descripcion: 'x' }] };
    expect(esquemaManifiesto.safeParse(ok).success).toBe(true);
    expect(esquemaManifiesto.safeParse({ ...ok, roles: [...ok.roles, ...ok.roles] }).success).toBe(false);
    expect(esquemaManifiesto.safeParse({ ...ok, base_datos: 'prod' }).success).toBe(false);
  });
});
