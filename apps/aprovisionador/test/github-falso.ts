// GitHub falso en memoria: registra cada llamada y simula repos, ramas, rulesets y environments.
import { ErrorGitHub, type ClienteGitHub, type Metodo } from '../src/github.js';

export interface Llamada {
  metodo: Metodo;
  ruta: string;
  cuerpo?: unknown;
}

export class GitHubFalso implements ClienteGitHub {
  llamadas: Llamada[] = [];
  repos = new Set<string>();
  ramas = new Set<string>();
  archivos = new Set<string>();
  /** Archivos con contenido ("repo:ruta" → texto): la API los devuelve en base64. */
  contenidos = new Map<string, string>();
  rulesets = new Map<string, { id: number; name: string }[]>();
  politicas = new Map<string, string[]>();
  miembrosTeam = 1;
  codeql = new Map<string, string>();
  etiquetas = new Set<string>();
  fallarEtiquetas = false;
  fallarEn: string | null = null;

  constructor(private readonly org: string) {}

  async pedir<T>(metodo: Metodo, ruta: string, cuerpo?: unknown): Promise<T> {
    this.llamadas.push({ metodo, ruta, ...(cuerpo === undefined ? {} : { cuerpo }) });
    if (this.fallarEn && ruta.includes(this.fallarEn)) throw new ErrorGitHub(403, metodo, ruta, 'Resource not accessible by integration');
    const r = (x: unknown) => x as T;
    let m: RegExpExecArray | null;

    if (metodo === 'POST' && ruta === `/orgs/${this.org}/repos`) {
      this.repos.add((cuerpo as { name: string }).name);
      return r({});
    }
    if (/\/teams\/[^/]+\/members/.test(ruta)) return r(Array.from({ length: this.miembrosTeam }, (_, i) => ({ login: `rev${i}` })));
    if (/^\/orgs\/[^/]+\/teams\/[^/]+$/.test(ruta)) return r({ id: 77 });
    if (/^\/users\/[^/]+$/.test(ruta)) return r({ id: 55 });
    if ((m = /^\/repos\/[^/]+\/([^/]+)$/.exec(ruta))) {
      if (!this.repos.has(m[1] ?? '')) throw new ErrorGitHub(404, metodo, ruta, 'Not Found');
      return r({ html_url: `https://github.test/${m[1]}` });
    }
    if ((m = /^\/repos\/[^/]+\/([^/]+)\/branches\/(.+)$/.exec(ruta))) {
      if (!this.ramas.has(`${m[1]}:${decodeURIComponent(m[2] ?? '')}`)) throw new ErrorGitHub(404, metodo, ruta, 'Branch not found');
      return r({});
    }
    if ((m = /^\/repos\/[^/]+\/([^/]+)\/contents\/(.+)$/.exec(ruta))) {
      const clave = `${m[1]}:${m[2]}`;
      const texto = this.contenidos.get(clave);
      if (texto !== undefined) return r({ content: Buffer.from(texto, 'utf8').toString('base64') });
      if (!this.archivos.has(clave)) throw new ErrorGitHub(404, metodo, ruta, 'Not Found');
      return r({});
    }
    if ((m = /^\/repos\/[^/]+\/([^/]+)\/labels(?:\/(.+))?$/.exec(ruta))) {
      if (this.fallarEtiquetas) throw new ErrorGitHub(403, metodo, ruta, 'Resource not accessible by integration');
      if (metodo === 'POST') {
        this.etiquetas.add(`${m[1]}:${(cuerpo as { name: string }).name}`);
        return r({});
      }
      if (!this.etiquetas.has(`${m[1]}:${m[2] ?? ''}`)) throw new ErrorGitHub(404, metodo, ruta, 'Not Found');
      return r({});
    }
    if ((m = /^\/repos\/[^/]+\/([^/]+)\/code-scanning\/default-setup$/.exec(ruta))) {
      if (metodo === 'PATCH') this.codeql.set(m[1] ?? '', (cuerpo as { state: string }).state);
      return r({ state: this.codeql.get(m[1] ?? '') ?? 'not-configured' });
    }
    if ((m = /^\/repos\/[^/]+\/([^/]+)\/rulesets$/.exec(ruta))) {
      const lista = this.rulesets.get(m[1] ?? '') ?? [];
      if (metodo === 'POST') {
        lista.push({ id: lista.length + 1, name: (cuerpo as { name: string }).name });
        this.rulesets.set(m[1] ?? '', lista);
      }
      return r(lista);
    }
    if (/\/environments\/[^/]+\/deployment-branch-policies$/.test(ruta)) {
      const clave = ruta;
      const lista = this.politicas.get(clave) ?? [];
      if (metodo === 'POST') this.politicas.set(clave, [...lista, (cuerpo as { name: string }).name]);
      return r({ branch_policies: lista.map((name) => ({ name })) });
    }
    if (metodo === 'POST' && ruta.endsWith('/pulls')) return r({ html_url: 'https://github.test/pr/1' });
    return r({});
  }

  async buscar<T>(ruta: string): Promise<T | null> {
    try {
      return await this.pedir<T>('GET', ruta);
    } catch (err) {
      if (err instanceof ErrorGitHub && err.status === 404) return null;
      throw err;
    }
  }

  rutas(metodo?: Metodo): string[] {
    return this.llamadas.filter((l) => !metodo || l.metodo === metodo).map((l) => `${l.metodo} ${l.ruta}`);
  }
}
