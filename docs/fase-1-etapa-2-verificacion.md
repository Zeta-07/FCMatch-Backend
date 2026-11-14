# Fase 1 — Etapa 2: persistencia de identidad

## Alcance y estado

Actualización posterior: el propietario aprobó estos resultados y autoriza commits/push de Etapas 1 y 2, sin fusiones. La prohibición de publicación y la espera de Etapa 3 descritas en el informe original son históricas; DT-011 registra la autorización nueva para registro/verificación exclusivamente. Las evidencias y migraciones aplicadas se conservan.

El propietario aprobó Etapa 1, la excepción temporal Angular 22.2.4 y esta entrega exclusivamente de persistencia el 11/11/2026. No se fuerza Angular 22.2.5, no se cambian dependencias incompatibles ni se instala una biblioteca nueva para estas tablas. Los resultados de Etapa 1 se mantienen en su informe; la aprobación está registrada en DT-010 y Engram.

Migración nueva: `migrations/1794355200000_identity.sql`. La migración de infraestructura `1793836800000_infrastructure.sql` se conserva sin cambios. Esta entrega no implementa controladores, repositorios de negocio, servicios de autenticación, credenciales/JWT, jobs, interfaces, funciones administrativas, eliminación de cuenta o almacenamiento R2. Solo `/api/v1/health` está implementado y las 19 operaciones objetivo de identidad siguen `planned`.

Cambios locales en la rama existente `feature/fase-1-identidad`, preservando el trabajo aprobado sin commit de Etapa 1. No commits, push ni fusiones autorizados. **Implementación y verificaciones locales completadas; detenerse para revisión antes de Etapa 3.**

## Modelo de almacenamiento

Todas las tablas usan PK UUID generada por PostgreSQL, `created_at`/`updated_at` timestamptz y nombres calificados bajo `fcmatch`. No se instalan extensiones, no se conceden privilegios nuevos ni se añaden RLS/Supabase. Las fechas se expresan en UTC desde el pool existente; timestamptz conserva instantes independientemente de la zona del cliente.

### users

- `id` interno y `public_id` único, autogenerado y estable. Ambos y `created_at` son inmutables.
- `username` conserva presentación, admite el contrato ASCII de 3–30 caracteres y tiene índice único sobre `lower(username)` con collation C. Ese índice permite búsqueda por prefijo y contiene `public_id`; no se necesita un segundo índice redundante de búsqueda ni una extensión.
- `email` normalizado sin espacios exteriores, en minúsculas y único; comprobar formato completo/normalización antes de escribir corresponde al DTO/servicio futuro. El check SQL solo es una defensa estructural adicional, no implementa verificación por correo.
- `password_hash` admite forma PHC Argon2id v19 con tamaño acotado. No se almacena contraseña plana; validar criptografía y parámetros reales pertenece a Etapa 3. El PHC sintético de pruebas solo acredita forma de almacenamiento, no un login utilizable.
- `league_name` opcional respeta el máximo de 100 caracteres del contrato; `avatar_key` opcional solo admite el espacio `avatars/`, nombre aleatorio y extensiones de imagen previstas. No URLs arbitrarias, rutas ascendentes o claves de evidencias. Una clave no se comparte entre dos usuarios.
- `email_verified_at` opcional no puede ser infinito ni anterior a creación. No se implementa su establecimiento por verificación todavía. No se añade `deletion_requested_at`: RF-07 sigue en Fase 9.

### sessions

- Una fila por generación de refresh, no una fila mutable que pierda el hash anterior. `refresh_token_hash` es bytea de 32 bytes único; el servicio futuro calculará SHA256 del secreto aleatorio antes de persistirlo.
- La fila raíz tiene `id = family_id` y `parent_id IS NULL`. El identificador estable de la familia/raíz servirá para vincular el JWT futuro; `consumed_at` de esa raíz describe su refresh, no el cierre de toda la sesión.
- Cada sucesor referencia una raíz existente y su padre de la misma familia, propietario, contexto, origen, dispositivo y vencimiento. El padre debe estar consumido y no revocado. `parent_id` único impide bifurcar la cadena; índice único parcial permite a lo sumo una generación no consumida/no revocada por familia.
- Vencimiento finito, posterior a creación, máximo 720 horas desde la creación de raíz. Cada sucesor hereda exactamente el vencimiento absoluto; no se extiende al renovar. Metadatos, hash y vencimiento son inmutables; consumo y revocación no pueden borrarse o reescribirse una vez asentados.
- Contextos actuales `web` y `mobile_browser`. Orígenes canónicos HTTPS o HTTP loopback de desarrollo, máximo 255 caracteres. La lista exacta de orígenes permitidos y autorización siguen siendo responsabilidad del servicio futuro, no de un regex SQL.
- No crear nuevas generaciones de raíz revocada. El trigger de integridad de inserción bloquea raíz y luego padre; los servicios futuros deberán respetar ese orden y realizar consumo/creación/revocación dentro de transacciones cortas. La revocación de familia y validación de JWT aún no están implementadas.
- Los hashes consumidos permanecen en filas históricas para futura detección de replay. Las FK no borran en cascada; eliminar raíz con descendientes no es una limpieza válida. La limpieza futura debe respetar orden y retención hasta expiración; no hay job de limpieza en esta etapa.

### action_tokens

- Usuario obligatorio con FK; finalidad limitada a `verify_email`, `reset_password` y `email_change`. No incluye eliminación de cuenta ni otra fase.
- Hash único de 32 bytes, nunca columna de secreto bruto. `new_email` obligatorio y normalizado solo para cambio de correo; nulo en las demás finalidades. No se impone unicidad de ese destino: la disponibilidad definitiva se comprobará al confirmar contra `users`.
- TTL máximo de 24 h para verificación y 30 min para recuperación/cambio de correo, según Etapa 1 aprobada. Se comprueba relación entre fechas, no `now()` en un CHECK: filas históricas vencidas siguen siendo válidas para conservación/limpieza.
- `used_at` indica consumo real antes del vencimiento; `revoked_at` permite invalidación de hermanos u operaciones anteriores sin falsificar un consumo. Ambas marcas son irreversibles; identidad, hash, finalidad, destino y vencimiento no cambian.
- Las pruebas de UPDATE condicional concurrente muestran una sola fila consumible. No sustituyen al servicio de verificación/recuperación, ni prueban todavía entrega SMTP de esos flujos.

### login_attempts

- Contadores agregados por `scope` y `key_hash` únicos; scopes actuales `login_identity`, `login_ip`, `email_identity`, `email_ip`. Sirven también para identidades inexistentes, sin FK que confirme que existe una cuenta.
- La clave futura será HMAC-SHA256 de identidad/IP normalizada, no email/IP en claro ni un identificador público. No se guarda aquí la clave HMAC o contraseña.
- Intentos enteros no negativos, ventana/expiración finitas y bloqueo opcional acotado por expiración. No se fija un bloqueo permanente ni se implementa el algoritmo de límite/bloqueo en esta entrega.
- UPSERT sobre la clave única permite incremento atómico sin perder intentos. La identidad del bucket es inmutable; sus contadores y ventana se actualizarán desde el servicio futuro.

## Restricciones, índices y responsabilidad de servicios

La función técnica `identity_guard_update` mantiene timestamps e inmutabilidad. `identity_guard_session_insert` refuerza referencias y consistencia de familia sin emitir/validar secretos, gestionar HTTP ni autenticar a nadie. Ambas usan search_path restringido, referencias calificadas y permisos del invocador, sin SECURITY DEFINER.

Índices de FK y acceso: sesiones por usuario/expiración y familia/creación, padre único; tokens por usuario/finalidad/creación y pendientes; hashes únicos; índices de expiración en sesiones, tokens y contadores. No se usan predicados parciales dependientes del reloj. No se duplican PK/unique con índices equivalentes adicionales.

Las restricciones no demuestran que un valor de 32 bytes sea criptográficamente un hash ni que un PHC verifique una contraseña; el servicio futuro lo garantizará. Tampoco autorizan operaciones por usuario o implementan toda la protección de reutilización. Concurrencia, errores HTTP y transacciones del servicio seguirán requiriendo pruebas en sus respectivas etapas.

## Estrategia de pruebas reales

- Guardia de entorno: `TEST_DATABASE_URL` configurada, nombre terminado en `_test` y distinto de desarrollo. Fixtures por UUID, sin usuarios o claves reales.
- `node-pg-migrate` aplica con orden comprobado y transacción única. Los dos archivos de integración esperan el mismo advisory lock para no competir al migrar en paralelo.
- Pruebas de restricciones dentro de transacciones revertidas; savepoints para rechazos esperados sin dejar transacciones abortadas.
- Up/Down/Up ejecutado sobre un esquema aleatorio propio dentro de una transacción revertida, calificando los objetos de la misma migración. No ejecutar Down sobre desarrollo ni borrar un esquema compartido.
- Fixtures de concurrencia confirmados únicamente en base de pruebas, limpiados por UUID/hash de la propia ejecución; sin TRUNCATE ni eliminación global.
- Pruebas paralelas con conexiones PostgreSQL independientes: username único sin mayúsculas, un sucesor de refresh, consumo condicional de token y UPSERT de contador sin incremento perdido.
- Comprobar FK, forma de hashes, campos/timestamps inmutables, rechazo de reactivación, metadatos de índices, repetición de migración, UTC y regresiones de health/contrato/SMTP.

## Resultados

| Comprobación             | Resultado                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Backend `npm run check`  | Tipos, lint, formato, OpenAPI, 15 pruebas unitarias/configuración/contrato, 18 integraciones y build satisfactorios                    |
| Persistencia nueva       | 16 pruebas PostgreSQL reales, incluidas cuatro de concurrencia, satisfactorias                                                         |
| Infraestructura anterior | Integraciones de PostgreSQL/UTC/health y SMTP local satisfactorias                                                                     |
| Migración de desarrollo  | Aplicada una vez; segundo `db:migrate` informa que no hay migraciones pendientes                                                       |
| Base de pruebas          | Nueva migración aplicada por el runner; repetición sin cambios; Up/Down/Up aislado satisfactorio                                       |
| Limpieza de fixtures     | Las cuatro tablas tienen cero filas tanto en desarrollo como en pruebas al verificar la entrega                                        |
| Clientes                 | Checks completos de Web Cliente, móvil navegador y AdminWeb satisfactorios; nueve pruebas Playwright con health interceptado explícito |
| Auditorías               | Cero vulnerabilidades detectadas en los cuatro paquetes, sin instalar dependencias en esta etapa                                       |
| Contrato y diseño        | Modelos conservan el hash aprobado de Etapa 1; verificador de distribución de diseño pasa en los tres clientes                         |
| Git                      | Sin commits, cambios staged, push ni fusiones; cambios locales conservados en las ramas existentes                                     |
| GitHub Actions           | No ejecutado para estos cambios locales, por falta de autorización de publicación                                                      |

La migración anterior conserva SHA256 `ff74720007eeb84d7d7395d3821dcbc325c51733ea6656d1b72415d0f3a92108`. La nueva, ya aplicada, tiene SHA256 `b35b704398075165cfa68fe2cbc2b241988c21fc7e049bd4e5828acf78427276`; cualquier corrección posterior de DDL requiere otra migración, no reescribirla. Los tipos compartidos mantienen `9f37985e45e7c3f7ca7aa4dbdeebaeea92ca8e1de65e004b84a5687aa73839fb`. No se alteraron configuración, pool, SMTP/R2, servidores, rutas ni código de aplicación ejecutable.

Se inició solo la instancia PostgreSQL existente para las comprobaciones, sin recrear bases/roles o credenciales. Al terminar se detiene para restaurar el estado inicial; los datos y las tablas permanecen. Los procesos efímeros de SMTP y clientes pertenecen a las pruebas y se cierran al finalizar. El aviso Angular NG0913 de tamaño de los PNG originales sigue siendo conocido y no bloqueante; no se modifican logos para ocultarlo.

No se identifican nuevas decisiones de negocio bloqueantes para esta persistencia. La excepción temporal de Angular y los resultados de Etapa 1 están aprobados y registrados en Engram. R2 real, correo de seguridad ejecutable, JWT/Argon2id reales, pruebas de fallos SMTP del flujo y validación nativa siguen en sus etapas previstas. Ningún resultado de esta etapa los acredita. **Esperar revisión del propietario antes de comenzar Etapa 3.**
