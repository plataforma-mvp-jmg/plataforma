import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adaptarPlantilla } from '../src/contenido.js';
import { ambientesDeseados, debeAprovisionarse, tagDePlantilla } from '../src/deseado.js';
import { modulo } from './modulo.js';

function plantilla(readme = '# plantilla-modulo\n') {
  const dir = mkdtempSync(join(tmpdir(), 'cont-'));
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "plantilla-modulo",\n  "description": "plantilla-modulo"\n}\n');
  writeFileSync(join(dir, 'modulo.yaml'), 'id: plantilla-modulo\n');
  writeFileSync(join(dir, 'README.md'), readme);
  return dir;
}

describe('adaptarPlantilla', () => {
  it('reemplaza solo el nombre del paquete, el id y el encabezado', () => {
    expect(adaptarPlantilla(plantilla(), modulo())).toEqual(['package.json', 'modulo.yaml', 'README.md']);
  });

  it('falla si la plantilla cambió y un reemplazo no encaja exactamente una vez', () => {
    expect(() => adaptarPlantilla(plantilla('# otra cosa\n'), modulo())).toThrow('README.md: se esperaba 1 coincidencia');
    expect(() => adaptarPlantilla(plantilla('# plantilla-modulo\n# plantilla-modulo\n'), modulo())).toThrow('hay 2');
  });
});

describe('reglas de la configuración deseada', () => {
  it('tag de la plantilla', () => {
    expect(tagDePlantilla('plantilla-modulo@1.2.3', 'plantilla-modulo')).toBe('v1.2.3');
    expect(() => tagDePlantilla('plantilla-modulo@latest', 'plantilla-modulo')).toThrow('no soportada');
  });

  it('qué módulos se aprovisionan', () => {
    expect(debeAprovisionarse(modulo())).toBe(true);
    expect(debeAprovisionarse(modulo({ estado: 'deprecado' }))).toBe(true);
    expect(debeAprovisionarse(modulo({ estado: 'retirado' }))).toBe(false);
    expect(debeAprovisionarse(modulo({ repo: 'plataforma' }))).toBe(false);
  });

  it('production siempre lo aprueba Sistemas y nunca quien despliega', () => {
    for (const riesgo of ['bajo', 'medio', 'alto'] as const) {
      const prod = ambientesDeseados(modulo({ riesgo }), 'sistemas').at(-1);
      expect(prod).toEqual({ nombre: 'production', revisores: [{ tipo: 'Team', slug: 'sistemas' }], prevenirAutoAprobacion: true });
    }
  });

  it('riesgo medio o alto: aceptación del PO, que tampoco puede aprobar su propio pedido', () => {
    const m = modulo({ riesgo: 'medio', duenos: { product_owner: 'po-notas', responsable_tecnico: 'rt-notas' } });
    expect(ambientesDeseados(m, 'sistemas').find((a) => a.nombre === 'aceptacion-negocio')).toEqual({
      nombre: 'aceptacion-negocio',
      revisores: [{ tipo: 'User', login: 'po-notas' }],
      prevenirAutoAprobacion: true,
    });
    expect(ambientesDeseados(modulo({ riesgo: 'bajo' }), 'sistemas').map((a) => a.nombre)).toEqual(['staging', 'production']);
  });
});
