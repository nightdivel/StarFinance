// UEX API client for GET endpoints
// Base docs: https://uexcorp.space/api/documentation/
// Usage patterns: https://api.uexcorp.uk/2.0/{resource}/?param=value

const UEX_BASE_URL = (import.meta.env.VITE_UEX_API_BASE_URL || 'https://api.uexcorp.uk/2.0').replace(/\/$/, '');
const USE_PROXY = String(import.meta.env.VITE_UEX_USE_PROXY ?? 'true') !== 'false';
let RUNTIME_TOKEN = '';
let RUNTIME_CLIENT_VERSION = '';
try {
  const saved = typeof window !== 'undefined' ? localStorage.getItem('uex.api.token') : '';
  if (saved) RUNTIME_TOKEN = String(saved).trim();
} catch (_) {}
try {
  const savedV = typeof window !== 'undefined' ? localStorage.getItem('uex.client.version') : '';
  if (savedV) RUNTIME_CLIENT_VERSION = String(savedV).trim();
} catch (_) {}
if (!RUNTIME_TOKEN && import.meta.env.VITE_UEX_API_TOKEN) RUNTIME_TOKEN = String(import.meta.env.VITE_UEX_API_TOKEN).trim();
if (!RUNTIME_CLIENT_VERSION && import.meta.env.VITE_UEX_CLIENT_VERSION) RUNTIME_CLIENT_VERSION = String(import.meta.env.VITE_UEX_CLIENT_VERSION).trim();

function buildQuery(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of entries) {
    if (Array.isArray(v)) {
      for (const item of v) usp.append(k, String(item));
    } else {
      usp.append(k, String(v));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

class UexApiService {
  constructor() {
    this.baseURL = UEX_BASE_URL;
  }

  buildUrl(resource = '', path = '', params = undefined) {
    const base = (this.baseURL || '').replace(/\/$/, '');
    const res = String(resource || '').replace(/^\//, '').replace(/\/$/, '');
    const p = String(path || '').replace(/^\//, '');
    const url = p ? `${base}/${res}/${p}` : `${base}/${res}`;
    const qs = buildQuery(params);
    return url + qs;
  }

  async get(resource, { path = '', params, signal, headers = {} } = {}) {
    if (USE_PROXY) {
      const usp = new URLSearchParams();
      usp.set('resource', String(resource || '').replace(/^\//, ''));
      if (path) usp.set('path', String(path).replace(/^\//, ''));
      if (params && typeof params === 'object') {
        for (const [k, v] of Object.entries(params)) {
          if (v == null || v === '') continue;
          if (Array.isArray(v)) v.forEach((vv) => usp.append(k, String(vv)));
          else usp.append(k, String(v));
        }
      }
      const url = `./api/uex?${usp.toString()}`;
      const appToken = typeof window !== 'undefined' ? localStorage.getItem('authToken') : '';
      const h = {
        Accept: 'application/json',
        ...(appToken ? { Authorization: `Bearer ${appToken}` } : {}),
        ...(RUNTIME_TOKEN ? { 'x-uex-token': RUNTIME_TOKEN } : {}),
        ...(RUNTIME_CLIENT_VERSION ? { 'x-uex-client-version': RUNTIME_CLIENT_VERSION } : {}),
        ...headers,
      };
      const resp = await fetch(url, { method: 'GET', headers: h, signal });
      let body = '';
      if (!resp.ok) {
        try { body = await resp.text(); } catch {}
        const err = new Error(`UEX proxy HTTP ${resp.status}`);
        err.status = resp.status;
        err.body = body;
        err.url = url;
        throw err;
      }
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('application/json')) return resp.json();
      try { return await resp.json(); } catch {}
      return await resp.text();
    }

    // Direct mode (no proxy)
    const url = this.buildUrl(resource, path, params);
    const baseHeaders = {
      Accept: 'application/json',
      ...(RUNTIME_CLIENT_VERSION ? { 'X-Client-Version': RUNTIME_CLIENT_VERSION } : {}),
      ...headers,
    };
    const attempts = [];
    if (RUNTIME_TOKEN) {
      attempts.push({ ...baseHeaders, Authorization: `Bearer ${RUNTIME_TOKEN}`, 'X-API-Key': RUNTIME_TOKEN });
      attempts.push({ ...baseHeaders, 'X-API-Key': RUNTIME_TOKEN });
      attempts.push({ ...baseHeaders, Authorization: `Token ${RUNTIME_TOKEN}` });
    } else {
      attempts.push(baseHeaders);
    }
    let lastErr;
    for (const h of attempts) {
      const resp = await fetch(url, { method: 'GET', headers: h, signal });
      let bodyText = '';
      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
          try { bodyText = await resp.text(); } catch {}
          lastErr = new Error(`UEX HTTP ${resp.status}`);
          lastErr.status = resp.status;
          lastErr.body = bodyText;
          lastErr.url = url;
          continue;
        }
        try { bodyText = await resp.text(); } catch {}
        const err = new Error(`UEX HTTP ${resp.status}`);
        err.status = resp.status;
        err.body = bodyText;
        err.url = url;
        throw err;
      }
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('application/json')) return resp.json();
      try { return await resp.json(); } catch {}
      return await resp.text();
    }
    if (lastErr) throw lastErr;
    const err = new Error('UEX request failed');
    err.url = url;
    throw err;
  }

  setToken(token) {
    RUNTIME_TOKEN = String(token || '').trim();
    try { if (typeof window !== 'undefined') localStorage.setItem('uex.api.token', RUNTIME_TOKEN); } catch (_) {}
  }

  setClientVersion(version) {
    RUNTIME_CLIENT_VERSION = String(version || '').trim();
    try { if (typeof window !== 'undefined') localStorage.setItem('uex.client.version', RUNTIME_CLIENT_VERSION); } catch (_) {}
  }

  getToken() {
    return RUNTIME_TOKEN;
  }

  // Convenience helpers for common GET resources
  getCategories(options = {}) { return this.get('categories', options); }
  getItems(options = {}) { return this.get('items', options); }
  getItemsAttributes(options = {}) { return this.get('items_attributes', options); }
  getCategoriesAttributes(options = {}) { return this.get('categories_attributes', options); }
  getCommodities(options = {}) { return this.get('commodities', options); }
  getCommoditiesPrices(options = {}) { return this.get('commodities_prices', options); }
  getCommoditiesPricesAll(options = {}) { return this.get('commodities_prices_all', options); }
  getCommoditiesPricesHistory(options = {}) { return this.get('commodities_prices_history', options); }
  getFuelPrices(options = {}) { return this.get('fuel_prices', options); }
  getFuelPricesAll(options = {}) { return this.get('fuel_prices_all', options); }
  getSpaceStations(options = {}) { return this.get('space_stations', options); }
  getPlanets(options = {}) { return this.get('planets', options); }
  getMoons(options = {}) { return this.get('moons', options); }
  getTerminals(options = {}) { return this.get('terminals', options); }
  getTerminalsDistances(options = {}) { return this.get('terminals_distances', options); }
  getStarSystems(options = {}) { return this.get('star_systems', options); }
  getJumpPoints(options = {}) { return this.get('jump_points', options); }
  getCities(options = {}) { return this.get('cities', options); }
  getCompanies(options = {}) { return this.get('companies', options); }
  getOrganizations(options = {}) { return this.get('organizations', options); }
  getFactions(options = {}) { return this.get('factions', options); }
  getVehicles(options = {}) { return this.get('vehicles', options); }
  // Add more as needed, using the generic get(resource, { params })
}

export const uexApi = new UexApiService();
export default UexApiService;
