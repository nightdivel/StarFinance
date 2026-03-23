-- Add News module permissions (idempotent)
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Администратор','news','write')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Пользователь','news','read')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Гость','news','read')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;
