import { describe, expect, it } from 'vitest';
import { reconciliarModulo, reconciliarRegistry, type Contexto, type OperacionesGit } from '../src/reconciliar.js';
import { resumenMarkdown } from '../src/resumen.js';
import { GitHubFalso } from './github-falso.js';
import { modulo } from './modulo.js';

const ORG = 'org-test';

function contexto(gh: GitHubFalso) {
  const hechos: string[] = [];
  const git: OperacionesGit = {
    async inicializarMain(repo) {
      // El orden importa: main tiene que existir antes del ruleset.
      expect(gh.rutas('POST').some((r) => r.endsWith('/rulesets'))).toBe(false);
      gh.ramas.add(`${repo}:main`);
      hechos.push(`init ${repo}`);
    },
    async publicarContenido(repo, m, tag) {
      gh.ramas.add(`${repo}:aprovisionamiento/inicial`);
      hechos.push(`contenido ${repo} ${m.id} ${tag}`);
    },
  };
  const ctx: Contexto = { org: ORG, teamRevisores: 'sistemas', repoPlantilla: 'plantilla-modulo', gh, git };
  return { ctx, hechos };
}

describe('reconciliarModulo', () => {
  it('módulo nuevo: crea el repo, lo protege y abre el PR inicial', async () => {
    const gh = new GitHubFalso(ORG);
    const { ctx, hechos } = contexto(gh);
    const r = await reconciliarModulo(modulo(), ctx);

    expect(r.estado).toBe('ok');
    expect(hechos).toEqual(['init modulo-notas', 'contenido modulo-notas notas v0.1.0']);
    const crear = gh.llamadas.find((l) => l.ruta === `/orgs/${ORG}/repos`);
    expect(crear?.cuerpo).toEqual({ name: 'modulo-notas', visibility: 'public', auto_init: false });
    expect(gh.rutas()).toContain(`PUT /orgs/${ORG}/teams/sistemas/repos/${ORG}/modulo-notas`);
    expect(gh.rutas()).toContain(`PUT /repos/${ORG}/modulo-notas/vulnerability-alerts`);

    const ruleset = gh.llamadas.find((l) => l.metodo === 'POST' && l.ruta.endsWith('/rulesets'))?.cuerpo as { rules: { type: string; parameters?: Record<string, unknown> }[]; bypass_actors: unknown[] };
    expect(ruleset.bypass_actors).toEqual([]);
    expect(ruleset.rules.find((x) => x.type === 'pull_request')?.parameters).toMatchObject({ required_approving_review_count: 1, require_code_owner_review: true, require_last_push_approval: true });

    // Riesgo bajo: staging y production (sin aceptación de negocio). Production: Sistemas, sin autoaprobación.
    const ambientes = gh.llamadas.filter((l) => l.metodo === 'PUT' && /\/environments\/[^/]+$/.test(l.ruta));
    expect(ambientes.map((a) => a.ruta.split('/').pop())).toEqual(['staging', 'production']);
    expect(ambientes[1]?.cuerpo).toMatchObject({ reviewers: [{ type: 'Team', id: 77 }], prevent_self_review: true });
    expect(gh.rutas('POST').filter((x) => x.endsWith('/deployment-branch-policies'))).toHaveLength(2);

    const pr = gh.llamadas.find((l) => l.ruta.endsWith('/pulls'))?.cuerpo as { head: string; base: string; body: string };
    expect(pr).toMatchObject({ head: 'aprovisionamiento/inicial', base: 'main' });
    expect(pr.body).toContain('Requiere la aprobación de Sistemas');
    expect(pr.body).toMatch(/## Asistencia de IA \(GOB-06\)\n\n- Herramienta: ninguna/);
    expect(r.acciones.at(-1)).toContain('PR inicial');
  });

  it('es idempotente: la segunda corrida no crea nada ni vuelve a subir contenido', async () => {
    const gh = new GitHubFalso(ORG);
    const { ctx, hechos } = contexto(gh);
    await reconciliarModulo(modulo(), ctx);
    gh.llamadas = [];
    const r = await reconciliarModulo(modulo(), ctx);

    expect(r.estado).toBe('ok');
    expect(hechos).toHaveLength(2);
    expect(gh.rutas('POST')).toEqual([]);
    expect(gh.rutas('PUT')).toContain(`PUT /repos/${ORG}/modulo-notas/rulesets/1`);
  });

  it('si main ya tiene contenido no abre el PR inicial', async () => {
    const gh = new GitHubFalso(ORG);
    gh.repos.add('modulo-notas');
    gh.ramas.add('modulo-notas:main');
    gh.archivos.add('modulo-notas:modulo.yaml');
    const { ctx, hechos } = contexto(gh);
    const r = await reconciliarModulo(modulo(), ctx);
    expect(hechos).toEqual([]);
    expect(r.acciones.join(' ')).not.toContain('PR inicial');
  });

  it('riesgo medio: agrega la aceptación del negocio por el Product Owner', async () => {
    const gh = new GitHubFalso(ORG);
    const { ctx } = contexto(gh);
    await reconciliarModulo(modulo({ riesgo: 'medio' }), ctx);
    const ambientes = gh.llamadas.filter((l) => l.metodo === 'PUT' && /\/environments\/[^/]+$/.test(l.ruta));
    expect(ambientes.map((a) => a.ruta.split('/').pop())).toEqual(['staging', 'aceptacion-negocio', 'production']);
    expect(ambientes[1]?.cuerpo).toMatchObject({ reviewers: [{ type: 'User', id: 55 }], prevent_self_review: true });
    expect(gh.rutas()).toContain('GET /users/po-user');
  });

  it('riesgo alto con un solo revisor: falla antes de crear nada', async () => {
    const gh = new GitHubFalso(ORG);
    const { ctx } = contexto(gh);
    const r = await reconciliarModulo(modulo({ riesgo: 'alto', duenos: { product_owner: 'a', responsable_tecnico: 'b' } }), ctx);
    expect(r.estado).toBe('error');
    expect(r.error).toContain('exige 2 revisores');
    expect(gh.rutas('POST')).toEqual([]);
  });

  it('riesgo alto con dos revisores: ruleset de 2 aprobaciones', async () => {
    const gh = new GitHubFalso(ORG);
    gh.miembrosTeam = 2;
    const { ctx } = contexto(gh);
    const r = await reconciliarModulo(modulo({ riesgo: 'alto', duenos: { product_owner: 'a', responsable_tecnico: 'b' } }), ctx);
    expect(r.estado).toBe('ok');
    const ruleset = gh.llamadas.find((l) => l.ruta.endsWith('/rulesets') && l.metodo === 'POST')?.cuerpo as { rules: { type: string; parameters?: { required_approving_review_count?: number } }[] };
    expect(ruleset.rules.find((x) => x.type === 'pull_request')?.parameters?.required_approving_review_count).toBe(2);
  });

  it('omite módulos del monorepo y retirados', async () => {
    const gh = new GitHubFalso(ORG);
    const { ctx } = contexto(gh);
    expect((await reconciliarModulo(modulo({ repo: 'plataforma' }), ctx)).estado).toBe('omitido');
    expect((await reconciliarModulo(modulo({ estado: 'retirado' }), ctx)).estado).toBe('omitido');
    expect(gh.llamadas).toEqual([]);
  });

  it('un error de GitHub queda en el resultado y no frena a los demás módulos', async () => {
    const gh = new GitHubFalso(ORG);
    gh.fallarEn = 'modulo-roto';
    const { ctx } = contexto(gh);
    const rs = await reconciliarRegistry([modulo({ id: 'roto', repo: 'modulo-roto' }), modulo()], ctx);
    expect(rs.map((r) => r.estado)).toEqual(['error', 'ok']);
    expect(rs[0]?.error).toContain('403');
    const md = resumenMarkdown(rs);
    expect(md).toContain('❌');
    expect(md).toContain('✅');
  });

  it('plantilla de otro repo → error claro', async () => {
    const gh = new GitHubFalso(ORG);
    const { ctx } = contexto(gh);
    const r = await reconciliarModulo(modulo({ plantilla: 'otra-plantilla@1.0.0' }), ctx);
    expect(r.error).toContain('plantilla no soportada');
  });
});

describe('etiquetas revision-simulada y dependencias', () => {
  it('las crea una sola vez', async () => {
    const gh = new GitHubFalso(ORG);
    const { ctx } = contexto(gh);
    expect((await reconciliarModulo(modulo(), ctx)).acciones).toEqual(expect.arrayContaining(['etiqueta revision-simulada', 'etiqueta dependencias']));
    const creadas = gh.llamadas.filter((l) => l.metodo === 'POST' && l.ruta.endsWith('/labels')).map((l) => l.cuerpo);
    expect(creadas).toMatchObject([{ name: 'revision-simulada', color: 'FBCA04' }, { name: 'dependencias' }]);
    gh.llamadas = [];
    const segunda = (await reconciliarModulo(modulo(), ctx)).acciones;
    expect(segunda).not.toContain('etiqueta revision-simulada');
    expect(segunda).not.toContain('etiqueta dependencias');
    expect(gh.rutas('POST')).not.toContain(`POST /repos/${ORG}/modulo-notas/labels`);
  });

  it('si no se puede crear, lo informa y el aprovisionamiento sigue', async () => {
    const gh = new GitHubFalso(ORG);
    gh.fallarEtiquetas = true;
    const { ctx } = contexto(gh);
    const r = await reconciliarModulo(modulo(), ctx);
    expect(r.estado).toBe('ok');
    expect(r.acciones).toContain('etiqueta revision-simulada: no se pudo crear (403)');
    expect(r.acciones.at(-1)).toContain('PR inicial');
  });
});

describe('CodeQL (SEG-10)', () => {
  const reglas = (gh: GitHubFalso) =>
    (gh.llamadas.filter((l) => /\/rulesets(\/\d+)?$/.test(l.ruta) && l.metodo !== 'GET').at(-1)?.cuerpo as { rules: { type: string; parameters?: unknown }[] }).rules;

  it('repo nuevo: CodeQL queda pendiente y el ruleset no lo exige (si no, bloquearía el PR inicial)', async () => {
    const gh = new GitHubFalso(ORG);
    const { ctx } = contexto(gh);
    const r = await reconciliarModulo(modulo(), ctx);
    expect(r.acciones).toContain('CodeQL pendiente (main sin código)');
    expect(gh.rutas()).not.toContain(`PATCH /repos/${ORG}/modulo-notas/code-scanning/default-setup`);
    expect(reglas(gh).map((x) => x.type)).not.toContain('code_scanning');
  });

  it('con código en main: activa CodeQL y el ruleset exige alertas por debajo de "alta"', async () => {
    const gh = new GitHubFalso(ORG);
    gh.repos.add('modulo-notas');
    gh.ramas.add('modulo-notas:main');
    gh.archivos.add('modulo-notas:modulo.yaml');
    const { ctx } = contexto(gh);
    const r = await reconciliarModulo(modulo(), ctx);
    expect(r.acciones).toContain('CodeQL activado');
    expect(gh.llamadas.find((l) => l.metodo === 'PATCH' && l.ruta.endsWith('/default-setup'))?.cuerpo).toEqual({ state: 'configured', query_suite: 'default' });
    expect(reglas(gh).find((x) => x.type === 'code_scanning')?.parameters).toEqual({
      code_scanning_tools: [{ tool: 'CodeQL', security_alerts_threshold: 'high_or_higher', alerts_threshold: 'errors' }],
    });

    // Segunda corrida: ya configurado, no lo vuelve a activar pero lo sigue exigiendo.
    gh.llamadas = [];
    const r2 = await reconciliarModulo(modulo(), ctx);
    expect(r2.acciones).not.toContain('CodeQL activado');
    expect(gh.rutas('PATCH')).not.toContain(`PATCH /repos/${ORG}/modulo-notas/code-scanning/default-setup`);
    expect(reglas(gh).map((x) => x.type)).toContain('code_scanning');
  });
});

describe('resumenMarkdown', () => {
  it('registry vacío y módulos omitidos', () => {
    expect(resumenMarkdown([])).toContain('No hay módulos');
    expect(resumenMarkdown([{ id: 'x', repo: 'plataforma', estado: 'omitido', acciones: [] }])).toContain('Sin repo propio');
  });
});
