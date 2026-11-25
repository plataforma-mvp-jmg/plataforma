// Configuración deseada de un repo de módulo según su perfil de riesgo (ADR-085, docs/07 §4).
// Funciones puras: lo que se aplica se decide acá y se testea sin red.
import type { ModuloRegistry } from '@plataforma/contracts';

export const NOMBRE_RULESET = 'main-modulo';
export const RAMA_INICIAL = 'aprovisionamiento/inicial';

/** Aprobaciones de code owner exigidas por riesgo. Riesgo alto exige dos personas distintas. */
export function aprobacionesRequeridas(riesgo: ModuloRegistry['riesgo']): number {
  return riesgo === 'alto' ? 2 : 1;
}

/**
 * SAST (SEG-10): bloquea el merge con alertas de CodeQL de severidad alta o mayor, o con errores.
 * Solo se exige con CodeQL activo: si la herramienta no está configurada, GitHub bloquea todo merge.
 */
export const REGLA_CODEQL = {
  type: 'code_scanning',
  parameters: {
    code_scanning_tools: [{ tool: 'CodeQL', security_alerts_threshold: 'high_or_higher', alerts_threshold: 'errors' }],
  },
};

export function rulesetDeseado(riesgo: ModuloRegistry['riesgo'], o: { codeql: boolean } = { codeql: false }) {
  return {
    name: NOMBRE_RULESET,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    bypass_actors: [],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_linear_history' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: aprobacionesRequeridas(riesgo),
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: true,
          require_last_push_approval: true,
          required_review_thread_resolution: true,
          allowed_merge_methods: ['squash'],
        },
      },
      {
        type: 'required_status_checks',
        parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'resumen' }] },
      },
      ...(o.codeql ? [REGLA_CODEQL] : []),
    ],
  };
}

export function ajustesRepoDeseados(m: ModuloRegistry) {
  return {
    description: `${m.nombre} — módulo de la plataforma (MVP, datos sintéticos)`,
    has_wiki: false,
    has_projects: false,
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    allow_auto_merge: true,
    delete_branch_on_merge: true,
    security_and_analysis: {
      secret_scanning: { status: 'enabled' },
      secret_scanning_push_protection: { status: 'enabled' },
    },
  };
}

export type Revisor = { tipo: 'Team'; slug: string } | { tipo: 'User'; login: string };

export interface AmbienteDeseado {
  nombre: string;
  revisores: Revisor[];
  /** Quien dispara el despliegue no puede aprobarlo (segregación de funciones). */
  prevenirAutoAprobacion: boolean;
}

/**
 * staging sin aprobación; production aprobado por Sistemas, nunca por quien despliega.
 * Riesgo medio o alto: además aceptación del negocio por el Product Owner antes de producción (doc 10).
 */
export function ambientesDeseados(m: ModuloRegistry, teamRevisores: string): AmbienteDeseado[] {
  const ambientes: AmbienteDeseado[] = [{ nombre: 'staging', revisores: [], prevenirAutoAprobacion: false }];
  if (m.riesgo !== 'bajo') {
    // Sin autoaprobación también acá: si el PO dispara la promoción, no puede aceptarla él mismo (el deployer de
    // producción lo rechaza igual; así GitHub lo corta antes y no se gasta la aprobación de Sistemas).
    ambientes.push({ nombre: 'aceptacion-negocio', revisores: [{ tipo: 'User', login: m.duenos.product_owner }], prevenirAutoAprobacion: true });
  }
  ambientes.push({ nombre: 'production', revisores: [{ tipo: 'Team', slug: teamRevisores }], prevenirAutoAprobacion: true });
  return ambientes;
}

/** Módulos que el aprovisionador administra: con repo propio y no retirados. */
export function debeAprovisionarse(m: ModuloRegistry): boolean {
  return m.repo !== 'plataforma' && m.estado !== 'retirado';
}

/** "plantilla-modulo@0.1.0" → tag "v0.1.0" del repo de la plantilla. */
export function tagDePlantilla(plantilla: string, repoPlantilla: string): string {
  const m = /^([a-z0-9-]+)@(\d+\.\d+\.\d+)$/.exec(plantilla);
  if (!m || m[1] !== repoPlantilla) throw new Error(`plantilla no soportada: ${plantilla} (se espera ${repoPlantilla}@x.y.z)`);
  return `v${m[2]}`;
}

/** Etiqueta de las revisiones simuladas del MVP (ADR-064): la usan los PR de los módulos. */
export const ETIQUETA_REVISION = { name: 'revision-simulada', color: 'FBCA04', description: 'Revision hecha por la cuenta simulada del MVP' };
/** Etiqueta que dependabot.yml de la plantilla pone a sus PR: sin ella, Dependabot comenta un error en cada PR. */
export const ETIQUETA_DEPENDENCIAS = { name: 'dependencias', color: '0366D6', description: 'Actualizaciones de Dependabot' };
export const ETIQUETAS = [ETIQUETA_REVISION, ETIQUETA_DEPENDENCIAS];
