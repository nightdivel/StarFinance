-- 005_purchase_requests.sql

-- Reserved quantity on warehouse items
ALTER TABLE warehouse_items 
  ADD COLUMN IF NOT EXISTS reserved NUMERIC(18,3) NOT NULL DEFAULT 0;

-- Purchase requests
CREATE TABLE IF NOT EXISTS purchase_requests (
  id TEXT PRIMARY KEY,
  warehouse_item_id TEXT NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  buyer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  price_per_unit NUMERIC(18,2),
  currency TEXT,
  status TEXT NOT NULL CHECK (status IN ('Заявка отправлена','Выполнено','Отменена')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- Logs for requests
CREATE TABLE IF NOT EXISTS purchase_request_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- created, confirmed, canceled, deleted
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_purchase_requests_buyer ON purchase_requests(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_item ON purchase_requests(warehouse_item_id);

-- Default permissions for requests module
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Администратор','requests','write')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Пользователь','requests','read')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Гость','requests','none')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;
