// Un ciclo del deployer para un módulo y un entorno: toma el pedido pendiente más nuevo, lo valida,
// en producción verifica las aprobaciones (I4-3), verifica la atestación, prepara la base y migra (I4-4), levanta la versión nueva y recién retira la anterior si la nueva está sana.
// Cualquier rechazo o falla deja la versión anterior funcionando.
import type { ModuloRegistry } from '@plataforma/contracts';
import type { ClienteGitHub } from '@plataforma/github';
import { sinCredenciales } from './base.js';
import { verificarPromocion, type Promocion } from './promocion.js';
import type { Docker, Entorno, Mapa, Pedido, ProveedorBase, Salud, VerificadorAtestacion } from './tipos.js';
import { descripcion, nombreContenedor, puertoLibre, TAREA, validarPedido } from './verificacion.js';

export interface Contexto {
  org: string;
  entorno: Entorno;
  gh: ClienteGitHub;
  docker: Docker;
  atestacion: VerificadorAtestacion;
  salud: Salud;
  mapa: Mapa;
  rangoPuertos: [number, number];
  /** Variables para el contenedor (JWKS e issuer de la plataforma). Nunca secretos de la plataforma. */
  envModulo: Record<string, string>;
  /** Base de los módulos con `datos.base` (I4-4). Sin configurar, esos módulos no se despliegan. */
  base?: ProveedorBase;
  log: (mensaje: string) => void;
  ahora?: () => Date;
}

export type EstadoCiclo = 'sin_pedidos' | 'desplegado' | 'rechazado' | 'fallido' | 'error';
export interface ResultadoCiclo {
  modulo: string;
  estado: EstadoCiclo;
  pedido?: number;
  detalle?: string;
}

const ENTORNO_MODULO: Record<Entorno, string> = { staging: 'staging', production: 'produccion' };
const PENDIENTE = new Set(['queued', 'pending']);

interface DeploymentApi {
  id: number;
  sha: string;
  environment: string;
  creator: { login: string } | null;
  payload: unknown;
  created_at: string;
}

// Solo pedidos con la tarea de la plataforma: GitHub crea además un deployment propio por cada job que usa
// un environment (por ejemplo, el job aprobado de modulo-promover), y esos no son pedidos.
async function pedidosPendientes(ctx: Contexto, repo: string): Promise<Pedido[]> {
  const deps = await ctx.gh.pedir<DeploymentApi[]>('GET', `/repos/${ctx.org}/${repo}/deployments?environment=${ctx.entorno}&task=${TAREA}&per_page=10`);
  const pendientes: Pedido[] = [];
  for (const d of deps) {
    const estados = await ctx.gh.pedir<{ state: string }[]>('GET', `/repos/${ctx.org}/${repo}/deployments/${d.id}/statuses?per_page=1`);
    const estado = estados[0]?.state;
    if (estado === undefined || PENDIENTE.has(estado)) {
      pendientes.push({ id: d.id, sha: d.sha, entorno: d.environment, creador: d.creator?.login ?? '', payload: d.payload, creado: d.created_at });
    }
  }
  // La API devuelve primero el más nuevo; se ordena igual por las dudas.
  return pendientes.sort((a, b) => b.creado.localeCompare(a.creado));
}

async function informar(ctx: Contexto, repo: string, pedido: number, state: string, texto: string) {
  await ctx.gh.pedir('POST', `/repos/${ctx.org}/${repo}/deployments/${pedido}/statuses`, {
    state,
    description: descripcion(texto),
    environment: ctx.entorno,
    auto_inactive: true,
  });
}

export async function procesarModulo(m: ModuloRegistry, ctx: Contexto): Promise<ResultadoCiclo> {
  const repo = m.repo;
  const pendientes = await pedidosPendientes(ctx, repo);
  const [pedido, ...viejos] = pendientes;
  if (!pedido) return { modulo: m.id, estado: 'sin_pedidos' };

  // Solo se despliega el pedido más nuevo; los anteriores pendientes quedan descartados.
  for (const v of viejos) await informar(ctx, repo, v.id, 'inactive', `Reemplazado por el pedido #${pedido.id}`);
  await informar(ctx, repo, pedido.id, 'in_progress', 'Verificando el pedido y la atestación');

  // 1. Validación del pedido y de la procedencia de la imagen (antes de tocar Docker).
  let destino: { imagen: string; digest: string; run?: number };
  let promocion: Promocion | undefined;
  try {
    destino = validarPedido(pedido, { org: ctx.org, repo, entorno: ctx.entorno });
    if (destino.run !== undefined) {
      promocion = await verificarPromocion({ gh: ctx.gh, org: ctx.org, modulo: m, pedido: pedido.id, creado: pedido.creado, digest: destino.digest, run: destino.run });
    }
    await ctx.atestacion.verificar(destino.imagen, destino.digest, `${ctx.org}/${repo}`);
  } catch (err) {
    const motivo = (err as Error).message;
    await informar(ctx, repo, pedido.id, 'failure', `Rechazado: ${motivo}`);
    ctx.log(`${m.id} #${pedido.id}: rechazado (${motivo})`);
    return { modulo: m.id, estado: 'rechazado', pedido: pedido.id, detalle: motivo };
  }

  // 2. Versión nueva en un puerto propio; la anterior sigue atendiendo mientras tanto.
  const ref = `${destino.imagen}@${destino.digest}`;
  const nombre = nombreContenedor(ctx.entorno, m.id, destino.digest);
  let creado = false;
  const envEntorno = { ...ctx.envModulo, ENTORNO: ENTORNO_MODULO[ctx.entorno] };
  try {
    await ctx.docker.descargar(ref);

    // 2a. Base del módulo (I4-4): esquema y rol propios, y migraciones con la imagen NUEVA antes del corte.
    //     Si fallan, la versión anterior sigue atendiendo. Las migraciones tienen que ser compatibles hacia atrás.
    let envBase: Record<string, string> = {};
    if (m.datos.base === 'postgres') {
      if (!ctx.base) throw new Error('el módulo usa base y el deployer no tiene DB_ADMIN_URL ni DB_CLAVE_MAESTRA');
      const b = await ctx.base.asegurar(m.id);
      envBase = { DATABASE_URL: b.url, DB_SCHEMA: b.esquema };
      await informar(ctx, repo, pedido.id, 'in_progress', `Aplicando migraciones en ${b.esquema}`);
      const r = await ctx.docker.migrar({ nombre: `${nombre}-migrar-${(ctx.ahora?.() ?? new Date()).getTime()}`, imagen: ref, env: { ...envEntorno, ...envBase } });
      if (!r.ok) {
        ctx.log(`${m.id} #${pedido.id}: migraciones fallidas\n${sinCredenciales(r.salida)}`);
        await informar(ctx, repo, pedido.id, 'failure', 'Las migraciones fallaron; sigue activa la versión anterior');
        return { modulo: m.id, estado: 'fallido', pedido: pedido.id, detalle: 'migraciones' };
      }
    }

    const existentes = await ctx.docker.listar(ctx.entorno);
    if (existentes.some((c) => c.nombre === nombre)) await ctx.docker.eliminar(nombre);
    const puerto = puertoLibre(ctx.rangoPuertos, existentes.filter((c) => c.nombre !== nombre).map((c) => c.puerto));
    await ctx.docker.ejecutar({
      nombre,
      imagen: ref,
      puerto,
      etiquetas: {
        'plataforma.modulo': m.id,
        'plataforma.entorno': ctx.entorno,
        'plataforma.digest': destino.digest,
        'plataforma.puerto': String(puerto),
        'plataforma.pedido': String(pedido.id),
      },
      env: { ...envEntorno, ...envBase },
    });
    creado = true;

    if (!(await ctx.salud.esperar(puerto, m.id))) {
      ctx.log(`${m.id} #${pedido.id}: no pasó el health check\n${await ctx.docker.logs(nombre)}`);
      await ctx.docker.eliminar(nombre);
      await informar(ctx, repo, pedido.id, 'failure', 'No pasó el health check; sigue activa la versión anterior');
      return { modulo: m.id, estado: 'fallido', pedido: pedido.id, detalle: 'health check' };
    }

    // 3. Corte: la versión nueva queda publicada en el mapa y se retiran las anteriores del módulo.
    await ctx.mapa.escribir(m.id, {
      url: `http://127.0.0.1:${puerto}`,
      digest: destino.digest,
      pedido: pedido.id,
      desplegado: (ctx.ahora?.() ?? new Date()).toISOString(),
      ...(promocion ? { aprobadoPor: promocion.aprobadores, run: promocion.run } : {}),
    });
    for (const c of existentes) if (c.modulo === m.id && c.nombre !== nombre) await ctx.docker.eliminar(c.nombre);
    // Evidencia en GitHub (SOX): quién pidió, quién aprobó y en qué run.
    const evidencia = promocion ? `; pidió ${promocion.solicitante}, aprobó ${promocion.aprobadores.join(', ')} (run ${promocion.run})` : '';
    await informar(ctx, repo, pedido.id, 'success', `Desplegado ${destino.digest.slice(0, 19)} en el puerto ${puerto}${evidencia}`);
    ctx.log(`${m.id} #${pedido.id}: desplegado ${destino.digest} en ${puerto}${evidencia}`);
    return { modulo: m.id, estado: 'desplegado', pedido: pedido.id };
  } catch (err) {
    const motivo = sinCredenciales((err as Error).message);
    if (creado) await ctx.docker.eliminar(nombre).catch(() => undefined);
    await informar(ctx, repo, pedido.id, 'error', `Error al desplegar: ${motivo}`).catch(() => undefined);
    ctx.log(`${m.id} #${pedido.id}: error (${motivo})`);
    return { modulo: m.id, estado: 'error', pedido: pedido.id, detalle: motivo };
  }
}

/** Módulos con repo propio y no retirados (mismo criterio que el aprovisionador). */
export function modulosDesplegables(registry: ModuloRegistry[]): ModuloRegistry[] {
  return registry.filter((m) => m.repo !== 'plataforma' && m.estado !== 'retirado');
}
