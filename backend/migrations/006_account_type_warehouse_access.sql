-- 006_account_type_warehouse_access.sql

CREATE TABLE IF NOT EXISTS account_type_warehouse_types (
  account_type TEXT NOT NULL REFERENCES account_types(name) ON DELETE CASCADE,
  warehouse_type TEXT NOT NULL REFERENCES warehouse_types(name) ON DELETE CASCADE,
  PRIMARY KEY (account_type, warehouse_type)
);
