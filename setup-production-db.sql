-- Setup script voor productie database in CapRover
-- Voer uit in de postgres-waai container

-- Maak database aan (als die nog niet bestaat)
SELECT 'CREATE DATABASE waai_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'waai_db')\gexec

-- Verbind met waai_db
\c waai_db

-- Voer alle migraties uit (kopieer van migrations folder)
-- Dit wordt handmatig gedaan omdat we in de container zijn
