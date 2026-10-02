class TtlCache {
  constructor({ maxEntries = 2000 } = {}) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.map.size >= this.maxEntries) {
      // Evict oldest entry
      const oldestKey = this.map.keys().next().value;
      if (oldestKey) this.map.delete(oldestKey);
    }
    this.map.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}

class SingleFlight {
  constructor() {
    this.inFlight = new Map();
  }

  async run(key, fn) {
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}

module.exports = {
  TtlCache,
  SingleFlight,
};
