# AGENTS.md — Plataforma de torneos de FC Mobile

Direccion del archivo dercas: "C:\Users\DELL5401\Documents\Desarrollo_movil\fc_torneos\Contexto\DERCAS – Plataforma web y móvil para la gestión y organización de torneos de FC.md"

Guía obligatoria para el agente de programación. Fuente de verdad: **DERCAS v1.1**. Si este archivo y el DERCAS difieren, prevalece el DERCAS; avisa al usuario de la discrepancia.


## 0. Reglas de oro

1. No cambies decisiones confirmadas ni agregues funcionalidades fuera de alcance (sección 1).
2. **Toda regla de negocio, cálculo y permiso vive en el backend.** Los clientes solo presentan y envían intenciones.
3. Una **única API REST compartida** para la Web Cliente, la app móvil (`FCMatch-Frontend`) y el panel `FCMatch-AdminWeb`. Nunca crees un segundo backend.
4. No preguntes lo ya decidido. Los detalles menores resuélvelos con buenas prácticas y documenta la decisión en `docs/decisiones.md`. Consulta al usuario solo ante un **bloqueo crítico de negocio**.
5. **Prohibido usar colores hexadecimales (o rgb/hsl) fijos en vistas y componentes.** Solo variables CSS globales (sección 12).
6. Nada de secretos en el repositorio. Usa variables de entorno y `.env.example`.
7. Todo cambio con lógica de negocio lleva pruebas (sección 13).
8. **Herramientas y dependencias siempre en la última versión estable** (sección 2.2). Nunca publiques en GitHub sin aprobación explícita del usuario (sección 19).

## 1. Alcance

**Incluye:** torneos de FC Mobile (Liga, Eliminación directa pura, Grupos + eliminación directa); cuentas, perfiles públicos, amigos e invitaciones; reporte de resultados con evidencias, disputas y auditoría; notificaciones internas; estadísticas; resumen final compartible; **administración general de la plataforma** (panel `FCMatch-AdminWeb`, solo para el propietario, enfocado en la administración y gestión del sistema; ver 13.4).

**Fuera de alcance (no implementar):** otros videojuegos, fútbol real, reservas de canchas, pagos o premios, integración automática con FC Mobile, rangos de FC Mobile, bloqueo de usuarios, correo o push como notificaciones de torneo, fechas u horarios por partido, catálogo público de torneos, contraevidencia en disputas.

## 2. Stack y arquitectura

| Componente | Tecnología |
|---|---|
| Web Cliente (`FCMatch-Frontend`, carpeta `web/`) | Angular + **Ionic** |
| Panel de administración del propietario (`FCMatch-AdminWeb`) | Angular + **Ionic** |
| App móvil (`FCMatch-Frontend`, carpeta `mobile/`) | Angular + **Ionic** (componentes nativos de Ionic) + Capacitor |
| Lenguaje | TypeScript (estricto) en todo el proyecto |
| Backend | Node.js + Express |
| Base de datos | PostgreSQL |
| Evidencias | Cloudflare R2 (bucket privado) |
| Autenticación | JWT (access + refresh) |
| Herramientas | VS Code, Git/GitHub, Thunder Client (todas en su última versión estable, ver 2.2) |

**Cliente-servidor:** tres aplicaciones consumen la misma API REST de `FCMatch-Backend`, que centraliza lógica, autenticación, validaciones y datos: la **Web Cliente** y la **app móvil** (ambas en el repositorio `FCMatch-Frontend`, en las carpetas `web/` y `mobile/`) y el **panel de administración del propietario** (`FCMatch-AdminWeb`). **No confundas la Web Cliente con `FCMatch-AdminWeb`:** son productos distintos, con audiencias, pantallas y permisos distintos; no copies pantallas de uno al otro.

### 2.1 Backend: Modular + Capas

Módulos: `users` (usuarios, perfiles, autenticación), `tournaments`, `matches` (partidos, resultados, evidencias), `friends`, `notifications`, `statistics`.

Cada módulo tiene tres capas:

| Capa | Responsabilidad | Prohibido |
|---|---|---|
| Controladores | Recibir HTTP, validar DTO, delegar, responder | Lógica de negocio, acceso a BD |
| Servicios | Reglas de negocio, transacciones, permisos | Conocer Express (`req`/`res`) |
| Repositorios | Consultas y operaciones SQL | Reglas de negocio |

Reglas: un módulo solo usa otro a través de su **servicio** (nunca sus repositorios). Sin dependencias circulares. Las operaciones multi-tabla (generar calendario, confirmar, retiro, finalizar) usan **transacciones**.

### 2.2 Versiones y herramientas actualizadas

- Todas las herramientas del proyecto deben estar en su **última versión estable**: Node.js (última LTS), npm, TypeScript, Angular, Ionic, Capacitor, Express, PostgreSQL, Git, VS Code y las dependencias del proyecto. No uses versiones beta, RC ni *canary*.
- Antes de iniciar una tarea, verifica versiones (`node -v`, `npm outdated`, `ng version`, `ionic info`). Si algo está desactualizado, actualízalo antes de continuar.
- Al crear el proyecto o añadir una dependencia, instala la versión estable más reciente; no copies versiones antiguas de ejemplos, tutoriales ni de tu conocimiento previo. Consulta el registro (npm) o la documentación oficial.
- Las actualizaciones van en **commits separados** (`chore: actualizar dependencias`), con pruebas, lint y build en verde antes de continuar.
- Si una actualización mayor introduce una incompatibilidad real, no hagas *downgrade* en silencio: documenta el caso en `docs/decisiones.md` e informa al usuario.
- Prohibido usar paquetes deprecados o sin mantenimiento cuando exista una alternativa vigente. Ejecuta `npm audit` y corrige las vulnerabilidades.

### 2.3 Interfaz, identidad visual y logo (estándar obligatorio)

- **Web Cliente, AdminWeb y app móvil:** **Ionic + Angular** es la única biblioteca de interfaz. Antes de crear un componente propio, busca el equivalente nativo de Ionic (`ion-*`). No mezcles otras bibliotecas de UI; una excepción necesita aprobación del usuario y se registra en `docs/decisiones.md`.
- **Capacitor:** se utiliza para funciones y compilaciones móviles. Los tres clientes comparten identidad visual, componentes reutilizables y estilos responsivos mediante un sistema de diseño compartido, conservando rutas, navegación y responsabilidades propias.
- **Identidad visual única:** todas las aplicaciones usan los colores corporativos y la identidad visual del proyecto (sección 14), con el mismo tema, tipografía, iconografía y comportamiento, para que el diseño y la experiencia sean consistentes en todas las plataformas. No inventes paletas, colores ni estilos propios por aplicación.
- **Logo oficial:** `C:\Users\DELL5401\Documents\Desarrollo_movil\fc_torneos\Logo.png`. Úsalo en todas las aplicaciones (pantallas de acceso, cabecera o barra de navegación, favicon e ícono de la app) y **no lo modifiques** (colores, proporciones, recortes ni redibujado). Cópialo a los recursos de cada repositorio (p. ej. `src/assets/branding/`); **nunca referencies la ruta absoluta en el código**. Si no puedes acceder al archivo, pídeselo al usuario en vez de sustituirlo. Si en alguno de los dos temas el logo se ve con un fondo que choque, avisa al usuario.

## 3. Estructura de los repositorios

El proyecto se divide en **tres repositorios independientes** (URLs en la sección 19). `FCMatch-Frontend` contiene dos aplicaciones en carpetas separadas: la Web Cliente (`web/`) y la app móvil (`mobile/`). No existe un monorepo entre repositorios: cada uno tiene su propio `README.md`, pruebas, CI y ramas, y cada aplicación tiene su propio `package.json`.

| Repositorio | Contenido | Tecnología |
|---|---|---|
| `FCMatch-Backend` | API REST única, lógica de negocio, base de datos, tareas programadas | Node.js + Express + PostgreSQL |
| `FCMatch-AdminWeb` | Panel de administración de la plataforma (solo propietario) | Angular + Ionic |
| `FCMatch-Frontend` | Web Cliente (`web/`) y app móvil (`mobile/`) | `web/`: Angular + Ionic; `mobile/`: Angular + Ionic + Capacitor |

### 3.1 FCMatch-Backend

```
/
├─ AGENTS.md
├─ docs/                  # DERCAS.md, decisiones.md, contrato de la API (OpenAPI)
├─ src/
│  ├─ modules/<modulo>/{controller,service,repository,dto,routes}
│  ├─ shared/{middleware,errors,config,db,storage,utils}
│  ├─ jobs/               # tareas programadas idempotentes
│  └─ app.ts, server.ts
├─ migrations/
├─ tests/
└─ .env.example
```

### 3.2 Clientes: FCMatch-AdminWeb y FCMatch-Frontend

`FCMatch-AdminWeb` es una sola aplicación Angular en la raíz del repositorio:

```
/
├─ AGENTS.md
├─ docs/                  # decisiones.md propio del repositorio
├─ src/
│  ├─ app/{core,shared,features/<modulo>}
│  └─ styles/themes.scss  # ÚNICO lugar con colores hexadecimales de esta aplicación
└─ .env.example
```

`FCMatch-Frontend` contiene **dos aplicaciones independientes** en carpetas separadas, cada una con la estructura anterior (su propio `package.json`, `src/app/{core,shared,features/<modulo>}` y `src/styles/themes.scss`):

```
/
├─ AGENTS.md
├─ docs/                  # decisiones.md del repositorio
├─ web/                   # Web Cliente: Angular + Ionic
└─ mobile/                # App móvil: Angular + Ionic + Capacitor
```

Los tres clientes usan Ionic. El sistema de diseño comparte componentes y estilos responsivos sin mezclar las rutas, navegación ni responsabilidades de cada aplicación.

### 3.3 Reglas entre repositorios

- **El contrato de la API vive en `FCMatch-Backend`** (`docs/`, formato OpenAPI). Los clientes se adaptan a él; nunca al revés sin avisar al usuario.
- No hay código compartido por rutas relativas ni submódulos. Los modelos TypeScript y el cliente API se **generan o copian desde el contrato** en cada cliente; mantenlos idénticos entre todos los clientes.
- `FCMatch-AdminWeb` (panel del propietario), `FCMatch-Frontend/web` (Web Cliente) y `FCMatch-Frontend/mobile` (app móvil) son productos distintos: comparten el contrato de la API, los modelos y el sistema de diseño (componentes Ionic reutilizables, temas y estilos responsivos). Las pantallas, las rutas, la navegación y los permisos son propios de cada uno (sección 13). La distribución del diseño respeta la independencia de los repositorios; no se importan fuentes por rutas relativas entre repositorios.
- **`themes.scss` es idéntico en las tres aplicaciones** (`AdminWeb`, `web/` y `mobile/`). Un cambio de tema o de tokens se hace en las tres, con un Pull Request en cada repositorio afectado (sección 19). El agente debe avisar si detecta que difieren.
- Cada repositorio mantiene su propio `docs/decisiones.md`. Las decisiones que afecten a más de un repositorio se registran en cada uno y se referencian entre sí.
- `AGENTS.md` y `DERCAS.md` se mantienen **sincronizados** en los tres repositorios. Si difieren, prevalece el DERCAS y se avisa al usuario.
- Un cambio de API que rompa compatibilidad se publica **primero** en el Backend (retrocompatible mientras haya clientes sin actualizar) y después en los clientes, cada uno en su propio Pull Request.

## 4. Convenciones de API

- Prefijo `/api/v1`. JSON. IDs UUID. Fechas en **UTC** (ISO 8601); el cliente las muestra en la zona del usuario.
- Errores uniformes: `{ "error": { "code": "...", "message": "...", "details": [] } }` con el código HTTP correcto (400, 401, 403, 404, 409, 422, 429, 500). Mensajes al usuario en **español**. Nunca expongas trazas, tokens ni datos sensibles.
- Listados paginados; filtros por query string.
- Validación de entrada con esquemas (Zod o equivalente) en el controlador; consultas **siempre parametrizadas**.
- Catálogo mínimo de endpoints (ajustable sin contradecir el DERCAS):

| Módulo | Endpoints |
|---|---|
| auth/users | `POST /auth/register, /login, /refresh, /logout, /logout-all, /verify-email, /forgot-password, /reset-password`; `GET/PATCH /users/me`; `POST /users/me/email-change`; `POST/DELETE /users/me/deletion`; `GET /users?search=`; `GET /users/:publicId`; `GET /users/:publicId/stats, /history` |
| friends | `GET /friends`; `POST /friends/requests`; `PATCH /friends/requests/:id`; `DELETE /friends/:id` |
| tournaments | `POST /tournaments`; `GET/PATCH /tournaments/:id`; `POST /tournaments/:id/start, /cancel, /join`; `GET /tournaments/join/:code`; miembros, colaboradores, expulsión, retiro, transferencia, grupos y siembra; `POST /tournaments/:id/invitations`; `PATCH /invitations/:id`; `GET /tournaments/:id/overview, /standings, /bracket, /stats, /summary` |
| matches | `GET /tournaments/:id/matches`; `POST/PATCH /matches/:id/report`; `POST /matches/:id/confirm, /dispute, /resolve`; `PUT /matches/:id/result`; `GET /matches/:id/evidence, /audit` |
| notifications | `GET /notifications`; `PATCH /notifications/:id/read`; `POST /notifications/read-all`; `DELETE /notifications/read` |

## 5. Dominio: roles y permisos

Los permisos son **por torneo** y se verifican en el backend en cada operación protegida.

| Acción | Organizador | Colaborador | Participante | Espectador |
|---|---|---|---|---|
| Configurar, iniciar, cancelar torneo | Sí | No | No | No |
| Asignar o retirar colaboradores | Sí | No | No | No |
| Revisar y modificar grupos y siembra (antes de iniciar) | Sí | No | No | No |
| Expulsar, descalificar, gestionar retiros | Sí | Apoyo | Solicita su retiro | No |
| Registrar resultado directamente | Sí | Sí | No | No |
| Revisar evidencias y resolver disputas | Sí | Sí | No | No |
| Reportar, confirmar o disputar sus partidos | Si participa | Si participa | Sí | No |
| Ver evidencias | Todas | Todas | Solo las de sus partidos | No |
| Ver tablas, llaves, resultados confirmados | Sí | Sí | Sí | Sí (con enlace) |

- **Administrador de plataforma** = el propietario del sistema. Es un rol **global** (no por torneo) y solo opera desde `FCMatch-AdminWeb`. Sus funciones y permisos exactos aún no están definidos en el DERCAS (ver 13.4); no los inventes.
- **Moderador** = organizador o colaborador. Los colaboradores tienen un único perfil operativo.
- Un moderador puede participar. Si reporta su partido, **no puede confirmarlo** (lo confirma el rival). En una disputa de un partido donde juega un moderador, resuelve otro moderador.
- Si los dos jugadores son los únicos moderadores, el organizador designa un **tercero de confianza temporal** con permiso exclusivo de ver evidencias y resolver esa disputa (`moderation_delegations`).
- Espectador: solo con enlace, solo lectura, sin evidencias privadas. Con torneo lleno, quien tiene el enlace entra como espectador.

## 6. Dominio: torneos

### 6.1 Configuración (solo estos campos)
Nombre (obligatorio), descripción (opcional), imagen/insignia (genérica por defecto), formato, cantidad de participantes (dentro del rango del formato), modalidad de avance (Ritmo Libre o Por Jornadas; solo Liga y Grupos en fase regular) y fecha de inicio (informativa, **no impide iniciar**). Sin más reglas configurables.

### 6.2 Inscripción
Enlace de invitación o código único. Al abrirlo se muestra confirmación para unirse; con cupo queda inscrito. Al llegar al máximo se bloquean inscripciones. Invitaciones directas a amigos requieren aceptación; si aceptan sin cupo, no se inscriben. El organizador puede iniciar cuando quiera si se cumple el **mínimo**; fuera del rango no se permite iniciar.

### 6.3 Formatos

**Liga (8–20):** tabla única, todos contra todos una vez (método del círculo; con número impar descansa uno por jornada). Clasifican 4 (8–12 participantes) u 8 (13–20). Eliminatorias: semifinales y final (4) o cuartos, semifinales y final (8), emparejando 1.º vs último, 2.º vs penúltimo, etc.

**Eliminación directa pura (8–64):** cuadro directo; si no es potencia de dos, el sistema asigna *byes* a las mejores siembras. Siembra: manual u aleatoria (aleatoria por defecto). Quien tiene *bye* avanza sin jugar.

**Grupos + eliminación (8–32):** reparto aleatorio en grupos de 3 o 4, con diferencia de tamaño mínima y nunca menores de 3; el organizador puede modificarlos antes de iniciar. Todos contra todos por grupo; clasifican 2 por grupo. Clasificados ordenados por puntos, diferencia de goles y goles a favor; el organizador valida la siembra y solo entonces se genera el cuadro. Si no completa 4, 8 o 16, se asignan *byes*. Primera ronda: primeros vs segundos de otros grupos, evitando mismo grupo cuando sea matemáticamente posible.

**Comunes a eliminatorias de los tres formatos:** todas las rondas **a ida y vuelta, incluida la final**. Gana el marcador **global** (suma de goles; sin gol de visitante). Si empatan: **un partido adicional** que no admite empate; si empata, se repite hasta haber ganador. Los *byes* no son retiros.

**Tabla de fase regular:** victoria 3, empate 1, derrota 0. Desempate: puntos, diferencia de goles, goles a favor, resultado directo entre empatados y, como último recurso, sorteo determinista registrado.

### 6.4 Modalidades de avance
- **Ritmo Libre:** se genera toda la programación al iniciar; el siguiente partido de un jugador se habilita al confirmarse su anterior, sin depender de otros.
- **Por Jornadas:** la jornada siguiente se habilita solo cuando todos los partidos de la actual están disputados, reportados y confirmados.
- **Eliminatorias:** una ronda se habilita al resolverse los cruces que la alimentan; la vuelta, al confirmarse la ida; el partido adicional, al confirmarse ambos y persistir el empate.
- No hay fechas, horarios ni plazo máximo por partido; los participantes coordinan por su cuenta.

### 6.5 Estados del torneo
**Borrador** (configuración incompleta) → **Abierto** (al guardar configuración válida) → **En curso** (al iniciar) → **Finalizado** (automático al completarse todos los partidos; declara campeón sin aprobación manual). **Cancelado** lo establece solo el organizador (con advertencia y confirmación), incluso iniciado el torneo. Todos los cambios son automáticos salvo la cancelación.

### 6.6 Retiro, expulsión y descalificación
- **Liga y fase de grupos:** los partidos jugados permanecen en el historial; sus resultados y puntos **dejan de contar para la tabla**; los pendientes se cancelan y salen del calendario; **nunca** se crean marcadores ni puntos ficticios.
- **Eliminatorias (cualquier formato):** el rival avanza por **W.O.**; los partidos jugados conservan su resultado real; no se inventan marcadores.
- Los partidos realmente disputados siguen aportando a las estadísticas personales del retirado.

### 6.7 Generación
Al iniciar, el sistema genera todas las jornadas y partidos de la fase regular. El cuadro eliminatorio se genera al iniciar (eliminación directa) o al validar la siembra tras los grupos. Envía **un aviso agrupado** por inicio de fase a moderadores (no uno por partido).

## 7. Dominio: partidos, evidencias y disputas

**Estados de partido:** `bloqueado` → `pendiente` → `reportado` → `confirmado`; ramas `en_disputa` (desde reportado), `cancelado` (retiro) y `wo`. `confirmado` es **inmutable**.

**Reporte:** cualquiera de los dos jugadores reporta marcador con **1 o 2 imágenes obligatorias** (JPG, JPEG, PNG; sin video). El rival recibe notificación y **confirma** o **disputa** (motivo breve). Sin respuesta en **24 horas** desde el reporte, se **confirma automáticamente**. Quien reportó puede editar mientras el rival no haya actuado; la edición actualiza la notificación y **reinicia el plazo de 24 h**. Un moderador puede registrar o corregir un resultado directamente (sin evidencia obligatoria) mientras no esté confirmado; el registro directo queda confirmado de inmediato.

**Disputa:** un moderador distinto de los jugadores revisa evidencias y fija el marcador final, que queda confirmado y bloqueado.

**Bloqueo:** un resultado confirmado queda bloqueado permanentemente; ni organizador ni colaboradores pueden modificarlo. Refuerza en servicio **y** en BD (trigger).

**Auditoría:** toda acción sobre resultados (reportar, editar, confirmar, disputar, resolver, cambio administrativo) registra quién, qué y cuándo en `audit_log`. La auditoría **se conserva** aunque se borren las imágenes.

**Evidencias en R2:** bucket **privado**; acceso por **URL firmadas de corta duración** emitidas tras verificar permisos; se valida el tipo MIME real, tamaño y cantidad en el backend; nombres de objeto aleatorios; visibles solo para los dos jugadores y moderadores autorizados. Se conservan mientras el torneo esté En curso o Cancelado y se **eliminan automáticamente al pasar a Finalizado**.

## 8. Cuentas y perfiles

- Registro e inicio de sesión con correo y contraseña; cuenta obligatoria para participar. Verificación de correo en el registro.
- Usuario: `username` obligatorio, único (insensible a mayúsculas) y editable si está disponible; `public_id` único autogenerado (el usuario no lo elige); nombre de liga opcional; foto opcional (JPG, JPEG, PNG, WebP; máx. 5 MB). **El correo es privado**, nunca se muestra.
- Perfil público (usuario, liga, foto, estadísticas, historial) visible para cualquiera. Búsqueda por username. Lista de amigos privada del propietario.
- Amistad: solicitud, aceptar o rechazar, listar, eliminar. Sin bloqueo.
- Cambio de correo: verificar la nueva dirección antes de aplicar.
- Eliminación de cuenta: confirmación con contraseña y correo, espera de **7 días** cancelable iniciando sesión. Un participante puede eliminarla con partidos pendientes (se aplica retiro). Un organizador debe antes **transferir** sus torneos activos a un colaborador o participante existente. Al ejecutarse se eliminan datos personales y se conserva lo necesario para resultados, mostrando «Usuario eliminado».
- Historial: torneos en que participó y resultado (campeón, subcampeón, posición final o retirado).

## 9. Notificaciones y estadísticas

**Notificaciones (solo dentro de la plataforma, sin correo ni push):** campana con contador de no leídas; historial; marcar una o todas como leídas; eliminar las leídas; al pulsar, abrir el partido o sección.

Destinatarios: nuevo partido → sus dos jugadores; resultado reportado → rival y moderadores; confirmación o disputa → jugadores implicados y moderadores que deban intervenir; nueva jornada o fase → participantes afectados; invitaciones y solicitudes → destinatario. **Nadie recibe información privada de disputas ajenas.**

**Estadísticas por torneo:** máximo goleador, mejor defensa (menos goles recibidos), campeón y subcampeón. Sin métricas extra.
**Estadísticas del perfil:** torneos disputados y ganados; partidos jugados, ganados, empatados y perdidos; porcentaje de victorias; goles marcados y recibidos; diferencia de goles. Solo cuentan torneos **Finalizados**; los cancelados no. Se calculan sobre partidos confirmados.

**Resumen final:** campeón, subcampeón, clasificación, estadísticas, reconocimientos, resultados destacados y cuadro (en formatos eliminatorios). Cualquier integrante puede compartirlo.

## 10. Seguridad (obligatoria)

- **Contraseñas:** hash **Argon2id** con parámetros adecuados. Nunca texto plano.
- **JWT:** access token de vida corta + **refresh token con rotación**, guardado en BD solo como hash y vinculado a sesión/dispositivo. La reutilización de un refresh revocado invalida toda la familia de sesión.
- **Tokens en cliente:** web (web del cliente y AdminWeb): refresh en cookie HttpOnly + Secure + SameSite, access en memoria. App móvil: almacenamiento seguro del dispositivo (Capacitor). Nunca en logs, mensajes de error ni `localStorage`.
- **Fuerza bruta:** límite de intentos fallidos con bloqueo **temporal**; respuestas que no revelen si el correo existe.
- **Rate limiting** en login, registro y recuperación de contraseña; límites generales en la API.
- **Validación y sanitización** de toda entrada. Autorización por rol comprobada **en el backend** en cada operación protegida; nunca confiar en controles visuales.
- **HTTPS** en entornos desplegados, `helmet`, CORS restringido a orígenes propios.
- **Recuperación de contraseña, verificación y cambio de correo:** enlaces o códigos temporales de un solo uso, guardados como hash, con expiración y protección contra reutilización. Cambiar la contraseña revoca las sesiones.
- **Cierre de sesión:** dispositivo actual y todos los dispositivos.
- Secretos solo por variables de entorno.

## 11. Modelo de datos (PostgreSQL)

UUID, `created_at/updated_at` en UTC, claves foráneas con restricciones e índices en columnas de consulta. Tablas: `users`, `sessions`, `action_tokens`, `login_attempts`, `friendships`, `tournaments`, `tournament_members`, `tournament_invitations`, `stages`, `groups`, `group_members`, `rounds`, `ties`, `matches`, `match_reports`, `evidence_files`, `disputes`, `audit_log`, `notifications`, `moderation_delegations`.

Restricciones clave: marcador no negativo; un solo reporte activo por partido; usuario inscrito una vez por torneo; nunca más participantes que el máximo; `username` y `email` únicos; `invite_code` único; partido `confirmado` inmutable. Migraciones versionadas; nunca modifiques una migración ya aplicada.

## 12. Tareas programadas (`FCMatch-Backend`, `src/jobs`, idempotentes)

1. Auto-confirmar reportes con plazo de 24 h vencido.
2. Ejecutar eliminaciones de cuenta tras 7 días.
3. Borrar evidencias en R2 cuando el torneo pasa a Finalizado.
4. Limpiar tokens y bloqueos expirados.

Registran su ejecución y toleran reinicios y ejecuciones duplicadas.

## 13. Clientes (Web Cliente, App móvil y AdminWeb)

Comunes a todos: guards por sesión y rol, interceptores para JWT y errores; mostrar acciones solo cuando procedan, pero **el backend decide**; interfaz en español; fechas UTC convertidas a la zona del usuario; estándar de interfaz e identidad visual de la sección 2.3.

### 13.1 Pantallas del cliente (Web Cliente y App móvil)

- **Públicas:** inicio de sesión, registro, recuperar contraseña, verificar correo, unirse por enlace o código, vista de espectador.
- **Autenticadas:** inicio (mis torneos y unirse por código), crear torneo, **vista general única del torneo** (resumen, partidos con filtros por participante/jornada/estado, tablas o grupos, cuadro, estadísticas, participantes, administración del torneo según rol), detalle de partido (reportar, confirmar, disputar, evidencias), amigos y solicitudes, búsqueda de usuarios, perfil público e historial, notificaciones, ajustes de cuenta (perfil, correo, contraseña, sesiones, eliminar cuenta, **alternar tema**).
- **No crear** secciones «Mis partidos» ni «Historial» separadas; se resuelve con filtros en la vista general.

### 13.2 Web Cliente (Angular + Ionic)

- Para los usuarios finales (organizadores, participantes y espectadores). **No es la AdminWeb.**
- Componentes de **Ionic** con estilos responsivos compartidos. Navegación: barra superior y rutas por característica. El enlace de espectador se abre aquí.
- Vive en `FCMatch-Frontend/web/`.

### 13.3 App móvil, `FCMatch-Frontend/mobile/` (Angular + Ionic + Capacitor)

- Prioriza los **componentes nativos de Ionic** y el sistema de diseño compartido. Capacitor se reserva para las funciones y compilaciones móviles.
- Navegación: pestañas inferiores (Torneos, Amigos, Notificaciones, Perfil).

### 13.4 FCMatch-AdminWeb (Angular + Ionic)

- Panel del **administrador de plataforma** (el propietario), **enfocado en la administración y gestión del sistema**. **No es la Web Cliente**: no reutilices sus pantallas ni su navegación; los organizadores y participantes nunca entran aquí.
- Componentes de **Ionic** y sistema de diseño compartido. Acceso restringido al rol de administrador de plataforma, verificado en el backend en cada operación. Incluye inicio de sesión y **alternar tema**.
- **Funciones concretas pendientes de definir en el DERCAS.** No implementes ninguna función de administración hasta que el DERCAS o el usuario la especifiquen; si te piden construir el panel, empieza solo por autenticación, guard de rol y la estructura base, y pregunta cuáles son las funciones.
- Navegación: barra superior o lateral con rutas por característica.

## 14. Sistema de diseño y modo oscuro

**Modo oscuro es el predeterminado** y se puede alternar a claro (Dark Mode Toggle). La preferencia se guarda en el dispositivo y se aplica antes del primer render para evitar parpadeos. El tema se controla con el atributo `data-theme="dark|light"` en `:root`.

### 14.1 Variables obligatorias

Definidas **únicamente** en `src/styles/themes.scss` de cada cliente (archivo idéntico en `FCMatch-AdminWeb` y `FCMatch-Frontend`, ver 3.3):

```scss
:root,
:root[data-theme="dark"] {
  --bg-primary:    #0B0F19; /* Azul Noche Oscuro */
  --bg-surface:    #1E2430; /* Superficie / Tarjetas */
  --color-primary: #00FF87; /* Verde Neón Deportivo */
  --color-secondary: #3B82F6; /* Azul Eléctrico */
  --text-primary:  #F9FAFB;

  --status-success: #10B981; /* Confirmado / Victoria */
  --status-warning: #F59E0B; /* Pendiente / Reportado */
  --status-danger:  #EF4444; /* En Disputa / Derrota */
  --status-locked:  #6B7280; /* Bloqueado */
}

:root[data-theme="light"] {
  --bg-primary:    #F3F4F6;
  --bg-surface:    #FFFFFF;
  --color-primary: #059669; /* Verde Esmeralda */
  --color-secondary: #2563EB;
  --text-primary:  #111827;

  --status-success: #059669;
  --status-warning: #D97706;
  --status-danger:  #DC2626;
  --status-locked:  #6B7280;
}
```

### 14.2 Colores de estado de partido

| Estado | Variable | Oscuro / Claro |
|---|---|---|
| Confirmado / Victoria | `--status-success` | `#10B981` / `#059669` |
| Pendiente / Reportado | `--status-warning` | `#F59E0B` / `#D97706` |
| En Disputa / Derrota | `--status-danger` | `#EF4444` / `#DC2626` |
| Bloqueado | `--status-locked` | `#6B7280` en ambos |

Mapeo: `confirmado` y victoria → success; `pendiente` y `reportado` → warning; `en_disputa` y derrota → danger; `bloqueado` → locked. Empate, `cancelado` y `wo` usan tokens neutros derivados.

### 14.3 Tokens derivados permitidos

Para contraste y detalles que las variables obligatorias no cubren, el agente puede definir (solo en `themes.scss`, para ambos temas) tokens neutros como `--text-secondary`, `--border-color` y `--color-on-primary` (texto sobre fondos `--color-primary`: oscuro en modo oscuro, claro en modo claro). Verifica contraste legible (objetivo WCAG AA) y documenta los valores elegidos en `docs/decisiones.md`.

### 14.4 Integración con Ionic en los tres clientes

**Web Cliente, AdminWeb y app móvil (Ionic):** mapea las variables de Ionic a las propias, sin hex en componentes. Comparte los componentes reutilizables y estilos responsivos del sistema de diseño; el tema alterna con `data-theme`:

```scss
:root {
  --ion-background-color: var(--bg-primary);
  --ion-card-background: var(--bg-surface);
  --ion-text-color: var(--text-primary);
  --ion-color-primary: var(--color-primary);
  --ion-color-secondary: var(--color-secondary);
}
```

### 14.5 Regla de estilos (inquebrantable)

- **Prohibido** escribir colores hexadecimales, `rgb()`, `hsl()` o nombres de color fijos en `.scss`, `.css`, plantillas HTML, estilos en línea o TypeScript de componentes. Todo color se consume con `var(--...)`.
- La **única excepción** es `src/styles/themes.scss` (definición de los temas) en cada cliente.
- Los gráficos, iconos SVG y cualquier librería de UI deben recibir sus colores desde variables CSS (p. ej. `fill="currentColor"` o `var(--...)`).
- El cambio de tema debe ser **dinámico**, sin recargar la página.
- Configura `stylelint` con `color-no-hex` y un lint equivalente para plantillas, y haz que falle el CI ante cualquier incumplimiento fuera de `themes.scss`.
- Toda pantalla nueva debe revisarse en **ambos temas** antes de darse por terminada.

## 15. Pruebas y calidad

- Pruebas unitarias obligatorias para: generación de calendarios y cuadros (con *byes*), reparto de grupos de 3 o 4, tablas y desempates, series ida/vuelta y partido adicional, W.O. y retiros, ciclo de vida de partidos (incluida confirmación automática a 24 h), permisos por rol y conflictos de interés, y flujo de cuenta (eliminación a 7 días, refresh tokens).
- Pruebas de integración de la API con base de datos de prueba.
- Cobertura mínima sobre reglas de negocio críticas; `eslint` y `prettier` sin errores; TypeScript en modo estricto.
- Rendimiento: listados paginados, índices en consultas frecuentes (vista general, tablas, cuadro).
- Concurrencia: confirmaciones y resoluciones protegidas contra doble ejecución (restricciones de BD o bloqueo optimista).

## 16. Flujo de trabajo del agente

1. Lee el DERCAS y este archivo antes de empezar una tarea.
2. Trabaja por módulo y por vertical (migración → repositorio → servicio → controlador → pruebas → cliente).
3. Commits pequeños y descriptivos (Conventional Commits); ramas por funcionalidad; nunca subas secretos. El flujo completo de ramas, publicación y Pull Request está en la sección 19.
4. Ejecuta lint, pruebas y build antes de dar una tarea por terminada, verifica los cambios y presenta un resumen al usuario.
5. Registra en `docs/decisiones.md` cada decisión de diseño no cubierta por el DERCAS.
6. Si detectas una contradicción real con el DERCAS, detente en ese punto, explica el conflicto y pregunta; en cualquier otro caso, continúa.

## 17. Decisiones asumidas (corregibles por el usuario)

1. Borrador pasa a Abierto al guardar configuración válida.
2. Editar un reporte reinicia el plazo de 24 h.
3. Registros directos de moderadores: sin evidencia obligatoria, confirmados al instante; corregibles solo antes de confirmarse.
4. Desempates adicionales: resultado directo y sorteo determinista registrado.
5. Siembra de eliminación directa: manual o aleatoria (aleatoria por defecto).
6. El partido adicional de desempate no admite empate.
7. Transferencia de torneo: a un colaborador o participante existente.
8. Cuenta eliminada: se muestra «Usuario eliminado» en datos históricos.
9. Disputas: motivo breve, sin contraevidencia.
10. Tokens de diseño derivados (`--text-secondary`, `--border-color`, `--color-on-primary`) definidos por el agente en `themes.scss`.
11. `FCMatch-AdminWeb` es el panel del administrador de plataforma (propietario), enfocado en la administración y gestión del sistema; sus funciones exactas están pendientes de definir.
12. La Web Cliente y la app móvil (Angular + Ionic) viven en el mismo repositorio `FCMatch-Frontend`, en las carpetas `web/` y `mobile/`; junto a AdminWeb comparten el sistema de diseño, componentes y estilos responsivos, manteniendo aplicaciones, rutas y navegación independientes. Capacitor se utiliza en móvil.

## 18. Lista de verificación antes de entregar una tarea

- [ ] Respeta el DERCAS y no añade funcionalidades fuera de alcance.
- [ ] La lógica y los permisos están en el backend, en la capa correcta.
- [ ] Entradas validadas, errores uniformes, sin datos sensibles en logs.
- [ ] Sin colores fijos en vistas; funciona en modo oscuro y claro.
- [ ] Usa componentes nativos de Ionic y el sistema de diseño compartido en los tres clientes, con la identidad visual y el logo oficiales.
- [ ] Pruebas, lint y build en verde.
- [ ] Decisiones nuevas documentadas.
- [ ] Herramientas y dependencias en su última versión estable.
- [ ] Resumen presentado al usuario y aprobación recibida **antes** de publicar en GitHub.

## 19. Repositorios y flujo de Git/GitHub

### 19.1 Repositorios oficiales

| Repositorio | Contenido | URL |
|---|---|---|
| FCMatch-AdminWeb | Panel administrativo web (AdminWeb) | https://github.com/Zeta-07/FCMatch-AdminWeb.git |
| FCMatch-Frontend | Web Cliente (`web/`) y aplicación móvil (`mobile/`) | https://github.com/Zeta-07/FCMatch-Frontend.git |
| FCMatch-Backend | Servidor y API (Backend) | https://github.com/Zeta-07/FCMatch-Backend.git |

Identifica automáticamente a qué repositorio pertenece cada archivo modificado. Si una tarea afecta a varios repositorios, gestiona los cambios de **cada uno por separado** (rama, commits y Pull Request propios).

### 19.2 Reglas obligatorias

1. **Finalización de tareas:** al completar una tarea, ejecuta las pruebas correspondientes, verifica los cambios y presenta un resumen al usuario. Si alguna prueba falla, **no publiques**: informa del fallo y propón una solución.
2. **Aprobación previa:** no publiques cambios en GitHub sin recibir antes la **aprobación explícita del usuario**.
3. **Ramas:** antes de publicar, sincroniza `develop` del repositorio correspondiente y crea una rama de trabajo con el formato `feature/nombre-tarea`, `fix/nombre-error` o `refactor/nombre-cambio`.
4. **Commits:** descriptivos y con *Conventional Commits*. Ejemplos:
   - `feat: implementar autenticación de usuarios`
   - `fix: corregir validación de productos`
   - `refactor: optimizar servicio de pedidos`
5. **Publicación:** una vez aprobada la tarea, haz `push` de la rama de trabajo al repositorio remoto correspondiente.
6. **Pull Request:** créalo automáticamente en GitHub con:
   - Rama de origen: la rama de trabajo. Rama de destino: `develop`.
   - Título descriptivo.
   - Resumen de los cambios realizados.
   - Pruebas ejecutadas y sus resultados.
   - Referencia a la tarea implementada (requisito del DERCAS o *issue* de GitHub, el que corresponda).
7. **Asignación:** asigna el Pull Request a `Zeta-07` como responsable y solicítale la revisión como *reviewer*, siempre que GitHub permita ambas operaciones. Si alguna falla, crea el Pull Request igualmente e informa al usuario.
8. **Aprobación del Pull Request:** deja el Pull Request **abierto** y espera la revisión y aprobación del usuario antes de realizar cualquier integración. La aprobación para publicar (regla 2) y la aprobación del Pull Request son **dos momentos distintos**.

### 19.3 Restricciones (estrictamente prohibido)

- Hacer commits directamente sobre `main` o `develop`.
- Ejecutar *merges* automáticos.
- Usar *force push* sobre ramas protegidas.
- Hacer *rebase* sobre ramas compartidas.
- Eliminar ramas sin autorización.
