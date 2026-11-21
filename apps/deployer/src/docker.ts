// Docker por CLI. Los contenedores corren sin privilegios: sistema de archivos de solo lectura, sin
// capacidades, sin escalada, memoria y procesos limitados, y el puerto publicado solo en 127.0.0.1.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Contenedor, Docker, Entorno } from './tipos.js';

const exec = promisify(execFile);
/** Las variables se pasan como `-e NOMBRE` y el valor viaja en el entorno del proceso: no queda en los argumentos. */
const docker = async (args: string[], env: Record<string, string> = {}, timeout = 0) =>
  (await exec('docker', args, { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, ...env }, timeout })).stdout.trim();
const SEGURIDAD = ['--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--pids-limit', '128'];

export function crearDocker(): Docker {
  return {
    async descargar(imagen) {
      await docker(['pull', '--quiet', imagen]);
    },
    async listar(entorno: Entorno) {
      const formato = '{{.Names}}|{{.Label "plataforma.modulo"}}|{{.Label "plataforma.digest"}}|{{.Label "plataforma.puerto"}}';
      const salida = await docker(['ps', '-a', '--filter', 'label=plataforma.administrado=si', '--filter', `label=plataforma.entorno=${entorno}`, '--format', formato]);
      return salida
        .split('\n')
        .filter(Boolean)
        .map((l): Contenedor => {
          const [nombre = '', modulo = '', digest = '', puerto = '0'] = l.split('|');
          return { nombre, modulo, entorno, digest, puerto: Number(puerto) };
        });
    },
    async ejecutar(o) {
      const args = ['run', '-d', '--name', o.nombre, '--restart', 'unless-stopped'];
      args.push(...SEGURIDAD, '-p', `127.0.0.1:${o.puerto}:3000`);
      args.push('--add-host', 'host.docker.internal:host-gateway');
      args.push('--label', 'plataforma.administrado=si');
      for (const [k, v] of Object.entries(o.etiquetas)) args.push('--label', `${k}=${v}`);
      for (const k of Object.keys(o.env)) args.push('-e', k);
      args.push(o.imagen);
      await docker(args, o.env);
    },
    async eliminar(nombre) {
      await docker(['rm', '-f', nombre]);
    },
    async migrar(o) {
      const args = ['run', '--rm', '--name', o.nombre, ...SEGURIDAD];
      for (const k of Object.keys(o.env)) args.push('-e', k);
      args.push(o.imagen, 'node', 'dist/migrar.js');
      try {
        const salida = await docker(args, o.env, 180_000);
        return { ok: true, salida };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        return { ok: false, salida: `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message };
      }
    },
    async logs(nombre) {
      const { stdout, stderr } = await exec('docker', ['logs', '--tail', '40', nombre]).catch(() => ({ stdout: '', stderr: '' }));
      return `${stdout}${stderr}`;
    },
  };
}
