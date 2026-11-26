# ADR 0016 — Roles explícitos, sin jerarquía

- Estado: aceptado (26/11/2026) · Incremento I5
- Reemplaza la consecuencia "expansión de jerarquías" de la ADR 0004.

## Contexto

La ADR 0004 dejó previsto que un rol incluyera a otros (`operador` incluye `lector`), resuelto con los
manifiestos. Nunca se implementó: `tieneRol` de `@plataforma/auth` compara exacto, y la plantilla ya
documentaba que los roles no se heredan. En I4-2b se vio el efecto real: con solo `operador`,
`GET /api/v1/yo` respondía 403 (*Requiere el rol lector*). Había que decidir antes de los módulos reales.

Opciones:

1. **Jerárquicos:** cada módulo declara un orden en `modulo.yaml` y un rol incluye a los inferiores.
   Es más cómodo de administrar, pero el acceso efectivo queda implícito: para saber qué puede hacer
   alguien hay que leer la jerarquía de cada módulo, y un cambio en el manifiesto amplía accesos sin
   tocar la asignación de roles.
2. **Explícitos:** cada permiso se asigna por separado. Da más trabajo de administración (una persona
   suele tener dos o tres roles por módulo), pero la matriz de accesos es literal.

## Decisión

**Roles explícitos.** Decisión del responsable del área.

- `tieneRol` sigue comparando exacto; no se agrega jerarquía ni en `@plataforma/auth` ni en los manifiestos.
- Cada endpoint declara el **rol requerido**, no un "rol mínimo": la expresión sugería una jerarquía que no existe.
- La asignación de roles (hoy `roles.local.yaml`; en la Fase 1.5 el proveedor corporativo) lista todos los
  roles de cada persona en cada módulo.

## Consecuencias

- **Auditoría (SOX):** el acceso efectivo de una persona es exactamente la lista de roles asignados. Un cambio
  en el código o en el manifiesto de un módulo no amplía accesos: solo un cambio en la asignación lo hace, y
  esa asignación la administra Sistemas.
- **Administración:** más entradas por persona. Se mitiga con roles pensados por tarea y no por nivel, y
  con perfiles de asignación en el proveedor corporativo (por ejemplo, grupos de Workspace) cuando llegue.
- La plantilla usa "rol requerido" en `AGENTS.md` y en la matriz de permisos (plantilla 0.7.6).
- **No se agregó una validación nueva.** La plataforma no conoce hoy los roles que declara cada módulo
  (están en su `modulo.yaml`, no en el registry), así que no puede rechazar una asignación a un rol
  inexistente. Si se necesita, el camino es publicar los roles del manifiesto en el registry; se evalúa
  con el proveedor corporativo de roles.
