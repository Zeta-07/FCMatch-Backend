# Decisiones técnicas — Fase 0

## DT-013 — Etapa 4 autorizada: sesiones y contraseña sin perfiles/UI

El propietario aprueba Etapa 3 y autoriza Etapa 4, con commits/push tras checks y actualización de PR #5; no fusiones, force push o Etapa 5. JWT HS256/jose 6.2.17, issuer API origin, audiencias/contextos separados y clave aleatoria independiente obligatoria; access ≤15 min y vencimiento absoluto. Refresh 32 bytes, hash e historial sobre tablas aplicadas, vida absoluta 30 días, rotación estricta sin gracia. CSRF se liga a raíz en payload firmado, login renueva contexto y bootstrap/refresh no invalidan innecesariamente pestañas. Autorización consulta BD, no solo JWT. Orden usuario→raíz→generación y replay revocado durablemente antes del 401; login/cambio revalidan hash bajo lock tras Argon. Login/clave actual comparten bloqueo de identidad; Argon comparte semáforo máximo dos. Recuperación 30 min con política SMTP genérica existente; reset/cambio revocan todas las sesiones y tokens sensibles pendientes, sin login automático. No tablas/migraciones nuevas. Pérdida de microsegundos al reinsertar expires_at corregida con INSERT SELECT en PostgreSQL, sin truncar BD o relajar integridad. Evidencia/límites: `docs/fase-1-etapa-4-verificacion.md`. Modelos no cambian de forma; clientes sin auth/interfaz nueva, Web Locks pendiente de su etapa.

## DT-012 — Registro y verificación ejecutables, sin login

Etapa 3 implementa únicamente registro, verificación y reenvío, más bootstrap/protección CSRF exigidos por el contrato existente. Argon2 0.45.2 precompilado, instalado sin scripts: Argon2id 64 MiB/t3/p1/salida32, calibración Windows hash+verificación 281–303 ms, máximo dos hashes en paralelo sin cola. Límites persistentes y HMAC de IP/identidad usan las tablas aplicadas, sin nueva migración; usuario se bloquea antes de consumir/invalidar tokens hermanos. SMTP fuera de transacción, presupuesto de espera 5 s, aceptación genérica y piso HTTP de 6 s para reducir enumeración por latencia; un timeout conserva token. No hay garantía de tiempo constante bajo sobrecarga. Cookies CSRF independientes host-only y firmadas de 1 h no son sesiones; secretos independientes obligatorios, solo configuración local/CI, sin defaults. Configuración de producción falla si HTTP o hostnames distintos (criterio conservador de compatibilidad SameSite). El mensaje apunta a una ruta web futura con token en fragmento, sin crear UI ni acción GET. Las 15 operaciones restantes siguen planned. AWS se actualizó al parche estable 3.1167.0 en commit separado con check completo; Angular 22.2.4/TS 6.0.3 conservan excepciones existentes. Detalle y límites en `docs/fase-1-etapa-3-verificacion.md`. Publicación de Etapa 3 expresamente autorizada si checks satisfactorios; no integración ni Etapa 4.

## DT-011 — Publicación incremental autorizada, sin integración

El propietario aprueba Etapa 2 y autoriza publicar los cambios aprobados de Etapas 1 y 2 en `feature/fase-1-identidad` antes de implementar Etapa 3. Autoriza además commits y push al terminar cada etapa aprobada si sus verificaciones son satisfactorias; para Etapa 3 autoriza expresamente esa publicación al finalizar registro/verificación. Esta autorización sustituye la prohibición temporal de publicar de las entregas anteriores, no autoriza secretos, force push, fusiones o avanzar a Etapa 4. Mantenimiento separado en commits propios, PR hacia develop abierto para revisión. Referencias: DT-011 de Frontend, DT-010 de AdminWeb.

## DT-010 — Etapa 1 aprobada y persistencia exclusiva de Etapa 2

El 11/11/2026 el propietario aprueba los resultados de Etapa 1 y la excepción temporal Angular 22.2.4; queda resuelta la solicitud de aprobación que DT-009 conserva como antecedente. No se fuerza 22.2.5 ni se relajan peers. Se conservan contrato, políticas y pruebas. Se autoriza exclusivamente crear `users`, `sessions`, `action_tokens` y `login_attempts`, con una migración nueva, restricciones, índices y pruebas PostgreSQL reales; no endpoints, servicios de autenticación, UI, R2 ni nuevas funciones. La migración aplicada de infraestructura no se modifica. La familia de refresh se representa por una raíz y generaciones relacionadas en `sessions`, sin quinta tabla ni sobrescribir hashes consumidos. Hashes de tokens/claves se almacenan como bytea de 32 bytes; verificar su cálculo pertenece al servicio futuro. Los triggers solo refuerzan integridad, inmutabilidad y timestamps. No sustituyen validación de credenciales ni implementan el flujo de autenticación. Referencias de la excepción: DT-010 de Frontend, DT-009 de AdminWeb. Detalle y evidencia de persistencia en `docs/fase-1-etapa-2-verificacion.md`. Etapa 3 requiere revisión previa; siguen prohibidos commits, push y fusiones.

## DT-008 — Fase 1, Etapa 1: contrato sin negocio ejecutable

El propietario aprueba implementación local por etapas de RF-01 a RF-06, sin commits, push ni fusiones y con revisión entre etapas. SMTP local es la aceptación de desarrollo; entrega externa y validación Android/iOS/almacenamiento seguro quedan pendientes (nativo en Fase 11). Avatares usarán R2 de desarrollo real, todavía pendiente de configuración. `docs/fase-1-identidad.md` fija trazabilidad, DTO, políticas SMTP y rotación estricta sin gracia, coordinación entre pestañas, CSRF por contexto y separación de cookies Web Cliente/móvil navegador. El OpenAPI es objetivo: solo health está implementado; no hay tablas ni endpoints de identidad ejecutables en Etapa 1. Los tipos se distribuyen a los tres clientes sin importar fuentes entre repositorios. Referencias: DT-009 de Frontend y DT-008 de AdminWeb.

## DT-009 — Mantenimiento compatible previo a Fase 1

Registro npm consultado el 11/11/2026: npm 12.2.2, Ionic 9.0.11, Playwright 1.65.0, Prettier 3.10.0 y typescript-eslint 8.72.2, junto con parches compatibles de Backend, fijados mediante lockfiles. TypeScript conserva 6.0.3 por peers `<6.1`. Angular 22.2.5 está publicado, pero la actualización dirigida mantuvo 22.2.4 y la instalación explícita/alineada falló con `ERESOLVE`. La actualización global de transitivas también falló por `@babel/parser@^8.1.2` no disponible. Se conserva Angular 22.2.4 existente, sin downgrade, force, legacy-peer-deps u override. La excepción temporal **aún requiere aprobación**, no se considera mantenimiento cerrado. Scripts de instalación no revisados siguen bloqueados. El mantenimiento será un grupo separado del contrato para un futuro commit autorizado; no se realiza ningún commit ahora. Detalle en `docs/fase-1-identidad.md`.

## DT-007 — Catálogo portable de skills OpenCode

El propietario aprueba publicar las seis skills existentes y revisadas antes de autorizar Fase 1. Backend aloja una única copia en `.opencode/skills/`, con catálogo HTTP, fuentes fijadas, licencias y SHA256. Frontend y AdminWeb consumen los mismos archivos desde GitHub con SHA completo en su configuración OpenCode, sin rutas personales, archivos duplicados ni imports de código de aplicación entre repositorios. El catálogo es una herramienta de desarrollo y no se sirve desde la API. `skills:check` valida integridad y catálogo en CI; los originales quedan excluidos del formateo y de conversión de saltos de línea. No se añaden plugins, MCP, permisos ni dependencias. Guía y límites en `docs/skills-opencode.md` y `docs/skills-policy.md`; referencias cruzadas: DT-008 de Frontend y DT-007 de AdminWeb. Las tres skills locales de Stitch se preservan sin republicarlas. Fase 1 no iniciada.

## DT-001 — Angular + Ionic en los tres clientes

Decisión expresa del propietario: Web Cliente, móvil y AdminWeb usan Angular + Ionic; Capacitor únicamente en móvil. Se actualizaron solo las referencias técnicas de AGENTS, DERCAS y plan. Los requisitos funcionales y reglas de negocio se conservan. La misma decisión consta en los documentos de decisiones de `FCMatch-Frontend` y `FCMatch-AdminWeb`.

## DT-002 — Base ejecutable sin negocio anticipado

La única ruta es `/api/v1/health`. Las tablas de usuarios y torneos, JWT, guards de autenticación y tareas de negocio se incorporarán en las fases autorizadas. La migración inicial prepara únicamente el esquema `fcmatch` y el registro versionado del migrador.

## DT-003 — Versiones estables compatibles

Node 26.13.0 LTS, npm 12.2.1, Express 5 y PostgreSQL 18.6, comprobados en fuentes oficiales. TypeScript 7.0.2 es la última estable publicada, pero Angular compiler-cli 22 exige `>=6.0 <6.1` y typescript-eslint exige `<6.1`. Se fija la última estable compatible, TypeScript 6.0.3, en los cuatro paquetes. No se fuerza la resolución ni se oculta esta incompatibilidad.

`openapi-typescript` 7.13.0 exige TypeScript 5; se elige `@hey-api/openapi-ts` 0.99.0 compatible. Se validó generación y compilación.

## DT-004 — Dependencias transitivas

La auditoría inicial de las últimas versiones detectó avisos en minimatch, glob y js-yaml. Se fijan overrides a minimatch 11.0.4, glob 14.0.3 y js-yaml 5.5.0, todos estables corregidos. Tipos, generador, lint, migraciones y pruebas verifican la combinación; `npm audit` queda sin vulnerabilidades. Los lockfiles fijan la resolución.

## DT-005 — Infraestructura local y servicios externos

El usuario autorizó PostgreSQL local y correo exclusivamente local, dejando R2 pendiente de credenciales. Bases `fcmatch` y `fcmatch_test` separadas, rol de aplicación sin privilegios de superusuario, contraseñas aleatorias excluidas de Git, UTC y escucha en loopback. El adaptador R2 no simula conectividad si falta configuración.

## DT-006 — Calidad y separación de repositorios

Pruebas HTTP con Node Test Runner y Supertest, integración con PostgreSQL real y recepción SMTP técnica. CI propio con PostgreSQL efímero. Los clientes reciben los tipos generados por copia controlada; ningún cliente importa archivos fuente de este repositorio por rutas relativas. API y UI siguen siendo productos independientes.
