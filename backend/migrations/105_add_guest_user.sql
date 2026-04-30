-- Ensure guest user exists
INSERT INTO users (id, username, account_type, is_active, auth_type)
VALUES ('guest', 'guest', 'Гость', true, 'local')
ON CONFLICT (id) DO NOTHING;
