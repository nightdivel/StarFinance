const http = require('http');
const express = require('express');
const cors = require('cors');
const { query } = require('../../db');
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const { createServiceApp } = require('../_shared/createServiceApp');

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'directories-service';

const app = createServiceApp();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

const readSettingsMap = async () => {
  const map = {};
  try {
    const res = await query('SELECT key, value FROM settings');
    for (const r of res.rows) {
      map[r.key] = r.value;
    }
  } catch (_) {}
  return map;
};

async function loadDirectoriesFromDb() {
  const productTypes = await (async () => {
    try {
      const r = await query('SELECT name FROM product_types ORDER BY name');
      return r.rows.map((x) => x.name);
    } catch {
      return [];
    }
  })();

  const showcaseStatuses = await (async () => {
    try {
      const r = await query('SELECT name FROM showcase_statuses ORDER BY name');
      return r.rows.map((x) => x.name);
    } catch {
      return [];
    }
  })();

  const warehouseTypes = await (async () => {
    try {
      const r = await query('SELECT name FROM warehouse_types ORDER BY name');
      return r.rows.map((x) => x.name);
    } catch {
      return [];
    }
  })();

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
        type: x.type || null,
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

  const categories = await (async () => {
    try {
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

      const fromTypes = (
        await query(`SELECT name, uex_category FROM product_types WHERE name IS NOT NULL`)
      ).rows.map((x) => ({
        id: null,
        name: x.name || null,
        section: x.uex_category || null,
      }));

      const all = [...fromNames, ...fromTypes];
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

  const accountTypes = [];
  try {
    const at = await query('SELECT name FROM account_types ORDER BY name');
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
      accountTypes.push({ name: row.name, permissions: permObj, allowedWarehouseTypes });
    }
  } catch (_) {}

  const uexSync = await (async () => {
    try {
      const r = await query('SELECT resource, last_sync_at, last_uex_marker, meta FROM uex_sync_state ORDER BY last_sync_at DESC');
      return r.rows;
    } catch {
      return [];
    }
  })();

  return {
    productTypes,
    showcaseStatuses,
    warehouseTypes,
    productNames,
    categories,
    accountTypes,
    uex_sync: uexSync,
  };
}

app.get('/api/directories', authenticateToken, requirePermission('directories', 'read'), async (req, res) => {
  try {
    const dirs = await loadDirectoriesFromDb();
    res.json({ success: true, directories: dirs });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения справочников' });
  }
});

app.post('/api/directories/product-types', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Некорректное имя типа' });
    await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name.trim()]);
    const dirs = await loadDirectoriesFromDb();
    res.json({ success: true, directories: dirs });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения типа' });
  }
});

app.delete('/api/directories/product-types/:name', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    if (!name) return res.status(400).json({ error: 'Имя не указано' });
    await query('DELETE FROM product_types WHERE name = $1', [name]);
    const dirs = await loadDirectoriesFromDb();
    res.json({ success: true, directories: dirs });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления типа' });
  }
});

app.post('/api/directories/showcase-statuses', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Некорректное имя статуса' });
    await query('INSERT INTO showcase_statuses(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name.trim()]);
    const dirs = await loadDirectoriesFromDb();
    res.json({ success: true, directories: dirs });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения статуса' });
  }
});

app.delete('/api/directories/showcase-statuses/:name', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    if (!name) return res.status(400).json({ error: 'Имя не указано' });
    await query('DELETE FROM showcase_statuses WHERE name = $1', [name]);
    const dirs = await loadDirectoriesFromDb();
    res.json({ success: true, directories: dirs });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления статуса' });
  }
});

app.post('/api/directories/warehouse-types', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Некорректное имя типа склада' });
    await query('INSERT INTO warehouse_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name.trim()]);
    const dirs = await loadDirectoriesFromDb();
    res.json({ success: true, directories: dirs });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения типа склада' });
  }
});

app.delete('/api/directories/warehouse-types/:name', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    if (!name) return res.status(400).json({ error: 'Имя не указано' });
    await query('DELETE FROM warehouse_types WHERE name = $1', [name]);
    const dirs = await loadDirectoriesFromDb();
    res.json({ success: true, directories: dirs });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления типа склада' });
  }
});

app.post('/api/directories/product-names', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const { name, type } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Некорректное имя' });
    if (type) {
      await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [type]);
    }
    await query(
      `INSERT INTO product_names(name, type)
       VALUES ($1,$2)
       ON CONFLICT (name) DO UPDATE SET
         type = EXCLUDED.type`,
      [name.trim(), type || null]
    );
    let dirs = null;
    try {
      dirs = await loadDirectoriesFromDb();
    } catch (err) {
      console.error('loadDirectoriesFromDb failed after product-names insert:', err);
    }
    if (dirs) res.json({ success: true, directories: dirs });
    else res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения наименования' });
  }
});

app.put('/api/directories/product-names/:name', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const currentName = decodeURIComponent(req.params.name || '');
    const { name, type, section, uexType, uexCategoryId } = req.body || {};
    if (!currentName) return res.status(400).json({ error: 'Имя не указано' });
    if (type) {
      await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [type]);
    }
    if (name && name !== currentName) {
      const newName = name.trim();
      await query(
        `UPDATE product_names
         SET name = $2,
             type = COALESCE($3, type)
         WHERE name = $1`,
        [currentName, newName, type || null]
      );
    } else {
      await query(
        `UPDATE product_names
         SET type            = COALESCE($2, type),
             uex_type        = COALESCE($3, uex_type),
             uex_section     = COALESCE($4, uex_section),
             uex_category_id = COALESCE($5, uex_category_id)
         WHERE name = $1`,
        [currentName, type || null, uexType || null, section || null, uexCategoryId || null]
      );
    }

    let dirs = null;
    try {
      dirs = await loadDirectoriesFromDb();
    } catch (err) {
      console.error('loadDirectoriesFromDb failed after product-names update:', err);
    }
    if (dirs) res.json({ success: true, directories: dirs });
    else res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка обновления наименования' });
  }
});

app.delete('/api/directories/product-names/:name', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    if (!name) return res.status(400).json({ error: 'Имя не указано' });
    await query('DELETE FROM product_names WHERE name = $1', [name]);
    const dirs = await loadDirectoriesFromDb();
    res.json({ success: true, directories: dirs });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления наименования' });
  }
});

// Product Names with UEX fields (read-only view)
app.get('/api/directories/product-names-uex', authenticateToken, requirePermission('directories', 'read'), async (req, res) => {
  try {
    const s = await readSettingsMap();
    const baseCurrency = s['system.baseCurrency'] ?? 'aUEC';
    const cres = await query('SELECT code FROM currencies ORDER BY code');
    const codes = cres.rows.map((r) => r.code);
    const rres = await query('SELECT code, rate FROM currency_rates WHERE base_code = $1', [baseCurrency]);
    const rates = Object.fromEntries(rres.rows.map((r) => [r.code, Number(r.rate)]));
    res.json({ currencies: codes, baseCurrency, rates });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения валют' });
  }
});

const port = Number(process.env.PORT || 3002);
http.createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`[directories-service] listening on :${port}`);
});
