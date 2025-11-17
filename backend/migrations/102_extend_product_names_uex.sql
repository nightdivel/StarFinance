-- 102_extend_product_names_uex.sql
-- Добавление дополнительных полей для UEX-мэппинга номенклатуры
-- Новая структура: type/section/id_category/name

ALTER TABLE product_names
  ADD COLUMN IF NOT EXISTS uex_type TEXT,          -- 'item' | 'service' (машинный тип из UEX)
  ADD COLUMN IF NOT EXISTS uex_section TEXT,       -- section из категории UEX (напр. Trading, Services)
  ADD COLUMN IF NOT EXISTS uex_category_id TEXT;   -- id категории из UEX (id_category);

-- Индекс по uex_category_id для быстрых выборок по категории
CREATE INDEX IF NOT EXISTS idx_product_names_uex_category_id
  ON product_names(uex_category_id);
