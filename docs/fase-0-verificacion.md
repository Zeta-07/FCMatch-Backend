# FCMatch — Informe de verificación de Fase 0

Verificación local original: 04/11/2026. Revisión de publicación autorizada: 05/11/2026. Alcance: exclusivamente los diez pasos de Fase 0, con el cambio tecnológico autorizado a Angular + Ionic en los tres clientes. Este es el informe único y versionado para los tres repositorios oficiales.

## Resultado

**Base técnica implementada y verificada localmente.** API y los tres clientes ejecutables, PostgreSQL real, configuración por entorno, diseño compartido y controles técnicos satisfactorios. **El propietario confirmó personalmente que Engram y Google Stitch funcionan correctamente**; ese punto está resuelto y no se repite su comprobación. La conexión externa a R2 sigue pendiente por la elección de entorno local.

No se implementó Fase 1 ni ninguna operación de cuentas, torneos o administración del propietario. El propietario autorizó guardar y publicar la Fase 0 en los tres repositorios, inicializar `main`, `develop` y `feature/fase-0` con un ancestro común y abrir PR hacia `develop` únicamente tras comprobar CI satisfactorio. No autorizó fusionar los PR. Los resultados remotos se registrarán en este informe cuando estén comprobados.

## Diez pasos

1. **Repositorios:** consultados y clonados los tres repositorios oficiales; no había ramas ni commits remotos ni código previo local. Verificado.
2. **Versiones:** Node 26.13.0 LTS, npm 12.2.1, Git 2.56.0.windows.4, PostgreSQL 18.6 y Engram 3.6.2 locales. Angular 22.2.4, Ionic 9.0.10 y Capacitor 8.6.0. VS Code 1.145.0 coincide con su canal estable consultado. Excepción compatible TypeScript 6.0.3 documentada.
3. **API y clientes:** Express + TypeScript estricto; clientes Angular + Ionic separados. Rutas técnicas propias: `/estado`, `/inicio`, `/sistema`. Capacitor configurado solo en móvil. Build y ejecución verificados.
4. **PostgreSQL y migraciones:** instancia local loopback `5433`, bases desarrollo/pruebas separadas, usuario de aplicación sin superusuario, esquema inicial y migraciones versionadas. PostgreSQL real, UTC y repetición de migraciones probados.
5. **OpenAPI y configuración:** `/api/v1/health`, modelos generados idénticos, errores uniformes en español, Zod y variables por entorno. Validación OpenAPI, tipos y pruebas HTTP satisfactorias.
6. **Calidad y CI:** ESLint, Stylelint, control de colores en plantillas, Prettier, build, pruebas de API/integración/navegador y workflows por repositorio. Controles locales satisfactorios; publicación autorizada y ejecución remota pendiente de resultado.
7. **Engram y Google Stitch:** instalados e integrados, con habilidades de diseño y clave externa al repositorio. Funcionamiento comprobado personalmente por el propietario; pendiente cerrado sin repetir pruebas.
8. **Logo:** copias binarias del original en los tres clientes y favicon referenciado al mismo PNG. Identidad por SHA256 y carga en navegador verificadas.
9. **Diseño compartido:** componentes, temas y estilos responsivos distribuidos sin imports entre repositorios. Oscuro inicial, claro persistente y aplicado antes del render. Sincronización por hash y recorridos desktop/móvil satisfactorios.
10. **Correo y almacenamiento:** transporte SMTP, capturador local y adaptador R2 con configuración validada y comprobador explícito. PostgreSQL/SMTP verificados; R2 configurado, pendiente de credenciales por elección del usuario.

## Pruebas y comandos ejecutados en la verificación local original

### Backend

- `npm run check`: satisfactorio.
- `npm run api:generate`: generación satisfactoria con `@hey-api/openapi-ts`.
- `npm run db:migrate`: aplicado el esquema de infraestructura.
- Cinco pruebas HTTP/configuración: health, indisponibilidad de base sin filtración, CORS y 404, JSON inválido y rate limit, validación sin secretos.
- Dos pruebas de integración: PostgreSQL real con migraciones repetibles/UTC/health, y mensaje SMTP realmente recibido por un capturador local.
- `npm run infra:check`: PostgreSQL y SMTP conectados; R2 informó pendiente explícitamente.
- `npm audit`: cero vulnerabilidades detectadas.

### Web Cliente, móvil y AdminWeb

- `npm run check` en cada paquete: lint, formato, build y dos recorridos Playwright satisfactorios.
- **Seis recorridos de navegador contra la API y PostgreSQL reales**: logo cargado, conexión, alternancia oscuro/claro, persistencia al recargar, ancho de 390 px sin desbordamiento, error por API inaccesible y reintento satisfactorio.
- Se validó adicionalmente el modo de contrato interceptado utilizado por CI en la Web Cliente: dos recorridos satisfactorios. Este modo está explícitamente separado de las verificaciones reales.
- `npm audit` en los tres clientes: cero vulnerabilidades detectadas.
- `npm ls --depth=0`: dependencias resueltas sin errores en móvil y AdminWeb.
- `npx cap doctor`: paquetes Capacitor 8.6.0 coinciden con las últimas versiones reportadas. No se añadieron ni compilaron proyectos nativos de otras fases.

### Integridad y MCP

- `node tooling/verify-phase0.mjs`: contexto, logo, temas, componentes y modelos coinciden en los tres clientes.
- `node FCMatch-Frontend/scripts/sync-design.mjs --check` y su variante para AdminWeb: satisfactorios.
- `git check-ignore`: secretos, estado local de PostgreSQL y configuración pública generada excluidos correctamente.
- `opencode mcp list`: Engram y Stitch conectados.
- `scripts/check-mcp.ts engram`: 27 herramientas, resolución de proyecto, escritura y recuperación por búsqueda de la observación técnica.
- `scripts/check-mcp.ts stitch`: 16 herramientas y `list_projects` autenticado. Sin imprimir credenciales ni datos de proyectos.
- Se guardaron en Engram por MCP la decisión tecnológica, los resultados comprobados, los pendientes y la restricción de no iniciar Fase 1.

Al terminar se detuvieron los procesos de API, capturador SMTP y PostgreSQL iniciados para las pruebas. Los datos locales y `.env` se conservan. Los comandos de los READMEs permiten iniciarlos de nuevo; no es necesario reinstalar herramientas ni repetir la creación de las bases.

## Criterios de cierre del plan

- **API ejecutable y conectada a PostgreSQL:** cumplido.
- **Clientes ejecutables y capaces de comunicarse con ella:** cumplido en los tres clientes, mediante pruebas reales de navegador.
- **Configuración documentada y reproducible:** scripts, `.env.example`, lockfiles, versiones y READMEs preparados. No se ha ejecutado una instalación desde cero en otra máquina ni CI remota.
- **Tema oscuro y claro operativo:** cumplido, con persistencia y revisión responsiva.
- **Comprobaciones técnicas iniciales satisfactorias:** cumplido para el entorno local. Engram y Google Stitch confirmados por el propietario; límites externos detallados a continuación.

## Pendientes y límites explícitos

1. **Engram y Google Stitch:** comprobados personalmente por el propietario. No queda pendiente de reinicio ni de nueva verificación para el cierre de Fase 0.
2. **R2:** falta bucket privado y credenciales de desarrollo. Se dejó preparado el adaptador; no se simula el servicio ni se afirma conectividad. El usuario eligió entorno local para esta entrega.
3. **CI remota y PR:** publicación autorizada el 05/11/2026. Los workflows se ejecutan al publicar las ramas; los PR se abrirán solo tras obtener resultados satisfactorios. Los enlaces y conclusiones comprobadas se incorporarán abajo.
4. **Compatibilidad:** TypeScript 7.0.2 está publicado, pero Angular compiler-cli 22 y typescript-eslint no lo admiten. Se usa 6.0.3, con explicación en los tres documentos de decisiones.
5. **Logo:** Angular emite en desarrollo un aviso de tamaño intrínseco superior al renderizado. Se conserva el PNG original, sin recortarlo ni modificarlo. No impide las compilaciones ni pruebas.
6. **Scripts opcionales npm:** npm 12 bloquea por defecto ciertos scripts de dependencias nativas opcionales; build y pruebas funcionaron con los paquetes precompilados disponibles. No se habilitó ejecución indiscriminada de scripts.

Las compilaciones Android/iOS, el despliegue público y el correo transaccional externo siguen en sus fases previstas. Las funciones exactas de AdminWeb no son necesarias para esta estructura técnica y no se inventaron.

## Huellas de integridad

- Logo original y sus tres copias: `c73ea6256cad87b326199f54637529c785e47e2ca655a84595809770dec9bc74`.
- `themes.scss` común: `2ff1cdd909509178d5cc69f0250281ac09fd13a2ee8ab537a1519d261de964ab`.
- Archivo oficial EDB descargado, hash observado: `e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2`. Se registra procedencia e integridad local; no se presenta como checksum publicado por el proveedor.
- Node, Git y Engram se comprobaron contra los hashes publicados por sus distribuidores y fijados en `tooling/bootstrap-windows.ps1`.

**La Fase 1 permanece sin autorización y no se ha iniciado.**

## Publicación y revisión remota

La revisión previa encontró los tres remotos oficiales vacíos, sin ramas ni commits. Se prepara un commit raíz de documentación por repositorio como ancestro común de `main` y `develop`; la implementación se conserva en `feature/fase-0`. No se sobrescribe trabajo remoto ni se utiliza force push. Las ramas base no incluyen workflows hasta la integración revisada de la Fase 0.

Se revisan los archivos candidatos antes de cada commit: `.env`, `.local/`, dependencias instaladas, compilaciones y resultados de pruebas permanecen excluidos. Las plantillas contienen ejemplos; Stitch referencia una variable de entorno y la contraseña de PostgreSQL en CI pertenece únicamente al servicio efímero.

Estado de ejecución remota: pendiente de publicación y comprobación. Este apartado se actualizará con los enlaces verificables, sin atribuir éxito a ejecuciones aún no terminadas.
