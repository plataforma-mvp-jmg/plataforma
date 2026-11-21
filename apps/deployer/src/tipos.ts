// Contratos internos del deployer. Las implementaciones reales (docker, gh) quedan detrás de interfaces
// para probar la lógica sin red ni contenedores.
export type Entorno = 'staging' | 'production';

export interface Pedido {
  id: number;
  sha: string;
  entorno: string;
  creador: string;
  payload: unknown;
  creado: string;
}

export interface Contenedor {
  nombre: string;
  modulo: string;
  entorno: string;
  digest: string;
  puerto: number;
}

export interface OpcionesRun {
  nombre: string;
  imagen: string;
  puerto: number;
  etiquetas: Record<string, string>;
  env: Record<string, string>;
}

export interface Docker {
  descargar(imagen: string): Promise<void>;
  /** Contenedores administrados por el deployer en un entorno (por etiquetas). */
  listar(entorno: Entorno): Promise<Contenedor[]>;
  ejecutar(o: OpcionesRun): Promise<void>;
  eliminar(nombre: string): Promise<void>;
  /** Últimas líneas del log (para diagnóstico local, nunca a GitHub). */
  logs(nombre: string): Promise<string>;
  /** Corre `node dist/migrar.js` de la imagen en un contenedor de un solo uso (I4-4). */
  migrar(o: { nombre: string; imagen: string; env: Record<string, string> }): Promise<ResultadoMigracion>;
}

export interface BaseModulo {
  esquema: string;
  /** URL con el rol del módulo. Va al contenedor por variable de entorno; nunca a logs ni a GitHub. */
  url: string;
}

export interface ProveedorBase {
  /** Crea o corrige el esquema y el rol del módulo (idempotente) y devuelve cómo conectarse. */
  asegurar(id: string): Promise<BaseModulo>;
}

export interface ResultadoMigracion {
  ok: boolean;
  /** Salida del proceso, sin credenciales. Solo para el log local. */
  salida: string;
}

export interface VerificadorAtestacion {
  /** Lanza un Error con el motivo si la atestación no cumple la política. */
  verificar(imagen: string, digest: string, repo: string): Promise<void>;
}

export interface Salud {
  /** true si el módulo responde /health y /meta con el id esperado dentro del plazo. */
  esperar(puerto: number, idModulo: string): Promise<boolean>;
}

export interface EntradaMapa {
  url: string;
  digest: string;
  pedido: number;
  desplegado: string;
  /** Producción: quién aprobó y en qué run (evidencia, I4-3). */
  aprobadoPor?: string[];
  run?: number;
}

export interface Mapa {
  leer(): Promise<Record<string, EntradaMapa>>;
  escribir(id: string, entrada: EntradaMapa): Promise<void>;
}
