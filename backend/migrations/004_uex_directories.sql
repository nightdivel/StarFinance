-- 004_uex_directories.sql
-- Миграция для интеграции справочников UEX:
-- 1) расширение product_names полями UEX
-- 2) опциональное поле uex_category в product_types
-- 3) таблица состояния синхронизации uex_sync_state

-- 1. Расширение справочника номенклатуры product_names
ALTER TABLE product_names
  ADD COLUMN IF NOT EXISTS uex_id TEXT,
  ADD COLUMN IF NOT EXISTS uex_category TEXT,
  ADD COLUMN IF NOT EXISTS uex_subcategory TEXT,
  ADD COLUMN IF NOT EXISTS uex_meta JSONB;

-- Индекс по uex_id для быстрого поиска по идентификатору UEX
CREATE INDEX IF NOT EXISTS idx_product_names_uex_id
  ON product_names(uex_id);


-- 2. Опциональное поле категории UEX для типов товаров
ALTER TABLE product_types
  ADD COLUMN IF NOT EXISTS uex_category TEXT;


-- 3. Таблица состояния синхронизации данных из UEX
CREATE TABLE IF NOT EXISTS uex_sync_state (
  resource TEXT PRIMARY KEY,          -- имя ресурса, например 'commodities', 'product_types'
  last_sync_at TIMESTAMPTZ,           -- время последней успешной синхронизации
  last_uex_marker TEXT,              -- маркер/идентификатор инкрементального синка (id/hash/updated_at)
  meta JSONB                         -- произвольные метаданные (статистика, диагностическая информация)
);
