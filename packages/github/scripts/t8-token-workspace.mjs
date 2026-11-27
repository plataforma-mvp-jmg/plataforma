// Prueba T8 (ADR 0020) contra GitHub real: lo que puede y lo que NO puede hacer un token de workspace.
// Uso (desde la raíz, después de `pnpm build`):
//   $env:WORKSPACE_APP_CLIENT_ID="Iv23..."; $env:WORKSPACE_APP_KEY_PATH="C:\Users\PC\.plataforma\workspace.pem"
//   node packages/github/scripts/t8-token-workspace.mjs modulo-tareas-piloto
// Nunca imprime el token. Deja el repo como estaba (cierra el PR y borra la rama de prueba).
import { readFileSync } from 'node:fs';
import { crearEmisorTokensRepo } from '../dist/index.js';

const ORG = process.env.PLATAFORMA_ORG ?? 'plataforma-mvp-jmg';
const REPO = process.argv[2] ?? 'modulo-tareas-piloto';
const API = 'https://api.github.com';
const clientId = process.env.WORKSPACE_APP_CLIENT_ID;
const rutaClave = process.env.WORKSPACE_APP_KEY_PATH;
if (!clientId || !rutaClave) throw new Error('Faltan WORKSPACE_APP_CLIENT_ID o WORKSPACE_APP_KEY_PATH');

const emitir = crearEmisorTokensRepo({
  clientId,
  clavePrivada: readFileSync(rutaClave, 'utf8'),
  org: ORG,
  permisos: { contents: 'write', pull_requests: 'write' },
});

let fallas = 0;
const comprobar = (nombre, ok, detalle) => {
  process.stdout.write(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? ` (${detalle})` : ''}\n`);
  if (!ok) fallas++;
};

const { token, vence } = await emitir(REPO);
comprobar('token emitido y acotado a un repo', true, `${REPO}, vence ${vence.toISOString()}`);

const gh = async (metodo, ruta, cuerpo) => {
  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(cuerpo ? { 'content-type': 'application/json' } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  const texto = await res.text();
  let json = {};
  try { json = texto ? JSON.parse(texto) : {}; } catch { /* respuesta no JSON */ }
  return { status: res.status, json };
};
const b64 = (s) => Buffer.from(s).toString('base64');

// 1. No alcanza otros repos.
for (const otro of ['plataforma', 'plantilla-modulo']) {
  const r = await gh('GET', `/repos/${ORG}/${otro}`);
  comprobar(`sin acceso a ${otro}`, r.status === 404, `HTTP ${r.status}`);
}

// 2. Rama de prueba desde main.
const rama = `t8/prueba-${Date.now()}`;
const main = await gh('GET', `/repos/${ORG}/${REPO}/git/ref/heads/main`);
const crearRama = await gh('POST', `/repos/${ORG}/${REPO}/git/refs`, { ref: `refs/heads/${rama}`, sha: main.json.object?.sha });
comprobar('crea una rama', crearRama.status === 201, `HTTP ${crearRama.status}`);

let pr;
try {
  // 3. No puede tocar workflows (la App no tiene el permiso workflows).
  const wf = await gh('PUT', `/repos/${ORG}/${REPO}/contents/.github/workflows/t8.yml`, { message: 't8: workflow (debe fallar)', content: b64('on: push\n'), branch: rama });
  comprobar('rechaza escribir en .github/workflows', wf.status >= 400, `HTTP ${wf.status}`);

  // 4. Puede commitear código en su rama.
  const doc = await gh('PUT', `/repos/${ORG}/${REPO}/contents/docs/t8.md`, { message: 't8: archivo de prueba', content: b64('# T8\n'), branch: rama });
  comprobar('commitea en su rama', doc.status === 201, `HTTP ${doc.status}`);

  // 5. No puede escribir directo en main (ruleset).
  const directo = await gh('PUT', `/repos/${ORG}/${REPO}/contents/docs/t8-main.md`, { message: 't8: directo a main (debe fallar)', content: b64('x\n'), branch: 'main' });
  comprobar('rechaza escribir directo en main', directo.status >= 400, `HTTP ${directo.status}`);

  // 6. Abre un PR.
  const nuevo = await gh('POST', `/repos/${ORG}/${REPO}/pulls`, { title: 'T8: prueba de token de workspace (se cierra sola)', head: rama, base: 'main', body: 'Prueba automática T8 (ADR 0020). No revisar: se cierra y se borra la rama.' });
  comprobar('abre un PR', nuevo.status === 201, `HTTP ${nuevo.status}`);
  pr = nuevo.json.number;

  // 7. No puede mergear (falta aprobación independiente y checks).
  if (pr) {
    const merge = await gh('PUT', `/repos/${ORG}/${REPO}/pulls/${pr}/merge`, { merge_method: 'squash' });
    comprobar('no puede mergear', merge.status >= 400, `HTTP ${merge.status}`);
  }
} finally {
  // Limpieza.
  if (pr) await gh('PATCH', `/repos/${ORG}/${REPO}/pulls/${pr}`, { state: 'closed' });
  const borrar = await gh('DELETE', `/repos/${ORG}/${REPO}/git/refs/heads/${rama}`);
  comprobar('limpieza: PR cerrado y rama borrada', borrar.status === 204, `HTTP ${borrar.status}`);
}

process.stdout.write(fallas === 0 ? '\nT8: todo como se esperaba.\n' : `\nT8: ${fallas} comprobación(es) fallaron.\n`);
process.exit(fallas === 0 ? 0 : 1);
