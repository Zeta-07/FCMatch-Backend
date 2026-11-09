# Decisiones técnicas — Fase 0

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
