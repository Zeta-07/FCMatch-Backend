# DERCAS – Plataforma web y móvil para la gestión y organización de torneos de FC Mobile

Documento de Especificación de Requisitos, Condiciones y Alcance del Sistema. Versión 1.1 – 04/11/2026 (incorpora la WebAdmin, la Web Cliente como aplicación propia y los estándares de interfaz e identidad visual). Fuentes: «registro\_acuerdos\_proyecto\_fc\_mobile.md» y «Arquitectura y decisiones técnicas confirmadas». Este documento es la referencia para elaborar el AGENTS.md.

## 1. Introducción

### 1.1 Propósito y problema

La plataforma permite crear, organizar, administrar y consultar torneos de FC Mobile. Sustituye la organización manual por grupos de WhatsApp, capturas y registros dispersos, que dificulta el seguimiento de participantes, partidos, resultados y clasificaciones. La Web Cliente, la aplicación móvil y la WebAdmin comparten backend, API y datos.

### 1.2 Alcance de la versión 1

- Solo FC Mobile. Resultados registrados manualmente con capturas como evidencia.
- Tres formatos: Liga, Eliminación directa pura y Grupos + eliminación directa.
- Cuentas, perfiles públicos, amigos, invitaciones, notificaciones internas y estadísticas.
- Administración y gestión del sistema mediante la **WebAdmin**, de uso exclusivo del propietario de la plataforma (funciones concretas por definir).

### 1.3 Fuera de alcance

Otros videojuegos, campeonatos de fútbol real, reservas de canchas, pagos o premios, integración automática con FC Mobile, rangos de FC Mobile, bloqueo de usuarios, notificaciones por correo o push, fechas y horarios por partido, catálogo público de torneos.

### 1.4 Glosario

- **Moderador:** organizador o colaborador.
- **Administrador de plataforma:** propietario del sistema; rol global que opera solo desde la WebAdmin.
- **Web Cliente:** aplicación web para los usuarios finales. No es la WebAdmin.
- **WebAdmin:** panel de administración y gestión del sistema (`FCMatch-AdminWeb`).
- **Bye:** pase directo en eliminatorias; no es un retiro.
- **W.O.:** avance por retiro o descalificación del rival.
- **Serie:** cruce eliminatorio a ida y vuelta.
- **Jornada:** conjunto de partidos de una ronda de la fase regular.

## 2. Arquitectura y tecnología (decisiones confirmadas)

- **Cliente-servidor** con tres clientes (Web Cliente, WebAdmin y app móvil) y **una única API REST compartida** que centraliza lógica de negocio, autenticación, validaciones y datos. Prohibido crear backends separados.
- **Backend Modular + Capas** (sustituye la mención previa a «Clean Architecture»). Módulos: `users`, `tournaments`, `matches`, `friends`, `notifications`, `statistics`. Cada módulo: Controladores (HTTP) → Servicios (lógica y reglas) → Repositorios (acceso a BD). Los controladores no acceden a la BD; los repositorios no contienen reglas de negocio.

| Componente | Tecnología |
| --- | --- |
| Web Cliente | Angular + Ionic |
| WebAdmin | Angular + Ionic |
| Móvil | Angular + Ionic + Capacitor (componentes nativos de Ionic) |
| Lenguaje frontend | TypeScript |
| Backend | Node.js + Express |
| Base de datos | PostgreSQL |
| Evidencias | Cloudflare R2 |
| Autenticación | JWT |
| Herramientas | VS Code, Git/GitHub, Thunder Client |

Todos los cálculos de torneo (calendarios, tablas, cuadros, desempates) se hacen en el backend; los clientes solo presentan.

### 2.1 Interfaz e identidad visual (estándar de desarrollo)

- **Web Cliente, WebAdmin y app móvil:** Angular + Ionic, priorizando los componentes nativos de Ionic. Comparten un sistema de diseño con componentes reutilizables, estilos responsivos y temas oscuro y claro, manteniendo sus propias rutas, navegación y responsabilidades.
- **Capacitor:** se utiliza para las funciones y compilaciones móviles.
- Todas las aplicaciones mantienen los colores corporativos y la identidad visual definidos para el proyecto, para garantizar consistencia en el diseño y la experiencia de usuario en todas las plataformas.
- Logo oficial del proyecto: `Logo.png` (carpeta del proyecto `fc_torneos`), usado en todas las aplicaciones.
- La Web Cliente y la app móvil conviven en el repositorio del frontend, en carpetas separadas (`web/` y `mobile/`), como aplicaciones independientes.

## 3. Roles y permisos

| Acción | Organizador | Colaborador | Participante | Espectador |
| --- | --- | --- | --- | --- |
| Configurar, iniciar y cancelar torneo | Sí | No | No | No |
| Asignar o retirar colaboradores | Sí | No | No | No |
| Revisar y modificar grupos y siembra antes de iniciar | Sí | No | No | No |
| Expulsar, descalificar, gestionar retiros | Sí | Apoyo | Solicita su retiro | No |
| Registrar resultado directamente | Sí | Sí | No | No |
| Revisar evidencias y resolver disputas | Sí | Sí | No | No |
| Reportar, confirmar o disputar partidos propios | Si participa | Si participa | Sí | No |
| Ver evidencias | Todas | Todas | Solo las de sus partidos | No |
| Ver tablas, llaves, resultados confirmados | Sí | Sí | Sí | Sí (con enlace) |

- Los permisos son **por torneo**; se verifican en el backend en cada operación.
- Un moderador también puede participar. Si reporta su partido no puede confirmarlo (lo confirma su rival). En disputas de un partido donde juega un moderador, decide otro moderador.
- Si los dos jugadores son los únicos moderadores, el organizador designa a un **tercero de confianza temporal**, con permiso exclusivo de ver evidencias y resolver esa disputa.
- Los colaboradores comparten un único perfil operativo y no pueden cambiar estructura o reglas, gestionar colaboradores, ni cancelar o eliminar el torneo.
- **Administrador de plataforma:** rol global (no por torneo) que opera solo desde la WebAdmin y se orienta a la administración y gestión del sistema. Sus funciones y permisos concretos están pendientes de definir; se verifican en el backend en cada operación.

## 4. Requisitos funcionales

### 4.1 Cuentas y perfiles (módulo `users`)

- **RF-01** Registro e inicio de sesión con correo y contraseña; la cuenta es obligatoria para participar.
- **RF-02** Verificación del correo en el registro; recuperación de contraseña por correo.
- **RF-03** Perfil: nombre de usuario obligatorio, único y editable si está disponible; ID de usuario único autogenerado; nombre de liga opcional; foto opcional (JPG, JPEG, PNG, WebP, máx. 5 MB). El correo es privado y nunca se muestra.
- **RF-04** Búsqueda de usuarios por nombre de usuario; el perfil público muestra usuario, liga, foto, estadísticas generales e historial.
- **RF-05** Cambio de correo con verificación de la nueva dirección antes de aplicarlo.
- **RF-06** Cierre de sesión en el dispositivo actual y en todos los dispositivos (invalida refresh tokens).
- **RF-07** Eliminación de cuenta con confirmación por contraseña y correo, espera de 7 días y posibilidad de cancelar iniciando sesión. Un participante puede eliminar su cuenta con partidos pendientes (se aplica retiro). Un organizador debe transferir antes sus torneos activos. Al ejecutarse se eliminan los datos personales y se conservan los resultados necesarios, mostrando «Usuario eliminado».

### 4.2 Amigos (módulo `friends`)

- **RF-08** Enviar, aceptar o rechazar solicitudes; la amistad existe solo al aceptar. Listar y eliminar amigos. La lista es privada del propietario. Sin bloqueo.
- **RF-09** El organizador invita amigos a un torneo; el invitado recibe notificación y acepta o rechaza. Si acepta sin cupos, no se inscribe.

### 4.3 Torneos (módulo `tournaments`)

- **RF-10** Crear torneo con: nombre (obligatorio), descripción (opcional), imagen/insignia (genérica por defecto), formato, cantidad de participantes dentro del rango del formato, modalidad de avance (Ritmo Libre o Por Jornadas; solo Liga y Grupos) y fecha de inicio. No hay más configuración.
- **RF-11** Cada torneo tiene enlace de invitación y código único. Al abrirlo se muestra confirmación para unirse; si hay cupo queda inscrito. Al completarse el cupo se bloquean inscripciones y quien tenga el enlace entra como espectador.
- **RF-12** El organizador gestiona participantes (lista, expulsión, retiro, descalificación) y colaboradores, y revisa grupos y siembra antes de iniciar.
- **RF-13** El organizador puede iniciar en cualquier momento si se cumple el mínimo del formato; la fecha configurada es informativa y no lo impide. No se puede iniciar fuera del rango.
- **RF-14** Cancelación por el organizador, incluso iniciado el torneo, con advertencia y confirmación.
- **RF-15** Finalización automática al completarse todos los partidos; se declara campeón sin aprobación manual.
- **RF-16** Resumen final (campeón, subcampeón, clasificación, estadísticas, reconocimientos, resultados destacados y cuadro en formatos eliminatorios) que cualquier integrante puede compartir.
- **RF-17** Vista general única del torneo, estilo liga deportiva, con filtros por participante, jornada/fase, estado y otros. No hay secciones «Mis partidos» ni «Historial».

### 4.4 Partidos y resultados (módulo `matches`)

Ver sección 6.

### 4.5 Notificaciones (módulo `notifications`)

- **RF-18** Solo dentro de la plataforma: campana con contador de no leídas, historial, marcar una o todas como leídas, eliminar las leídas, y apertura del partido o sección correspondiente al pulsar.
- **RF-19** Destinatarios: nuevo partido → sus dos participantes; resultado reportado → el rival y los moderadores; confirmación o disputa → participantes implicados y moderadores que deban intervenir; nueva jornada o fase → participantes afectados; invitaciones y solicitudes de amistad → destinatario.
- **RF-20** Nadie recibe información privada de disputas ajenas. Se evita saturar a moderadores con avisos de generación de partidos (un aviso agrupado por inicio de fase).

### 4.6 Estadísticas (módulo `statistics`)

- **RF-21** Por torneo: máximo goleador, mejor defensa (menos goles recibidos), campeón, subcampeón. Sin métricas adicionales.
- **RF-22** En el perfil: torneos disputados y ganados, partidos jugados, ganados, empatados y perdidos, porcentaje de victorias, goles marcados y recibidos, diferencia de goles.
- **RF-23** Solo los torneos **Finalizados** cuentan en las estadísticas de torneos; los cancelados no. Los partidos confirmados de quien se retira conservan su aporte a sus estadísticas personales, aunque no cuenten para la tabla.

## 5. Reglas de los formatos de torneo

### 5.1 Liga (8–20 participantes)

- Fase regular: tabla única, todos contra todos, una vez por pareja, repartida en jornadas (método del círculo; con número impar descansa uno por jornada).
- Clasifican 4 (8–12 participantes) u 8 (13–20).
- Eliminatorias: semifinales y final (4) o cuartos, semifinales y final (8), todas a ida y vuelta.
- Emparejamiento: 1.º vs último, 2.º vs penúltimo, etc.

### 5.2 Eliminación directa pura (8–64)

- Cuadro de eliminación directa; si no es potencia de dos se asignan *byes* automáticamente a las mejores siembras.
- El organizador define la siembra (orden manual o aleatoria; aleatoria por defecto).
- Todas las rondas, incluida la final, a ida y vuelta. Quien tiene *bye* avanza sin jugar.

### 5.3 Grupos + eliminación directa (8–32)

- Reparto aleatorio en grupos de 3 o 4, con diferencia de tamaño mínima (nunca grupos menores de 3). El organizador puede modificarlos antes de iniciar.
- Todos contra todos dentro del grupo; clasifican los 2 primeros de cada grupo.
- Los clasificados se ordenan por puntos, diferencia de goles y goles a favor. El organizador revisa y valida la siembra antes de generar el cuadro (que se crea al terminar los grupos).
- Si no se completa un cuadro de 4, 8 o 16, se asignan *byes*.
- Primera ronda: primeros contra segundos de otros grupos, evitando choques del mismo grupo cuando sea matemáticamente posible.
- Eliminatorias a ida y vuelta, incluida la final.

### 5.4 Reglas comunes

- **Serie a ida y vuelta:** gana quien tenga mayor marcador global (suma de goles de ambos partidos, sin regla de gol de visitante). Si empatan se juega **un partido adicional** que no admite empate; si fuese empate se repite hasta haber ganador.
- **Tabla de la fase regular:** victoria 3 puntos, empate 1, derrota 0. Desempate: puntos, diferencia de goles, goles a favor, resultado entre los empatados y, como último recurso, sorteo determinista registrado.
- *Byes* no son retiros.

### 5.5 Modalidades de avance (Liga y Grupos, fase regular)

- **Ritmo Libre:** se genera toda la programación al iniciar; el siguiente partido de un participante se habilita cuando su partido anterior está confirmado, sin depender de otros jugadores.
- **Por Jornadas:** la jornada siguiente se habilita solo cuando todos los partidos de la actual están disputados, reportados y confirmados.
- **Eliminatorias (todos los formatos):** una ronda se habilita cuando se resolvieron los cruces que la alimentan; en cada serie, la vuelta se habilita al confirmar la ida y el partido adicional al confirmar ambos y persistir el empate.
- No hay fechas, horarios ni plazo máximo por partido: un partido permanece pendiente hasta ser jugado, reportado y confirmado.

### 5.6 Estados del torneo

**Borrador** (configuración incompleta) → **Abierto** (inscripciones, al guardar la configuración válida) → **En curso** (al iniciar) → **Finalizado** (automático). **Cancelado** lo establece solo el organizador. Todos los cambios son automáticos salvo la cancelación.

### 5.7 Retiro, expulsión y descalificación

- **Liga y fase de grupos:** los partidos jugados permanecen en el historial; sus resultados y puntos dejan de contar para la tabla; los pendientes se cancelan y desaparecen del calendario; no se crean marcadores ni puntos ficticios.
- **Eliminatorias:** el rival avanza por W.O.; los partidos jugados conservan su resultado real; no se inventan marcadores.
- Si el retiro ocurre durante las eliminatorias de cualquier formato, se aplica la regla de W.O.

## 6. Partidos, evidencias y disputas

### 6.1 Generación

Al iniciar el torneo se generan automáticamente todas las jornadas y partidos de la fase regular (Grupos: calendario de cada grupo). El cuadro eliminatorio se genera al iniciar (eliminación directa) o al validar la siembra tras los grupos.

### 6.2 Estados del partido

`bloqueado` → `pendiente` → `reportado` → `confirmado`; ramas `en_disputa` (desde reportado), `cancelado` (retiro) y `wo`. Un partido `confirmado` es inmutable.

### 6.3 Reporte

- Cualquiera de los dos participantes puede reportar marcador con **1 o 2 imágenes obligatorias** (JPG, JPEG, PNG; sin video).
- Las evidencias son visibles solo para los dos participantes y los moderadores autorizados; nunca para espectadores ni otros participantes.
- El rival recibe notificación y puede **confirmar** o **disputar** (indicando un motivo breve).
- Si no actúa en **24 horas** desde el reporte, el resultado se confirma automáticamente.
- Quien reportó puede editar mientras el rival no haya actuado; la edición actualiza la notificación y reinicia el plazo de 24 horas.
- Moderadores pueden registrar o corregir un resultado directamente (sin evidencia obligatoria) mientras el partido no esté confirmado; un registro directo queda confirmado de inmediato.

### 6.4 Disputa

Un moderador distinto de los jugadores revisa las evidencias y decide el marcador final, que queda confirmado y bloqueado. Si ambos jugadores son los únicos moderadores se aplica el tercero temporal (sección 3).

### 6.5 Confirmación y bloqueo

Un resultado confirmado queda bloqueado de forma permanente; ni organizador ni colaboradores pueden modificarlo.

### 6.6 Auditoría

Toda acción sobre resultados (reporte, edición, confirmación, disputa, resolución, cambio administrativo) registra quién, qué y cuándo. La auditoría se conserva aunque se eliminen las imágenes.

### 6.7 Evidencias en Cloudflare R2

- Bucket **privado**; el acceso se da mediante URL firmadas de corta duración, emitidas tras verificar permisos en el backend.
- Se validan tipo MIME real, tamaño y cantidad en el backend; los nombres de objeto son aleatorios.
- Se conservan mientras el torneo esté En curso o Cancelado y se eliminan automáticamente al pasar a **Finalizado**.

## 7. Seguridad y autenticación

La autenticación y autorización viven en el backend y las comparten la Web Cliente, la WebAdmin y la app móvil.

- **Contraseñas:** nunca en texto plano; hash con **Argon2id** y parámetros adecuados.
- **JWT:** access token de vida corta más **refresh tokens** con rotación, almacenados solo como hash en BD y vinculados a una sesión/dispositivo. Reutilización de un refresh token revocado invalida la familia de sesión.
- **Almacenamiento de tokens:** web con cookie HttpOnly + Secure + SameSite para el refresh token y access token en memoria; móvil en almacenamiento seguro del dispositivo (Capacitor). Nunca en logs, mensajes de error ni localStorage.
- **Fuerza bruta:** límite de intentos fallidos con bloqueo temporal gestionado de forma segura, sin revelar si el correo existe.
- **Rate limiting** en login, registro y recuperación de contraseña, y límites generales en la API.
- **Validación y sanitización** de todas las entradas con esquemas (p. ej. Zod/Joi); consultas parametrizadas.
- **Autorización por rol** en cada operación protegida (propietario, colaborador, participante, espectador) comprobada en el backend.
- **HTTPS** obligatorio en entornos desplegados, cabeceras de seguridad (helmet) y CORS restringido a los orígenes propios.
- **Recuperación de contraseña y verificación/cambio de correo:** enlaces o códigos temporales de un solo uso, guardados como hash, con expiración y protección contra reutilización. Cambiar la contraseña revoca las sesiones.
- **Eliminación de cuenta:** flujo de 7 días descrito en RF-07.
- Secretos solo por variables de entorno; nunca en el repositorio.

## 8. Requisitos no funcionales

Se documentan como objetivos razonables, sin restricciones arbitrarias.

- **Rendimiento:** las consultas frecuentes (vista general, tablas, cuadro) responden con fluidez; listados paginados y con índices.
- **Compatibilidad:** web en navegadores modernos actuales y diseño responsivo; móvil en Android e iOS mediante Capacitor.
- **Disponibilidad:** operación continua razonable; las tareas programadas son idempotentes para tolerar reinicios.
- **Usabilidad:** vista de torneo clara, acciones disponibles solo cuando proceden, mensajes de error comprensibles en español.
- **Mantenibilidad:** módulos desacoplados, código en TypeScript, validaciones centralizadas y pruebas unitarias de las reglas de negocio críticas.
- **Integridad:** operaciones multi-tabla en transacciones (generación de calendario, confirmación, retiro).
- **Concurrencia:** confirmaciones y resoluciones protegidas contra doble ejecución (bloqueo optimista o restricciones de BD).
- **Idioma:** interfaz en español; fechas almacenadas en UTC y mostradas en la zona del usuario.
- **Privacidad:** correo y evidencias nunca públicos; datos personales eliminados al borrar la cuenta.

## 9. Diseño técnico propuesto

Elaborado aplicando buenas prácticas; el agente puede ajustarlo sin contradecir las secciones 2 a 8.

### 9.1 Modelo de datos (PostgreSQL)

Identificadores UUID, marcas `created_at/updated_at` en UTC, claves foráneas con restricciones e índices en columnas de consulta.

| Tabla | Contenido clave |
| --- | --- |
| `users` | id, public\_id único, username único (insensible a mayúsculas), email único, password\_hash, league\_name, avatar\_key, email\_verified\_at, deletion\_requested\_at |
| `sessions` | id, user\_id, refresh\_token\_hash, family\_id, device, expires\_at, revoked\_at |
| `action_tokens` | user\_id, tipo (verificar correo, recuperar contraseña, cambio de correo), token\_hash, new\_email, expires\_at, used\_at |
| `login_attempts` | clave (correo/IP), intentos, locked\_until |
| `friendships` | requester\_id, addressee\_id, estado (pendiente/aceptada), único por pareja |
| `tournaments` | nombre, descripción, formato, max\_participants, advance\_mode, start\_date, estado, organizer\_id, invite\_code único |
| `tournament_members` | tournament\_id, user\_id, rol (participante/colaborador), estado (activo/retirado/expulsado/descalificado), seed; único (torneo, usuario) |
| `tournament_invitations` | tournament\_id, invitee\_id, estado |
| `stages`, `groups`, `group_members`, `rounds` | fases (regular/eliminatoria), grupos, jornadas y rondas |
| `ties` | serie ida/vuelta: participantes, ganador, estado |
| `matches` | stage/round/group, tie\_id, leg (ida/vuelta/extra), home\_id, away\_id, estado, marcador confirmado, confirmed\_at |
| `match_reports` | match\_id, reportado por, marcador, estado, auto\_confirm\_at |
| `evidence_files` | report\_id, r2\_key, tipo, tamaño, deleted\_at |
| `disputes` | match\_id, abierta por, motivo, resuelta por, resolución |
| `audit_log` | entidad, acción, actor, datos previos/nuevos, fecha |
| `notifications` | user\_id, tipo, referencia, leída, fecha |
| `moderation_delegations` | disputa, tercero designado, vigencia |

Restricciones destacadas: marcador no negativo, un partido por emparejamiento y vuelta, un solo reporte activo por partido, ningún usuario inscrito dos veces, nunca más participantes que `max_participants`, y partido `confirmado` inmutable (reforzado en servicio y con trigger). Las estadísticas se calculan sobre partidos confirmados de torneos finalizados.

### 9.2 API REST (prefijo `/api/v1`)

Respuestas JSON, errores con formato `{ error: { code, message, details } }`, códigos HTTP correctos, paginación por cursor o página.

| Módulo | Endpoints principales |
| --- | --- |
| auth/users | `POST /auth/register, /login, /refresh, /logout, /logout-all, /verify-email, /forgot-password, /reset-password`; `GET/PATCH /users/me`; `POST /users/me/email-change`; `POST/DELETE /users/me/deletion`; `GET /users?search=`; `GET /users/:publicId` |
| friends | `GET /friends`; `POST /friends/requests`; `PATCH /friends/requests/:id`; `DELETE /friends/:id` |
| tournaments | `POST/GET /tournaments/:id`; `PATCH /tournaments/:id`; `POST /tournaments/:id/start, /cancel`; `GET /tournaments/join/:code`; `POST /tournaments/:id/join`; `GET /tournaments/:id/members`; `POST /tournaments/:id/invitations`; `PATCH /invitations/:id`; gestión de colaboradores, expulsión, retiro y transferencia; edición de grupos y siembra; `GET /tournaments/:id/overview, /standings, /bracket, /stats, /summary` |
| matches | `GET /tournaments/:id/matches` (filtros); `POST /matches/:id/report`; `PATCH /matches/:id/report`; `POST /matches/:id/confirm, /dispute`; `POST /matches/:id/resolve`; `PUT /matches/:id/result` (moderador); `GET /matches/:id/evidence`; `GET /matches/:id/audit` |
| notifications | `GET /notifications`; `PATCH /notifications/:id/read`; `POST /notifications/read-all`; `DELETE /notifications/read` |
| statistics | `GET /users/:publicId/stats, /history` |

### 9.3 Estructura de carpetas

- **Backend:** `src/modules/<modulo>/{controller,service,repository,dto,routes}`; `src/shared/{middleware,errors,config,db,storage,utils}`; `src/jobs/`; `migrations/`; `tests/`.
- **Web Cliente y WebAdmin (Angular + Ionic):** `src/app/{core,shared,features/<modulo>}` con servicios HTTP, guards e interceptores (JWT, errores).
- **Móvil (Angular + Ionic + Capacitor):** misma separación. Los tres clientes reutilizan modelos, cliente API y sistema de diseño (componentes y estilos responsivos), manteniendo repositorios y aplicaciones independientes.

### 9.4 Pantallas y navegación

- **Públicas:** inicio de sesión, registro, recuperar contraseña, verificar correo, unirse por enlace/código, vista de espectador.
- **Autenticadas:** inicio (mis torneos y torneos por unirse mediante código), crear torneo, vista general del torneo (pestañas: resumen, partidos con filtros, tablas/grupos, cuadro, estadísticas, participantes, administración según rol), detalle de partido (reportar, confirmar, disputar, evidencias), amigos y solicitudes, búsqueda de usuarios, perfil público e historial, notificaciones, ajustes de cuenta (perfil, correo, contraseña, sesiones, eliminar cuenta).
- **WebAdmin:** pantallas de administración y gestión del sistema, solo para el administrador de plataforma (por definir).
- **Navegación:** web con barra superior y rutas por característica; móvil con pestañas inferiores (Torneos, Amigos, Notificaciones, Perfil).

### 9.5 Tareas programadas

- Confirmación automática de reportes con plazo vencido de 24 horas.
- Ejecución de eliminaciones de cuenta tras 7 días.
- Eliminación de evidencias en R2 al pasar un torneo a Finalizado.
- Limpieza de tokens y bloqueos expirados.

Todas son idempotentes y registran su ejecución.

## 10. Decisiones de diseño asumidas

Se documentan para que el agente las respete y el usuario pueda corregirlas:

1. Borrador pasa a Abierto automáticamente al guardar una configuración válida.
2. La edición de un reporte reinicia el plazo de 24 horas.
3. Los registros directos de moderadores no exigen evidencia y quedan confirmados de inmediato; solo pueden corregirse mientras no estén confirmados.
4. Criterios de desempate más allá de puntos, diferencia y goles a favor (resultado directo y sorteo registrado).
5. Siembra de eliminación directa: manual o aleatoria, aleatoria por defecto.
6. El partido adicional de desempate no admite empate.
7. La transferencia de un torneo se hace a un colaborador o participante existente.
8. Al eliminar una cuenta se muestra «Usuario eliminado» en datos históricos.
9. Las disputas requieren un motivo breve; no hay contraevidencia adicional.
10. La Web Cliente y la app móvil (Angular + Ionic) viven en el mismo repositorio del frontend, en carpetas separadas. Junto a WebAdmin comparten el sistema de diseño, componentes reutilizables y estilos responsivos, conservando rutas, navegación y responsabilidades propias. Capacitor se utiliza para funciones y compilaciones móviles.
11. Las funciones concretas de la WebAdmin se definirán más adelante; hasta entonces solo se construye su base (autenticación, rol y estructura).

## 11. Revisión de consistencia

- «Clean Architecture» del registro queda reemplazada por **Modular + Capas**.
- «Corregir resultados» del organizador se aplica solo a resultados no confirmados, coherente con el bloqueo permanente.
- Por defecto no hay plazo máximo para jugar; solo el reporte tiene plazo (24 h).
- Un participante retirado conserva estadísticas personales aunque sus resultados no cuenten en la tabla.
- La v1.1 incorpora al administrador de plataforma (antes fuera de alcance) y la Web Cliente como aplicación propia.
- No hay contradicciones críticas de negocio pendientes, salvo la definición de las funciones de la WebAdmin.

## 12. Instrucciones para el agente de desarrollo

1. Respetar íntegramente este documento; no cambiar decisiones confirmadas.
2. Implementar toda regla de negocio y permiso en el backend; los clientes nunca son la fuente de verdad.
3. Mantener la arquitectura Modular + Capas y la API única compartida.
4. No pedir al usuario decisiones técnicas ya resueltas; decidir los detalles menores con buenas prácticas y documentarlos.
5. Consultar al usuario solo ante un bloqueo crítico de negocio.
6. Escribir pruebas para formatos de torneo, desempates, W.O., ciclo de vida de partidos y permisos.
7. Mantener migraciones versionadas, validación de entradas y manejo uniforme de errores.
8. No agregar funcionalidades fuera del alcance de la sección 1.3.
9. Cumplir los estándares de interfaz e identidad visual de la sección 2.1.
