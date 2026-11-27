// Autenticación como GitHub App: JWT RS256 firmado con la clave privada de la App → token de
// instalación de 1 hora, guardado en memoria y renovado 5 minutos antes de vencer.
// Solo node:crypto: lee las claves PKCS#1 ("BEGIN RSA PRIVATE KEY") que descarga GitHub.
import { createPrivateKey, createSign, type KeyObject } from 'node:crypto';

export interface OpcionesApp {
  /** Client ID de la App (GitHub lo acepta como emisor del JWT). */
  clientId: string;
  /** Contenido PEM de la clave privada. */
  clavePrivada: string;
  /** Organización donde está instalada la App. */
  org: string;
  /** Permisos pedidos para el token (subconjunto de los de la App: mínimo privilegio). */
  permisos?: Record<string, 'read' | 'write'>;
  api?: string;
  fetchFn?: typeof fetch;
  ahora?: () => number;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function jwtDeApp(clientId: string, clave: KeyObject, ahoraSeg: number): string {
  const encabezado = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // iat 60 s antes por desfase de relojes; vida máxima permitida por GitHub: 10 minutos.
  const cuerpo = b64url(JSON.stringify({ iat: ahoraSeg - 60, exp: ahoraSeg + 540, iss: clientId }));
  const firma = createSign('RSA-SHA256').update(`${encabezado}.${cuerpo}`).sign(clave);
  return `${encabezado}.${cuerpo}.${b64url(firma)}`;
}

function crearPedidorApp(o: Pick<OpcionesApp, 'api' | 'fetchFn'>) {
  const api = o.api ?? 'https://api.github.com';
  const f = o.fetchFn ?? fetch;
  return async <T>(metodo: string, ruta: string, jwt: string, cuerpo?: unknown): Promise<T> => {
    const res = await f(`${api}${ruta}`, {
      method: metodo,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${jwt}`,
        'x-github-api-version': '2022-11-28',
        ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    });
    if (!res.ok) throw new Error(`GitHub App: ${metodo} ${ruta} → ${res.status}`);
    return (await res.json()) as T;
  };
}

export function crearProveedorTokenApp(o: OpcionesApp): () => Promise<string> {
  const pedir = crearPedidorApp(o);
  const ahora = o.ahora ?? Date.now;
  const clave = createPrivateKey(o.clavePrivada);
  let cache: { token: string; vence: number } | null = null;

  return async () => {
    if (cache && cache.vence - ahora() > 5 * 60_000) return cache.token;
    const jwt = jwtDeApp(o.clientId, clave, Math.floor(ahora() / 1000));
    const inst = await pedir<{ id: number }>('GET', `/orgs/${o.org}/installation`, jwt);
    const t = await pedir<{ token: string; expires_at: string }>('POST', `/app/installations/${inst.id}/access_tokens`, jwt, o.permisos ? { permissions: o.permisos } : undefined);
    cache = { token: t.token, vence: Date.parse(t.expires_at) };
    return t.token;
  };
}

export interface TokenRepo {
  token: string;
  vence: Date;
  repo: string;
}

export type OpcionesEmisorRepo = Omit<OpcionesApp, 'permisos'> & { permisos: Record<string, 'read' | 'write'> };

/**
 * Emite un token de instalación acotado a UN repositorio y a los permisos pedidos (sin caché:
 * cada workspace recibe el suyo). Verifica la respuesta de GitHub: si el token alcanzara otro
 * repo o algún permiso no pedido (o más amplio), lo rechaza en vez de entregarlo.
 */
export function crearEmisorTokensRepo(o: OpcionesEmisorRepo): (repo: string) => Promise<TokenRepo> {
  const pedir = crearPedidorApp(o);
  const ahora = o.ahora ?? Date.now;
  const clave = createPrivateKey(o.clavePrivada);
  let idInstalacion: number | null = null;

  return async (repo: string) => {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) throw new Error('GitHub App: nombre de repo inválido');
    const jwt = jwtDeApp(o.clientId, clave, Math.floor(ahora() / 1000));
    if (idInstalacion === null) {
      idInstalacion = (await pedir<{ id: number }>('GET', `/orgs/${o.org}/installation`, jwt)).id;
    }
    const t = await pedir<{
      token: string;
      expires_at: string;
      permissions?: Record<string, string>;
      repository_selection?: string;
      repositories?: { name: string }[];
    }>('POST', `/app/installations/${idInstalacion}/access_tokens`, jwt, { repositories: [repo], permissions: o.permisos });

    const repos = (t.repositories ?? []).map((r) => r.name);
    if (t.repository_selection !== 'selected' || repos.length !== 1 || repos[0] !== repo) {
      throw new Error(`GitHub App: el token emitido no está acotado al repo ${repo}`);
    }
    for (const [permiso, nivel] of Object.entries(t.permissions ?? {})) {
      const pedido = o.permisos[permiso];
      if (permiso === 'metadata' && nivel === 'read') continue;
      if (!pedido || (pedido === 'read' && nivel !== 'read')) {
        throw new Error(`GitHub App: el token emitido trae un permiso no pedido (${permiso}:${nivel})`);
      }
    }
    return { token: t.token, vence: new Date(t.expires_at), repo };
  };
}
