-- Up Migration
-- La Fase 0 solo prepara el esquema. Las tablas de negocio pertenecen a fases posteriores.
CREATE SCHEMA IF NOT EXISTS fcmatch;

-- Down Migration
DROP SCHEMA fcmatch;
