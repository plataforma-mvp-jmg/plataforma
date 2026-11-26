# ADR 0004 — Roles con ProveedorRoles y YAML local (incremento I1-3)

- **Estado:** Aceptada
- **Fecha:** 2026-11-14

## Contexto

El JWT necesita roles y empresas (ADR-029). En la versión corporativa vienen de los grupos `plat-*`
de Google Workspace (ADR-081); en el MVP no hay Workspace.

## Decisión

- Interfaz `ProveedorRoles.obtenerRoles(usuario)` → `{ plataforma, modulos, empresas }` (P2).
- MVP: `ProveedorRolesYaml` lee `infra/local/roles.local.yaml` (fuera del repo, P7), indexado por
  email verificado, sin distinguir mayúsculas.
- Validación estricta con Zod: roles de plataforma cerrados, claves desconocidas rechazadas (evita
  typos que dejen a alguien sin control), emails únicos, ids de módulo válidos.
- Archivo inválido al arrancar: la API no inicia. Inválido al recargar: se conserva la última
  versión válida y se registra el error. Archivo inexistente: nadie tiene roles (con aviso).
- El token lleva **solo** los roles del módulo de su `aud` (o los de plataforma si `aud=plataforma`)
  y las empresas del usuario. Usuario no listado: entra sin roles.

## Consecuencias

- ~~La expansión de jerarquías (`operador` incluye `lector`) se resuelve con los manifiestos en I1-5.~~
  Reemplazado por la ADR 0016: los roles son explícitos, sin jerarquía.
- En la Fase 1.5 se agrega `ProveedorRolesWorkspace` (Directory API) sin cambiar rutas ni módulos.
