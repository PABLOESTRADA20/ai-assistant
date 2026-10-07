-- Se ejecuta solo la primera vez (al crearse el volumen de datos).
-- POSTGRES_DB (aria) ya existe: aquí se crea la BD de pruebas y la extensión
-- vector en ambas. La migración de Prisma también la crea con
-- CREATE EXTENSION IF NOT EXISTS, pero así la BD queda lista de inicio.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE DATABASE aria_test;

\connect aria_test
CREATE EXTENSION IF NOT EXISTS vector;
