-- 007_finance_requests.sql

-- Table to track confirmation workflow for outgoing transactions
CREATE TABLE IF NOT EXISTS finance_requests (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  from_user TEXT REFERENCES users(id) ON DELETE SET NULL,
  to_user TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'В обработке', -- В обработке | Выполнено | Отменена
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_finance_requests_to_user ON finance_requests(to_user);
CREATE INDEX IF NOT EXISTS idx_finance_requests_status ON finance_requests(status);
