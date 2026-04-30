-- Migration: warehouse_items.owner_login → owner_id (userId)
ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id);

-- Copy userId for all items where possible
UPDATE warehouse_items wi
SET owner_id = u.id
FROM users u
WHERE wi.owner_login = u.username;

-- (Optional) Remove old owner_login after migration is verified
-- ALTER TABLE warehouse_items DROP COLUMN IF EXISTS owner_login;
