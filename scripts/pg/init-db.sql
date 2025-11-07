-- StarFinanceProject: базовая инициализация схемы
-- Таблица для хранения состояния приложения (JSONB)
CREATE TABLE IF NOT EXISTS app_state (
  id SMALLINT PRIMARY KEY,
  data JSONB NOT NULL
);

-- Первичная запись, если отсутствует
INSERT INTO app_state (id, data)
SELECT 1, '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM app_state WHERE id = 1);
