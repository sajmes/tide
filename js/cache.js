// Shared localStorage cache with TTL.
// Used by tides, wind-swell, surfline, and buoy services.

(function() {
  'use strict';

  var DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

  function get(key, ttlMs) {
    var maxAge = ttlMs != null ? ttlMs : DEFAULT_TTL_MS;
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (Date.now() - entry.timestamp > maxAge) {
        localStorage.removeItem(key);
        return null;
      }
      return entry.data;
    } catch (e) {
      return null;
    }
  }

  function set(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (e) {
      // Storage full or disabled — silent.
    }
  }

  function clearAll(prefixes) {
    var toRemove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      for (var j = 0; j < prefixes.length; j++) {
        if (k.indexOf(prefixes[j]) === 0) {
          toRemove.push(k);
          break;
        }
      }
    }
    for (var r = 0; r < toRemove.length; r++) {
      localStorage.removeItem(toRemove[r]);
    }
  }

  window.TideCache = { get: get, set: set, clearAll: clearAll };
})();
