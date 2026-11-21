import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // cli.ts arma las dependencias reales; docker.ts, atestacion.ts y postgres.ts hablan con sistemas externos
      // (postgres.ts tiene una prueba de integración con PG_PRUEBA_URL).
      exclude: ['src/cli.ts', 'src/docker.ts', 'src/atestacion.ts', 'src/postgres.ts'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
