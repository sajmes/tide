// App orchestrator.
// Fetches data per spot, scores all windows, renders the three components.

(function() {
  'use strict';

  var AUTO_REFRESH_MS = 30 * 60 * 1000;
  var refreshTimer = null;

  var DEFAULT_PREFS = { waveMin: 1, waveMax: 4, wind: 'light' };
  var WIND_MAX_MAP = { glassy: 5, light: 10, moderate: 15, any: 50 };
  var ALL_COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

  async function init() {
    var state = {
      spotManager: new window.SpotManager(),
      tideService: new window.TideService(),
      windSwellService: new window.WindSwellService(),
      surflineService: new window.SurflineService(),
      buoyService: window.BuoyService ? new window.BuoyService() : null,
      scoringEngine: new window.ScoringEngine(),
      renderer: new window.Renderer(),
      tideDataBySpot: {},
      windSwellDataBySpot: {},
      scoredWindowsBySpot: {},
      sunData: null,
      waterTempF: null,
      airTempF: null,
      currentWind: null,
      buoyNow: null,
      userPrefs: loadUserPrefs(),
      selectedSpotId: 'all',
      isLoading: false
    };

    state.renderer.setSpots(state.spotManager.getAll());
    populateSpotFilter(state);
    setupEventListeners(state);
    await fetchAndRender(state);
    startAutoRefresh(state);
    startCountdownTicker(state);
  }

  // ---------- Prefs ----------

  function loadUserPrefs() {
    try {
      var saved = localStorage.getItem('surf-user-prefs');
      if (saved) {
        var p = JSON.parse(saved);
        return Object.assign({}, DEFAULT_PREFS, p);
      }
    } catch (e) {}
    return Object.assign({}, DEFAULT_PREFS);
  }

  function saveUserPrefs(prefs) {
    try { localStorage.setItem('surf-user-prefs', JSON.stringify(prefs)); } catch (e) {}
  }

  // Returns a deep copy of the spot with user prefs intersected into idealConditions.
  function applyPrefs(spot, prefs) {
    var merged = JSON.parse(JSON.stringify(spot));
    var ideal = merged.idealConditions;

    var minW = Math.max(ideal.waveHeightMinFt, prefs.waveMin);
    var maxW = Math.min(ideal.waveHeightMaxFt, prefs.waveMax);
    if (minW > maxW) { minW = prefs.waveMin; maxW = prefs.waveMax; }
    ideal.waveHeightMinFt = minW;
    ideal.waveHeightMaxFt = maxW;

    if (prefs.wind === 'any') {
      ideal.windDirections = ALL_COMPASS.slice();
      ideal.maxWindSpeedMph = 50;
    } else {
      var max = WIND_MAX_MAP[prefs.wind] || 50;
      ideal.maxWindSpeedMph = Math.min(ideal.maxWindSpeedMph, max);
    }
    return merged;
  }

  // ---------- Data + render ----------

  async function fetchAndRender(state) {
    if (state.isLoading) return;
    state.isLoading = true;
    document.body.classList.add('is-loading');

    try {
      var spots = state.spotManager.getAll();

      // Fetch tide + wind/swell/sun per spot in parallel.
      var perSpot = await Promise.all(spots.map(function(spot) {
        return Promise.all([
          state.tideService.fetchTidePredictions(spot.noaaStationId),
          state.windSwellService.fetchAll(spot.lat, spot.lng)
        ]).then(function(r) { return { spotId: spot.id, tide: r[0], ws: r[1] }; })
          .catch(function() { return { spotId: spot.id, tide: [], ws: { wind: null, swell: null, sun: null } }; });
      }));

      var tideDataBySpot = {};
      var windSwellDataBySpot = {};
      for (var i = 0; i < perSpot.length; i++) {
        tideDataBySpot[perSpot[i].spotId] = perSpot[i].tide;
        windSwellDataBySpot[perSpot[i].spotId] = perSpot[i].ws;
        if (!state.sunData && perSpot[i].ws && perSpot[i].ws.sun) {
          state.sunData = perSpot[i].ws.sun;
        }
      }

      // Surfline overlay per spot.
      await Promise.all(spots.map(function(spot) {
        if (!spot.surflineSpotId) return Promise.resolve();
        return state.surflineService.fetchWaveForecast(spot.surflineSpotId)
          .then(function(wave) {
            if (!wave) return;
            var ws = windSwellDataBySpot[spot.id];
            if (ws && ws.swell) {
              windSwellDataBySpot[spot.id].swell = state.surflineService.mergeSurflineWaves(ws.swell, wave);
            }
          })
          .catch(function() {});
      }));

      // Water temp from NOAA San Diego (9410230 has no temp sensor — 9410170 does).
      try {
        var temp = await state.tideService.fetchWaterTemp('9410170');
        if (temp != null) state.waterTempF = temp;
      } catch (e) {}

      // Buoy nowcast (Phase 4) — non-blocking.
      if (state.buoyService) {
        try {
          var buoy = await state.buoyService.fetchLatest();
          if (buoy) state.buoyNow = buoy;
        } catch (e) {}
      }

      state.tideDataBySpot = tideDataBySpot;
      state.windSwellDataBySpot = windSwellDataBySpot;

      // Score every window per spot, with user prefs applied.
      var scoredWindowsBySpot = {};
      for (var s = 0; s < spots.length; s++) {
        var spot = spots[s];
        var scoringSpot = applyPrefs(spot, state.userPrefs);
        var ws = windSwellDataBySpot[spot.id];
        scoredWindowsBySpot[spot.id] = state.scoringEngine.scoreAllWindows(
          scoringSpot,
          tideDataBySpot[spot.id],
          ws.wind,
          ws.swell
        );
      }
      state.scoredWindowsBySpot = scoredWindowsBySpot;

      // Pull current air temp + wind from any spot's hourly data.
      pullCurrentAirAndWind(state);

      // Render.
      state.renderer.renderNowStrip(state);
      state.renderer.renderHero(state);
      state.renderer.renderOutlook(state);

      updateHeader(state);
    } finally {
      state.isLoading = false;
      document.body.classList.remove('is-loading');
    }
  }

  function pullCurrentAirAndWind(state) {
    state.airTempF = null;
    state.currentWind = null;
    var nowMs = Date.now();
    var spots = state.spotManager.getAll();
    for (var s = 0; s < spots.length; s++) {
      var ws = state.windSwellDataBySpot[spots[s].id];
      if (!ws || !ws.wind || !ws.wind.times) continue;
      for (var k = 0; k < ws.wind.times.length; k++) {
        var t = new Date(ws.wind.times[k]).getTime();
        if (Math.abs(t - nowMs) < 3600000) {
          if (ws.wind.airTemp && ws.wind.airTemp[k] != null) state.airTempF = ws.wind.airTemp[k];
          if (ws.wind.windSpeed && ws.wind.windSpeed[k] != null) {
            state.currentWind = {
              speed: ws.wind.windSpeed[k],
              gusts: ws.wind.windGusts ? ws.wind.windGusts[k] : null,
              dir: ws.wind.windDirection ? window.ScoringEngine.degreesToCompass(ws.wind.windDirection[k]) : null
            };
          }
          break;
        }
      }
      if (state.airTempF != null && state.currentWind) break;
    }
  }

  function updateHeader(state) {
    var dateEl = document.getElementById('current-date');
    if (dateEl) {
      var d = new Date();
      dateEl.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }
  }

  // ---------- Auto refresh + countdown tick ----------

  function startAutoRefresh(state) {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function() {
      window.TideCache.clearAll(['tides-','wind-','swell-','surfline-','sun-','watertemp-','buoy-']);
      fetchAndRender(state);
    }, AUTO_REFRESH_MS);
  }

  // Re-render the hero every minute so countdown stays current.
  function startCountdownTicker(state) {
    setInterval(function() { state.renderer.renderHero(state); }, 60 * 1000);
  }

  // ---------- Event wiring ----------

  function populateSpotFilter(state) {
    var sel = document.getElementById('spot-filter');
    if (!sel) return;
    var spots = state.spotManager.getAll();
    sel.innerHTML = '<option value="all">All Spots (best)</option>';
    for (var i = 0; i < spots.length; i++) {
      var o = document.createElement('option');
      o.value = spots[i].id;
      o.textContent = spots[i].name;
      sel.appendChild(o);
    }
    sel.value = state.selectedSpotId;
  }

  function setupEventListeners(state) {
    var refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function() {
        window.TideCache.clearAll(['tides-','wind-','swell-','surfline-','sun-','watertemp-','buoy-']);
        fetchAndRender(state);
      });
    }

    var spotFilter = document.getElementById('spot-filter');
    if (spotFilter) {
      spotFilter.addEventListener('change', function() {
        state.selectedSpotId = spotFilter.value;
        state.renderer.renderOutlook(state);
      });
    }

    var settingsBtn = document.getElementById('btn-settings');
    var settingsPanel = document.getElementById('settings-panel');
    if (settingsBtn && settingsPanel) {
      settingsBtn.addEventListener('click', function() {
        settingsPanel.toggleAttribute('hidden');
        if (!settingsPanel.hasAttribute('hidden')) populateSettings(state);
      });
    }

    var savePrefsBtn = document.getElementById('btn-save-prefs');
    if (savePrefsBtn) {
      savePrefsBtn.addEventListener('click', function() {
        var newPrefs = readPrefsFromUI();
        if (!newPrefs) return;
        state.userPrefs = newPrefs;
        saveUserPrefs(newPrefs);
        rescore(state);
      });
    }
  }

  function populateSettings(state) {
    var p = state.userPrefs;
    var fields = {
      'pref-wave-min': p.waveMin,
      'pref-wave-max': p.waveMax,
      'pref-wind': p.wind
    };
    for (var id in fields) {
      var el = document.getElementById(id);
      if (el) el.value = fields[id];
    }
  }

  function readPrefsFromUI() {
    var minEl = document.getElementById('pref-wave-min');
    var maxEl = document.getElementById('pref-wave-max');
    var windEl = document.getElementById('pref-wind');
    if (!minEl || !maxEl || !windEl) return null;
    return {
      waveMin: parseFloat(minEl.value) || 1,
      waveMax: parseFloat(maxEl.value) || 4,
      wind: windEl.value || 'light'
    };
  }

  function rescore(state) {
    var spots = state.spotManager.getAll();
    var scoredWindowsBySpot = {};
    for (var i = 0; i < spots.length; i++) {
      var spot = spots[i];
      var scoringSpot = applyPrefs(spot, state.userPrefs);
      var ws = state.windSwellDataBySpot[spot.id];
      if (!ws) continue;
      scoredWindowsBySpot[spot.id] = state.scoringEngine.scoreAllWindows(
        scoringSpot, state.tideDataBySpot[spot.id], ws.wind, ws.swell
      );
    }
    state.scoredWindowsBySpot = scoredWindowsBySpot;
    state.renderer.renderHero(state);
    state.renderer.renderOutlook(state);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
