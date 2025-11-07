-- Add theme preference column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(10) DEFAULT 'light';

-- Update existing users to have a default theme
UPDATE users SET theme_preference = 'light' WHERE theme_preference IS NULL;
