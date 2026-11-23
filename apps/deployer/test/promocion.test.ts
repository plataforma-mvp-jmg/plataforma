import { describe, expect, it } from 'vitest';
import { procesarModulo, type Contexto } from '../src/ciclo.js';
import { environmentsRequeridos } from '../src/promocion.js';
import { AtestacionFalsa, DIGEST_A, DIGEST_B, DockerFalso, GitHubFalso, MapaFalso, ORG, modulo, saludFalsa, type DeploymentFalso, type RunFalso } from './falsos.js';

const IMAGEN = `ghcr.io/${ORG}/modulo-notas`;
const RUN = 555;
const APROBADO: RunFalso = {
  actor: 'autor',
  aprobaciones: [{ state: 'approved', user: 'revisor', environments: ['production'] }],
};

/** Staging #1 exitoso con DIGEST_A y el pedido de producción #10 con el run indicado. */
function escenario(o: { run?: RunFalso; pedido?: Partial<DeploymentFalso>; extra?: DeploymentFalso[]; riesgo?: 'bajo' | 'medio' } = {}) {
  const gh = new GitHubFalso([
    { id: 1, environment: 'staging', estados: ['inactive', 'success', 'in_progress'], payload: { imagen: IMAGEN, digest: DIGEST_A } },
    ...(o.extra ?? []),
    { id: 10, environment: 'production', created_at: '2026-11-17T09:00:30Z', payload: { imagen: IMAGEN, digest: DIGEST_A, run_id: RUN }, ...o.pedido },
  ]);
  gh.runs[RUN] = o.run ?? APROBADO;
  const docker = new DockerFalso();
  const mapa = new MapaFalso();
  const atestacion = new AtestacionFalsa();
  const ctx: Contexto = {
    org: ORG, entorno: 'production', gh, docker, atestacion, salud: saludFalsa(true), mapa,
    rangoPuertos: [4500, 4599], envModulo: {}, log: () => {}, ahora: () => new Date('2026-11-21T12:00:00Z'),
  };
  return { ctx, gh, docker, mapa, atestacion, m: modulo({ riesgo: o.riesgo ?? 'bajo' }) };
}

describe('promoción a producción (I4-3)', () => {
  it('aprobada por otra persona y probada en staging → desplegada, con la evidencia en GitHub y en el mapa', async () => {
    const { ctx, gh, docker, mapa, m } = escenario();
    expect((await procesarModulo(m, ctx)).estado).toBe('desplegado');
    expect(docker.ejecutados[0]?.env.ENTORNO).toBe('produccion');
    expect(mapa.datos.notas).toMatchObject({ digest: DIGEST_A, pedido: 10, aprobadoPor: ['revisor'], run: RUN });
    expect(gh.estados(10).at(-1)).toMatchObject({ state: 'success', description: expect.stringContaining('pidió autor, aprobó revisor (run 555)') });
  });

  it('riesgo medio exige además la aceptación de negocio', async () => {
    const sinNegocio = escenario({ riesgo: 'medio' });
    expect((await procesarModulo(sinNegocio.m, sinNegocio.ctx)).detalle).toBe('falta la aprobación de "aceptacion-negocio" en el run 555');

    const conNegocio = escenario({
      riesgo: 'medio',
      run: { actor: 'autor', aprobaciones: [{ state: 'approved', user: 'po', environments: ['aceptacion-negocio'] }, ...(APROBADO.aprobaciones ?? [])] },
    });
    expect((await procesarModulo(conNegocio.m, conNegocio.ctx)).estado).toBe('desplegado');
    expect(conNegocio.mapa.datos.notas?.aprobadoPor).toEqual(['po', 'revisor']);
  });

  it.each<[string, Parameters<typeof escenario>[0], string]>([
    ['sin run_id', { pedido: { payload: { imagen: IMAGEN, digest: DIGEST_A } } }, 'falta el run de promoción (run_id)'],
    ['creado a mano por una persona', { pedido: { creador: 'autor' } }, 'solo se aceptan pedidos de los workflows de la plataforma'],
    ['run de otro workflow', { run: { ...APROBADO, referenced_workflows: [{ path: `${ORG}/plataforma/.github/workflows/modulo-publicar.yml@abc` }] } }, 'no usa modulo-promover.yml'],
    ['run de un workflow con el mismo nombre en otro repo', { run: { ...APROBADO, referenced_workflows: [{ path: `${ORG}/otro/.github/workflows/modulo-promover.yml@abc` }] } }, 'no usa modulo-promover.yml'],
    ['run desde otra rama', { run: { ...APROBADO, head_branch: 'feat/x' } }, 'no es una promoción manual desde main'],
    ['run disparado por push', { run: { ...APROBADO, event: 'push' } }, 'no es una promoción manual desde main'],
    ['run que terminó con error', { run: { ...APROBADO, status: 'completed', conclusion: 'failure' } }, 'terminó en failure'],
    ['sin aprobaciones', { run: { actor: 'autor' } }, 'falta la aprobación de "production"'],
    ['aprobación rechazada', { run: { actor: 'autor', aprobaciones: [{ state: 'rejected', user: 'revisor', environments: ['production'] }] } }, 'fue rechazada'],
    ['autoaprobación', { run: { actor: 'autor', aprobaciones: [{ state: 'approved', user: 'autor', environments: ['production'] }] } }, 'lo aprobó quien pidió la promoción (autor)'],
    ['digest que nunca pasó por staging', { pedido: { payload: { imagen: IMAGEN, digest: DIGEST_B, run_id: RUN } } }, 'no tiene un despliegue exitoso en staging'],
    ['pedido creado fuera del job de producción del run', { run: { ...APROBADO, jobs: [{ name: 'promover / producción (pedido de despliegue)', started_at: '2026-11-17T09:05:00Z', completed_at: '2026-11-17T09:06:00Z' }] } }, 'no lo creó el job de producción'],
    ['run sin el job de producción', { run: { ...APROBADO, jobs: [{ name: 'promover / preparar', started_at: '2026-11-17T09:00:00Z', completed_at: null }] } }, 'no lo creó el job de producción'],
    ['run ya usado en un pedido anterior', { extra: [{ id: 5, environment: 'production', estados: ['success'], payload: { imagen: IMAGEN, digest: DIGEST_A, run_id: RUN } }] }, 'ya se usó en el pedido #5'],
  ])('rechaza: %s, sin tocar Docker', async (_c, o, motivo) => {
    const { ctx, gh, docker, m } = escenario(o);
    const r = await procesarModulo(m, ctx);
    expect(r.estado).toBe('rechazado');
    expect(r.detalle).toContain(motivo);
    expect(docker.descargados).toEqual([]);
    expect(gh.estados(10).at(-1)).toMatchObject({ state: 'failure' });
  });

  it('un pedido anterior con el mismo run que no llegó a desplegarse no bloquea', async () => {
    const { ctx, m } = escenario({ extra: [{ id: 5, environment: 'production', estados: ['failure'], payload: { imagen: IMAGEN, digest: DIGEST_A, run_id: RUN } }] });
    expect((await procesarModulo(m, ctx)).estado).toBe('desplegado');
  });

  it('rollback (I4-5): un digest viejo probado en staging se encuentra aunque haya más de 100 despliegues después', async () => {
    const nuevos: DeploymentFalso[] = Array.from({ length: 150 }, (_, i) => ({
      id: 1000 + i, environment: 'staging', estados: ['success'], payload: { imagen: IMAGEN, digest: DIGEST_B },
    }));
    // DIGEST_A solo está en el despliegue #1, el más viejo (queda en la segunda página).
    const { ctx, gh, m } = escenario({ extra: nuevos });
    gh.deployments.sort((a, b) => (a.id === 10 ? -1 : b.id === 10 ? 1 : b.id - a.id));
    expect((await procesarModulo(m, ctx)).estado).toBe('desplegado');
    expect(gh.llamadas.some((l) => l.ruta.includes('environment=staging') && l.ruta.includes('page=2'))).toBe(true);
  });

  it('staging fallido con ese digest no cuenta como probado', async () => {
    const { ctx, gh, m } = escenario();
    gh.deployments[0] = { id: 1, environment: 'staging', estados: ['failure', 'in_progress'], payload: { imagen: IMAGEN, digest: DIGEST_A } };
    expect((await procesarModulo(m, ctx)).detalle).toContain('no tiene un despliegue exitoso en staging');
  });

  it('environments requeridos por riesgo', () => {
    expect(environmentsRequeridos('bajo')).toEqual(['production']);
    expect(environmentsRequeridos('alto')).toEqual(['aceptacion-negocio', 'production']);
  });
});
