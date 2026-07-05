-- Runs once on first boot of the postgres volume.
-- The vector extension for the app database is managed by Prisma migrations;
-- this only provisions the separate database Evolution API owns.
CREATE DATABASE evolution;
