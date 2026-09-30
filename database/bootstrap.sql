-- MariaDB bootstrap for the TSC Case Management platform.
--
-- Creates the database, the application user, and the grants the app needs.
-- Safe to re-run: every statement is IF NOT EXISTS / idempotent.
--
--   mariadb -u root < database/bootstrap.sql
--
-- The password below is the development default and must match DATABASE_URL in
-- .env. It is deliberately not a secret: this file exists so a developer can
-- reproduce the local database, not to hold production credentials. Use a
-- generated secret and an environment-injected password for any real deployment.
--
-- Verified against MariaDB 12.3.3.

CREATE DATABASE IF NOT EXISTS `tsc_case_management`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 'localhost' covers the unix socket, 127.0.0.1 the TCP connection the app uses.
CREATE USER IF NOT EXISTS 'tsc'@'localhost' IDENTIFIED BY 'tsc_dev_password';
CREATE USER IF NOT EXISTS 'tsc'@'127.0.0.1' IDENTIFIED BY 'tsc_dev_password';

GRANT ALL PRIVILEGES ON `tsc_case_management`.* TO 'tsc'@'localhost';
GRANT ALL PRIVILEGES ON `tsc_case_management`.* TO 'tsc'@'127.0.0.1';

FLUSH PRIVILEGES;

-- Note on timezones: this instance also serves other databases, so the script
-- deliberately does not touch the global time_zone. The app stores and reads
-- every timestamp through mysql2/drizzle and does its own date arithmetic in
-- JS, so it is timezone-agnostic — but a `timestamp` column is converted using
-- the server's zone, so keep the server zone stable across deployments or the
-- displayed dates will shift.

