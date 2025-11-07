-- 006_requests_status_processing.sql
-- Allow new status 'В обработке' for purchase_requests.status and keep backward compatibility

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN (
    SELECT conname
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE cls.relname = 'purchase_requests' AND con.contype = 'c'
  ) LOOP
    -- Drop all check constraints; we will re-add the correct one below
    EXECUTE format('ALTER TABLE purchase_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
END$$;

ALTER TABLE purchase_requests
  ADD CONSTRAINT purchase_requests_status_check
  CHECK (status IN ('В обработке','Заявка отправлена','Выполнено','Отменена'));
