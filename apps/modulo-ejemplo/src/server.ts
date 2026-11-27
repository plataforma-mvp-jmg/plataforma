import { crearVerificador, audienciaModulo } from '@plataforma/auth';
import { construirModulo } from './app.js';

// Valores por defecto para desarrollo local (P1: todo se puede cambiar por variables de entorno).
const id = process.env.MODULO_ID ?? 'modulo-ejemplo';
const verificar = crearVerificador({
  jwksUrl: process.env.PLATFORM_JWKS_URL ?? 'http://127.0.0.1:8088/.well-known/jwks.json',
  issuer: process.env.PLATFORM_ISSUER ?? 'http://localhost:8088',
  audiencia: audienciaModulo(id),
});
const app = construirModulo({ id, verificar, logger: true });
await app.listen({ port: Number(process.env.PORT ?? 3101), host: process.env.HOST ?? '127.0.0.1' });
