import type { ModuloRegistry } from '@plataforma/contracts';
import type { ClienteGitHub, Metodo } from '@plataforma/github';
import type { BaseModulo, Contenedor, Docker, EntradaMapa, Mapa, OpcionesRun, ProveedorBase, ResultadoMigracion, Salud, VerificadorAtestacion } from '../src/tipos.js';

export const ORG = 'org-test';
export const DIGEST_A = `sha256:${'a'.repeat(64)}`;
export const DIGEST_B = `sha256:${'b'.repeat(64)}`;

export function modulo(extra: Partial<ModuloRegistry> = {}): ModuloRegistry {
  return {
    id: 'notas', nombre: 'Notas', objetivo: 'x', area: 'Sistemas', empresas: ['acopio'],
    duenos: { product_owner: 'po', responsable_tecnico: 'rt' }, repo: 'modulo-notas', plantilla: 'plantilla-modulo@0.4.0',
    estado: 'en_desarrollo', riesgo: 'bajo', criticidad: 'baja', sox: { en_alcance: false, justificacion: 'x' },
    datos: { clasificacion: 'interna', datos_personales: false }, agente: { habilitado: false }, menu: { seccion: 'S', orden: 1 },
    ...extra,
  };
}

export interface DeploymentFalso {
  id: number;
  environment?: string;
  creador?: string;
  payload?: unknown;
  created_at?: string;
  estados?: string[];
}

export interface RunFalso {
  event?: string;
  head_branch?: string;
  status?: string;
  conclusion?: string | null;
  actor?: string;
  triggering_actor?: string;
  referenced_workflows?: { path: string }[];
  aprobaciones?: { state: string; user: string; environments: string[] }[];
  jobs?: { name: string; started_at: string | null; completed_at: string | null }[];
}

export class GitHubFalso implements ClienteGitHub {
  llamadas: { metodo: Metodo; ruta: string; cuerpo?: unknown }[] = [];
  runs: Record<number, RunFalso> = {};
  constructor(public deployments: DeploymentFalso[]) {}
  async pedir<T>(metodo: Metodo, ruta: string, cuerpo?: unknown): Promise<T> {
    this.llamadas.push({ metodo, ruta, ...(cuerpo === undefined ? {} : { cuerpo }) });
    const r = (x: unknown) => x as T;
    let m: RegExpExecArray | null;
    if ((m = /\/actions\/runs\/(\d+)\/jobs/.exec(ruta))) {
      const run = this.runs[Number(m[1])];
      return r({ jobs: run?.jobs ?? [{ name: 'promover / producción (pedido de despliegue)', started_at: '2026-11-17T09:00:00Z', completed_at: null }] });
    }
    if ((m = /\/actions\/runs\/(\d+)(\/approvals)?$/.exec(ruta))) {
      const run = this.runs[Number(m[1])];
      if (!run) throw new Error('404 run');
      if (m[2]) return r((run.aprobaciones ?? []).map((a) => ({ state: a.state, user: { login: a.user }, environments: a.environments.map((name) => ({ name })) })));
      return r({
        event: run.event ?? 'workflow_dispatch',
        head_branch: run.head_branch ?? 'main',
        status: run.status ?? 'in_progress',
        conclusion: run.conclusion ?? null,
        actor: { login: run.actor ?? 'autor' },
        triggering_actor: { login: run.triggering_actor ?? run.actor ?? 'autor' },
        referenced_workflows: run.referenced_workflows ?? [{ path: `${ORG}/plataforma/.github/workflows/modulo-promover.yml@abc` }],
      });
    }
    if ((m = /\/deployments\?environment=([a-z-]+)&task=deploy:plataforma/.exec(ruta))) {
      const env = m[1];
      return r(this.deployments.filter((d) => (d.environment ?? 'staging') === env).map((d) => ({ id: d.id, sha: 'abc', environment: d.environment ?? 'staging', creator: { login: d.creador ?? 'github-actions[bot]' }, payload: d.payload ?? { imagen: `ghcr.io/${ORG}/modulo-notas`, digest: DIGEST_A }, created_at: d.created_at ?? `2026-11-17T10:00:0${d.id}Z` })));
    }
    if ((m = /\/deployments\/(\d+)\/statuses/.exec(ruta))) {
      const d = this.deployments.find((x) => x.id === Number(m?.[1]));
      if (metodo === 'POST') {
        d?.estados?.unshift((cuerpo as { state: string }).state);
        if (d && !d.estados) d.estados = [(cuerpo as { state: string }).state];
        return r({});
      }
      const limite = /per_page=1$/.test(ruta) ? 1 : 100;
      return r((d?.estados ?? []).slice(0, limite).map((state) => ({ state })));
    }
    throw new Error(`ruta no simulada: ${metodo} ${ruta}`);
  }
  async buscar<T>(): Promise<T | null> {
    return null;
  }
  estados(id: number) {
    return this.llamadas.filter((l) => l.metodo === 'POST' && l.ruta.endsWith(`/deployments/${id}/statuses`)).map((l) => l.cuerpo as { state: string; description: string });
  }
}

export class DockerFalso implements Docker {
  contenedores: Contenedor[] = [];
  ejecutados: OpcionesRun[] = [];
  eliminados: string[] = [];
  descargados: string[] = [];
  fallarEn: 'descargar' | 'ejecutar' | null = null;
  async descargar(imagen: string) {
    if (this.fallarEn === 'descargar') throw new Error('pull denegado');
    this.descargados.push(imagen);
  }
  async listar() {
    return [...this.contenedores];
  }
  async ejecutar(o: OpcionesRun) {
    if (this.fallarEn === 'ejecutar') throw new Error('puerto ocupado');
    this.ejecutados.push(o);
    this.contenedores.push({ nombre: o.nombre, modulo: o.etiquetas['plataforma.modulo'] ?? '', entorno: o.etiquetas['plataforma.entorno'] ?? '', digest: o.etiquetas['plataforma.digest'] ?? '', puerto: o.puerto });
  }
  async eliminar(nombre: string) {
    this.eliminados.push(nombre);
    this.contenedores = this.contenedores.filter((c) => c.nombre !== nombre);
  }
  async logs() {
    return 'Error: no arranca';
  }
  migraciones: { nombre: string; imagen: string; env: Record<string, string> }[] = [];
  resultadoMigracion: ResultadoMigracion = { ok: true, salida: 'aplicadas: 0001_inicial.sql' };
  async migrar(o: { nombre: string; imagen: string; env: Record<string, string> }) {
    this.migraciones.push(o);
    return this.resultadoMigracion;
  }
}

export class BaseFalsa implements ProveedorBase {
  aseguradas: string[] = [];
  constructor(private readonly error: string | null = null) {}
  async asegurar(id: string): Promise<BaseModulo> {
    if (this.error) throw new Error(this.error);
    this.aseguradas.push(id);
    return { esquema: `${id.replace(/-/g, '_')}_staging`, url: `postgresql://mod_${id}.ref:secreta@pooler.test:5432/postgres` };
  }
}

export class AtestacionFalsa implements VerificadorAtestacion {
  verificadas: string[] = [];
  constructor(private readonly error: string | null = null) {}
  async verificar(imagen: string, digest: string, repo: string) {
    if (this.error) throw new Error(this.error);
    this.verificadas.push(`${imagen}@${digest} ${repo}`);
  }
}

export const saludFalsa = (ok: boolean): Salud => ({ esperar: async () => ok });

export class MapaFalso implements Mapa {
  datos: Record<string, EntradaMapa> = {};
  async leer() {
    return this.datos;
  }
  async escribir(id: string, e: EntradaMapa) {
    this.datos[id] = e;
  }
}
