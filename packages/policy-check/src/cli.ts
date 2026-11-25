#!/usr/bin/env node
// policy-check --modulo <dir> --plataforma <dir> --repo <nombre> [--pr-body <archivo>] [--pr-autor <login>] [--salida <json>]
//              [--registry <dir>] [--excepciones <archivo>] [--repo-plantilla <nombre>]
// El catálogo sale de --plataforma (versión fijada); registry y excepciones pueden venir de main (datos vivos).
// Código de salida: 0 cumple · 1 bloquea el merge · 2 configuración inválida.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { cargarRegistryTolerante } from '@plataforma/contracts';
import { cargarCatalogo, cargarExcepciones } from './configuracion.js';
import { evaluar } from './evaluar.js';
import { anotaciones, markdown, paraIa } from './salida.js';

const { values: a } = parseArgs({
  options: {
    modulo: { type: 'string', default: '.' },
    plataforma: { type: 'string' },
    repo: { type: 'string' },
    'pr-body': { type: 'string' },
    'pr-autor': { type: 'string' },
    salida: { type: 'string' },
    hoy: { type: 'string' },
    registry: { type: 'string' },
    excepciones: { type: 'string' },
    'repo-plantilla': { type: 'string' },
  },
});

try {
  if (!a.plataforma || !a.repo) throw new Error('faltan --plataforma y --repo');
  const hoy = a.hoy ?? new Date().toISOString().slice(0, 10);
  const catalogo = cargarCatalogo(join(a.plataforma, 'policies/catalogo.yaml'));
  // Registry vivo (main) con código fijado por SHA: se toleran campos nuevos y archivos de otros módulos que
  // no se puedan leer. Si el que falla es el del propio módulo, ARQ-06 lo informa como "no está en el registry".
  const registry = cargarRegistryTolerante(a.registry ?? join(a.plataforma, 'registry'));
  for (const archivo of registry.invalidos) process.stdout.write(`::warning::registry: ${archivo} no se pudo leer; se ignora\n`);
  const resultado = evaluar({
    dir: a.modulo,
    repo: a.repo,
    registry: registry.modulos,
    catalogo,
    excepciones: cargarExcepciones(a.excepciones ?? join(a.plataforma, 'policies/excepciones.yaml'), catalogo, hoy),
    cuerpoPr: a['pr-body'] ? readFileSync(a['pr-body'], 'utf8') : null,
    autorPr: a['pr-autor'] ?? null,
    hoy,
    repoPlantilla: a['repo-plantilla'],
  });
  const md = markdown(resultado);
  process.stdout.write(`${[...anotaciones(resultado), md].join('\n')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  if (a.salida) writeFileSync(a.salida, `${JSON.stringify(paraIa(resultado), null, 2)}\n`);
  process.exitCode = resultado.bloquea ? 1 : 0;
} catch (err) {
  process.stderr.write(`policy-check: ${(err as Error).message}\n`);
  process.exitCode = 2;
}
