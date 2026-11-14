# Fase 1 — Etapa 5: perfiles y avatares

## Alcance y estado

Autorización: RF-03/04/05 exclusivamente, sin interfaces de Etapa 6, funciones administrativas, competición o eliminación de cuentas. Commits/push en la rama existente y actualización de PR #5 autorizados **solo tras verificaciones satisfactorias**. No fusiones ni force push.

Implementadas y verificadas las ocho operaciones de perfil propio/público, edición, búsqueda por prefijo/cursor firmado, cambio de correo SMTP y avatares S3. Con las etapas anteriores son **20 operaciones implementadas**. Estadísticas `null` e historial `[]` siguen vacíos por diseño. La integración real R2 queda **pendiente** por decisión explícita del propietario; no se activa Cloudflare, solicita tarjeta o comparte secretos.

## Almacenamiento seleccionado

| Alternativa    | Evaluación                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------- |
| SeaweedFS 4.53 | Elegido: mantenido, Apache-2.0, binarios oficiales nativos Windows/Linux, S3 y URLs firmadas |
| MinIO          | Descartado: repositorio archivado en la consulta oficial                                     |
| Garage         | Mantenido, menor ajuste nativo Windows para este entorno                                     |
| RustFS 1.0.5   | Mantenido, alternativa válida; SeaweedFS ofrece mejor ajuste al flujo nativo seleccionado    |

Fuentes consultadas: API GitHub de repositorios/releases y código SeaweedFS fijado a 4.53 (`weed/command/server.go`, `mini.go`, scaffold de master/security). Release estable 08/11/2026. SHA-256 Windows `d458d60e6a4120a64244b0ad7bc02cbc0e2fca71a7f775a88edc01da3b435cd7`; Linux `d1a7dec9f48d8b33895a0ea8951971defc2dc5312906dcc76fa5a5f74a6ee90d`. No se copia el ejemplo oficial de identidades porque incluye acceso anónimo y Admin amplios.

Preparación desde Backend:

```sh
node scripts/download-storage.mjs
node scripts/storage-local.mjs
```

En otra terminal:

```sh
node scripts/storage-local.mjs --init
node scripts/storage-local.mjs --configure
```

`--configure` actualiza únicamente las seis variables S3 de `.env`, conserva las demás y no imprime secretos. Es exclusivo de desarrollo. Tests usan credenciales de test directamente desde el archivo ignorado; el backend usa identidad dev, ninguna de ellas tiene Admin. Bootstrap solo prepara buckets. `SEAWEEDFS_BINARY` permite indicar un binario previamente verificado. Datos/secretos quedan en `.local/storage/`, nunca en clientes/Git/Engram. El proceso corre en primer plano y se detiene con Ctrl+C; no eliminar carpetas para detenerlo.

Puertos solo 127.0.0.1: S3 8333, master 9333/19333, filer 8888/18888, volumen 8088/18088, S3 gRPC 18333. HTTP del filer deshabilitado. HTTP de volumen **no puede deshabilitarse sin romper operaciones S3**; se protege con claves JWT internas de escritura/lectura y UI deshabilitada por ese mecanismo. Claves de filer protegen también IAM gRPC; el resto de gRPC requiere entorno local de confianza. No exponer puertos a LAN/Internet, no afirmar endurecimiento de un despliegue distribuido o cifrado en reposo. Servicios IAM HTTP, WebDAV, SFTP, Iceberg/Lance, telemetría y métricas externos deshabilitados.

El crecimiento por defecto pide siete volúmenes por colección: se fija uno por crecimiento y máximo 16 volúmenes de 32 MiB. La primera prueba falló con máximo cuatro y crecimiento por defecto; se corrigió sin borrar datos. Otro fallo detectado: el diario inicial aceptaba UUID con guiones, pero users requiere 32 hex; se corrige con migración aditiva y generación de claves aleatorias compatibles, sin editar migraciones aplicadas.

## Garantías y límites

- URLs de lectura privadas, firmadas ≤300 s, no-store; HTTP únicamente loopback local. R2 producción HTTPS con región auto y endpoint global, sin afirmar prueba real. Cambiar proveedor **no copia objetos automáticamente**: antes de migrar datos se debe realizar copia/verificación de claves y corte controlado futuro.
- Cargas por API, sin URL/clave/propietario elegidos por cliente. Dos cargas máximas por proceso, dos decodificaciones, límite de dimensiones/píxeles, sin imágenes animadas/metadatos y tamaño de archivo 5 MiB (más overhead multipart acotado). Servidor limita recepción a 30 s; despliegue deberá configurar también su proxy.
- Reservar clave en PostgreSQL → subir objeto → firmar → activar bajo autorización revalidada. Retirar anterior después de commit; nunca borrar un objeto activo por un error de commit ambiguo. Borrados fallidos quedan registrados y el siguiente intento retoma limpieza; reservas interrumpidas vencen a los 15 min, sin borrar fotos activas. No hay atomicidad distribuida ni promesa de respuesta idempotente de PUT después de pérdida de red.
- Cambio de correo: contraseña actual, token 256 bits/hash/30 min/usuario/destino, SMTP fuera de locks, 202 genérico, dirección anterior hasta confirmar y unicidad atómica sin revelar tercero. Confirmación no abre sesiones nuevas; invalida tokens sensibles anteriores. SMTP externo no verificado.
- CSRF v2 mueve solo cookie de contexto a `/api/v1` y borra la antigua de `/api/v1/auth`; refresh conserva su Path. Pestañas siguen compartiendo binding estable; no se añade transporte nativo o almacenamiento persistente.

## Evidencia

| Verificación final local                | Resultado                                                                                                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend check completo                  | Tipos, lint, formato, OpenAPI y build correctos                                                                                                                                                                  |
| Unitarias/HTTP/configuración/contrato   | **35/35**, incluidas validaciones DTO/imagen/configuración y regresiones de identidad                                                                                                                            |
| Integraciones reales PostgreSQL/SMTP/S3 | **68/68**: 52 regresiones previas, 15 de perfiles/avatares/correo/CSRF y una de S3 directo                                                                                                                       |
| S3 privado                              | Upload/read firmados; rechazo anónimo, firma alterada/vencida; identidad test sin acceso al bucket dev; borrado/idempotencia y filer HTTP cerrado                                                                |
| Fallos/concurrencia                     | Dos sustituciones, DB rollback después de SQL, fallo antes/después de escritura real, firma/borrado fallidos, revocación durante upload, publicación tardía tras reserva vencida y compensación reconstruida     |
| Correo                                  | Contraseña actual/titular, dirección anterior hasta confirmar, destinos sucesivos, consumo paralelo, conflicto de unicidad y SMTP rechazado/aceptación ambigua; regresiones previas incluyen conexión SMTP caída |
| Clientes                                | Tres checks completos y **9/9 Playwright**, con health interceptado explícito; sin interfaces de identidad o pruebas nativas nuevas                                                                              |
| Auditorías                              | Cuatro paquetes sin vulnerabilidades detectadas                                                                                                                                                                  |
| Modelos/diseño                          | Cuatro copias idénticas de tipos, cambio de descripción sin ruptura de shape; temas/logos intactos                                                                                                               |
| Migraciones                             | Dos nuevas aditivas, cuatro aplicadas en desarrollo/pruebas; hashes de infraestructura/identidad previos intactos                                                                                                |
| Fixtures                                | Cero filas en las cinco tablas y cero objetos bajo avatars/ en ambos buckets tras limpiar solo fixtures propios; un objeto de una prueba interrumpida se identificó por contenido exacto antes de borrarlo       |
| Smoke compilado                         | API con S3 local real arranca: health/CSRF 200/no-store, login sin CSRF 403, perfil propio sin sesión 401 y perfil público inexistente 404                                                                       |
| Recuperación/arranque                   | Script manual ejecutado sin pendientes; descarga Windows reproducible/SHA verificada y preparación de buckets idempotente                                                                                        |
| Publicación/CI                          | Publicación autorizada tras estos checks; CI definitivo se verifica en los commits publicados y se registra en PR #5, sin usar runs de Etapa 4 como evidencia de esta etapa                                      |

Fallos iniciales de multipart, claves y formato se corrigieron antes del check final. No se usan esos intentos fallidos como aprobación para publicar. Angular 22.2.6 aparece disponible en npm; se conserva **22.2.4 bajo la excepción explícita aprobada**, igual que TypeScript 6.0.3 frente a 7.0.2 por compatibilidad. No actualizaciones forzadas, downgrades o scripts de instalación habilitados. Persiste el aviso informativo NG0913 por los PNG oficiales, sin modificarlos.

Pruebas con imágenes sintéticas y fixtures por UUID, sin imprimir URL firmada, correos con tokens o credenciales. Las inyecciones de fallo son pruebas negativas alrededor de almacenamiento real: no reemplazan SeaweedFS por un mock de aceptación.

## Revisión de seguridad acotada

| Severidad   | Hallazgos confirmados en el alcance revisado                       |
| ----------- | ------------------------------------------------------------------ |
| Crítica     | 0                                                                  |
| Alta        | 0                                                                  |
| Media       | 0                                                                  |
| Baja        | 0                                                                  |
| Informativa | 2: entorno local de confianza y aceptación de producción pendiente |

Alcance: diff de perfiles/avatares/correo, autorización transaccional, DTO/multipart/Sharp, repositorios SQL, cookies CSRF, adaptador S3, configuración/scripts/CI y modelos/documentación publicables. Flujo verificado entrada → validación/servicio → SQL/S3/SMTP → respuesta construida por whitelist. No se encontraron vulnerabilidades confirmadas en ese alcance; confianza alta en los casos dinámicos comprobados y moderada en la revisión estática general, **sin garantía de ausencia de vulnerabilidades**. Auditorías sin vulnerabilidades detectadas y scan de archivos publicables contra los secretos reales locales sin coincidencias; `.env`, credenciales y claves internas ignorados. No se añadieron parches fuera del alcance autorizado.

Informativa 1 (alta confianza): `scripts/storage-local.mjs` aísla a loopback y endurece HTTP, pero los puertos internos gRPC/datos locales presuponen usuario/host de confianza. No exponerlos ni convertir este script en despliegue productivo. Informativa 2 (alta confianza): `src/shared/storage/avatars.ts` conserva R2 configurable, pero hacen falta aceptación real, secretos de producción, HTTPS/topología/proxy y migración controlada de objetos; SMTP externo y validación nativa siguen pendientes. Los pisos temporales/límites por proceso conservan los límites ya documentados en Etapa 4.

Referencia: DT-014; Frontend DT-012 y AdminWeb DT-011. La decisión de R2 diferido está registrada también en Engram. **Esperar aprobación antes de Etapa 6; mantener PR abiertos sin fusionar.**
