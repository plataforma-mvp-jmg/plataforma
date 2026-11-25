import { rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cargarCatalogo, evaluar, type Excepcion, type ResultadoEvaluacion } from '../src/index.js';
import { CUERPO_PR_OK, escribir, moduloValido, registro } from './fixture.js';

// El catálogo real del repo: si alguien lo cambia, estos tests lo ejercitan.
const catalogo = cargarCatalogo(join(import.meta.dirname, '../../../policies/catalogo.yaml'));
const HOY = '2026-11-15';

function correr(dir: string, o: { riesgo?: 'bajo' | 'medio' | 'alto'; cuerpoPr?: string | null; autorPr?: string; excepciones?: Excepcion[]; repo?: string } = {}) {
  return evaluar({
    dir,
    repo: o.repo ?? 'modulo-notas',
    registry: [registro({ riesgo: o.riesgo ?? 'bajo', ...(o.riesgo === 'alto' ? { duenos: { product_owner: 'a', responsable_tecnico: 'b' } } : {}) })],
    catalogo,
    excepciones: o.excepciones ?? [],
    cuerpoPr: o.cuerpoPr === undefined ? CUERPO_PR_OK : o.cuerpoPr,
    autorPr: o.autorPr,
    hoy: HOY,
  });
}

const estado = (r: ResultadoEvaluacion, id: string) => r.politicas.find((p) => p.id === id)?.estado;
const fallas = (r: ResultadoEvaluacion, id: string) => r.politicas.find((p) => p.id === id)?.fallas.map((f) => f.mensaje) ?? [];

describe('módulo que cumple todo', () => {
  it('no bloquea y todas las políticas dan ok', () => {
    const r = correr(moduloValido());
    expect(r.bloquea).toBe(false);
    expect(r.politicas.map((p) => p.estado)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(r).toMatchObject({ modulo: 'notas', perfil: 'B' });
  });
});

describe('ARQ-01 · estructura', () => {
  it.each(['AGENTS.md', 'docs/runbook.md', '.github/CODEOWNERS', 'Dockerfile'])('falta %s → bloquea', (f) => {
    const dir = moduloValido();
    unlinkSync(join(dir, f));
    const r = correr(dir);
    expect(r.bloquea).toBe(true);
    expect(fallas(r, 'ARQ-01')).toContain(`falta ${f}`);
  });

  it('sin tests o con CLAUDE.md que no importa AGENTS.md → bloquea', () => {
    const dir = moduloValido();
    rmSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(join(dir, 'CLAUDE.md'), 'hola\n');
    expect(fallas(correr(dir), 'ARQ-01')).toEqual(['no hay tests (tests/**/*.test.ts)', 'CLAUDE.md no importa AGENTS.md']);
  });
});

describe('ARQ-06 · manifiesto y registry', () => {
  it('id que no está en el registry → bloquea y aplica el perfil más exigente', () => {
    const dir = moduloValido();
    writeFileSync(join(dir, 'modulo.yaml'), 'id: otro-modulo\nversion: 0.1.0\nroles:\n  - id: lector\n    descripcion: x\n');
    const r = correr(dir);
    expect(fallas(r, 'ARQ-06')).toEqual(['el módulo "otro-modulo" no está en el registry']);
    expect(r.perfil).toBe('A');
  });

  it('manifiesto con campos no permitidos, YAML roto o ausente → bloquea', () => {
    const dir = moduloValido();
    writeFileSync(join(dir, 'modulo.yaml'), 'id: notas\nversion: 0.1.0\nroles: [{id: lector, descripcion: x}]\nbase_datos: produccion\n');
    expect(fallas(correr(dir), 'ARQ-06')[0]).toContain('modulo.yaml: (raíz)');
    writeFileSync(join(dir, 'modulo.yaml'), 'id: [\n');
    expect(fallas(correr(dir), 'ARQ-06')[0]).toContain('no es YAML válido');
    unlinkSync(join(dir, 'modulo.yaml'));
    expect(fallas(correr(dir), 'ARQ-06')).toEqual(['falta modulo.yaml']);
  });

  it('repo, nombre del paquete o estado incoherentes con el registry → bloquea', () => {
    const dir = moduloValido();
    escribir(dir, 'package.json', JSON.stringify({ name: 'otro', packageManager: 'pnpm@12.18.0' }));
    const r = correr(dir, { repo: 'modulo-impostor' });
    expect(fallas(r, 'ARQ-06')).toEqual([
      'el registry asigna "notas" al repo "modulo-notas", no a "modulo-impostor"',
      'package.json se llama "otro" y debería ser "modulo-notas"',
    ]);
    const retirado = evaluar({ dir: moduloValido(), repo: 'modulo-notas', registry: [registro({ estado: 'retirado' })], catalogo, excepciones: [], cuerpoPr: CUERPO_PR_OK, hoy: HOY });
    expect(fallas(retirado, 'ARQ-06')).toEqual(['el módulo "notas" está retirado en el registry']);
  });
});

describe('SEG-12 · cadena de suministro', () => {
  it('versiones con rango, git o URL → bloquea, con la línea del package.json', () => {
    const dir = moduloValido();
    escribir(dir, 'package.json', JSON.stringify({ name: 'modulo-notas', packageManager: 'pnpm@12.18.0', dependencies: { a: '^1.0.0', b: 'github:x/y', c: 'latest', d: '1.0.0-beta.1' } }, null, 2));
    const r = correr(dir);
    expect(fallas(r, 'SEG-12')).toHaveLength(3);
    expect(r.politicas.find((p) => p.id === 'SEG-12')?.fallas[0]).toMatchObject({ archivo: 'package.json', linea: 5 });
  });

  it('sin lockfile, con otro gestor o con registro alternativo → bloquea', () => {
    const dir = moduloValido();
    unlinkSync(join(dir, 'pnpm-lock.yaml'));
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    writeFileSync(join(dir, '.npmrc'), 'registry=https://evil.test/\n@acme:registry=https://npm.acme.test/\nregistry=https://registry.npmjs.org/\n');
    escribir(dir, 'package.json', JSON.stringify({ name: 'modulo-notas', packageManager: 'npm@11.0.0' }));
    expect(fallas(correr(dir), 'SEG-12')).toEqual([
      'falta pnpm-lock.yaml',
      'lockfile no permitido: package-lock.json',
      'packageManager no es pnpm',
      'registro no permitido en .npmrc: registry=https://evil.test/',
      'registro no permitido en .npmrc: @acme:registry=https://npm.acme.test/',
    ]);
    unlinkSync(join(dir, 'package.json'));
    expect(fallas(correr(dir), 'SEG-12')).toContain('falta package.json');
  });
});

describe('GOB-06 · asistencia de IA', () => {
  it.each([
    ['sin sección', '## Qué cambia\n\nAlgo.', 'la descripción del PR no tiene la sección "Asistencia de IA"'],
    ['plantilla sin completar', '## Asistencia de IA (GOB-06)\n\n- Herramienta: <!-- claude-code / ninguna -->\n- Alcance: <!-- todo / parcial -->\n', 'no se indicó la herramienta de IA'],
    ['herramienta inventada', '## Asistencia de IA\n- Herramienta: skynet\n', 'herramienta de IA no reconocida: "skynet"'],
    ['IA sin alcance', '## Asistencia de IA\n- Herramienta: Claude-Code\n', 'no se indicó el alcance de la asistencia de IA'],
  ])('%s → bloquea', (_c, cuerpo, mensaje) => {
    expect(fallas(correr(moduloValido(), { cuerpoPr: cuerpo }), 'GOB-06')).toEqual([mensaje]);
  });

  it('"ninguna" no pide alcance; fuera de un PR no aplica', () => {
    expect(estado(correr(moduloValido(), { cuerpoPr: '## Asistencia de IA\n- Herramienta: ninguna\n## Pruebas\n' }), 'GOB-06')).toBe('ok');
    expect(estado(correr(moduloValido(), { cuerpoPr: null }), 'GOB-06')).toBe('no_aplica');
  });

  it('PR de Dependabot (autor del evento) cumple sin la sección; otro autor con el mismo cuerpo bloquea', () => {
    const cuerpo = 'Bumps jose from 6.2.17 to 6.2.18.';
    expect(estado(correr(moduloValido(), { cuerpoPr: cuerpo, autorPr: 'dependabot[bot]' }), 'GOB-06')).toBe('ok');
    expect(fallas(correr(moduloValido(), { cuerpoPr: cuerpo, autorPr: 'dependabot' }), 'GOB-06')).toHaveLength(1);
    expect(fallas(correr(moduloValido(), { cuerpoPr: cuerpo, autorPr: 'jmgarciarivoiro-tita' }), 'GOB-06')).toHaveLength(1);
  });
});

describe('COD-05 · cobertura por riesgo', () => {
  it('60 % alcanza para bajo (50) pero no para medio (70) ni alto (80)', () => {
    expect(estado(correr(moduloValido(60), { riesgo: 'bajo' }), 'COD-05')).toBe('ok');
    expect(fallas(correr(moduloValido(60), { riesgo: 'medio' }), 'COD-05')).toEqual(['cobertura de líneas 60% < 70% exigido para riesgo M']);
    expect(correr(moduloValido(79.9), { riesgo: 'alto' }).bloquea).toBe(true);
  });

  it('sin reporte o con reporte incompleto → bloquea', () => {
    const dir = moduloValido();
    writeFileSync(join(dir, 'coverage/coverage-summary.json'), '{"total":{}}');
    expect(fallas(correr(dir), 'COD-05')[0]).toContain('no tiene total.lines.pct');
    unlinkSync(join(dir, 'coverage/coverage-summary.json'));
    expect(fallas(correr(dir), 'COD-05')[0]).toContain('no se encontró');
  });
});

describe('excepciones', () => {
  const exc = (vence: string): Excepcion => ({ id: 'EXC-2026-001', modulo: 'notas', politica: 'COD-05', detalle: 'd', mitigacion: 'm', vence, aprobado_por: ['sistemas'] });

  it('vigente: la política queda exceptuada y no bloquea', () => {
    const r = correr(moduloValido(10), { excepciones: [exc('2026-12-31')] });
    expect(estado(r, 'COD-05')).toBe('exceptuada');
    expect(r.bloquea).toBe(false);
  });

  it('vence hoy: todavía vale; vencida ayer: vuelve a bloquear', () => {
    expect(correr(moduloValido(10), { excepciones: [exc(HOY)] }).bloquea).toBe(false);
    expect(correr(moduloValido(10), { excepciones: [exc('2026-11-14')] }).bloquea).toBe(true);
  });

  it('no se aplica a otro módulo ni a otra política', () => {
    const r = correr(moduloValido(10), { excepciones: [{ ...exc('2026-12-31'), modulo: 'otro' }, { ...exc('2026-12-31'), politica: 'SEG-12' }] });
    expect(estado(r, 'COD-05')).toBe('falla');
  });
});

describe('repo de la plantilla', () => {
  const plantilla = () => {
    const dir = moduloValido();
    writeFileSync(join(dir, 'modulo.yaml'), 'id: plantilla-modulo\nversion: 0.1.0\nroles:\n  - id: lector\n    descripcion: x\n');
    escribir(dir, 'package.json', JSON.stringify({ name: 'plantilla-modulo', packageManager: 'pnpm@12.18.0' }));
    return dir;
  };
  const evaluarPlantilla = (dir: string, repo = 'plantilla-modulo') =>
    evaluar({ dir, repo, registry: [registro()], catalogo, excepciones: [], cuerpoPr: CUERPO_PR_OK, hoy: HOY, repoPlantilla: 'plantilla-modulo' });

  it('no necesita estar en el registry y se evalúa con el perfil más exigente', () => {
    const r = evaluarPlantilla(plantilla());
    expect(estado(r, 'ARQ-06')).toBe('ok');
    expect(r.perfil).toBe('A');
    expect(r.bloquea).toBe(false);
  });

  it('id o paquete con otro nombre → bloquea', () => {
    const dir = plantilla();
    writeFileSync(join(dir, 'modulo.yaml'), 'id: otro-id\nversion: 0.1.0\nroles:\n  - id: lector\n    descripcion: x\n');
    escribir(dir, 'package.json', JSON.stringify({ name: 'otro', packageManager: 'pnpm@12.18.0' }));
    expect(fallas(evaluarPlantilla(dir), 'ARQ-06')).toEqual(['en la plantilla, el id tiene que ser "plantilla-modulo"', 'en la plantilla, package.json tiene que llamarse "plantilla-modulo"']);
  });

  it('un módulo no puede hacerse pasar por la plantilla: se decide por el nombre real del repo', () => {
    const r = evaluarPlantilla(plantilla(), 'modulo-impostor');
    expect(fallas(r, 'ARQ-06')).toEqual(['el módulo "plantilla-modulo" no está en el registry']);
    expect(r.bloquea).toBe(true);
  });
});
