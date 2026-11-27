import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { crearEmisorTokensRepo } from '../src/index.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const PERMISOS = { contents: 'write', pull_requests: 'write' } as const;

function falso(respuesta: (body: Record<string, unknown>) => Record<string, unknown>) {
  const llamadas: { url: string; body?: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    llamadas.push({ url, ...(body ? { body } : {}) });
    if (url.endsWith('/installation')) return new Response('{"id":7}', { status: 200 });
    return new Response(JSON.stringify(respuesta(body ?? {})), { status: 201 });
  }) as unknown as typeof fetch;
  return { llamadas, fetchFn };
}

const ok = (body: Record<string, unknown>) => ({
  token: 'ghs_x',
  expires_at: '2026-11-27T12:00:00Z',
  permissions: { ...(body.permissions as object), metadata: 'read' },
  repository_selection: 'selected',
  repositories: (body.repositories as string[]).map((name) => ({ name })),
});

describe('emisor de tokens por repo (workspace)', () => {
  it('pide un token acotado al repo y a los permisos, sin caché', async () => {
    const { llamadas, fetchFn } = falso(ok);
    const emitir = crearEmisorTokensRepo({ clientId: 'Iv23', clavePrivada: pem, org: 'o', permisos: PERMISOS, fetchFn });
    const t = await emitir('modulo-notas-piloto');
    expect(t).toEqual({ token: 'ghs_x', vence: new Date('2026-11-27T12:00:00Z'), repo: 'modulo-notas-piloto' });
    expect(llamadas[1]?.body).toEqual({ repositories: ['modulo-notas-piloto'], permissions: PERMISOS });
    await emitir('modulo-notas-piloto');
    // La instalación se resuelve una vez; el token se pide cada vez.
    expect(llamadas.map((l) => l.url.split('/').pop())).toEqual(['installation', 'access_tokens', 'access_tokens']);
  });

  it('rechaza un token que alcance todos los repos u otro repo', async () => {
    const todos = falso((b) => ({ ...ok(b), repository_selection: 'all' }));
    await expect(crearEmisorTokensRepo({ clientId: 'x', clavePrivada: pem, org: 'o', permisos: PERMISOS, fetchFn: todos.fetchFn })('modulo-a')).rejects.toThrow('no está acotado');
    const otro = falso((b) => ({ ...ok(b), repositories: [{ name: 'plataforma' }] }));
    await expect(crearEmisorTokensRepo({ clientId: 'x', clavePrivada: pem, org: 'o', permisos: PERMISOS, fetchFn: otro.fetchFn })('modulo-a')).rejects.toThrow('no está acotado');
  });

  it('rechaza un token con permisos no pedidos o más amplios', async () => {
    const extra = falso((b) => ({ ...ok(b), permissions: { ...PERMISOS, workflows: 'write' } }));
    await expect(crearEmisorTokensRepo({ clientId: 'x', clavePrivada: pem, org: 'o', permisos: PERMISOS, fetchFn: extra.fetchFn })('modulo-a')).rejects.toThrow('workflows:write');
    const amplio = falso((b) => ({ ...ok(b), permissions: { contents: 'write' } }));
    await expect(crearEmisorTokensRepo({ clientId: 'x', clavePrivada: pem, org: 'o', permisos: { contents: 'read' }, fetchFn: amplio.fetchFn })('modulo-a')).rejects.toThrow('contents:write');
  });

  it('valida el nombre del repo antes de llamar a GitHub', async () => {
    const { llamadas, fetchFn } = falso(ok);
    await expect(crearEmisorTokensRepo({ clientId: 'x', clavePrivada: pem, org: 'o', permisos: PERMISOS, fetchFn })('../plataforma')).rejects.toThrow('inválido');
    expect(llamadas).toHaveLength(0);
  });
});
