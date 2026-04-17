// Surfline wave forecast (unofficial public endpoint).
// Returns 6-day surf-face heights. We then learn the per-spot Surfline:Open-Meteo
// wave-height ratio (bucketed by 8-point swell direction) so we can predict
// wave heights for days 7-13 with the same calibration the spot has shown
// across the prior week.

(function() {
  'use strict';

  var BASE_URL = 'https://services.surfline.com/kbyg/spots/forecasts';
  var COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  function dirToBucket(deg) {
    if (deg == null || isNaN(deg)) return null;
    var d = ((deg % 360) + 360) % 360;
    var idx = Math.round(d / 45) % 8;
    return COMPASS_8[idx];
  }

  function median(arr) {
    if (!arr.length) return null;
    var sorted = arr.slice().sort(function(a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function SurflineService() {}

  SurflineService.prototype.fetchWaveForecast = async function(surflineSpotId) {
    if (!surflineSpotId) return null;
    var cacheKey = 'surfline-wave-' + surflineSpotId;
    var cached = window.TideCache.get(cacheKey);
    if (cached) return cached;

    var url = BASE_URL + '/wave?spotId=' + surflineSpotId + '&days=6&intervalHours=1';
    try {
      var response = await fetch(url);
      if (!response.ok) {
        console.warn('Surfline wave API returned status ' + response.status);
        return null;
      }
      var json = await response.json();
      if (!json.data || !json.data.wave || json.data.wave.length === 0) return null;

      var waves = json.data.wave;
      var data = { times: [], waveHeightMin: [], waveHeightMax: [], humanRelation: [] };
      for (var i = 0; i < waves.length; i++) {
        var w = waves[i];
        data.times.push(new Date(w.timestamp * 1000));
        data.waveHeightMin.push(w.surf ? w.surf.min : null);
        data.waveHeightMax.push(w.surf ? w.surf.max : null);
        data.humanRelation.push(w.surf ? w.surf.humanRelation : null);
      }
      window.TideCache.set(cacheKey, data);
      return data;
    } catch (e) {
      console.warn('Failed to fetch Surfline wave forecast:', e);
      return null;
    }
  };

  // Merge Surfline wave heights into the swell data. For Open-Meteo time slots
  // within Surfline's 6-day window: use Surfline directly. For slots beyond:
  // learn a per-direction-bucket Surfline:OM ratio (median, with min sample size)
  // and apply it to predict wave height.
  SurflineService.prototype.mergeSurflineWaves = function(swellData, surflineWaveData) {
    if (!surflineWaveData || !swellData || !swellData.times) return swellData;

    var slTimes = surflineWaveData.times;
    var slMinArr = surflineWaveData.waveHeightMin;
    var slMaxArr = surflineWaveData.waveHeightMax;
    var omSwell = swellData.swellHeight || [];
    var omDir = swellData.swellDirection || [];
    var n = swellData.times.length;

    var mergedWaveHeight = new Array(n);
    var waveSource = new Array(n);
    var hasSurfline = new Array(n);

    var bucketRatios = {};
    var allRatios = [];

    for (var i = 0; i < n; i++) {
      var targetMs = new Date(swellData.times[i]).getTime();
      var bestIdx = -1;
      var bestDiff = Infinity;
      for (var j = 0; j < slTimes.length; j++) {
        var diff = Math.abs(new Date(slTimes[j]).getTime() - targetMs);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = j; }
      }

      if (bestIdx >= 0 && bestDiff < 2 * 60 * 60 * 1000) {
        var min = slMinArr[bestIdx];
        var max = slMaxArr[bestIdx];
        if (min != null && max != null) {
          var sl = (min + max) / 2;
          mergedWaveHeight[i] = sl;
          waveSource[i] = 'surfline';
          hasSurfline[i] = true;

          var omH = omSwell[i];
          if (omH != null && omH > 0.3) {
            var ratio = sl / omH;
            allRatios.push(ratio);
            var bucket = dirToBucket(omDir[i]);
            if (bucket) {
              if (!bucketRatios[bucket]) bucketRatios[bucket] = [];
              bucketRatios[bucket].push(ratio);
            }
          }
        }
      }
    }

    var overallRatio = median(allRatios);
    if (overallRatio == null || overallRatio <= 0) overallRatio = 1.0;

    var bucketMedian = {};
    for (var b in bucketRatios) {
      if (bucketRatios[b].length >= 6) {
        bucketMedian[b] = median(bucketRatios[b]);
      }
    }

    for (var k = 0; k < n; k++) {
      if (hasSurfline[k]) continue;
      var omK = omSwell[k];
      if (omK == null) { mergedWaveHeight[k] = null; continue; }
      var bk = dirToBucket(omDir[k]);
      if (bk && bucketMedian[bk] != null) {
        mergedWaveHeight[k] = omK * bucketMedian[bk];
        waveSource[k] = 'predicted-bucket';
      } else {
        mergedWaveHeight[k] = omK * overallRatio;
        waveSource[k] = 'predicted-overall';
      }
    }

    return {
      times: swellData.times,
      swellHeight: swellData.swellHeight,
      swellDirection: swellData.swellDirection,
      swellPeriod: swellData.swellPeriod,
      waveHeight: swellData.waveHeight,
      surflineWaveHeight: mergedWaveHeight,
      waveSource: waveSource,
      hasSurflineData: true,
      calibration: {
        overallRatio: overallRatio,
        bucketMedian: bucketMedian,
        sampleCount: allRatios.length
      }
    };
  };

  window.SurflineService = SurflineService;
})();
