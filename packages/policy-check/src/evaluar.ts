// Aplica el catálogo a un módulo: perfil según el registry, excepciones vigentes y resultado final.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuloResumen } from '@plataforma/contracts';
import { parse } from 'yaml';
import { CHECKS_POR_NOMBRE, type Falla } from './checks.js';
import type { Catalogo, Excepcion, Perfil } from './configuracion.js';

export interface ResultadoPolitica {
  id: string;
  tipo: 'E' | 'O';
  descripcion: string;
  estado: 'ok' | 'falla' | 'exceptuada' | 'no_aplica';
  fallas: Falla[];
  excepcion?: string;
}

export interface ResultadoEvaluacion {
  modulo: string;
  repo: string;
  perfil: Perfil;
  bloquea: boolean;
  politicas: ResultadoPolitica[];
}

export interface Entrada {
  dir: string;
  repo: string;
  registry: ModuloResumen[];
  catalogo: Catalogo;
  excepciones: Excepcion[];
  cuerpoPr: string | null;
  hoy: string;
  /** Nombre del repo de la plantilla de módulos (por ejemplo, plantilla-modulo). */
  repoPlantilla?: string | undefined;
}

const PERFIL: Record<ModuloResumen['riesgo'], Perfil> = { bajo: 'B', medio: 'M', alto: 'A' };

/** id del manifiesto (sin validar: ARQ-06 informa los errores). */
function idDelManifiesto(dir: string): string | undefined {
  const ruta = join(dir, 'modulo.yaml');
  if (!existsSync(ruta)) return undefined;
  try {
    const id = (parse(readFileSync(ruta, 'utf8')) as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

export function evaluar(e: Entrada): ResultadoEvaluacion {
  const id = idDelManifiesto(e.dir);
  // La plantilla se identifica por el nombre real del repo (GITHUB_REPOSITORY), que un módulo no controla.
  const esPlantilla = e.repoPlantilla !== undefined && e.repo === e.repoPlantilla;
  const modulo = esPlantilla ? undefined : e.registry.find((m) => m.id === id);
  // Sin registro (o en la plantilla) no hay riesgo declarado: se aplica el perfil más exigente.
  const perfil: Perfil = modulo ? PERFIL[modulo.riesgo] : 'A';
  const ctx = { dir: e.dir, repo: e.repo, registry: e.registry, modulo, perfil, cuerpoPr: e.cuerpoPr, esPlantilla };

  const politicas = e.catalogo.politicas.map((p): ResultadoPolitica => {
    const base = { id: p.id, tipo: p.tipo, descripcion: p.descripcion };
    if (!p.perfiles.includes(perfil)) return { ...base, estado: 'no_aplica', fallas: [] };
    const fallas = CHECKS_POR_NOMBRE[p.check](ctx, p);
    if (fallas === null) return { ...base, estado: 'no_aplica', fallas: [] };
    if (fallas.length === 0) return { ...base, estado: 'ok', fallas };
    const exc = e.excepciones.find((x) => x.modulo === id && x.politica === p.id && x.vence >= e.hoy);
    if (exc) return { ...base, estado: 'exceptuada', fallas, excepcion: `${exc.id} (vence ${exc.vence})` };
    return { ...base, estado: 'falla', fallas };
  });

  return {
    modulo: id ?? '(sin id)',
    repo: e.repo,
    perfil,
    bloquea: politicas.some((p) => p.estado === 'falla' && p.tipo === 'E'),
    politicas,
  };
}
