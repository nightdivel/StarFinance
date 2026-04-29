const createBuildAggregatedData = ({ query, readSettingsMap, getPermissionsForTypesDb }) => {
  if (typeof query !== 'function') throw new Error('createBuildAggregatedData: query is required');
  if (typeof readSettingsMap !== 'function') throw new Error('createBuildAggregatedData: readSettingsMap is required');
  if (typeof getPermissionsForTypesDb !== 'function') throw new Error('createBuildAggregatedData: getPermissionsForTypesDb is required');

  const buildAggregatedData = async (userId) => {
    try {
      // Settings fallback (version, baseCurrency)
      const s = await readSettingsMap();
      const version = s['system.version'] ?? '1.0.0';
      const baseCurrency = s['system.baseCurrency'] ?? 'aUEC';
      const appTitle = s['system.appTitle'] ?? 'BLSK Star Finance';
      const defaultMenuOrder = [
        'news',
        'finance',
        'warehouse',
        'showcase',
        'requests',
        'users',
        'directories',
        'uex',
        'tools',
        'settings',
      ];
      const menuOrderRaw = Array.isArray(s['system.menuOrder']) ? s['system.menuOrder'] : [];
      const menuOrder = [
        ...menuOrderRaw.filter((k) => defaultMenuOrder.includes(k)),
        ...defaultMenuOrder.filter((k) => !menuOrderRaw.includes(k)),
      ];

      // Currencies and rates from tables (fallback to settings if empty)
      let currencies = [];
      try {
        const cres = await query('SELECT code FROM currencies');
        currencies = cres.rows.map((r) => r.code);
      } catch (_) {}
      if (!Array.isArray(currencies) || currencies.length === 0) {
        currencies = s['system.currencies'] ?? ['aUEC', 'КП'];
      }
      let rates = {};
      try {
        const rres = await query('SELECT code, rate FROM currency_rates WHERE base_code = $1', [
          baseCurrency,
        ]);
        if (rres.rowCount > 0) {
          rates = Object.fromEntries(rres.rows.map((r) => [r.code, Number(r.rate)]));
        }
      } catch (_) {}
      if (Object.keys(rates).length === 0) {
        rates = s['system.rates'] ?? { aUEC: 1, КП: 0.9 };
      }
      const system = { version, currencies, baseCurrency, rates, appTitle, menuOrder };

      // Directories from tables (fallback to settings)
      const productTypes = await (async () => {
        try {
          const r = await query('SELECT name FROM product_types');
          return r.rows.map((x) => x.name);
        } catch {
          return [];
        }
      })();
      const showcaseStatuses = await (async () => {
        try {
          const r = await query('SELECT name FROM showcase_statuses');
          return r.rows.map((x) => x.name);
        } catch {
          return [];
        }
      })();
      const warehouseTypes = await (async () => {
        try {
          const r = await query('SELECT name FROM warehouse_types');
          return r.rows.map((x) => x.name);
        } catch {
          return [];
        }
      })();
      // Полная номенклатура товаров/услуг с UEX-полями для автоподсказок
      const productNames = await (async () => {
        try {
          const r = await query(
            `SELECT name, type, uex_id, uex_type, uex_section, uex_category_id,
                    uex_category, uex_subcategory
             FROM product_names
             ORDER BY name`
          );
          return r.rows.map((x) => ({
            name: x.name,
            // Бизнес-тип: "Товар" / "Услуга"
            type: x.type || null,
            // Машинный тип из UEX: 'item' | 'service'
            uexType: x.uex_type || null,
            section: x.uex_section || null,
            uexCategoryId: x.uex_category_id || null,
            uexCategory: x.uex_category || null,
            uexSubcategory: x.uex_subcategory || null,
            isUex: !!x.uex_id,
          }));
        } catch (e) {
          console.error(
            'loadDirectoriesFromDb: failed to load productNames with UEX fields, fallback to basic query:',
            e
          );
          try {
            const r = await query('SELECT name, type FROM product_names ORDER BY name');
            return r.rows.map((x) => ({
              name: x.name,
              type: x.type || null,
              uexType: null,
              section: null,
              uexCategoryId: null,
              uexCategory: null,
              uexSubcategory: null,
              isUex: false,
            }));
          } catch (e2) {
            console.error('loadDirectoriesFromDb: fallback query for productNames failed:', e2);
            return [];
          }
        }
      })();

      // Справочник категорий из product_names + product_types (по данным UEX)
      const categories = await (async () => {
        try {
          // 1) Категории, которые пришли вместе с номенклатурой (product_names)
          const fromNames = (
            await query(
              `SELECT DISTINCT uex_category_id, uex_category, uex_section
               FROM product_names
               WHERE uex_category_id IS NOT NULL OR uex_category IS NOT NULL`
            )
          ).rows.map((x) => ({
            id: x.uex_category_id || null,
            name: x.uex_category || null,
            section: x.uex_section || null,
          }));

          // 2) Категории из product_types (после синка UEX: name = имя категории, uex_category = раздел)
          const fromTypes = (
            await query(`SELECT name, uex_category FROM product_types WHERE name IS NOT NULL`)
          ).rows.map((x) => ({
            id: null,
            name: x.name || null,
            section: x.uex_category || null,
          }));

          const all = [...fromNames, ...fromTypes];
          // Уберём дубликаты по (name, section)
          const seen = new Set();
          const result = [];
          for (const c of all) {
            const key = `${c.name || ''}__${c.section || ''}`;
            if (!c.name && !c.id) continue;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(c);
          }
          return result;
        } catch {
          return [];
        }
      })();
      const directories = {
        productTypes: productTypes.length ? productTypes : (s['directories.productTypes'] ?? ['Услуга', 'Товар']),
        showcaseStatuses: showcaseStatuses.length
          ? showcaseStatuses
          : (s['directories.showcaseStatuses'] ?? ['На витрине', 'Скрыт']),
        warehouseTypes: warehouseTypes.length ? warehouseTypes : (s['directories.warehouseTypes'] ?? []),
        productNames,
        categories,
        uexSync: null,
        // accountTypes assembled from tables
        accountTypes: [],
      };

      const productNamesByName = new Map(
        (Array.isArray(productNames) ? productNames : []).map((p) => [
          p.name,
          {
            type: p.type || null,
            uexCategory: p.uexCategory || null,
          },
        ])
      );
      try {
        const at = await query('SELECT name FROM account_types');
        for (const row of at.rows) {
          const perms = await query(
            'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
            [row.name]
          );
          const permObj = Object.fromEntries(perms.rows.map((p) => [p.resource, p.level]));
          let allowedWarehouseTypes = [];
          try {
            const wtypes = await query(
              'SELECT warehouse_type FROM account_type_warehouse_types WHERE account_type = $1 ORDER BY warehouse_type',
              [row.name]
            );
            allowedWarehouseTypes = wtypes.rows.map((r) => r.warehouse_type);
          } catch (_) {}
          directories.accountTypes.push({ name: row.name, permissions: permObj, allowedWarehouseTypes });
        }
      } catch (_) {}

      // Users from DB with derived permissions
      let users = [];
      try {
        const ures = await query(
          "SELECT id, username, email, nickname, auth_type, account_type, is_active, discord_id, discord_data, created_at, last_login FROM users WHERE id <> 'deleted_user'"
        );

        const defaultPermissions = {
          finance: 'read',
          warehouse: 'read',
          showcase: 'read',
          users: 'none',
          directories: 'none',
          settings: 'none',
        };
        const permissionsByType = await getPermissionsForTypesDb(ures.rows.map((u) => u.account_type));
        for (const t of new Set(ures.rows.map((u) => u.account_type).filter(Boolean))) {
          if (!permissionsByType.has(t)) permissionsByType.set(t, { ...defaultPermissions });
        }

        // Hide sensitive user fields unless caller can read users section.
        let canReadUsersSection = false;
        if (userId) {
          const me = ures.rows.find((u) => String(u?.id || '') === String(userId));
          const mePerms = permissionsByType.get(me?.account_type || '') || {};
          const lvl = mePerms?.users;
          canReadUsersSection = lvl === 'read' || lvl === 'write';
        }

        for (const u of ures.rows) {
          const perms = permissionsByType.get(u.account_type) || { ...defaultPermissions };
          let avatarUrl;
          if (u.auth_type === 'discord') {
            try {
              const d =
                typeof u.discord_data === 'object'
                  ? u.discord_data
                  : JSON.parse(u.discord_data || 'null');
              if (d && d.id && d.avatar)
                avatarUrl = `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png`;
            } catch (_) {}
          }
          users.push({
            id: u.id,
            username: u.username,
            nickname: u.nickname || null,
            email: u.email,
            authType: u.auth_type,
            accountType: u.account_type,
            permissions: perms,
            isActive: u.is_active !== false,
            discordId: u.discord_id || undefined,
            discordData: u.discord_data || undefined,
            avatarUrl,
            createdAt: u.created_at ? new Date(u.created_at).toISOString() : undefined,
            lastLogin: u.last_login ? new Date(u.last_login).toISOString() : undefined,
          });
        }

        if (!canReadUsersSection) {
          users = users.map((u) => ({
            id: u.id,
            username: u.username,
            nickname: u.nickname || null,
            accountType: u.accountType,
            avatarUrl: u.avatarUrl,
          }));
        }
      } catch (_) {}

      // Warehouse (filtered по allowedWarehouseTypes текущего пользователя)
      const warehouse = [];
      let allowedTypes = null;
      let currentUsername = null;
      try {
        if (userId) {
          const ures = await query('SELECT account_type, username FROM users WHERE id = $1', [userId]);
          const accType = ures.rows[0]?.account_type || null;
          currentUsername = ures.rows[0]?.username || null;
          if (accType) {
            const wres = await query(
              'SELECT warehouse_type FROM account_type_warehouse_types WHERE account_type = $1',
              [accType]
            );
            allowedTypes = wres.rows.map((r) => r.warehouse_type).filter(Boolean);
          }
        }
      } catch (_) {}
      const showcaseItemsMap = new Map();
      try {
        const sc = await query('SELECT id, warehouse_item_id FROM showcase_items');
        for (const srow of sc.rows) {
          if (srow.warehouse_item_id) showcaseItemsMap.set(srow.warehouse_item_id, true);
        }
      } catch (_) {}
      try {
        let w;
        if (currentUsername && Array.isArray(allowedTypes) && allowedTypes.length > 0) {
          w = await query(
            'SELECT id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE owner_login = $2 AND warehouse_type = ANY($1)',
            [allowedTypes, currentUsername]
          );
        } else {
          // Пустой или отсутствующий список — не возвращаем позиции склада
          w = { rows: [] };
        }
        for (const it of w.rows) {
          // Ensure meta is an object
          let metaObj = undefined;
          try {
            if (it.meta && typeof it.meta === 'string') metaObj = JSON.parse(it.meta);
            else if (it.meta && typeof it.meta === 'object') metaObj = it.meta;
          } catch (_) {}
          // Попробуем сопоставить номенклатуру по имени для получения типа/категории из product_names
          let kind = null;
          let categoryName = null;
          const pn = productNamesByName.get(it.name);
          if (pn) {
            kind = pn.type || null; // "Товар" / "Услуга"
            categoryName = pn.uexCategory || null;
          }

          warehouse.push({
            id: it.id,
            // Название позиции склада
            name: it.name,
            // Бизнес-тип (Товар/Услуга) из справочника номенклатуры
            type: kind || it.type || null,
            productType: kind || it.type || null,
            // Категория (name из UEX)
            category: categoryName || null,
            quantity: Number(it.quantity) || 0,
            cost: it.cost !== null && it.cost !== undefined ? Number(it.cost) : undefined,
            price: it.cost !== null && it.cost !== undefined ? Number(it.cost) : undefined,
            currency: it.currency || null,
            displayCurrencies: it.display_currencies || undefined,
            // Описание из meta
            description: metaObj && metaObj.desc ? metaObj.desc : undefined,
            meta: metaObj || undefined,
            warehouseType: it.warehouse_type || null,
            // Владелец
            ownerLogin: it.owner_login || null,
            // Статус витрины
            showcaseStatus: showcaseItemsMap.has(it.id) ? 'На витрине' : 'Скрыт',
            createdAt: it.created_at ? new Date(it.created_at).toISOString() : undefined,
            updatedAt: it.updated_at ? new Date(it.updated_at).toISOString() : undefined,
          });
        }
      } catch (_) {}

      // Showcase Warehouse: товары на витрине со всех личных складов
      const showcaseWarehouse = [];
      try {
        const sw = await query(
          `SELECT w.id, w.name, w.type, w.quantity, w.cost, w.currency, w.display_currencies, w.meta,
                  w.warehouse_type, w.owner_login, w.created_at, w.updated_at
           FROM warehouse_items w
           JOIN showcase_items s ON s.warehouse_item_id = w.id
           ORDER BY s.created_at DESC`
        );
        for (const it of sw.rows) {
          let metaObj = undefined;
          try {
            if (it.meta && typeof it.meta === 'string') metaObj = JSON.parse(it.meta);
            else if (it.meta && typeof it.meta === 'object') metaObj = it.meta;
          } catch (_) {}

          // Попробуем сопоставить номенклатуру по имени для получения типа/категории из product_names
          let kind = null;
          let categoryName = null;
          const pn = productNamesByName.get(it.name);
          if (pn) {
            kind = pn.type || null;
            categoryName = pn.uexCategory || null;
          }

          showcaseWarehouse.push({
            id: it.id,
            name: it.name,
            type: kind || it.type || null,
            productType: kind || it.type || null,
            category: categoryName || null,
            quantity: Number(it.quantity) || 0,
            cost: it.cost !== null && it.cost !== undefined ? Number(it.cost) : undefined,
            price: it.cost !== null && it.cost !== undefined ? Number(it.cost) : undefined,
            currency: it.currency || null,
            displayCurrencies: it.display_currencies || undefined,
            description: metaObj && metaObj.desc ? metaObj.desc : undefined,
            meta: metaObj || undefined,
            warehouseType: it.warehouse_type || null,
            ownerLogin: it.owner_login || null,
            showcaseStatus: 'На витрине',
            createdAt: it.created_at ? new Date(it.created_at).toISOString() : undefined,
            updatedAt: it.updated_at ? new Date(it.updated_at).toISOString() : undefined,
          });
        }
      } catch (_) {}

      // Showcase
      const showcase = [];
      try {
        const sc = await query(
          'SELECT id, warehouse_item_id, status, price, currency, meta, created_at, updated_at FROM showcase_items'
        );
        for (const srow of sc.rows) {
          showcase.push({
            id: srow.id,
            warehouseItemId: srow.warehouse_item_id || null,
            status: srow.status || null,
            price: srow.price !== null && srow.price !== undefined ? Number(srow.price) : undefined,
            currency: srow.currency || null,
            meta: srow.meta || undefined,
            createdAt: srow.created_at ? new Date(srow.created_at).toISOString() : undefined,
            updatedAt: srow.updated_at ? new Date(srow.updated_at).toISOString() : undefined,
          });
        }
      } catch (_) {}

      // Transactions
      const transactions = [];
      try {
        const tres = await query(
          'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions'
        );
        for (const t of tres.rows) {
          const createdIso = t.created_at ? new Date(t.created_at).toISOString() : undefined;
          const desc = t.meta && t.meta.desc ? t.meta.desc : undefined;
          transactions.push({
            id: t.id,
            type: t.type,
            amount: Number(t.amount) || 0,
            currency: t.currency,
            from_user: t.from_user || null,
            to_user: t.to_user || null,
            item_id: t.item_id || null,
            meta: t.meta || undefined,
            createdAt: createdIso,
            date: createdIso,
            desc,
          });
        }
      } catch (_) {}

      // News
      const news = [];
      try {
        const nres = await query(
          `SELECT id, title, content, summary, published_at, author_id, created_at, updated_at
           FROM news 
           ORDER BY published_at DESC`
        );

        const readCountsMap = new Map();
        try {
          const rc = await query('SELECT news_id, COUNT(*)::int as count FROM news_reads GROUP BY news_id');
          for (const r of rc.rows) {
            readCountsMap.set(r.news_id, Number(r.count) || 0);
          }
        } catch (_) {}

        for (const n of nres.rows) {
          const readCount = readCountsMap.get(n.id) || 0;

          news.push({
            id: n.id,
            title: n.title,
            content: n.content,
            summary: n.summary,
            publishedAt: n.published_at ? new Date(n.published_at).toISOString() : undefined,
            authorId: n.author_id,
            createdAt: n.created_at ? new Date(n.created_at).toISOString() : undefined,
            updatedAt: n.updated_at ? new Date(n.updated_at).toISOString() : undefined,
            readCount,
          });
        }
      } catch (_) {}

      // nextId kept for backward compatibility (not used with normalized tables)
      return { system, warehouse, showcaseWarehouse, users, transactions, news, showcase, directories, nextId: 1 };
    } catch (error) {
      console.error('Error in buildAggregatedData:', error);
      // Возвращаем базовую структуру данных в случае ошибки
      return {
        system: { version: '1.0.0', currencies: ['aUEC'], baseCurrency: 'aUEC', rates: { aUEC: 1 } },
        warehouse: [],
        showcaseWarehouse: [],
        users: [],
        transactions: [],
        news: [],
        showcase: [],
        directories: {
          productTypes: [],
          showcaseStatuses: [],
          warehouseTypes: [],
          productNames: [],
          categories: [],
          accountTypes: [],
        },
        nextId: 1,
      };
    }
  };

  return buildAggregatedData;
};

module.exports = { createBuildAggregatedData };
