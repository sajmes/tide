// NOAA CO-OPS tide service.
// Hourly predictions, plus current water temperature from a separate station.

(function() {
  'use strict';

  var NOAA_API_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
  var FORECAST_DAYS = 14;

  function formatDateYYYYMMDD(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + month + day;
  }

  function buildParams(stationId, beginDate, endDate, interval) {
    return new URLSearchParams({
      begin_date: beginDate,
      end_date: endDate,
      station: stationId,
      product: 'predictions',
      datum: 'MLLW',
      units: 'english',
      time_zone: 'lst_ldt',
      interval: interval,
      format: 'json'
    });
  }

  function TideService() {}

  TideService.prototype.fetchTidePredictions = async function(stationId) {
    if (!stationId) return [];
    var cacheKey = 'tides-' + stationId + '-hourly';
    var cached = window.TideCache.get(cacheKey);
    if (cached) return cached;

    try {
      var now = new Date();
      var end = new Date(now);
      end.setDate(end.getDate() + FORECAST_DAYS);

      var params = buildParams(stationId, formatDateYYYYMMDD(now), formatDateYYYYMMDD(end), 'h');
      var response = await fetch(NOAA_API_BASE + '?' + params.toString());
      if (!response.ok) {
        console.warn('TideService: NOAA API returned ' + response.status);
        return [];
      }

      var json = await response.json();
      if (!json.predictions) return [];

      var predictions = json.predictions.map(function(p) {
        return { t: p.t, v: parseFloat(p.v) };
      });
      window.TideCache.set(cacheKey, predictions);
      return predictions;
    } catch (e) {
      console.warn('TideService: fetch failed', e);
      return [];
    }
  };

  // Linear interpolation between hourly samples — good to ~0.1ft.
  TideService.prototype.getTideAtTime = function(predictions, timestamp) {
    if (!predictions || predictions.length === 0) return null;
    var targetMs = new Date(timestamp).getTime();

    for (var i = 0; i < predictions.length - 1; i++) {
      var t0 = new Date(predictions[i].t).getTime();
      var t1 = new Date(predictions[i + 1].t).getTime();
      if (targetMs >= t0 && targetMs <= t1) {
        var ratio = (targetMs - t0) / (t1 - t0);
        var v0 = predictions[i].v;
        var v1 = predictions[i + 1].v;
        return Math.round((v0 + ratio * (v1 - v0)) * 100) / 100;
      }
    }

    var lastTime = new Date(predictions[predictions.length - 1].t).getTime();
    if (targetMs === lastTime) return predictions[predictions.length - 1].v;
    return null;
  };

  TideService.prototype.getTideMovement = function(predictions, timestamp) {
    if (!predictions || predictions.length === 0) return null;
    var targetMs = new Date(timestamp).getTime();

    for (var i = 0; i < predictions.length - 1; i++) {
      var t0 = new Date(predictions[i].t).getTime();
      var t1 = new Date(predictions[i + 1].t).getTime();
      if (targetMs >= t0 && targetMs <= t1) {
        return predictions[i + 1].v > predictions[i].v ? 'incoming' : 'outgoing';
      }
    }
    return null;
  };

  // Find the next high or low tide after a given timestamp.
  // Returns { type: 'H'|'L', time: Date, height: number } or null.
  TideService.prototype.getNextHiLo = function(predictions, timestamp) {
    if (!predictions || predictions.length < 3) return null;
    var startMs = new Date(timestamp).getTime();

    for (var i = 1; i < predictions.length - 1; i++) {
      var t = new Date(predictions[i].t).getTime();
      if (t < startMs) continue;
      var prev = predictions[i - 1].v;
      var cur = predictions[i].v;
      var next = predictions[i + 1].v;
      if (cur > prev && cur > next) return { type: 'H', time: new Date(predictions[i].t), height: cur };
      if (cur < prev && cur < next) return { type: 'L', time: new Date(predictions[i].t), height: cur };
    }
    return null;
  };

  TideService.prototype.fetchWaterTemp = async function(stationId) {
    var cacheKey = 'watertemp-' + stationId;
    var cached = window.TideCache.get(cacheKey);
    if (cached != null) return cached;

    try {
      var params = new URLSearchParams({
        station: stationId,
        date: 'latest',
        product: 'water_temperature',
        units: 'english',
        time_zone: 'lst_ldt',
        format: 'json'
      });
      var response = await fetch(NOAA_API_BASE + '?' + params.toString());
      if (!response.ok) return null;

      var json = await response.json();
      if (json.data && json.data.length > 0) {
        var tempF = parseFloat(json.data[0].v);
        if (!isNaN(tempF)) {
          window.TideCache.set(cacheKey, tempF);
          return tempF;
        }
      }
      return null;
    } catch (e) {
      console.warn('TideService: water temp fetch failed', e);
      return null;
    }
  };

  window.TideService = TideService;
})();
