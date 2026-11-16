# Fase 1, Etapa 6 — ID público numérico retrocompatible

## Alcance autorizado

Corrección aprobada por el propietario antes de la aceptación visual final. Sin Etapa 7, eliminación de cuentas, competición, funciones administrativas ni segundo backend. Detalle de decisiones en DT-015 y de interfaces en `FCMatch-Frontend/docs/etapa-6-correcciones.md`.

## Despliegue y reversión

Inventario local anterior: una cuenta de desarrollo y cero cuentas de prueba. Migraciones nuevas, sin alterar UUID, contraseñas, sesiones o claves foráneas. El número es integer en PostgreSQL y string de ocho dígitos en JSON, rango 10000000–99999999, único/inmutable, secuencia NO CYCLE, sin reciclado. Los huecos son válidos.

Para un volumen pequeño: respaldo verificado, `npm run db:migrate` y comprobación de cero nulos/duplicados, rango y conservación de identidades. En bases con más de 10000 pendientes: aplicar hasta expand mediante `npm run db:migrate -- --public-number-expand`, ejecutar `node --env-file=.env --import tsx scripts/backfill-public-numbers.ts`, comprobar cero nulos y finalizar con `npm run db:migrate`. El script completa lotes de 500 en transacciones independientes, omite filas bloqueadas y puede reanudarse; la validación final impide terminar con nulos. DDL sujeto a lock_timeout de 5 s, sin promesa de cero bloqueo. Ventana controlada y prueba de respaldo/restauración según el entorno antes de desplegar fuera de local.

Reversión operativa: volver al backend/cliente anterior conservando esquema y números asignados. Los Down se rechazan deliberadamente. Nunca bajar/reiniciar la secuencia, reciclar números o eliminar columnas publicadas; restauraciones deben conservar el avance para no reemitir identificadores.

## Compatibilidad y seguridad

- application/json conserva el shape y publicId UUID anteriores.
- Accept application/vnd.fcmatch.identity.v2+json solicita publicNumber adicional en perfiles/listados; Content-Type correspondiente y Vary: Accept. Los errores conservan application/json.
- Se resuelven números y UUID públicos anteriores, nunca UUID interno como sustituto del identificador público.
- Cursor anterior HMAC y ordenación UUID intactos; búsqueda numérica exacta y explícita, excluyente con search/cursor.
- Sin asignación masiva: registro y edición rechazan campos no permitidos. No cambia JWT, refresh, CSRF, Argon2id, permisos o privacidad.
- El ID numérico es enumerable; no es un secreto ni autoriza solicitudes. Se mantienen rate limiting y separación de perfiles privados/públicos.
- Backend primero, clientes después. Los tres clientes reciben modelos idénticos generados desde OpenAPI.

## Pruebas

Se incorporan integración de negociación/privacidad/enlaces/búsqueda/cursores/permisos, contrato de la representación opt-in y migración sobre cuentas previas en esquema sintético. Se prueban doce altas concurrentes, unicidad, inmutabilidad, no reciclado tras borrar una cuenta sintética y agotamiento de una secuencia aislada. Nunca se reinicia la secuencia compartida ni se eliminan cuentas ajenas.

`npm run check` completo satisfactorio: integridad de skills, typecheck, ESLint, Prettier, OpenAPI, **36 pruebas unitarias/HTTP/contrato**, **70 integraciones reales**, build. Ninguna omitida ni fallida en la pasada final. `npm audit --audit-level=low`: cero vulnerabilidades reportadas. Migraciones locales aplicadas y repetibles; prueba aislada de migración y compatibilidad satisfactoria. La aceptación de navegador con API, PostgreSQL, SMTP y SeaweedFS reales pertenece al informe de Frontend; integración R2/SMTP externo y validación nativa siguen pendientes conforme al plan.
