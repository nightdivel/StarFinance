-- Remove deprecated Discord guild mappings feature

-- Drop guild mappings table if it exists
DROP TABLE IF EXISTS discord_guild_mappings;

-- Optionally, if there were any dependent objects, they should be adjusted separately.
