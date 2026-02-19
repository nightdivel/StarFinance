\set ON_ERROR_STOP on

DO $$
DECLARE
  svc RECORD;
BEGIN
  FOR svc IN SELECT * FROM (VALUES
    ('identity'),
    ('directories'),
    ('settings'),
    ('warehouse'),
    ('showcase'),
    ('requests'),
    ('finance'),
    ('integration')
  ) AS t(name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc.name) THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', svc.name, svc.name);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = svc.name) THEN
      EXECUTE format('CREATE DATABASE %I OWNER %I', svc.name, svc.name);
    END IF;

    EXECUTE format('ALTER DATABASE %I OWNER TO %I', svc.name, svc.name);
  END LOOP;
END
$$;
