const http = require('http');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { query } = require('../../db');
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const { createServiceApp } = require('../_shared/createServiceApp');

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'uex-service';

const app = createServiceApp();

// CORS is mainly handled by the gateway, but keep a safe default for direct access
app.use(cors({ origin: true, credentials: true }));

// Body parsers for sync-directories
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

// ---- UEX API proxy and sync ----
// Base docs: https://uexcorp.space/api/documentation/
// Public base URL: https://api.uexcorp.space/2.0
const UEX_BASE_URL = (process.env.UEX_API_BASE_URL || 'https://api.uexcorp.space/2.0').replace(/\/$/, '');
const UEX_COMPANY_ID = process.env.UEX_COMPANY_ID || process.env.VITE_UEX_COMPANY_ID || null;
const UEX_AXIOS_TIMEOUT_MS = Number(process.env.UEX_AXIOS_TIMEOUT_MS || 120000);

function buildUexUrl(resource = '', pathPart = '', params = {}) {
  const base = (UEX_BASE_URL || '').replace(/\/$/, '');
  const res = String(resource || '').replace(/^\//, '').replace(/\/$/, '');
  const p = String(pathPart || '').replace(/^\//, '');
  const url = p ? `${base}/${res}/${p}` : `${base}/${res}`;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach((vv) => usp.append(k, String(vv)));
    else usp.append(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${url}?${qs}` : url;
}

async function upsertUexDirectories({ categories, items }) {
  let productTypesCreated = 0;
  let productTypesUpdated = 0;
  let productNamesCreated = 0;
  let productNamesUpdated = 0;

  if (Array.isArray(items) && items.length > 0) {
    try {
      await query('UPDATE product_types SET uex_category = NULL');
      await query(
        `UPDATE product_names
         SET type = NULL,
             uex_id = NULL,
             uex_type = NULL,
             uex_section = NULL,
             uex_category_id = NULL,
             uex_category = NULL,
             uex_subcategory = NULL,
             uex_meta = NULL
         WHERE uex_id IS NOT NULL
            OR uex_type IS NOT NULL
            OR uex_category_id IS NOT NULL
            OR uex_category IS NOT NULL`
      );
    } catch (e) {
      console.error('upsertUexDirectories: failed to reset previous UEX data:', e);
    }
  }

  const categoryById = new Map();
  if (Array.isArray(categories)) {
    for (const cat of categories) {
      const catId =
        cat?.id != null
          ? String(cat.id)
          : cat?.uuid != null
          ? String(cat.uuid)
          : cat?.category_id != null
          ? String(cat.category_id)
          : null;
      const catName = (cat?.name || cat?.title || '').toString().trim();
      const section = (cat?.section || cat?.category || cat?.slug || '').toString().trim() || null;

      if (catId) {
        categoryById.set(catId, { id: catId, name: catName, section, raw: cat });
      }

      const typeName = section || catName;
      if (!typeName) continue;

      const uexCategory = catName;
      const { rowCount } = await query('SELECT 1 FROM product_types WHERE name = $1', [typeName]);
      if (rowCount === 0) {
        await query(
          'INSERT INTO product_types(name, uex_category) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
          [typeName, uexCategory]
        );
        productTypesCreated += 1;
      } else {
        await query('UPDATE product_types SET uex_category = COALESCE($2, uex_category) WHERE name = $1', [
          typeName,
          uexCategory,
        ]);
        productTypesUpdated += 1;
      }
    }
  }

  if (Array.isArray(items)) {
    console.log(`[UEX SYNC] Processing ${items.length} items for database...`);
    for (const it of items) {
      const name = (it?.name || it?.title || '').toString().trim();
      if (!name) continue;

      const catIdRaw =
        it?.id_category != null
          ? String(it.id_category)
          : it?.category_id != null
          ? String(it.category_id)
          : it?.categoryId != null
          ? String(it.categoryId)
          : null;
      const category = catIdRaw ? categoryById.get(catIdRaw) : null;
      const section = category?.section || (it?.section || it?.category_section || null);
      const sectionLc = section ? section.toString().toLowerCase() : '';
      const uexType = sectionLc && (sectionLc === 'services' || sectionLc === 'service') ? 'service' : 'item';
      const productTypeName = section || category?.name || null;

      const uexId = it?.id != null ? String(it.id) : it?.uuid != null ? String(it.uuid) : null;
      const uexCategoryId = catIdRaw;
      const uexCategory =
        category?.name ||
        (typeof it?.category === 'string' && it.category.trim() !== '' ? it.category.trim() : null) ||
        (typeof it?.category_name === 'string' && it.category_name.trim() !== '' ? it.category_name.trim() : null);
      const uexSubcategory = null;
      const meta = {
        uexId,
        uexType,
        uexSection: section,
        uexCategoryId,
        uexCategoryName: uexCategory,
        raw: it,
      };

      const existing = await query('SELECT name FROM product_names WHERE name = $1', [name]);
      if (existing.rowCount === 0) {
        await query(
          `INSERT INTO product_names(name, type, uex_id, uex_type, uex_section, uex_category_id, uex_category, uex_subcategory, uex_meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (name) DO UPDATE SET
             type = EXCLUDED.type,
             uex_id = EXCLUDED.uex_id,
             uex_type = EXCLUDED.uex_type,
             uex_section = EXCLUDED.uex_section,
             uex_category_id = EXCLUDED.uex_category_id,
             uex_category = EXCLUDED.uex_category,
             uex_subcategory = EXCLUDED.uex_subcategory,
             uex_meta = EXCLUDED.uex_meta`,
          [
            name,
            productTypeName,
            uexId,
            uexType,
            section,
            uexCategoryId,
            uexCategory,
            uexSubcategory,
            meta,
          ]
        );
        productNamesCreated += 1;
      } else {
        await query(
          `UPDATE product_names
           SET type = COALESCE($2, type),
               uex_id = COALESCE($3, uex_id),
               uex_type = COALESCE($4, uex_type),
               uex_section = COALESCE($5, uex_section),
               uex_category_id = COALESCE($6, uex_category_id),
               uex_category = COALESCE($7, uex_category),
               uex_subcategory = COALESCE($8, uex_subcategory),
               uex_meta = $9
           WHERE name = $1`,
          [
            name,
            productTypeName,
            uexId,
            uexType,
            section,
            uexCategoryId,
            uexCategory,
            uexSubcategory,
            meta,
          ]
        );
        productNamesUpdated += 1;
      }
    }
  }

  // Записываем результат синхронизации в uex_sync_state
  try {
    const now = new Date().toISOString();
    await query(`
      INSERT INTO uex_sync_state (resource, last_sync_at, last_uex_marker, meta)
      VALUES ('directories', $1, $2, $3)
      ON CONFLICT (resource) DO UPDATE SET
        last_sync_at = EXCLUDED.last_sync_at,
        last_uex_marker = EXCLUDED.last_uex_marker,
        meta = EXCLUDED.meta
    `, [
      now,
      now,
      JSON.stringify({
        productTypesCreated,
        productTypesUpdated,
        productNamesCreated,
        productNamesUpdated,
        timestamp: now
      })
    ]);
    console.log(`[UEX SYNC] Sync state updated: ${now}`);
  } catch (e) {
    console.error('[UEX SYNC] Error updating sync state:', e);
  }

  return { productTypesCreated, productTypesUpdated, productNamesCreated, productNamesUpdated };
}

// Simple GET proxy used by frontend UEX tool (uexApiService.js in proxy mode)
app.get('/api/uex', authenticateToken, async (req, res) => {
  try {
    const { resource, path: p, ...rest } = req.query || {};
    const resourceStr = String(resource || '').trim();
    if (!resourceStr) return res.status(400).json({ error: 'resource is required' });
    const url = buildUexUrl(resourceStr, p || '', rest);

    const token = req.headers['x-uex-token'] || process.env.UEX_API_TOKEN || process.env.VITE_UEX_API_TOKEN;
    const clientVersion =
      req.headers['x-uex-client-version'] || process.env.UEX_CLIENT_VERSION || process.env.VITE_UEX_CLIENT_VERSION;

    const baseHeaders = {
      Accept: 'application/json',
      ...(clientVersion ? { 'X-Client-Version': String(clientVersion) } : {}),
    };

    const attempts = [];
    if (token) {
      const t = String(token).trim();
      attempts.push({ ...baseHeaders, Authorization: `Bearer ${t}`, 'X-API-Key': t });
      attempts.push({ ...baseHeaders, 'X-API-Key': t });
      attempts.push({ ...baseHeaders, Authorization: `Token ${t}` });
    } else {
      attempts.push(baseHeaders);
    }

    let lastErr;
    for (const h of attempts) {
      try {
        const resp = await axios.get(url, { headers: h, timeout: UEX_AXIOS_TIMEOUT_MS });
        return res.status(resp.status).json(resp.data);
      } catch (e) {
        const status = e?.response?.status;
        if (status === 401 || status === 403) {
          lastErr = e;
          continue;
        }
        const body = e?.response?.data;
        return res.status(status || 500).json({ error: 'UEX proxy error', status, body });
      }
    }
    if (lastErr) {
      const status = lastErr?.response?.status || 401;
      const body = lastErr?.response?.data;
      return res.status(status).json({ error: 'UEX authorization failed', status, body });
    }
    return res.status(500).json({ error: 'UEX proxy failed' });
  } catch (e) {
    console.error('GET /api/uex error:', e);
    res.status(500).json({ error: 'Ошибка прокси UEX' });
  }
});

// Sync UEX directories into local DB
app.post(
  '/api/uex/sync-directories',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const { full } = req.body || {};

      const deadlineMs = Number(process.env.UEX_SYNC_DEADLINE_MS || 8 * 60 * 1000);
      const startedAt = Date.now();
      const isTimedOut = () => Date.now() - startedAt > deadlineMs;

      const maxCategories = Number(process.env.UEX_SYNC_MAX_CATEGORIES || 200);
      const concurrency = Math.max(1, Number(process.env.UEX_SYNC_CONCURRENCY || 6));

      const token = req.headers['x-uex-token'] || process.env.UEX_API_TOKEN || process.env.VITE_UEX_API_TOKEN;
      const clientVersion =
        req.headers['x-uex-client-version'] || process.env.UEX_CLIENT_VERSION || process.env.VITE_UEX_CLIENT_VERSION;
      const baseHeaders = {
        Accept: 'application/json',
        ...(clientVersion ? { 'X-Client-Version': String(clientVersion) } : {}),
      };

      const attempts = [];
      if (token) {
        const t = String(token).trim();
        attempts.push({ ...baseHeaders, Authorization: `Bearer ${t}`, 'X-API-Key': t });
        attempts.push({ ...baseHeaders, 'X-API-Key': t });
        attempts.push({ ...baseHeaders, Authorization: `Token ${t}` });
      } else {
        attempts.push(baseHeaders);
      }

      async function fetchUex(resource, params = {}) {
        const finalParams = { ...params };
        if (resource === 'items' && UEX_COMPANY_ID) {
          if (!finalParams.id_company) {
            finalParams.id_company = UEX_COMPANY_ID;
          }
        }
        const url = buildUexUrl(resource, '', finalParams);
        let lastErr;
        for (const h of attempts) {
          try {
            const resp = await axios.get(url, { headers: h, timeout: UEX_AXIOS_TIMEOUT_MS });
            return resp.data;
          } catch (e) {
            const status = e?.response?.status;
            if (status === 401 || status === 403) {
              lastErr = e;
              continue;
            }
            throw e;
          }
        }
        if (lastErr) throw lastErr;
        throw new Error('UEX request failed');
      }

      const catsRaw = await fetchUex('categories').catch(() => []);
      const categories = Array.isArray(catsRaw?.data) ? catsRaw.data : Array.isArray(catsRaw) ? catsRaw : [];

      let items = [];
      if (Array.isArray(categories) && categories.length > 0) {
        console.log(`[UEX SYNC] Processing ${categories.length} categories for items...`);
        const byCat = [];

        const mapLimit = async (arr, limit, mapper) => {
          const results = new Array(arr.length);
          let idx = 0;
          const workers = new Array(Math.min(limit, arr.length)).fill(0).map(async () => {
            while (idx < arr.length) {
              const cur = idx++;
              if (isTimedOut()) return;
              try {
                results[cur] = await mapper(arr[cur], cur);
              } catch (e) {
                results[cur] = null;
              }
            }
          });
          await Promise.all(workers);
          return results;
        };

        await mapLimit(categories.slice(0, maxCategories), concurrency, async (cat) => {
          if (isTimedOut()) return null;
          const catId =
            cat?.id != null
              ? String(cat.id)
              : cat?.uuid != null
              ? String(cat.uuid)
              : cat?.category_id != null
              ? String(cat.category_id)
              : null;
          if (!catId) {
            console.log(`[UEX SYNC] Skipping category without ID:`, cat);
            return null;
          }
          try {
            const raw = await fetchUex('items', { id_category: catId }).catch(() => []);
            const arr = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
            console.log(`[UEX SYNC] Category ${catId} (${cat.name || 'unnamed'}): ${arr.length} items`);
            if (Array.isArray(arr) && arr.length > 0) byCat.push(...arr);
            return arr.length;
          } catch (e) {
            console.error(`[UEX SYNC] Error fetching items for category ${catId}:`, e.message);
            return null;
          }
        });
        console.log(`[UEX SYNC] Total items collected: ${byCat.length}`);
        if (byCat.length > 0) items = byCat;
      }

      if (
        (full === true || full === 'true') &&
        (!Array.isArray(items) || items.length === 0) &&
        Array.isArray(categories) &&
        categories.length > 0
      ) {
        // Additional full sync logic if needed (already covered above)
      }

      if (isTimedOut()) {
        return res.status(503).json({ success: false, error: 'UEX sync timeout' });
      }

      const stats = await upsertUexDirectories({ categories, items });
      const now = new Date();
      res.json({ success: true, syncedAt: now.toISOString(), ...stats });
    } catch (e) {
      console.error('POST /api/uex/sync-directories error:', e?.response?.data || e);
      const status = e?.response?.status || 500;
      const body = e?.response?.data;
      res.status(status).json({ success: false, error: 'Ошибка синхронизации UEX', detail: body });
    }
  }
);

const port = Number(process.env.PORT || 3007);
http.createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`[uex-service] listening on :${port}`);
});
