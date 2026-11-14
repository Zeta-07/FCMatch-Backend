# Fase 1, Etapa 6 — búsqueda unificada

## Cambio autorizado

Filtro aditivo query en GET /api/v1/users. Combina prefijo literal de username e ID público exacto ante ocho dígitos válidos, sin duplicar filas. Orden estable y paginación keyset sobre el conjunto completo, sin sumar resultados de dos páginas independientes. Se incluye al titular con los mismos datos públicos; la etiqueta Tú es presentación del cliente, no permiso ni campo privado nuevo.

search conserva exclusivamente prefijo de username y publicNumber conserva ID exacto sin cursor. Se rechazan filtros simultáneos. Cursores anteriores HMAC sin mode siguen siendo válidos con search; los nuevos llevan mode=unified y se vinculan a la consulta normalizada. No se aceptan firmas alteradas, segmentos extra, otras consultas ni cruces entre modos. Respuestas JSON, representación numérica negociada, UUID, permisos y rate limiting intactos. Sin migraciones ni cambios de identidad.

OpenAPI y modelos regenerados idénticos en Backend/Web/móvil/AdminWeb. Documentación de decisiones: DT-016; Frontend DT-014 y su informe docs/etapa-6-ajustes-finales.md; Admin DT-013. Requiere desplegar primero Backend compatible, después clientes.

## Verificación

`npm run check` completo satisfactorio: **36 pruebas unitarias/HTTP/contrato y 71 integraciones reales**, sin fallos ni omisiones; typecheck, ESLint, formato, OpenAPI, integridad de skills y build correctos. npm audit reporta cero vulnerabilidades. Integración PostgreSQL real: ID y username de personas distintas para la misma cadena, fila que cumple ambos criterios, titular, ceros iniciales, trim, paginación y cursores antiguos/nuevos, firmas alteradas y segmentos extra, validación y privacidad. Se mantiene la batería completa de identidad, sesiones, correo SMTP y objetos SeaweedFS reales. SDK AWS estable actualizado separadamente a 3.1169.0 según política de dependencias, sin cambios de adaptador ni almacenamiento.

PR #5 abierto sin merge. No Etapa 7. La aprobación para implementar/publicar no sustituye la revisión final del propietario. Permanecen diferidos R2/SMTP externos y validación nativa conforme al plan.
