# Fase 1 — Etapa 1: informe local

Fecha: 11/11/2026. **Resultados de Etapa 1 aprobados por el propietario, incluida la excepción temporal Angular 22.2.4.** Este informe conserva las incidencias y verificaciones de su entrega inicial; la aprobación posterior resuelve el pendiente de mantenimiento y autoriza solo la persistencia de Etapa 2. No hay commits, push ni PR nuevos.

## Entregado

- OpenAPI 3.1, versión de contrato 0.1.0: 20 operaciones, una implementada (health) y 19 marcadas `planned`. No son endpoints de identidad ejecutables.
- DTO separados de perfil público/propio, campos writeOnly, errores españoles, CSRF, cookies por contexto, subida de avatar y búsqueda paginada.
- Trazabilidad RF-01 a RF-06, límites y políticas de fallo SMTP/rotación documentados en [fase-1-identidad.md](fase-1-identidad.md).
- Modelos generados idénticos en Backend y tres clientes; AdminWeb solo recibe tipos y mantenimiento, sin funciones de Fase 10.
- Seis pruebas nuevas de estructura, privacidad, variantes Writable, seguridad declarada, límites y separación entre contrato y runtime.
- Mantenimiento de dependencias y npm 12.2.2 local/paquetes/workflows. No se habilitan scripts de dependencias, plugins nativos ni servicios nuevos.

## Verificaciones confirmadas

| Comprobación       | Resultado                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Ramas              | `feature/fase-1-identidad` local en tres repositorios, creada desde develop igual a main/origin al inicio      |
| OpenAPI            | Lint satisfactorio                                                                                             |
| Generación         | Dos generaciones con mismo hash; cuatro copias idénticas                                                       |
| Backend            | Tipos, lint, formato, OpenAPI y build satisfactorios                                                           |
| Pruebas Backend    | 15 unitarias/configuración/contrato y dos integraciones PostgreSQL/SMTP satisfactorias                         |
| Skills             | Seis skills y 113 recursos originales íntegros                                                                 |
| Auditorías         | Cero vulnerabilidades en cuatro paquetes, después del mantenimiento                                            |
| Diseño distribuido | `sync-design.mjs --check` satisfactorio en los tres clientes                                                   |
| Temas/logos        | Sin cambios funcionales o binarios; temas idénticos y dos PNG idénticos entre clientes                         |
| Clientes           | Lint, formato, build y tres pruebas Playwright por cliente satisfactorios (nueve recorridos); grafo npm válido |
| GitHub Actions     | No ejecutado para estos cambios: no hay publicación autorizada                                                 |

Hash SHA256 de tipos compartidos: `9f37985e45e7c3f7ca7aa4dbdeebaeea92ca8e1de65e004b84a5687aa73839fb`.

## Incidencias y límites

1. PostgreSQL estaba detenido y la primera integración falló con ECONNREFUSED. Se arrancó exclusivamente la instancia existente, sin recrear roles/bases/.env; la repetición de ambas pruebas fue satisfactoria. Solo se comprobó la migración de infraestructura ya existente, no se crearon tablas de Fase 1.
2. Checkout Windows había reintroducido CRLF en archivos anteriores y fuentes compartidas. Se normalizó con el formateador del proyecto, comprobando igualdad de contenido Git antes de refrescar el índice; no hay cambios staged ni cambios en skills/configuración personal. El verificador de diseño por bytes pasó después de normalizar las fuentes.
3. La actualización global de transitivas de cliente falló con ETARGET de Babel. La actualización dirigida actualizó Ionic 9.0.11, Playwright 1.65.0, Prettier 3.10.0 y typescript-eslint 8.72.2, pero mantuvo Angular 22.2.4. Los intentos explícitos/alineados hacia 22.2.5 fallaron con ERESOLVE; no se usaron force, legacy-peer-deps o nuevos overrides. Los rangos del intento fallido propio se devolvieron a su estado anterior, sin downgrade de instalación. **Esperar decisión del propietario sobre excepción temporal o investigación adicional antes de cerrar mantenimiento.**
4. Playwright actualizado requería un Chromium headless que no estaba instalado. La primera ejecución web falló antes de abrir navegador; no fue una regresión funcional. Se instaló Chromium/headless de Playwright 1.65.0 y los nueve recorridos finales pasaron sin cambiar de framework ni adjuntarse a un perfil personal. Persiste el aviso NG0913 de tamaño intrínseco de logos originales, ya conocido, sin alterar los PNG.
5. Las pruebas cliente usan `FCMATCH_E2E_STUB_API=1`, interceptando explícitamente health. No acreditan autenticación end-to-end, ni R2, ni seguridad nativa. PostgreSQL y SMTP sí son reales en las pruebas de Backend.

La instancia PostgreSQL iniciada para las comprobaciones se detuvo al terminar las integraciones, restaurando su estado inicial. Los servidores efímeros de pruebas se cierran al completar sus recorridos. No se dejó un entorno completo de aplicaciones ejecutándose.

## Pendientes de aprobación y etapas siguientes

- Aprobación recibida del contrato, políticas, resultados y excepción temporal de Angular 22.2.4. Etapa 2 autorizada exclusivamente para persistencia; Etapa 3 continúa pendiente de revisión.
- R2 real para avatares: acciones y variables necesarias en la guía; no se solicitaron ni expusieron credenciales. No se ha creado bucket ni subido contenido.
- SMTP de registro/verificación/recuperación, rotación real y sus pruebas de fallos/concurrencia corresponden a etapas posteriores. Solo se definieron sus políticas.
- Android/iOS y almacenamiento seguro nativo pendientes de Fase 11 por aprobación expresa. Correo externo también pendiente.
- Stitch se utilizará cuando corresponda diseñar interfaces; no se generaron diseños remotos durante esta etapa.
