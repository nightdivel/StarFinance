-- Add UEX module permissions (idempotent)
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Администратор','uex','write')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Пользователь','uex','read')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Гость','uex','read')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;
