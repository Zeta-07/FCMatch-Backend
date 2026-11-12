# Fase 1 — Identidad: contrato y criterios de entrega

## Estado y autorización

El propietario aprobó las Etapas 1–4 y autorizó exclusivamente Etapa 5: perfiles, búsqueda, cambio de correo y avatares. Las ocho operaciones restantes se incorporan en esta etapa; su validación completa se registra en `docs/fase-1-etapa-5-verificacion.md`. No hay interfaces de Etapa 6. Un tipo generado o un status del contrato no acredita por sí solo un flujo verificado.

Se permiten cambios y publicación en `feature/fase-1-identidad` únicamente tras verificaciones satisfactorias de Etapa 5, actualizando PR #5 existentes sin fusiones ni force push. Etapa 6 requiere nueva aprobación. Se conservan migraciones aplicadas y excepciones de Angular/TypeScript; incidencias de Etapa 1 son históricas.

Decisiones expresas:

- SMTP local real para desarrollo y pruebas; entrega a buzones externos pendiente.
- El propietario sustituyó R2 de desarrollo por S3 local real, sin tarjeta ni activación Cloudflare. SeaweedFS 4.53 es el servicio elegido. R2 sigue previsto para producción, **integración real pendiente**; no es un bloqueo para esta etapa ni se afirma haberla probado.
- Web Cliente y móvil en navegador como aceptación funcional. Android/iOS y almacenamiento seguro nativo pendientes de Fase 11; no crear plataformas, ejecutar `cap sync` ni afirmar pruebas nativas realizadas.
- AdminWeb no adelanta funciones de Fase 10. Solo recibe mantenimiento compatible y modelos del contrato compartido, sin pantallas, rutas o permisos nuevos.
- Sin eliminación de cuenta (Fase 9), amigos, notificaciones o competición. Estadísticas `null` e historial `[]` son estados vacíos, no cálculos ni datos ficticios.

Fuentes: DERCAS v1.1, secciones 4.1, 7 y 9; `AGENTS.md`; `Contexto/plan para el desarrollo de la app.md`, Fase 1; aprobación posterior del propietario. La fotografía inicial del plan y el informe de Fase 0 son históricos: los repositorios y MCP ya existen y los PR de Fase 0/skills ya fueron fusionados. Los dos logos por tema siguen aprobados y no se modifican.

## Trazabilidad y contrato objetivo

Todos los paths siguientes llevan `/api/v1`. La API única sigue en Backend. Controladores validan DTO; servicios deciden reglas, permisos y transacciones; repositorios ejecutan SQL parametrizado. Ningún cliente decide unicidad, verificación, revocación o propiedad de una foto.

| Requisito        | Operaciones objetivo                                                                                    | Interfaz Web Cliente/móvil navegador     | Evidencia futura                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| RF-01            | `POST /auth/register`, `/auth/login`                                                                    | Registro, acceso                         | Persistencia real, errores genéricos, correo verificado                                 |
| RF-02            | `POST /auth/verify-email`, `/auth/resend-verification`, `/auth/forgot-password`, `/auth/reset-password` | Verificación, reenvío, recuperación      | SMTP local recibido, token válido una vez, expiración y concurrencia                    |
| RF-03            | `GET/PATCH /users/me`, `PUT/DELETE /users/me/avatar`                                                    | Perfil y edición                         | Unicidad en BD, no asignación masiva, S3 local real y rechazo de archivos inválidos     |
| RF-04            | `GET /users?search=`, `GET /users/{publicId}`                                                           | Búsqueda, perfil público                 | Paginación, sin correo ni datos de sesión                                               |
| RF-05            | `POST /users/me/email-change`, `/users/me/email-change/confirm`                                         | Cambio y confirmación de correo          | Contraseña actual, token del titular, correo anterior hasta confirmar, unicidad atómica |
| RF-06            | `POST /auth/logout`, `/auth/logout-all`                                                                 | Salir aquí o en todos los dispositivos   | Revocación comprobada también con access previamente emitido                            |
| Seguridad / plan | `GET /auth/csrf`, `POST /auth/refresh`, `/auth/change-password`                                         | Sesión, renovación, cambio de contraseña | CSRF, rotación atómica, reutilización, expiración y revocación global                   |

Las rutas de soporte concretan requisitos existentes, no agregan funciones de negocio. No habrá registro público de administrador, selector de rol, listado administrativo ni acceso a cuentas ajenas. La búsqueda requiere sesión verificada; el perfil por `publicId` es público. Las rutas estáticas `/users/me` se registrarán antes del parámetro dinámico.

### DTO y validaciones

- `PublicProfile`: publicId UUID estable, username, liga nullable, avatar nullable con URL temporal, estadísticas e historial vacíos. No email, id interno, rol, hashes, claves de R2 ni sesiones. `OwnProfile` contiene ese perfil y el correo/fecha de verificación, exclusivamente para el titular.
- Email: máximo 254 caracteres; trim y minúsculas como identidad, sin reglas particulares de Gmail, puntos ni eliminación de `+tag`.
- Username: 3–30 caracteres ASCII de letras, números o `_`; búsqueda por prefijo de 2–30, insensible a mayúsculas. Conservar presentación y reforzar unicidad en BD. Paginación por cursor opaco, orden estable por username normalizado y publicId; 20 resultados por defecto, máximo 50. Escapar comodines SQL al buscar.
- Contraseña nueva: 12–128 caracteres Unicode, sin reglas de composición, trim, normalización ni truncamiento. Medir caracteres de forma coherente con JSON Schema; no longitud en bytes o unidades UTF-16. Argon2id con parámetros medidos en el entorno antes de Etapa 3 y límites de concurrencia; no bcrypt.
- Liga: texto simple de hasta 100 caracteres; null la elimina; rechazar texto vacío tras trim. PATCH solo acepta username y liga, al menos uno; campos extra se rechazan.
- Foto: JPG/JPEG, PNG o WebP, límite operativo 5 MiB = 5 242 880 bytes. El límite se aplica al archivo, con límite multipart adicional acotado. Una sola imagen; validar firma, MIME real, decodificación y límites de dimensiones/píxeles para evitar bombas de descompresión. No admitir SVG, URLs remotas ni objetos elegidos por cliente.
- Tokens de acción: al menos 256 bits aleatorios, codificación base64url; solo hash en BD y nunca en respuestas JSON. Se entregan únicamente por el mensaje de seguridad.

Los valores menores anteriores son decisiones técnicas locales de contrato, no campos nuevos configurables del producto. Los errores conservan `{ error: { code, message, details } }`, con mensajes españoles; details nunca reproduce contraseñas, tokens, correo de terceros, SQL o trazas. Entrada inválida 422, token de acción no utilizable 400, autenticación 401, Origin/CSRF 403, username ocupado 409, tamaño 413, formato 415, límites 429. JSON malformado sigue siendo 400 a nivel middleware; fallos inesperados conservan el 500 uniforme existente, aunque no se repita en cada operación. Una caída general de infraestructura puede devolver 503 sin depender de existencia de cuenta. Respuestas de identidad y URLs firmadas usan `Cache-Control: no-store`.

## Política de sesiones y renovaciones simultáneas

### Transporte y límites

- Access JWT: máximo 15 minutos, sin superar expiración de la sesión. Se comprobarán algoritmo permitido, firma, issuer, audience, expiración y sesión vigente; no basta con validar firma para autorizar una sesión revocada.
- Refresh opaco: familia con máximo absoluto de 30 días desde login, sin extender por renovación. Hash en PostgreSQL; valor bruto solo en cookie HttpOnly. Historial de hashes consumidos/revocados retenido mientras pueda recibirse un token no vencido; limpieza posterior idempotente no destruye detección de reutilización.
- Web Cliente: cookie `fcmatch_refresh_web`; móvil navegador: `fcmatch_refresh_mobile`. Host-only, `Path=/api/v1/auth`, HttpOnly, SameSite=Strict y Secure en despliegue. Solo se permite desactivar Secure en desarrollo explícito sobre loopback HTTP; nunca automáticamente por una cabecera manipulable. Producción falla al configurar orígenes no HTTPS o incompatibles con SameSite.
- Asignar cada Origin permitido a un contexto navegador por configuración exacta. Vincular la sesión y su cookie a ese contexto. No compartir accidentalmente refresh entre aplicaciones que usan la misma API, ni convertir Origin en autorización de negocio. CORS con credenciales y orígenes exactos; nunca `*`.
- Las páginas de seguridad requieren `Referrer-Policy: no-referrer`, no incluyen analítica/recursos ajenos y retiran el secreto del URL de navegación al recogerlo. No consumir por GET: un prefetch o escáner de correo no debe ejecutar la acción.
- Contexto CSRF HttpOnly independiente por cliente, prueba firmada devuelta por `GET /auth/csrf` al Origin permitido, conservada solo en memoria. Vinculada al contexto y a la sesión cuando existe; vence como máximo en 1 h. Toda mutación de esta fase requiere `X-CSRF-Token` y Origin válido. Incluye login/refresh/logout, no solo rutas con Bearer. Angular no agrega automáticamente XSRF a toda URL absoluta: el interceptor de API deberá hacerlo explícitamente solo para el backend permitido. Un 403 CSRF se produce antes de cualquier efecto; no repetir ciegamente mutaciones.
- `GET /auth/csrf` reutiliza el contexto válido en vez de invalidar a las otras pestañas en cada lectura; login renueva el contexto. Para una instalación same-origin, el navegador puede omitir Origin en ese GET: solo admitirlo con `Sec-Fetch-Site: same-origin` y origen público de API explícitamente permitido; no confiar en un Host arbitrario, un proxy no configurado ni un Origin ausente en peticiones cross-origin. Logout elimina cookies con los mismos atributos. No persistir tokens en localStorage, sessionStorage, IndexedDB, Capacitor Preferences ni archivos de pruebas. La preferencia de tema existente no cambia.
- La respuesta login/refresh solo contiene access, vencimientos, tipo Bearer y prueba CSRF; no contiene refresh, contraseña ni tokens de acción. Android/iOS requieren transporte/almacenamiento específico futuro; no habilitar en Fase 1 una salida JSON de refresh basándose en un header de cliente no confiable.

### Concurrencia y fallos de red

1. El servicio rota bajo una transacción corta con bloqueo/actualización condicional. Verificar familia/sesión, consumir el hash y emitir exactamente un sucesor es una sola operación atómica.
2. Reutilizar un hash consumido revoca la familia y produce 401. Esa revocación debe **confirmarse en BD antes de responder**, no perderse por rollback al lanzar el error. Revoca también el access de la familia, consultando vigencia de sesión en operaciones protegidas.
3. No hay período de gracia, repetición exitosa del token anterior ni caché del refresh bruto. Dos usos concurrentes del mismo refresh pueden dejar a la familia revocada: no se presentan como dos renovaciones satisfactorias.
4. Clientes: una promesa compartida de refresh por aplicación y coordinación entre pestañas del mismo origen con Web Locks. Tras adquirir el bloqueo se usa la cookie actualizada por el navegador. BroadcastChannel solo comunica eventos de sesión, nunca secretos persistentes. Si no se dispone de coordinación segura, no hacer renovación automática concurrente: pedir nuevo login en vez de debilitar la rotación.
5. No reintentar refresh automáticamente tras timeout/pérdida de conexión: la BD pudo haber rotado aunque el cliente no reciba respuesta. La política conservadora es volver a login. Para cambios autenticados, no reintentar automáticamente operaciones no idempotentes sin saber que no tuvieron efecto.
6. Logout actual es idempotente con CSRF válido aunque no haya access vigente; revoca una familia identificable y limpia cookies. Logout-all, reset y cambio de contraseña revocan todas las sesiones, incluida la actual. No revocan familias ajenas ante un token aleatorio que no identifica una sesión.

Pruebas obligatorias posteriores: dos renovaciones paralelas, sesión revocada durante rotación, refresh vencido/reutilizado, pérdida de respuesta, varias pestañas, clientes separados, access emitido antes de logout y revocación durable tras 401. Ninguna de estas garantías está implementada por la Etapa 1.

## Política de SMTP local y fallos

- La BD y SMTP no forman una transacción distribuida. Persistir cuenta sin verificar y hash del token en transacción corta; enviar **después del commit** con timeout acotado. No verificar, autenticar ni cambiar correo porque el envío fue aceptado por SMTP.
- Registro, reenvío, recuperación y solicitud de cambio de correo comparten 202 genérico ante destino elegible/no elegible y fallo SMTP posterior a persistencia. No devolver diferencias que permitan enumerar correos, ni estados de entrega específicos de una cuenta. El 202 dice expresamente que no garantiza recepción. Registrar solo categoría del fallo e identificador de correlación sin token/correo/credenciales/contenido del mensaje.
- Si falla persistencia no se envía el mensaje. Una caída general devuelve 503 uniforme, no un error condicionado a que exista la cuenta. Los usernames son públicos: 409 de disponibilidad no revela ni consulta el correo.
- Un timeout SMTP es ambiguo: el receptor pudo aceptar el correo. No borrar el token por timeout. El token tiene vida acotada, finalidad única, hash y consumo atómico; el mensaje capturado localmente es material sensible de prueba y queda fuera de Git, sin compartirlo ni imprimir sus enlaces en logs de aplicación.
- Tras falla de verificación, la cuenta sigue sin verificar y puede solicitar reenvío. Solicitar de nuevo no cambia contraseña ni revoca sesiones. Acotar la cantidad de tokens por los límites de solicitud y su TTL, sin un cupo adicional de tokens pendientes que deje sin reenvío a quien sufrió fallos de entrega. Un envío nuevo no invalida enlaces anteriores por un fallo SMTP. Al confirmar, invalidar todos los tokens hermanos de esa finalidad en la misma transacción.
- Para cambio de correo, el destino se vincula al token y al titular; nunca aceptar usuario/destino desde el cliente al confirmar. Una nueva solicitud hacia **otro destino** invalida los tokens del destino anterior. El correo anterior permanece hasta confirmar; comprobar disponibilidad de destino en la transacción de confirmación sin revelar la cuenta que lo ocupa. Se exige contraseña actual para solicitar.
- TTL: verificación 24 h; recuperación y cambio de correo 30 min. No hay reintentos automáticos ni nueva cola/servicio en esta entrega; recuperación mediante reenvío solicitado y limitado. No iniciar notificaciones de torneos por correo.
- Límites iniciales propuestos para implementar: login 30 solicitudes/IP/15 min y bloqueo temporal de 15 min tras 10 fallos por identidad normalizada; respuestas 401 genéricas también durante bloqueo. Solicitudes de correo 10/IP/15 min, máximo 5/identidad/h y separación de 60 s. Los límites por identidad se aplican también a cuentas inexistentes y responden 202 silencioso; 429 por IP incluye Retry-After. Claves de intentos seudonimizadas, caducidad y limpieza previstas. Combinar controles de IP/cuenta, sin bloqueo permanente. Afinar rendimiento/timing sin introducir enumeración; comparación Argon2id ficticia para cuenta inexistente.

Pruebas posteriores: receptor SMTP local, rechazo/conexión fallida/timeout tras aceptación, no rollback ficticio de correo, reenvío limitado, cuenta existente/inexistente, enlace anterior utilizable y consumo paralelo. No se afirma entrega externa ni se pide un proveedor SMTP externo.

## Almacenamiento de avatares: S3 local real y R2 pendiente

Desarrollo y pruebas usan SeaweedFS en loopback con buckets privados separados `fcmatch-dev-avatars`/`fcmatch-test-avatars`, identidades distintas y permisos por bucket. Sin identidad anónima, servicios auxiliares deshabilitados, filer HTTP cerrado y volumen protegido con JWT interno. Credenciales generadas en `.local/storage/` ignorado; el usuario del sistema operativo y los puertos gRPC loopback forman parte del entorno local de confianza, no un despliegue público. Adaptador configurable `STORAGE_PROVIDER=disabled|s3-local|r2`. S3 local falla en producción; no hay fallback automático. HTTP firmado solo en `127.0.0.1`; producción R2 usa HTTPS y necesitará credenciales y aceptación real externas futuras.

El backend valida, decodifica y recodifica imágenes sin metadatos, genera claves `avatars/` aleatorias de 128 bits y entrega URL firmada ≤5 min. No firma claves elegidas por clientes ni permite URLs de entrada. La sustitución conserva el objeto anterior hasta commit. Diario técnico PostgreSQL registra reservas/activos/retirados para no borrar una imagen activa ante commit ambiguo y permitir limpieza reintentable; reservas abandonadas se retiran tras 15 min. No se añade expiración global ni almacenamiento de evidencias de torneos.

Aceptación con imágenes sintéticas, PostgreSQL/SMTP/S3 reales: subida, sustitución, lectura firmada, rechazo anónimo/firma alterada/vencida, borrado, titularidad, concurrencia y fallos. No se imprimen ni publican firmas, imágenes personales o secretos. La guía Cloudflare entregada anteriormente se conserva como antecedente: no configurar R2 durante este desarrollo.

## Dependencias y verificaciones de Etapa 1

Se consultaron registro npm, peers y auditorías el 11/11/2026. Se mantienen Angular + Ionic, Node 26 LTS, PostgreSQL y TypeScript 6.0.3: Angular compiler-cli 22.2.5 y typescript-eslint 8.72.2 siguen exigiendo TypeScript <6.1, por lo que no se fuerza TypeScript 7. npm estable pasa a 12.2.2 en herramientas locales y configuración de los cuatro paquetes/CI. Ionic CLI continúa excluido por la excepción vigente.

Actualización compatible separable en lockfiles: Ionic 9.0.11, Playwright 1.65.0, Prettier 3.10.0 y typescript-eslint 8.72.2; Backend además actualiza dependencias compatibles de correo, AWS, Redocly, limitación y pruebas. **Angular 22.2.5 fue consultado, pero no se pudo instalar: los tres clientes conservan 22.2.4.** No se instalan aún Argon2, JWT, procesamiento de imágenes o plugin nativo: su selección y prueba corresponden a etapas ejecutables posteriores.

La actualización indiscriminada de transitivas del cliente encontró `ETARGET @babel/parser@^8.1.2` no disponible en el registro consultado. La actualización **dirigida de dependencias directas** actualizó las anteriores, pero no movió Angular. Se intentó alinear explícitamente sus siete paquetes a 22.2.5, también preparando el lockfile desde manifiestos alineados: npm devolvió `ERESOLVE` frente al grafo de pares 22.2.4 existente. Se retiró solo ese intento de cambio de rangos propio y se conservan manifiestos/lockfiles coherentes con la instalación anterior. No se instaló una versión menor, ni se usó `--force`, `--legacy-peer-deps`, override nuevo o relajación de peers. **Pendiente de aprobación del propietario: excepción temporal para Angular 22.2.4 o investigación aislada adicional antes de cerrar Etapa 1.** Los síntomas no prueban por sí solos una incompatibilidad del código de Angular ni una vulnerabilidad. Scripts de instalación bloqueados por npm siguen bloqueados; no se aprobaron scripts de terceros indiscriminadamente.

Comprobaciones de esta etapa: lint OpenAPI, generación reproducible de tipos, pruebas de estructura/privacidad/alcance del contrato y regresión de health/404, compilaciones, lint y pruebas existentes. Estas comprobaciones no prueban las futuras reglas de autenticación ni R2. Modelos idénticos en Backend y tres clientes, distribuidos por `tooling/sync-api.mjs` del espacio de trabajo; no imports de fuentes de otro repositorio.

Engram conserva decisiones y evidencias verificadas sin secretos. Stitch corresponde al diseño de las pantallas de Etapa 6, sin generar ahora pantallas ni proyectos remotos. Las seis skills son auxiliares: no sustituyen la API única, permisos en servicios, Ionic ni el mecanismo `data-theme`.
