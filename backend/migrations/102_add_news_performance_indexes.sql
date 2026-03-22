-- Добавление индексов для производительности новостей
-- Создано: 2026-03-22
-- Цель: Улучшение производительности запросов к новостям

-- Индекс для сортировки новостей по дате публикации и фильтрации по автору
CREATE INDEX IF NOT EXISTS idx_news_author_published 
ON news(author_id, published_at DESC);

-- Индекс для получения списка ознакомившихся с новостями
CREATE INDEX IF NOT EXISTS idx_news_reads_user_read_at 
ON news_reads(user_id, read_at DESC);

-- Индекс для проверки прочитанных новостей пользователем
CREATE INDEX IF NOT EXISTS idx_news_reads_user_news 
ON news_reads(user_id, news_id);

-- Индекс для фильтрации опубликованных новостей по дате
CREATE INDEX IF NOT EXISTS idx_news_published_status 
ON news(published_at DESC) WHERE published_at IS NOT NULL;

-- Индекс для поиска новостей по заголовку (если понадобится полнотекстовый поиск)
-- CREATE INDEX IF NOT EXISTS idx_news_title_gin 
-- ON news USING gin(to_tsvector('russian', title));

COMMENT ON INDEX idx_news_author_published IS 'Индекс для сортировки новостей по автору и дате публикации';
COMMENT ON INDEX idx_news_reads_user_read_at IS 'Индекс для получения истории прочтения новостей пользователем';
COMMENT ON INDEX idx_news_reads_user_news IS 'Индекс для проверки прочтения конкретной новости пользователем';
COMMENT ON INDEX idx_news_published_status IS 'Индекс для фильтрации опубликованных новостей';
