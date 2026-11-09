# Límites de módulos

Los módulos autorizados son `users`, `tournaments`, `matches`, `friends`, `notifications` y `statistics`.

Cada módulo se incorporará durante su fase con `controller/`, `service/`, `repository/`, `dto/` y `routes/`. Los controladores delegan; los servicios aplican negocio y permisos; los repositorios realizan SQL parametrizado. La colaboración entre módulos se hace mediante servicios y sin ciclos. No hay implementaciones de negocio en Fase 0.
