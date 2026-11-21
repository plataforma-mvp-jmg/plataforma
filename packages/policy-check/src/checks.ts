// Un check por política. Devuelve las fallas (vacío = cumple) o null si no aplica en este contexto.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { esquemaManifiesto, type ModuloResumen } from '@plataforma/contracts';
import { parse } from 'yaml';
import type { Perfil, Politica } from './configuracion.js';

export interface Falla {
  mensaje: string;
  archivo?: string | undefined;
  linea?: number | undefined;
  sugerencia: string;
}

export interface ContextoCheck {
  dir: string;
  repo: string;
  registry: ModuloResumen[];
  modulo: ModuloResumen | undefined;
  perfil: Perfil;
  /** Cuerpo del PR; null si la ejecución no es de un PR. */
  cuerpoPr: string | null;
  /** El repo evaluado es la plantilla de módulos (no figura en el registry). */
  esPlantilla: boolean;
}

export type Check = (ctx: ContextoCheck, p: Politica) => Falla[] | null;

const leer = (ctx: ContextoCheck, f: string) => readFileSync(join(ctx.dir, f), 'utf8');
const existe = (ctx: ContextoCheck, f: string) => existsSync(join(ctx.dir, f));

function lineaDe(texto: string, buscado: string): number | undefined {
  const i = texto.split('\n').findIndex((l) => l.includes(buscado));
  return i < 0 ? undefined : i + 1;
}

// ARQ-01 ------------------------------------------------------------------------------------------
export const ARCHIVOS_OBLIGATORIOS = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'modulo.yaml',
  'Dockerfile',
  '.github/CODEOWNERS',
  'docs/funcional/README.md',
  'docs/permisos.md',
  'docs/runbook.md',
];

function hayTests(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => {
    const ruta = join(dir, f);
    return statSync(ruta).isDirectory() ? hayTests(ruta) : /\.test\.ts$/.test(f);
  });
}

export const estructura: Check = (ctx) => {
  const fallas: Falla[] = ARCHIVOS_OBLIGATORIOS.filter((f) => !existe(ctx, f)).map((f) => ({
    mensaje: `falta ${f}`,
    archivo: f,
    sugerencia: `Recuperá ${f} desde plantilla-modulo y completalo para este módulo.`,
  }));
  if (!hayTests(join(ctx.dir, 'tests'))) {
    fallas.push({ mensaje: 'no hay tests (tests/**/*.test.ts)', archivo: 'tests', sugerencia: 'Agregá al menos los tests de contrato de la plantilla.' });
  }
  if (existe(ctx, 'CLAUDE.md') && !leer(ctx, 'CLAUDE.md').includes('@AGENTS.md')) {
    fallas.push({ mensaje: 'CLAUDE.md no importa AGENTS.md', archivo: 'CLAUDE.md', linea: 1, sugerencia: 'La primera línea de CLAUDE.md tiene que ser "@AGENTS.md".' });
  }
  return fallas;
};

// ARQ-06 ------------------------------------------------------------------------------------------
export const manifiestoRegistry: Check = (ctx) => {
  if (!existe(ctx, 'modulo.yaml')) return [{ mensaje: 'falta modulo.yaml', archivo: 'modulo.yaml', sugerencia: 'Recuperá modulo.yaml desde la plantilla.' }];
  let crudo: unknown;
  try {
    crudo = parse(leer(ctx, 'modulo.yaml'));
  } catch (err) {
    return [{ mensaje: `modulo.yaml no es YAML válido: ${(err as Error).message}`, archivo: 'modulo.yaml', sugerencia: 'Corregí la sintaxis YAML.' }];
  }
  const r = esquemaManifiesto.safeParse(crudo);
  if (!r.success) {
    return r.error.issues.map((i) => ({
      mensaje: `modulo.yaml: ${i.path.join('.') || '(raíz)'}: ${i.message}`,
      archivo: 'modulo.yaml',
      sugerencia: 'El manifiesto solo admite id, version y roles (id, descripcion).',
    }));
  }
  if (ctx.esPlantilla) {
    // La plantilla no es un módulo: su id y su paquete tienen que llamarse como el repo.
    const fallas: Falla[] = [];
    if (r.data.id !== ctx.repo) fallas.push({ mensaje: `en la plantilla, el id tiene que ser "${ctx.repo}"`, archivo: 'modulo.yaml', sugerencia: 'El aprovisionamiento reemplaza ese id al generar cada módulo.' });
    const nombre = existe(ctx, 'package.json') ? (JSON.parse(leer(ctx, 'package.json')) as { name?: string }).name : undefined;
    if (nombre !== ctx.repo) fallas.push({ mensaje: `en la plantilla, package.json tiene que llamarse "${ctx.repo}"`, archivo: 'package.json', sugerencia: 'El aprovisionamiento reemplaza ese nombre al generar cada módulo.' });
    return fallas;
  }
  const m = ctx.registry.find((x) => x.id === r.data.id);
  if (!m) {
    return [{ mensaje: `el módulo "${r.data.id}" no está en el registry`, archivo: 'modulo.yaml', linea: lineaDe(leer(ctx, 'modulo.yaml'), 'id:'), sugerencia: 'El id de modulo.yaml no se cambia: el alta la hace Sistemas en plataforma/registry.' }];
  }
  const fallas: Falla[] = [];
  if (m.repo !== ctx.repo) fallas.push({ mensaje: `el registry asigna "${m.id}" al repo "${m.repo}", no a "${ctx.repo}"`, archivo: 'modulo.yaml', sugerencia: 'Un módulo vive solo en su repo modulo-<id>.' });
  if (m.estado === 'retirado') fallas.push({ mensaje: `el módulo "${m.id}" está retirado en el registry`, sugerencia: 'Un módulo retirado no recibe cambios.' });
  if (existe(ctx, 'package.json')) {
    const nombre = (JSON.parse(leer(ctx, 'package.json')) as { name?: string }).name;
    if (nombre !== m.repo) fallas.push({ mensaje: `package.json se llama "${nombre ?? ''}" y debería ser "${m.repo}"`, archivo: 'package.json', linea: lineaDe(leer(ctx, 'package.json'), '"name"'), sugerencia: `Usá "name": "${m.repo}".` });
  }
  return fallas;
};

// SEG-12 ------------------------------------------------------------------------------------------
const VERSION_EXACTA = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const REGISTRO_NPM = 'https://registry.npmjs.org/';

export const cadenaSuministro: Check = (ctx) => {
  const fallas: Falla[] = [];
  if (!existe(ctx, 'pnpm-lock.yaml')) fallas.push({ mensaje: 'falta pnpm-lock.yaml', sugerencia: 'Corré pnpm install y commiteá el lockfile.' });
  for (const otro of ['package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock']) {
    if (existe(ctx, otro)) fallas.push({ mensaje: `lockfile no permitido: ${otro}`, archivo: otro, sugerencia: 'Solo pnpm: borrá ese archivo.' });
  }
  if (!existe(ctx, 'package.json')) return [...fallas, { mensaje: 'falta package.json', sugerencia: 'Recuperá package.json desde la plantilla.' }];
  const texto = leer(ctx, 'package.json');
  const pkg = JSON.parse(texto) as { packageManager?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  if (!pkg.packageManager?.startsWith('pnpm@')) {
    fallas.push({ mensaje: 'packageManager no es pnpm', archivo: 'package.json', linea: lineaDe(texto, '"packageManager"'), sugerencia: 'Usá el "packageManager" de la plantilla.' });
  }
  for (const [nombre, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!VERSION_EXACTA.test(version)) {
      fallas.push({ mensaje: `${nombre}: versión "${version}" no es exacta o no viene del registro npm`, archivo: 'package.json', linea: lineaDe(texto, `"${nombre}"`), sugerencia: `Fijá una versión exacta, por ejemplo "${nombre}": "1.2.3" (sin ^, ~, rangos, git ni URLs).` });
    }
  }
  if (existe(ctx, '.npmrc')) {
    const npmrc = leer(ctx, '.npmrc');
    npmrc.split('\n').forEach((l, i) => {
      const m = /^\s*(@[^:]+:)?registry\s*=\s*(\S+)/.exec(l);
      if (m && (m[1] || m[2] !== REGISTRO_NPM)) {
        fallas.push({ mensaje: `registro no permitido en .npmrc: ${l.trim()}`, archivo: '.npmrc', linea: i + 1, sugerencia: `Solo se permite ${REGISTRO_NPM}.` });
      }
    });
  }
  return fallas;
};

// GOB-06 ------------------------------------------------------------------------------------------
export const HERRAMIENTAS_IA = ['claude-code', 'claude', 'chatgpt', 'gemini', 'copilot', 'ninguna'];
const ALCANCES = ['todo', 'parcial'];

export const asistenciaIa: Check = (ctx) => {
  if (ctx.cuerpoPr === null) return null;
  const sinComentarios = ctx.cuerpoPr.replace(/<!--[\s\S]*?-->/g, '');
  const seccion = /##\s*Asistencia de IA[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i.exec(sinComentarios)?.[1];
  const sugerencia = `Completá en la descripción del PR: "- Herramienta: <${HERRAMIENTAS_IA.join(' / ')}>" y, si usaste IA, "- Alcance: <todo / parcial>".`;
  if (seccion === undefined) return [{ mensaje: 'la descripción del PR no tiene la sección "Asistencia de IA"', sugerencia }];
  const valor = (campo: string) => new RegExp(`${campo}[ \\t]*:[ \\t]*([^\\n]*)`, 'i').exec(seccion)?.[1]?.trim().toLowerCase() ?? '';
  const herramienta = valor('Herramienta');
  if (!HERRAMIENTAS_IA.includes(herramienta)) return [{ mensaje: herramienta ? `herramienta de IA no reconocida: "${herramienta}"` : 'no se indicó la herramienta de IA', sugerencia }];
  if (herramienta !== 'ninguna' && !ALCANCES.includes(valor('Alcance'))) return [{ mensaje: 'no se indicó el alcance de la asistencia de IA', sugerencia }];
  return [];
};

// COD-05 ------------------------------------------------------------------------------------------
export const RESUMEN_COBERTURA = 'coverage/coverage-summary.json';

export const cobertura: Check = (ctx, p) => {
  const minimo = p.umbral?.[ctx.perfil] ?? 0;
  if (!existe(ctx, RESUMEN_COBERTURA)) {
    return [{ mensaje: `no se encontró ${RESUMEN_COBERTURA}`, sugerencia: 'Corré los tests con cobertura y el reporter "json-summary" (vitest.config.ts de la plantilla).' }];
  }
  const pct = (JSON.parse(leer(ctx, RESUMEN_COBERTURA)) as { total?: { lines?: { pct?: number } } }).total?.lines?.pct;
  if (typeof pct !== 'number') return [{ mensaje: `${RESUMEN_COBERTURA} no tiene total.lines.pct`, sugerencia: 'Regenerá el reporte de cobertura.' }];
  if (pct < minimo) return [{ mensaje: `cobertura de líneas ${pct}% < ${minimo}% exigido para riesgo ${ctx.perfil}`, sugerencia: 'Agregá tests para el código nuevo.' }];
  return [];
};

export const CHECKS_POR_NOMBRE: Record<Politica['check'], Check> = {
  estructura,
  'manifiesto-registry': manifiestoRegistry,
  'cadena-suministro': cadenaSuministro,
  'asistencia-ia': asistenciaIa,
  cobertura,
};
