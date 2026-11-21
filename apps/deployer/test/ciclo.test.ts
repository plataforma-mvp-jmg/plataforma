import { describe, expect, it } from 'vitest';
import { modulosDesplegables, procesarModulo, type Contexto } from '../src/ciclo.js';
import { AtestacionFalsa, BaseFalsa, DIGEST_A, DIGEST_B, DockerFalso, GitHubFalso, MapaFalso, ORG, modulo, saludFalsa, type DeploymentFalso } from './falsos.js';

function contexto(deps: DeploymentFalso[], o: { atestacion?: AtestacionFalsa; salud?: boolean; docker?: DockerFalso; entorno?: 'staging' | 'production'; base?: BaseFalsa } = {}) {
  const gh = new GitHubFalso(deps);
  const docker = o.docker ?? new DockerFalso();
  const mapa = new MapaFalso();
  const atestacion = o.atestacion ?? new AtestacionFalsa();
  const logs: string[] = [];
  const ctx: Contexto = {
    org: ORG, entorno: o.entorno ?? 'staging', gh, docker, atestacion, salud: saludFalsa(o.salud ?? true), mapa,
    ...(o.base ? { base: o.base } : {}),
    rangoPuertos: [4100, 4199], envModulo: { PLATFORM_JWKS_URL: 'http://host.docker.internal:8080/.well-known/jwks.json', PLATFORM_ISSUER: 'http://localhost:8080' },
    log: (m) => logs.push(m), ahora: () => new Date('2026-11-17T12:00:00Z'),
  };
  return { ctx, gh, docker, mapa, atestacion, logs };
}

/** Versión anterior ya desplegada del módulo. */
function conVersionAnterior() {
  const docker = new DockerFalso();
  docker.contenedores.push({ nombre: 'plat-staging-notas-bbbbbbbbbbbb', modulo: 'notas', entorno: 'staging', digest: DIGEST_B, puerto: 4100 });
  return docker;
}

describe('procesarModulo', () => {
  it('sin pedidos pendientes no hace nada', async () => {
    const { ctx, docker, gh } = contexto([{ id: 1, estados: ['success'] }]);
    expect((await procesarModulo(modulo(), ctx)).estado).toBe('sin_pedidos');
    expect(docker.descargados).toEqual([]);
    expect(gh.llamadas.filter((l) => l.metodo === 'POST')).toEqual([]);
  });

  it('pedido válido: verifica la atestación, levanta la versión nueva, retira la anterior y lo informa', async () => {
    const { ctx, gh, docker, mapa, atestacion } = contexto([{ id: 7 }], { docker: conVersionAnterior() });
    const r = await procesarModulo(modulo(), ctx);

    expect(r).toEqual({ modulo: 'notas', estado: 'desplegado', pedido: 7 });
    expect(atestacion.verificadas).toEqual([`ghcr.io/${ORG}/modulo-notas@${DIGEST_A} ${ORG}/modulo-notas`]);
    expect(docker.descargados).toEqual([`ghcr.io/${ORG}/modulo-notas@${DIGEST_A}`]);
    const run = docker.ejecutados[0];
    expect(run).toMatchObject({ nombre: 'plat-staging-notas-aaaaaaaaaaaa', puerto: 4101, imagen: `ghcr.io/${ORG}/modulo-notas@${DIGEST_A}` });
    expect(run?.env).toEqual({ PLATFORM_JWKS_URL: 'http://host.docker.internal:8080/.well-known/jwks.json', PLATFORM_ISSUER: 'http://localhost:8080', ENTORNO: 'staging' });
    expect(run?.etiquetas).toMatchObject({ 'plataforma.modulo': 'notas', 'plataforma.entorno': 'staging', 'plataforma.digest': DIGEST_A, 'plataforma.pedido': '7' });
    expect(docker.eliminados).toEqual(['plat-staging-notas-bbbbbbbbbbbb']);
    expect(mapa.datos.notas).toEqual({ url: 'http://127.0.0.1:4101', digest: DIGEST_A, pedido: 7, desplegado: '2026-11-17T12:00:00.000Z' });
    expect(gh.estados(7).map((e) => e.state)).toEqual(['in_progress', 'success']);
  });

  it('solo despliega el pedido más nuevo; los pendientes anteriores quedan inactivos', async () => {
    const { ctx, gh, docker } = contexto([{ id: 9, created_at: '2026-11-17T11:00:00Z' }, { id: 8, created_at: '2026-11-17T10:00:00Z', estados: ['queued'] }]);
    expect((await procesarModulo(modulo(), ctx)).pedido).toBe(9);
    expect(gh.estados(8)).toMatchObject([{ state: 'inactive', description: 'Reemplazado por el pedido #9' }]);
    expect(docker.ejecutados).toHaveLength(1);
  });

  it.each([
    ['creado por una persona y no por el workflow', { creador: 'alguien' }, 'solo se aceptan pedidos de los workflows de la plataforma'],
    ['con la imagen de otro módulo', { payload: { imagen: `ghcr.io/${ORG}/modulo-otro`, digest: DIGEST_A } }, 'no es la del módulo'],
    ['con un tag en lugar de digest', { payload: { imagen: `ghcr.io/${ORG}/modulo-notas`, digest: 'latest' } }, 'digest inválido'],
    ['sin payload', { payload: '' }, 'no es la del módulo'],
  ])('pedido %s → rechazado sin tocar Docker y la versión anterior sigue', async (_c, extra, motivo) => {
    const { ctx, gh, docker } = contexto([{ id: 5, ...extra }], { docker: conVersionAnterior() });
    const r = await procesarModulo(modulo(), ctx);
    expect(r.estado).toBe('rechazado');
    expect(r.detalle).toContain(motivo);
    expect(docker.descargados).toEqual([]);
    expect(docker.contenedores.map((c) => c.nombre)).toEqual(['plat-staging-notas-bbbbbbbbbbbb']);
    expect(gh.estados(5).at(-1)).toMatchObject({ state: 'failure' });
    expect(gh.estados(5).at(-1)?.description).toContain('Rechazado:');
  });

  it('atestación inválida (T11: imagen fuera del pipeline) → rechazado sin descargar la imagen', async () => {
    const { ctx, docker, gh } = contexto([{ id: 6 }], { atestacion: new AtestacionFalsa('atestación inválida: no attestations found'), docker: conVersionAnterior() });
    const r = await procesarModulo(modulo(), ctx);
    expect(r.estado).toBe('rechazado');
    expect(docker.descargados).toEqual([]);
    expect(docker.contenedores).toHaveLength(1);
    expect(gh.estados(6).at(-1)?.description).toBe('Rechazado: atestación inválida: no attestations found');
  });

  it('la versión nueva no pasa el health check → se elimina y sigue la anterior', async () => {
    const { ctx, docker, mapa, gh, logs } = contexto([{ id: 3 }], { salud: false, docker: conVersionAnterior() });
    expect((await procesarModulo(modulo(), ctx)).estado).toBe('fallido');
    expect(docker.contenedores.map((c) => c.nombre)).toEqual(['plat-staging-notas-bbbbbbbbbbbb']);
    expect(mapa.datos).toEqual({});
    expect(gh.estados(3).at(-1)).toMatchObject({ state: 'failure', description: 'No pasó el health check; sigue activa la versión anterior' });
    expect(logs.join('\n')).toContain('Error: no arranca');
  });

  it('error de Docker → estado error, sin cambiar lo que está corriendo', async () => {
    const docker = conVersionAnterior();
    docker.fallarEn = 'descargar';
    const { ctx, gh } = contexto([{ id: 4 }], { docker });
    const r = await procesarModulo(modulo(), ctx);
    expect(r).toMatchObject({ estado: 'error', detalle: 'pull denegado' });
    expect(docker.contenedores).toHaveLength(1);
    expect(gh.estados(4).at(-1)).toMatchObject({ state: 'error', description: 'Error al desplegar: pull denegado' });
  });

  it('volver a desplegar el mismo digest reemplaza su contenedor y reutiliza el puerto', async () => {
    const docker = new DockerFalso();
    docker.contenedores.push({ nombre: 'plat-staging-notas-aaaaaaaaaaaa', modulo: 'notas', entorno: 'staging', digest: DIGEST_A, puerto: 4100 });
    const { ctx } = contexto([{ id: 2 }], { docker });
    expect((await procesarModulo(modulo(), ctx)).estado).toBe('desplegado');
    expect(docker.eliminados[0]).toBe('plat-staging-notas-aaaaaaaaaaaa');
    expect(docker.ejecutados[0]?.puerto).toBe(4100);
  });
});

describe('modulosDesplegables', () => {
  it('excluye los módulos del monorepo y los retirados', () => {
    const r = modulosDesplegables([modulo(), modulo({ id: 'ref', repo: 'plataforma' }), modulo({ id: 'viejo', repo: 'modulo-viejo', estado: 'retirado' })]);
    expect(r.map((m) => m.id)).toEqual(['notas']);
  });
});

describe('módulos con base (I4-4)', () => {
  const conBase = () => modulo({ datos: { clasificacion: 'interna', datos_personales: false, base: 'postgres' } });

  it('prepara la base, migra con la imagen nueva antes del corte y le pasa la conexión al contenedor', async () => {
    const base = new BaseFalsa();
    const { ctx, docker, gh } = contexto([{ id: 7 }], { base, docker: conVersionAnterior() });
    expect((await procesarModulo(conBase(), ctx)).estado).toBe('desplegado');
    expect(base.aseguradas).toEqual(['notas']);
    expect(docker.migraciones).toHaveLength(1);
    expect(docker.migraciones[0]).toMatchObject({ imagen: `ghcr.io/${ORG}/modulo-notas@${DIGEST_A}`, env: { DB_SCHEMA: 'notas_staging', ENTORNO: 'staging' } });
    expect(docker.migraciones[0]?.nombre).toMatch(/^plat-staging-notas-aaaaaaaaaaaa-migrar-\d+$/);
    expect(docker.ejecutados[0]?.env).toMatchObject({ DATABASE_URL: expect.stringContaining('mod_notas'), DB_SCHEMA: 'notas_staging' });
    expect(gh.estados(7).map((e) => e.description).join(' | ')).not.toContain('secreta');
  });

  it('si las migraciones fallan no levanta la versión nueva y la anterior sigue; la URL no llega al log', async () => {
    const docker = conVersionAnterior();
    docker.resultadoMigracion = { ok: false, salida: 'error: relation "x" already exists (postgresql://mod_notas.ref:secreta@pooler.test:5432/postgres)' };
    const { ctx, gh, logs } = contexto([{ id: 8 }], { base: new BaseFalsa(), docker });
    expect((await procesarModulo(conBase(), ctx)).estado).toBe('fallido');
    expect(docker.ejecutados).toEqual([]);
    expect(docker.contenedores.map((c) => c.nombre)).toEqual(['plat-staging-notas-bbbbbbbbbbbb']);
    expect(gh.estados(8).at(-1)).toMatchObject({ state: 'failure', description: 'Las migraciones fallaron; sigue activa la versión anterior' });
    expect(logs.join('\n')).toContain('already exists (postgresql://<oculta>)');
    expect(logs.join('\n')).not.toContain('secreta');
  });

  it('sin base configurada en el deployer, el pedido termina en error sin tocar lo que corre', async () => {
    const { ctx, docker, gh } = contexto([{ id: 9 }], { docker: conVersionAnterior() });
    expect((await procesarModulo(conBase(), ctx)).estado).toBe('error');
    expect(docker.contenedores).toHaveLength(1);
    expect(gh.estados(9).at(-1)?.description).toContain('no tiene DB_ADMIN_URL');
  });

  it('error al preparar la base: estado error y sin credenciales en GitHub', async () => {
    const { ctx, gh } = contexto([{ id: 10 }], { base: new BaseFalsa('timeout con postgresql://postgres.ref:admin@pooler.test:5432/postgres') });
    expect((await procesarModulo(conBase(), ctx)).estado).toBe('error');
    expect(gh.estados(10).at(-1)?.description).toBe('Error al desplegar: timeout con postgresql://<oculta>');
  });

  it('un módulo sin base no toca la base ni migra', async () => {
    const base = new BaseFalsa();
    const { ctx, docker } = contexto([{ id: 11 }], { base });
    await procesarModulo(modulo(), ctx);
    expect(base.aseguradas).toEqual([]);
    expect(docker.migraciones).toEqual([]);
    expect(docker.ejecutados[0]?.env).not.toHaveProperty('DATABASE_URL');
  });
});
