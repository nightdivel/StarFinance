-- 005_add_position_to_discord_scope_mappings.sql

ALTER TABLE IF EXISTS discord_scope_mappings
  ADD COLUMN IF NOT EXISTS position INT;

-- Заполним позицию по умолчанию текущим порядком (по scope, value), только для NULL
WITH ordered AS (
  SELECT scope, value, ROW_NUMBER() OVER (ORDER BY scope, value) AS rn
  FROM discord_scope_mappings
)
UPDATE discord_scope_mappings d
SET position = o.rn
FROM ordered o
WHERE d.scope = o.scope
  AND (d.value IS NOT DISTINCT FROM o.value)
  AND d.position IS NULL;

-- Индекс по позиции не обязателен, но может помочь при сортировке
-- CREATE INDEX IF NOT EXISTS idx_discord_scope_mappings_position ON discord_scope_mappings(position);
