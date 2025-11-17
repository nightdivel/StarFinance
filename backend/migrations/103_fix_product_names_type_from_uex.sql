-- 103_fix_product_names_type_from_uex.sql
-- Одноразовое выравнивание поля type в product_names по данным uex_type.
-- После выполнения:
--   uex_type = 'item'   => type = 'Товар'
--   uex_type = 'service'=> type = 'Услуга'

-- Обновляем только те записи, где uex_type уже заполнен.
UPDATE product_names
SET type = 'Товар'
WHERE uex_type = 'item';

UPDATE product_names
SET type = 'Услуга'
WHERE uex_type = 'service';
