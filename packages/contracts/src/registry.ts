// Module Registry (ADR-004, ADR-028): un YAML por módulo en /registry. Lo validan la API al arrancar,
// la CI y el aprovisionador (I2-3).
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const sinEmailNiUrl = z
  .string()
  .min(1)
  .refine((v) => !/[^\s@]+@[^\s@]+\.[a-z]{2,}|:\/\//.test(v.toLowerCase()), 'no se permiten emails ni URLs (P1, P7)');

export const esquemaModulo = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
    nombre: sinEmailNiUrl.max(60),
    objetivo: sinEmailNiUrl,
    area: sinEmailNiUrl,
    empresas: z.array(z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/)).min(1),
    duenos: z.object({ product_owner: sinEmailNiUrl, responsable_tecnico: sinEmailNiUrl }).strict(),
    repo: sinEmailNiUrl,
    plantilla: sinEmailNiUrl,
    estado: z.enum(['propuesto', 'en_desarrollo', 'staging', 'produccion', 'deprecado', 'retirado']),
    riesgo: z.enum(['bajo', 'medio', 'alto']),
    criticidad: z.enum(['baja', 'media', 'alta']),
    sox: z.object({ en_alcance: z.boolean(), justificacion: sinEmailNiUrl }).strict(),
    datos: z
      .object({
        clasificacion: z.enum(['publica', 'interna', 'confidencial', 'restringida']),
        datos_personales: z.boolean(),
        // I4-4: el módulo usa una base propia. El deployer le crea un esquema y un rol por entorno.
        base: z.enum(['postgres']).optional(),
      })
      .strict(),
    agente: z.object({ habilitado: z.boolean() }).strict(),
    estimacion_referencia_horas: z.number().int().positive().optional(),
    menu: z.object({ seccion: sinEmailNiUrl.max(40), orden: z.number().int().min(0).max(999) }).strict(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if ((m.riesgo === 'alto' || m.sox.en_alcance) && m.duenos.product_owner === m.duenos.responsable_tecnico) {
      ctx.addIssue({ code: 'custom', path: ['duenos'], message: 'en riesgo alto o SOX, PO y responsable técnico deben ser distintos' });
    }
    // El repo de un módulo se llama modulo-<id>; "plataforma" solo para módulos de referencia del monorepo.
    if (m.repo !== 'plataforma' && m.repo !== `modulo-${m.id}`) {
      ctx.addIssue({ code: 'custom', path: ['repo'], message: `el repo debe ser "modulo-${m.id}" (o "plataforma" para módulos de referencia)` });
    }
    if (!/^plantilla-modulo@\d+\.\d+\.\d+$/.test(m.plantilla)) {
      ctx.addIssue({ code: 'custom', path: ['plantilla'], message: 'formato esperado: plantilla-modulo@<versión semántica>' });
    }
    if (m.datos.datos_personales && m.riesgo === 'bajo') {
      ctx.addIssue({ code: 'custom', path: ['riesgo'], message: 'con datos personales el riesgo no puede ser bajo' });
    }
  });

export type ModuloRegistry = z.infer<typeof esquemaModulo>;

/** Carga y valida todos los módulos. Lanza con un mensaje claro si alguno es inválido. */
export function cargarRegistry(dir: string): ModuloRegistry[] {
  let archivos: string[];
  try {
    archivos = readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
  } catch {
    return [];
  }
  return archivos.map((archivo) => {
    const r = esquemaModulo.safeParse(parse(readFileSync(join(dir, archivo), 'utf8')));
    if (!r.success) {
      const detalle = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Registry inválido (${archivo}): ${detalle}`);
    }
    if (r.data.id !== basename(archivo, '.yaml')) throw new Error(`Registry inválido (${archivo}): el id debe coincidir con el nombre del archivo`);
    return r.data;
  });
}
