# Skills de OpenCode — preparación posterior a Fase 0

Fecha: 09/11/2026. OpenCode comprobado: **v2.2.6**. El propietario aprobó la instalación y su publicación en los tres repositorios. No se inicia Fase 1.

## Contexto y alcance

Se revisaron `AGENTS.md`, DERCAS v1.1 y `Contexto/plan para el desarrollo de la app.md`. El plan conserva una fotografía inicial anterior a la implementación: sus frases «todavía no existe código» o MCP pendientes son históricas, no el estado actual. La Fase 0 ya está publicada. Se conserva el stack, la API única, las capas del backend, los temas y el alcance de las fases.

No se cambian dependencias npm, código de negocio, bases de datos, permisos de herramientas, credenciales, configuración global, plugins ni servidores MCP. La única ampliación de CI comprueba integridad del catálogo; no cambia el comportamiento de la API ni de los clientes.

## Inventario y selección

| ID instalado                       | Procedencia                                                                                                                                                                       | Utilidad y límite                                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `angular-developer`                | [Angular/Google, oficial](https://github.com/angular/skills/tree/a4b55f012e98da6ed30d45381db1476680d270c5/angular-developer)                                                      | Angular moderno, signals, DI, HTTP, rutas, formularios y pruebas. No autoriza otra biblioteca UI ni crear una app nueva.                                                                                                   |
| `ionic-design`                     | [Capgo, comunidad especializada](https://github.com/cap-go/capacitor-skills/tree/e90bb5639130e34387f00bf0a95c6d47e4a2ebb8/skills/ionic-design)                                    | Componentes Ionic 9, CSS variables, navegación y formularios. Los ejemplos React/Vue no se copian a Angular; conservar nuestro tema data-theme. No es una skill oficial de Ionic.                                          |
| `capacitor-best-practices`         | [Capgo, comunidad especializada](https://github.com/cap-go/capacitor-skills/tree/e90bb5639130e34387f00bf0a95c6d47e4a2ebb8/skills/capacitor-best-practices)                        | Configuración, versiones compatibles, permisos y disponibilidad de plugins. No incorpora Capgo, live updates, betas, compilaciones nativas ni migraciones.                                                                 |
| `supabase-postgres-best-practices` | [Supabase, oficial de su autor](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase-postgres-best-practices)                   | PostgreSQL en cualquier entorno: esquema, índices, pools, transacciones, bloqueos y consultas. No instala Supabase ni reemplaza los permisos del backend.                                                                  |
| `playwright-cli`                   | [Microsoft/Playwright, oficial](https://github.com/microsoft/playwright-cli/tree/9166133dd68a4ba30ac959fade685e7c907e8629/skills/playwright-cli)                                  | Automatización, inspección y depuración de pruebas web. Reutiliza Playwright existente; sin instalación global ni MCP adicional.                                                                                           |
| `security-review`                  | [GitHub Awesome Copilot, colección comunitaria curada por GitHub](https://github.com/github/awesome-copilot/tree/e45ee935ed0b57992ad7b4e07dbea5cb534786f0/skills/security-review) | Revisión de seguridad TypeScript/Node/Express y frontend: entradas, SQLi, XSS, JWT, permisos, secretos y dependencias. Propone parches sin aplicarlos automáticamente. No es un escáner ejecutable ni certifica seguridad. |

**Existentes conservadas:** `generate-design`, `manage-design-system` y `upload-to-stitch`, desde `google-labs-code/stitch-skills`, sin reinstalarlas ni modificarlas. OpenCode ofrece además skills integradas (`opencode`, `report` y, en el catálogo API de este entorno, `browser`); tampoco se duplicaron.

**Catálogo publicado:** seis skills en una única copia canónica en `FCMatch-Backend/.opencode/skills/`. Las tres de Stitch ya instaladas se conservan localmente y no se incluyen en esta publicación. Un clon aislado recibe las seis aprobadas, además de las skills integradas en OpenCode; no necesita las tres locales de Stitch para cargar el catálogo.

### Candidatas descartadas

- [Ionic oficial](https://github.com/ionic-team/capacitor-skills): orientadas a plugins nuevos, migraciones Cordova/UIScene y OutSystems; no corresponden a la preparación actual ni al Capacitor 8.6 ya existente.
- `angular-new-app`: no se van a crear aplicaciones nuevas.
- `nodejs-backend-patterns` de `wshobson/agents`: se revisaron el manifiesto y las referencias. Los ejemplos incluyen bcrypt, refresh sin rotación/persistencia y SQL dinámico por claves de objeto sin allowlist. No se instaló; para Node/Express se prioriza la revisión de seguridad y la documentación oficial, no una plantilla incompatible con el DERCAS.
- `security-review` de Sentry: no se instaló para evitar duplicar ID/función; se eligió la alternativa de GitHub. Su exclusión general de rutas que requieren autenticación no resulta adecuada para nuestros permisos por torneo.
- Catálogos completos, generadores React/Tailwind, Supabase completo, skills de memoria, despliegue, pagos, push y creación de skills: innecesarios, duplican Engram/Stitch o quedan fuera del alcance.

La búsqueda web general devolvió HTTP 402; la investigación continuó directamente en la documentación oficial y los repositorios/API de GitHub. No se atribuye a resultados de buscador una selección que no se pudo consultar.

## Instalación, integridad y permisos

Procedimiento compatible con la [documentación oficial de skills de OpenCode V2](https://opencode.ai/docs/skills): copiar el directorio original con `SKILL.md` y sus referencias a una fuente de skills local. No se necesita ejecutar un instalador remoto.

1. Se descargó cada fuente desde un **commit SHA completo**, no desde una rama flotante para la instalación.
2. Se prepararon los archivos fuera de los repositorios en un directorio temporal de revisión. Ese directorio, las sesiones del navegador y sus resultados no se publican.
3. Se revisaron los seis manifiestos, sus comandos/permisos declarados, inventario completo y referencias relevantes a temas, configuración, datos y seguridad. Se buscaron instrucciones de instalación, ejecución, acceso a credenciales, delegación y transferencia de datos. No se ejecutaron los ejemplos de terceros ni se afirma una auditoría formal de cada línea.
4. Se verificó el hash Git blob de cada descarga contra el árbol del commit, y se registró SHA256 por archivo. Esto acredita correspondencia e integridad con la fuente consultada, no una firma independiente del autor.
5. Se instalaron **113 archivos de texto**: Markdown, dos metadata JSON y las licencias raíz disponibles. No hay scripts, ejecutables, symlinks, hooks, agentes ni archivos de configuración de plugins en las seis skills instaladas. El contenido original no se adaptó ni reescribió. Angular declara MIT y copyright Google en el frontmatter; las otras fuentes incluyen licencia raíz MIT o Apache-2.0 copiada con la skill.
6. `docs/skills-sources.json` fija origen, revisión y directorio. `.opencode/skills-lock.json` registra todos los archivos. `scripts/manage-opencode-skills.mjs --check` verifica hashes, archivos extra/faltantes y correspondencia del catálogo HTTP. El instalador rechaza sobrescribir una skill existente. `.gitattributes` conserva los bytes de terceros sin conversión CRLF; Prettier no modifica las fuentes vendorizadas.

`allowed-tools` de Playwright es metadato de portabilidad; OpenCode V2 no lo convierte en permisos. **No se añadieron reglas allow para shell, red, archivos ni MCP.** La política [skills-policy.md](skills-policy.md) mantiene DERCAS, Argon2id, rotación de sesiones, tokens fuera de localStorage, temas corporativos y autorización previa a cualquier efecto real.

Las instrucciones y referencias de seguridad contienen ejemplos intencionados de código vulnerable y expresiones de secretos ficticios. No se ejecutan ni se utilizan como valores reales; no deben confundirse con credenciales del proyecto.

La revisión previa a publicación produjo una única alerta de patrón en `security-review/references/secret-patterns.md`, línea 161: un identificador AWS público de ejemplo dentro de una sección didáctica. Se contrastó con el original fijado y no es una credencial de FCMatch. No se modifica el original ni se desactiva globalmente la detección de secretos.

## Configuración y carga

### Una sola fuente compartida mediante GitHub

El repositorio Backend aloja el catálogo como infraestructura de desarrollo, no como parte de la API. Los originales, sus licencias, el lock y esta guía existen una sola vez. Frontend y AdminWeb consumen ese catálogo mediante la función HTTP de OpenCode V2, sin imports de aplicación entre repositorios ni copias vendorizadas adicionales.

- **Backend:** descubrimiento nativo de `.opencode/skills` y `instructions: ["docs/skills-policy.md"]`.
- **Frontend y AdminWeb:** `skills` apunta a `https://raw.githubusercontent.com/Zeta-07/FCMatch-Backend/<commit-fijado>/.opencode/skills/`; `instructions` apunta a `docs/skills-policy.md` de la misma revisión. El SHA completo se guarda en cada `opencode.json`. No se usan rutas del equipo, rutas a repositorios hermanos, tokens en URL ni una rama flotante.
- `.opencode/skills/index.json` enumera las seis skills, su versión derivada de hashes y los 113 archivos completos. Los destinos son relativos y del mismo origen. OpenCode los almacena en su caché, no en los repositorios consumidores.
- Los tres repositorios son públicos. La descarga no requiere credenciales GitHub; Stitch continúa usando su propia variable de entorno. En otros equipos se requiere OpenCode V2 y acceso HTTPS a GitHub para la primera descarga. No se promete una descarga nueva sin red ni acceso a un repositorio privado sin autenticación.

Para actualizar: revisar una nueva versión, actualizar originales y lock, ejecutar `node scripts/manage-opencode-skills.mjs --catalog` y `npm run skills:check`, publicar Backend y cambiar **explícitamente** el SHA del catálogo en los consumidores mediante PR. No hace falta un cuarto repositorio ni instalar paquetes. No se distribuye configuración personal/global de OpenCode o Engram.

La configuración MCP de Engram y Stitch se preservó. No se migraron formatos ajenos ni se tocaron claves. La configuración global no se modificó.

OpenCode V2 detecta cambios automáticamente. Si el catálogo aún se está inicializando, consultar de nuevo desde la ubicación correcta una vez cargada; `/reload` fuerza la recarga sin reiniciar el proceso. No es necesario reinstalar las skills. En las pruebas de API se usó `location[directory]` con rutas normalizadas de Windows; la CLI sin ubicación explícita consultó inicialmente el directorio del usuario, no FCMatch.

Uso desde el chat: mencionar `@angular-developer`, `@ionic-design`, `@capacitor-best-practices`, `@supabase-postgres-best-practices`, `@playwright-cli` o `@security-review`. El agente también las carga cuando la tarea es pertinente. Instalar/cargar una skill no autoriza ejecutar todos sus workflows.

## Verificaciones realizadas

- `opencode --version`: v2.2.6.
- API `/api/skill`: lectura de ID, descripción, contenido y ruta de los manifiestos; sin IDs duplicados.
- Carga real con la herramienta `skill`: **las seis nuevas skills cargaron correctamente** con su directorio base y referencias.
- Configuración compartida comprobada mediante `/api/config` en el espacio de trabajo, Backend, `Frontend/web`, `Frontend/mobile` y AdminWeb; catálogo validado por ubicación.
- Integridad: **113 archivos** idénticos a la fuente fijada. Se comprobaron 72 enlaces locales fuera de bloques de código: 71 destinos presentes y un enlace a una captura de ejemplo `settings-after.png` que el usuario generaría al usar esa guía; no falta una referencia necesaria.
- Playwright CLI existente disponible. La apertura predeterminada con Chrome falló porque Chrome no está instalado; **sin instalar Chrome**, se utilizó el Chromium ya descargado por Playwright con `browser.launchOptions.executablePath` y `headless: true` en un JSON temporal. Apertura de `about:blank`, contenido de prueba efímero, clic por rol, título y snapshot: correctos. Se cerró únicamente la sesión `fcmatch-skills-check`. No se usó el perfil personal ni se guardaron cookies.
- Engram: `mem_current_project` resolvió `fcmatch`; decisiones de esta instalación se registran mediante MCP.
- Stitch: MCP conectado y llamada real de solo lectura `list_projects` satisfactoria; cero proyectos disponibles. No se generaron pantallas ni se cambiaron proyectos.
- Durante el trabajo se notificó un reinicio del servidor OpenCode y la cancelación de los cuatro servidores de desarrollo de la revisión anterior. Las skills persistieron; no se reinstalaron y Engram/Stitch volvieron a estar conectados. No se atribuye una causa al reinicio. Este cambio de procesos no es una modificación de las aplicaciones.
- No se ejecutó una auditoría completa de las aplicaciones ni pruebas nativas como parte de instalar skills. No se cambió funcionalidad existente; no hay compilación de aplicación nueva que validar.

## Reproducir comprobaciones no invasivas

Desde un clon de `FCMatch-Backend` con Node compatible:

```powershell
node --check scripts/manage-opencode-skills.mjs
node scripts/manage-opencode-skills.mjs --check
npm run skills:check
opencode mcp list
$directory = [Uri]::EscapeDataString((Resolve-Path .).Path)
opencode api get "/api/skill?location[directory]=$directory"
```

Desde cada cliente: `npx --no-install playwright cli --help`. Para usar Chromium sin Chrome, pasar un `--config` temporal como en la verificación; no crear un perfil persistente ni instalar navegadores globales automáticamente.

Clonar el repositorio ya aporta los archivos revisados; no hace falta volver a instalarlos. Para preparar una nueva selección desde upstream: `node scripts/manage-opencode-skills.mjs --stage <directorio-nuevo>`. Tras revisión, `--install-reviewed <directorio-revisado>` solo admite destinos inexistentes; después generar el catálogo con `--catalog`. **No ejecutar install sobre esta instalación existente.** El script es una utilidad de instalación/verificación, no una skill personalizada.

## Referencias

- https://opencode.ai/docs/skills
- https://opencode.ai/docs/config
- https://opencode.ai/docs/api
- https://angular.dev/ai/agent-skills
- Fuentes y revisiones exactas: `docs/skills-sources.json` y `.opencode/skills-lock.json`.
