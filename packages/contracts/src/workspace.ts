// Qué repo puede recibir un token de workspace (ADR 0020). Regla única, compartida por la API y el
// workspace manager: solo el repo propio de un módulo del registry que todavía se desarrolla.
// Nunca "plataforma" (registry, políticas, workflows reutilizables) ni la plantilla.
import type { ModuloResumen } from './registry.js';

/** Estados en los que un módulo admite cambios desde un workspace. */
const ESTADOS_EDITABLES = new Set(['propuesto', 'en_desarrollo', 'staging', 'produccion']);
const REPOS_PROHIBIDOS = new Set(['plataforma', 'plantilla-modulo']);

export type ResultadoRepoWorkspace = { ok: true; repo: string } | { ok: false; motivo: string };

export function repoParaWorkspace(modulos: readonly ModuloResumen[], moduloId: string): ResultadoRepoWorkspace {
  const m = modulos.find((x) => x.id === moduloId);
  if (!m) return { ok: false, motivo: `el módulo ${moduloId} no está en el registry` };
  if (REPOS_PROHIBIDOS.has(m.repo)) return { ok: false, motivo: `el repo ${m.repo} no se edita desde un workspace` };
  if (m.repo !== `modulo-${m.id}`) return { ok: false, motivo: `el repo del módulo debe ser modulo-${m.id}` };
  if (!ESTADOS_EDITABLES.has(m.estado)) return { ok: false, motivo: `el módulo está ${m.estado}` };
  return { ok: true, repo: m.repo };
}

/** Permisos del token de workspace: código y PRs; nunca workflows, administración ni secretos. */
export const PERMISOS_TOKEN_WORKSPACE = { contents: 'write', pull_requests: 'write' } as const;
