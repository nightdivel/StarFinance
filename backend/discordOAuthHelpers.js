const { URL } = require('url');

const createDiscordOAuthHelpers = ({ query, DISCORD_CONFIG, SERVER_CONFIG, safeJsonParse }) => {
  if (typeof query !== 'function') throw new Error('createDiscordOAuthHelpers: query is required');
  if (!DISCORD_CONFIG) throw new Error('createDiscordOAuthHelpers: DISCORD_CONFIG is required');
  if (!SERVER_CONFIG) throw new Error('createDiscordOAuthHelpers: SERVER_CONFIG is required');

  const readDiscordEffective = async () => {
    try {
      const ds = await query(
        'SELECT enable, client_id, client_secret, redirect_uri, default_account_type, base_url FROM discord_settings WHERE id = 1'
      );
      const row = ds.rows[0] || {};
      // Read attribute mappings, supporting both schemas:
      // (A) New: columns (source, key, value, account_type, guild_id, set)
      // (B) Legacy: single JSONB column rule
      let attrRows = [];
      try {
        const a = await query(
          'SELECT source, key, value, account_type, guild_id, set FROM discord_attr_mappings'
        );
        attrRows = a.rows || [];
      } catch (e) {
        try {
          const a = await query('SELECT rule FROM discord_attr_mappings');
          attrRows = (a.rows || []).map((r) => {
            const parse = typeof safeJsonParse === 'function' ? safeJsonParse : (x) => {
              try {
                return JSON.parse(x);
              } catch {
                return null;
              }
            };
            const rule = typeof r.rule === 'object' ? r.rule : parse(r.rule);
            return {
              source: rule?.source,
              key: rule?.key,
              value: rule?.value,
              account_type: rule?.accountType || rule?.account_type,
              guild_id: rule?.guildId || rule?.guild_id,
              set: rule?.set || null,
            };
          });
        } catch (_) {
          attrRows = [];
        }
      }
      return {
        enable: !!row.enable,
        clientId: row.client_id || DISCORD_CONFIG.CLIENT_ID || '',
        clientSecret: row.client_secret || DISCORD_CONFIG.CLIENT_SECRET || '',
        redirectUri: row.redirect_uri || DISCORD_CONFIG.REDIRECT_URI || '',
        defaultAccountType: row.default_account_type || 'Гость',
        baseUrl: row.base_url || '',
        attributeMappings: attrRows || [],
        guildMappings: [],
      };
    } catch (_) {
      return {
        enable: false,
        clientId: DISCORD_CONFIG.CLIENT_ID || '',
        clientSecret: DISCORD_CONFIG.CLIENT_SECRET || '',
        redirectUri: DISCORD_CONFIG.REDIRECT_URI || '',
        defaultAccountType: 'Гость',
        baseUrl: '',
        attributeMappings: [],
        guildMappings: [],
      };
    }
  };

  // Helper: derive callback route path from configured Redirect URI
  function getDiscordCallbackPathFromRedirect(redirectUri) {
    try {
      if (!redirectUri || typeof redirectUri !== 'string') return '/auth/discord/callback';
      const url = new URL(redirectUri);
      const p = url.pathname || '/auth/discord/callback';
      // Если внешний путь имеет префикс (например, /economy/auth/discord/callback), но
      // сам callback внутри приложения обслуживается без префикса, то регистрируем
      // роут именно как '/auth/discord/callback'.
      if (p.endsWith('/auth/discord/callback')) {
        return '/auth/discord/callback';
      }
      return p;
    } catch {
      return '/auth/discord/callback';
    }
  }

  // Helper: derive frontend base URL (where we send user after auth) from Redirect URI
  function getDiscordFrontendBaseFromRedirect(redirectUri) {
    try {
      if (!redirectUri || typeof redirectUri !== 'string') {
        return SERVER_CONFIG.FRONTEND_URL;
      }
      const url = new URL(redirectUri);
      // Обрежем суффикс /auth/discord/callback (и всё, что после него) из pathname
      url.pathname = url.pathname.replace(/\/auth\/discord\/callback.*$/, '');
      url.search = '';
      url.hash = '';
      // Уберём лишний завершающий слэш
      const s = url.toString();
      return s.endsWith('/') ? s.slice(0, -1) : s;
    } catch {
      return SERVER_CONFIG.FRONTEND_URL;
    }
  }

  return { readDiscordEffective, getDiscordCallbackPathFromRedirect, getDiscordFrontendBaseFromRedirect };
};

module.exports = { createDiscordOAuthHelpers };
