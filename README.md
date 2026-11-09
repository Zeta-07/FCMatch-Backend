# FCMatch Backend — Fase 0

Informe compartido de verificación y publicación: [docs/fase-0-verificacion.md](docs/fase-0-verificacion.md).

API REST única en Node.js + Express + TypeScript estricto. En esta fase únicamente sirve infraestructura: `GET /api/v1/health` consulta PostgreSQL real. No existen cuentas, autenticación ni operaciones de torneos.

## Requisitos

- Node.js 26.13.0 LTS y npm 12.2.1.
- PostgreSQL 18.6. El entorno local Windows usa binarios oficiales de EDB, escucha solo en `127.0.0.1:5433` y crea bases independientes de desarrollo y pruebas.
- En el espacio de trabajo original, `. ../tooling/activate.ps1` activa las herramientas locales sin cambiar Windows globalmente.

## Inicio

Desde este repositorio:

```powershell
npm ci
./scripts/postgres-local.ps1
npm run db:migrate
npm run dev
```

Para un clon independiente configura `PG_BIN` con el directorio `bin` de PostgreSQL, o prepara una instancia y copia `.env.example` a `.env` con sus credenciales. El script local genera contraseñas aleatorias y no sobrescribe un `.env` existente. No requiere privilegios de administrador. Para detener su instancia: `./scripts/postgres-local.ps1 -Action stop`.

## Verificaciones

```powershell
npm run check
npm audit
npm outdated
```

`check` ejecuta tipos, lint, formato, validación OpenAPI, cinco pruebas HTTP/configuración, dos pruebas de integración y compilación. Las pruebas de integración requieren `TEST_DATABASE_URL` distinta de `DATABASE_URL`.

El contrato es `docs/openapi.yaml`. `npm run api:generate` genera los tipos en `src/shared/api/`. No se implementan por adelantado endpoints de otras fases.

## Correo y almacenamiento

En otra terminal, `npm run infra:mail` inicia el capturador SMTP en `127.0.0.1:1025`. Acepta mensajes y descarta su contenido sin registrar códigos ni tokens. `npm run infra:check` comprueba PostgreSQL, SMTP y, si están completas sus variables, acceso al bucket R2.

R2 usa el SDK S3 oficial, región `auto` y endpoint de Cloudflare. Sin credenciales informa **pendiente**, no éxito. `HeadBucket` acredita acceso, no privacidad: verifica en Cloudflare que el bucket no tenga dominio público ni `r2.dev` habilitado. No hay endpoints de subida en esta fase.

## MCP

`opencode.json` registra Google Stitch usando `STITCH_API_KEY`; Engram está instalado globalmente para OpenCode. No hay claves en estos archivos. Reinicia OpenCode tras cambiar configuración y comprueba `opencode mcp list`.

Pruebas técnicas independientes:

```powershell
node --import tsx scripts/check-mcp.ts engram
node --import tsx scripts/check-mcp.ts stitch
```

Configura `ENGRAM_BIN` si el ejecutable no está en la ubicación local del espacio de trabajo. La prueba Engram guarda una observación técnica identificada como tal: no simula una sesión del agente. La exposición de sus herramientas al agente debe confirmarse en una sesión nueva después de reiniciar OpenCode.

## Estructura y CI

`src/shared/` contiene configuración, conexiones, errores y middleware. `src/modules/` y `src/jobs/` documentan los límites para futuras fases. No existe un segundo backend. Los futuros módulos siguen controlador → servicio → repositorio y solo se relacionan mediante servicios.

El workflow `.github/workflows/ci.yml` levanta PostgreSQL efímero y ejecuta los controles. No necesita SMTP ni R2 externos. Está preparado, pero su ejecución remota requiere publicar con autorización del propietario.

Las decisiones de compatibilidad y el cambio tecnológico están en `docs/decisiones.md`.
