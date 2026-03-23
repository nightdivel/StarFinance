const createAppDataCache = ({ ttlMs = 60000, maxKeys = 200 } = {}) => {
  const cache = new Map();

  const prune = (now = Date.now()) => {
    for (const [k, v] of cache.entries()) {
      if (!v || !v.expiresAt || v.expiresAt <= now) cache.delete(k);
    }
    while (cache.size > maxKeys) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  };

  const getOrSetPromise = async (key, producer) => {
    const now = Date.now();
    prune(now);

    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      if (cached.value) return cached.value;
      if (cached.promise) return cached.promise;
    }

    const promise = (async () => {
      const v = await producer();
      cache.set(key, { value: v, expiresAt: Date.now() + ttlMs });
      prune();
      return v;
    })();

    cache.set(key, { promise, expiresAt: now + ttlMs });
    return promise;
  };

  return {
    prune,
    getOrSetPromise,
    _cache: cache,
  };
};

module.exports = { createAppDataCache };
