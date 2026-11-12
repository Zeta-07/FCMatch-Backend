# FCMatch Backend

## Fase 1 — Etapa 4: autenticación y sesiones

Las Etapas 1–3 aprobadas están publicadas en `feature/fase-1-identidad`, con PR #5 abiertos hacia develop. Etapa 4 añade login verificado, JWT/refresh rotatorio, logout actual/global y recuperación/cambio de contraseña con revocación; [informe y límites](docs/fase-1-etapa-4-verificacion.md). Publicación autorizada si las verificaciones pasan; no fusiones, perfiles/avatares, interfaces o Etapa 5.

Informe compartido de verificación y publicación: [docs/fase-0-verificacion.md](docs/fase-0-verificacion.md).

API REST única en Node.js + Express + TypeScript estricto. Doce operaciones están implementadas; las otras ocho de perfiles/avatares/cambio de correo siguen `planned` y responden 404. Sin operaciones de torneos.

## Requisitos

- Node.js 26.13.0 LTS y npm 12.2.2.
- PostgreSQL 18.6. El entorno local Windows usa binarios oficiales de EDB, escucha solo en `127.0.0.1:5433` y crea bases independientes de desarrollo y pruebas.
- En el espacio de trabajo original, `. ../tooling/activate.ps1` activa las herramientas locales sin cambiar Windows globalmente.

## Inicio

Desde este repositorio:

```powershell
npm ci --ignore-scripts
./scripts/postgres-local.ps1
npm run db:migrate
npm run dev
```

Para un clon independiente configura `PG_BIN` con el directorio `bin` de PostgreSQL, o prepara una instancia y copia `.env.example` a `.env` con sus credenciales. El script local genera contraseñas aleatorias y no sobrescribe un `.env` existente. No requiere privilegios de administrador. Para detener su instancia: `./scripts/postgres-local.ps1 -Action stop`.

Antes de arrancar, completa `IDENTITY_*` según `.env.example`: tres secretos aleatorios independientes de al menos 32 bytes en hexadecimal (CSRF, abuso y JWT) y los orígenes exactos web/móvil/API. Guárdalos directamente en el entorno local ignorado, nunca Git/logs. Los dos clientes deben figurar en `CORS_ORIGINS`. El servidor falla sin configuración válida, sin secretos por defecto. Bootstrap CSRF obligatorio antes de mutaciones; tras login la prueba queda ligada a su familia. Los enlaces de correo apuntan a pantallas futuras, todavía no implementadas; esta etapa se verifica por API/SMTP local.

## Verificaciones

```powershell
npm run check
npm audit
npm outdated
```

`check` ejecuta integridad de skills, tipos, lint, formato, OpenAPI, **32 unitarias/HTTP/configuración/contrato, 52 integraciones reales** y build. Incluye sesiones, JWT/CSRF, hashing y entrega/errores SMTP, además de regresiones anteriores. Requiere `TEST_DATABASE_URL` distinta de desarrollo y nombre terminado en `_test`; no fixtures ni Down sobre desarrollo.

El contrato es `docs/openapi.yaml`. `npm run api:generate` genera los tipos en `src/shared/api/`. No se implementan por adelantado endpoints de otras fases.

## Correo y almacenamiento

En otra terminal, `npm run infra:mail` inicia el capturador SMTP en `127.0.0.1:1025`. Acepta mensajes y descarta su contenido sin registrar códigos ni tokens. `npm run infra:check` comprueba PostgreSQL, SMTP y, si están completas sus variables, acceso al bucket R2.

R2 usa el SDK S3 oficial, región `auto` y endpoint de Cloudflare. Sin credenciales informa **pendiente**, no éxito. `HeadBucket` acredita acceso, no privacidad: verifica en Cloudflare que el bucket no tenga dominio público ni `r2.dev` habilitado. No hay endpoints de subida en esta fase.

## MCP

Las seis skills OpenCode aprobadas se mantienen en un [catálogo compartido y portable](docs/skills-opencode.md), con una sola copia en este repositorio. Frontend y AdminWeb lo consumen por HTTPS desde una revisión Git fijada. Verificación: `npm run skills:check`.

`opencode.json` registra Google Stitch usando `STITCH_API_KEY`; Engram está instalado globalmente para OpenCode. No hay claves en estos archivos. Reinicia OpenCode tras cambiar configuración y comprueba `opencode mcp list`.

Pruebas técnicas independientes:

```powershell
node --import tsx scripts/check-mcp.ts engram
node --import tsx scripts/check-mcp.ts stitch
```

Configura `ENGRAM_BIN` si el ejecutable no está en la ubicación local del espacio de trabajo. La prueba Engram guarda una observación técnica identificada como tal: no simula una sesión del agente. La exposición de sus herramientas al agente debe confirmarse en una sesión nueva después de reiniciar OpenCode.

## Estructura y CI

`src/shared/` contiene configuración, conexiones, errores y middleware. `src/modules/users/` implementa registro/verificación por capas controlador → servicio → repositorio; los demás módulos y jobs siguen pendientes. No existe un segundo backend. Los módulos solo se relacionan mediante servicios.

El workflow `.github/workflows/ci.yml` levanta PostgreSQL efímero y ejecuta los controles. No necesita SMTP ni R2 externos. Está preparado, pero su ejecución remota requiere publicar con autorización del propietario.

Las decisiones de compatibilidad y el cambio tecnológico están en `docs/decisiones.md`.
