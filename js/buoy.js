// NDBC buoy service.
// Pulls real-time wave spectra from buoys near San Diego for nowcast accuracy.
// Primary: 46225 (Torrey Pines outer) — open-ocean swell ground truth.
// Fallback chain handles temporary outages.
//
// Output: { heightFt, periodS, dirDeg, dirCompass, observedAt, station }
//
// Why a separate buoy: Surfline gives forecast model output. Buoys give what
// the ocean is actually doing right this minute, updated every ~30min. Useful
// both as a "right now" signal and as a more accurate calibration source.

(function() {
  'use strict';

  // Order: try outer first, then nearshore. Add more if needed.
  var STATIONS = ['46225', '46266'];
  var COMPASS_16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  var BUOY_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes — buoys post every ~30 min.

  function metersToFeet(m) { return m * 3.28084; }

  function degreesToCompass(deg) {
    if (deg == null || isNaN(deg)) return null;
    var d = ((deg % 360) + 360) % 360;
    return COMPASS_16[Math.round(d / 22.5) % 16];
  }

  function BuoyService() {}

  // NDBC publishes plain-text "spec" files at:
  //   https://www.ndbc.noaa.gov/data/realtime2/{station}.spec
  // Format: header line, units line, then most-recent observation first.
  // Columns we want: WVHT (m), DPD (s), MWD (deg).
  BuoyService.prototype.fetchLatest = async function() {
    for (var i = 0; i < STATIONS.length; i++) {
      var result = await this._fetchStation(STATIONS[i]);
      if (result) return result;
    }
    return null;
  };

  BuoyService.prototype._fetchStation = async function(station) {
    var cacheKey = 'buoy-' + station;
    var cached = window.TideCache.get(cacheKey, BUOY_CACHE_TTL_MS);
    if (cached) return cached;

    var url = 'https://www.ndbc.noaa.gov/data/realtime2/' + station + '.spec';
    try {
      var response = await fetch(url);
      if (!response.ok) return null;
      var text = await response.text();
      var parsed = parseBuoySpec(text, station);
      if (parsed) window.TideCache.set(cacheKey, parsed);
      return parsed;
    } catch (e) {
      console.warn('Buoy fetch failed for ' + station, e);
      return null;
    }
  };

  // Parse NDBC .spec file. First two lines are headers (column names + units),
  // remaining lines are observations newest-first. We want the first non-MM row.
  function parseBuoySpec(text, station) {
    if (!text) return null;
    var lines = text.split('\n').filter(function(l) { return l.trim().length > 0; });
    if (lines.length < 3) return null;

    var header = lines[0].replace(/^#/, '').trim().split(/\s+/);
    var idxWVHT = header.indexOf('WVHT');
    var idxDPD = header.indexOf('DPD');
    var idxMWD = header.indexOf('MWD');
    var idxYY = header.indexOf('YY') >= 0 ? header.indexOf('YY') : header.indexOf('#YY');
    var idxMM = header.indexOf('MM');
    var idxDD = header.indexOf('DD');
    var idxhh = header.indexOf('hh');
    var idxmm = header.indexOf('mm');
    if (idxWVHT < 0 || idxDPD < 0 || idxMWD < 0) return null;

    for (var i = 2; i < lines.length; i++) {
      var cols = lines[i].trim().split(/\s+/);
      var wvht = parseFloat(cols[idxWVHT]);
      var dpd = parseFloat(cols[idxDPD]);
      var mwd = parseFloat(cols[idxMWD]);
      if (isNaN(wvht) || isNaN(dpd) || isNaN(mwd)) continue;

      var observedAt = null;
      if (idxYY >= 0 && idxMM >= 0 && idxDD >= 0 && idxhh >= 0) {
        var yy = parseInt(cols[idxYY], 10);
        var mo = parseInt(cols[idxMM], 10);
        var dd = parseInt(cols[idxDD], 10);
        var hh = parseInt(cols[idxhh], 10);
        var mi = idxmm >= 0 ? parseInt(cols[idxmm], 10) : 0;
        if (!isNaN(yy)) observedAt = new Date(Date.UTC(yy, mo - 1, dd, hh, mi));
      }

      return {
        station: station,
        heightFt: Math.round(metersToFeet(wvht) * 10) / 10,
        periodS: Math.round(dpd * 10) / 10,
        dirDeg: mwd,
        dirCompass: degreesToCompass(mwd),
        observedAt: observedAt
      };
    }
    return null;
  }

  window.BuoyService = BuoyService;
})();
