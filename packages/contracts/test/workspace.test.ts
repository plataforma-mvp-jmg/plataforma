import { describe, expect, it } from 'vitest';
import { repoParaWorkspace, type ModuloResumen } from '../src/index.js';

const modulos: ModuloResumen[] = [
  { id: 'notas-piloto', repo: 'modulo-notas-piloto', estado: 'produccion', riesgo: 'medio' },
  { id: 'modulo-ejemplo', repo: 'plataforma', estado: 'produccion', riesgo: 'bajo' },
  { id: 'viejo', repo: 'modulo-viejo', estado: 'retirado', riesgo: 'bajo' },
  { id: 'en-baja', repo: 'modulo-en-baja', estado: 'deprecado', riesgo: 'bajo' },
  { id: 'raro', repo: 'modulo-otro', estado: 'en_desarrollo', riesgo: 'bajo' },
];

describe('repo para un workspace', () => {
  it('admite el repo propio de un módulo vigente', () => {
    expect(repoParaWorkspace(modulos, 'notas-piloto')).toEqual({ ok: true, repo: 'modulo-notas-piloto' });
  });

  it('rechaza módulos inexistentes, de plataforma, retirados o deprecados y repos que no son modulo-<id>', () => {
    expect(repoParaWorkspace(modulos, 'no-existe')).toMatchObject({ ok: false, motivo: expect.stringContaining('no está') });
    expect(repoParaWorkspace(modulos, 'modulo-ejemplo')).toMatchObject({ ok: false, motivo: expect.stringContaining('plataforma') });
    expect(repoParaWorkspace(modulos, 'viejo')).toMatchObject({ ok: false, motivo: 'el módulo está retirado' });
    expect(repoParaWorkspace(modulos, 'en-baja')).toMatchObject({ ok: false, motivo: 'el módulo está deprecado' });
    expect(repoParaWorkspace(modulos, 'raro')).toMatchObject({ ok: false, motivo: expect.stringContaining('modulo-raro') });
  });
});
