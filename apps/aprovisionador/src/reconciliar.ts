// Reconciliación idempotente: lleva cada repo de módulo al estado deseado. Nunca borra ni transfiere
// repos, y solo toca repos llamados modulo-<id> que estén en el registry.
import type { ModuloRegistry } from '@plataforma/contracts';
import { ErrorGitHub, type ClienteGitHub } from './github.js';
import {
  ajustesRepoDeseados,
  ambientesDeseados,
  aprobacionesRequeridas,
  debeAprovisionarse,
  ETIQUETAS,
  NOMBRE_RULESET,
  RAMA_INICIAL,
  rulesetDeseado,
  tagDePlantilla,
  type Revisor,
} from './deseado.js';

export interface OperacionesGit {
  /** Crea `main` con un primer commit que solo trae CODEOWNERS (antes de proteger la rama). */
  inicializarMain(repo: string): Promise<void>;
  /** Sube la plantilla adaptada al módulo a la rama RAMA_INICIAL. */
  publicarContenido(repo: string, m: ModuloRegistry, tag: string): Promise<void>;
}

export interface Contexto {
  org: string;
  teamRevisores: string;
  repoPlantilla: string;
  gh: ClienteGitHub;
  git: OperacionesGit;
}

export interface Resultado {
  id: string;
  repo: string;
  estado: 'omitido' | 'ok' | 'error';
  acciones: string[];
  error?: string;
}

interface Repo {
  html_url: string;
}

export async function reconciliarModulo(m: ModuloRegistry, ctx: Contexto): Promise<Resultado> {
  const r: Resultado = { id: m.id, repo: m.repo, estado: 'ok', acciones: [] };
  if (!debeAprovisionarse(m)) return { ...r, estado: 'omitido' };
  const { gh, org } = ctx;
  const repo = `/repos/${org}/${m.repo}`;

  try {
    const tag = tagDePlantilla(m.plantilla, ctx.repoPlantilla);

    // Riesgo alto exige dos aprobaciones: sin dos revisores en el team, el repo quedaría bloqueado.
    const necesarias = aprobacionesRequeridas(m.riesgo);
    if (necesarias > 1) {
      const miembros = await gh.pedir<unknown[]>('GET', `/orgs/${org}/teams/${ctx.teamRevisores}/members?per_page=100`);
      if (miembros.length < necesarias) {
        throw new Error(`riesgo ${m.riesgo} exige ${necesarias} revisores en el team ${ctx.teamRevisores} y hay ${miembros.length}`);
      }
    }

    // 1. Repo (público en el MVP: rulesets y environments del plan gratuito, P7).
    if (!(await gh.buscar<Repo>(repo))) {
      await gh.pedir('POST', `/orgs/${org}/repos`, { name: m.repo, visibility: 'public', auto_init: false });
      r.acciones.push('repo creado');
    }

    // 2. Ajustes, seguridad y alertas de dependencias.
    await gh.pedir('PATCH', repo, ajustesRepoDeseados(m));
    await gh.pedir('PUT', `${repo}/vulnerability-alerts`);
    r.acciones.push('ajustes y seguridad');

    // 3. Acceso del team de revisores (code owner de la plantilla).
    await gh.pedir('PUT', `/orgs/${org}/teams/${ctx.teamRevisores}/repos/${org}/${m.repo}`, { permission: 'push' });
    r.acciones.push(`team ${ctx.teamRevisores}: write`);

    // 3b. Etiquetas (revisión simulada y Dependabot). No son un control: si fallan, se informa y se sigue.
    for (const etiqueta of ETIQUETAS) {
      try {
        if (!(await gh.buscar(`${repo}/labels/${etiqueta.name}`))) {
          await gh.pedir('POST', `${repo}/labels`, etiqueta);
          r.acciones.push(`etiqueta ${etiqueta.name}`);
        }
      } catch (err) {
        if (!(err instanceof ErrorGitHub)) throw err;
        r.acciones.push(`etiqueta ${etiqueta.name}: no se pudo crear (${err.status})`);
      }
    }

    // 4. main existe (con CODEOWNERS) antes de protegerla: después ni la App puede pushear a main.
    if (!(await gh.buscar(`${repo}/branches/main`))) {
      await ctx.git.inicializarMain(m.repo);
      r.acciones.push('main inicializada');
    }

    // 5. CodeQL con configuración por defecto (SEG-10). Necesita código en main: en un repo nuevo
    //    queda pendiente hasta que se mergea el PR inicial (lo toma la corrida programada).
    const tieneContenido = await gh.buscar(`${repo}/contents/modulo.yaml`);
    let codeql = false;
    if (tieneContenido) {
      const ds = await gh.pedir<{ state: string }>('GET', `${repo}/code-scanning/default-setup`);
      if (ds.state !== 'configured') {
        await gh.pedir('PATCH', `${repo}/code-scanning/default-setup`, { state: 'configured', query_suite: 'default' });
        r.acciones.push('CodeQL activado');
      }
      codeql = true;
    } else {
      r.acciones.push('CodeQL pendiente (main sin código)');
    }

    // 6. Ruleset del perfil de riesgo (crea o actualiza); exige CodeQL solo si está activo.
    const rulesets = await gh.pedir<{ id: number; name: string }[]>('GET', `${repo}/rulesets`);
    const existente = rulesets.find((x) => x.name === NOMBRE_RULESET);
    const deseado = rulesetDeseado(m.riesgo, { codeql });
    if (existente) await gh.pedir('PUT', `${repo}/rulesets/${existente.id}`, deseado);
    else await gh.pedir('POST', `${repo}/rulesets`, deseado);
    r.acciones.push(`ruleset ${NOMBRE_RULESET} (${necesarias} aprobación/es${codeql ? ', CodeQL' : ''})`);

    // 7. Environments con revisores y despliegue solo desde main.
    for (const amb of ambientesDeseados(m, ctx.teamRevisores)) {
      const reviewers = await Promise.all(amb.revisores.map((rev) => idRevisor(gh, org, rev)));
      await gh.pedir('PUT', `${repo}/environments/${amb.nombre}`, {
        reviewers,
        prevent_self_review: amb.prevenirAutoAprobacion,
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      });
      const politicas = await gh.pedir<{ branch_policies: { name: string }[] }>('GET', `${repo}/environments/${amb.nombre}/deployment-branch-policies`);
      if (!politicas.branch_policies.some((p) => p.name === 'main')) {
        await gh.pedir('POST', `${repo}/environments/${amb.nombre}/deployment-branch-policies`, { name: 'main', type: 'branch' });
      }
      r.acciones.push(`environment ${amb.nombre}`);
    }

    // 8. Contenido inicial por PR (nunca directo a main), solo si el repo todavía no lo tiene.
    const ramaPendiente = await gh.buscar(`${repo}/branches/${encodeURIComponent(RAMA_INICIAL)}`);
    if (!tieneContenido && !ramaPendiente) {
      await ctx.git.publicarContenido(m.repo, m, tag);
      const pr = await gh.pedir<{ html_url: string }>('POST', `${repo}/pulls`, {
        title: `chore: contenido inicial desde ${m.plantilla}`,
        head: RAMA_INICIAL,
        base: 'main',
        body: cuerpoPr(m, ctx),
      });
      r.acciones.push(`PR inicial: ${pr.html_url}`);
    }
  } catch (err) {
    return { ...r, estado: 'error', error: err instanceof Error ? err.message : String(err) };
  }
  return r;
}

async function idRevisor(gh: ClienteGitHub, org: string, rev: Revisor) {
  if (rev.tipo === 'Team') {
    const t = await gh.pedir<{ id: number }>('GET', `/orgs/${org}/teams/${rev.slug}`);
    return { type: 'Team', id: t.id };
  }
  const u = await gh.pedir<{ id: number }>('GET', `/users/${rev.login}`);
  return { type: 'User', id: u.id };
}

function cuerpoPr(m: ModuloRegistry, ctx: Contexto): string {
  return [
    `Contenido inicial de **${m.nombre}** generado desde \`${ctx.repoPlantilla}\` (\`${m.plantilla}\`).`,
    '',
    'Cambios respecto de la plantilla: nombre del paquete, `id` en `modulo.yaml` y encabezado del README.',
    '',
    `- Riesgo: ${m.riesgo} · criticidad: ${m.criticidad} · SOX: ${m.sox.en_alcance ? 'sí' : 'no'}`,
    `- Product Owner: ${m.duenos.product_owner} · responsable técnico: ${m.duenos.responsable_tecnico}`,
    '',
    'Lo abrió el aprovisionamiento de la plataforma (GitHub App). Requiere la aprobación de Sistemas como cualquier PR.',
    '',
    '## Asistencia de IA (GOB-06)',
    '',
    '- Herramienta: ninguna',
    '- Alcance: contenido generado por una automatización determinista (copia de la plantilla con reemplazos fijos).',
  ].join('\n');
}

export async function reconciliarRegistry(modulos: ModuloRegistry[], ctx: Contexto): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  // En serie: pocos módulos y llamadas ordenadas en el log.
  for (const m of modulos) resultados.push(await reconciliarModulo(m, ctx));
  return resultados;
}
