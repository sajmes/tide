// Multiplicative continuous scoring.
//
// Each session window produces a single 0-100 score:
//   score = 100 * swellQ * windFactor * tideFactor * timeFactor
//
// where each factor is in [0, 1] and uses a continuous function (no bands).
// Swell is the primary gate via multiplication: zero swell quality kills the
// session regardless of wind/tide. Wind and tide degrade the session smoothly
// rather than hard-cutting it.
//
// Wind, swell direction/height, and wave size are sampled at every hour of
// the session window and the worst hour is used (a 7am session that goes from
// glassy to onshore by 9am is rated by the 9am conditions).

(function() {
  'use strict';

  var FORECAST_DAYS = 14;
  var FIRST_HOUR = 5;
  var LAST_HOUR = 18;

  var COMPASS_16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

  function degreesToCompass(deg) {
    if (deg == null || isNaN(deg)) return null;
    var d = ((deg % 360) + 360) % 360;
    return COMPASS_16[Math.round(d / 22.5) % 16];
  }

  function clamp01(v) {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  // Smallest angle between two compass bearings, in degrees.
  function angularDistance(a, b) {
    var diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
  }

  // Best (smallest) angular distance from `deg` to any of the favored bearings.
  function bestAngularDistance(deg, favoredCompassList) {
    if (deg == null || isNaN(deg) || !favoredCompassList || !favoredCompassList.length) return 180;
    var bearings = favoredCompassList.map(compassToDeg);
    var best = 180;
    for (var i = 0; i < bearings.length; i++) {
      var d = angularDistance(deg, bearings[i]);
      if (d < best) best = d;
    }
    return best;
  }

  function compassToDeg(label) {
    var idx = COMPASS_16.indexOf(label);
    if (idx >= 0) return idx * 22.5;
    // Allow 8-point labels too
    var eight = ['N','NE','E','SE','S','SW','W','NW'];
    var i8 = eight.indexOf(label);
    if (i8 >= 0) return i8 * 45;
    return 0;
  }

  function findClosestIndex(times, timestamp) {
    if (!times || times.length === 0) return -1;
    var targetMs = new Date(timestamp).getTime();
    var bestIdx = -1;
    var bestDiff = Infinity;
    for (var i = 0; i < times.length; i++) {
      var diff = Math.abs(new Date(times[i]).getTime() - targetMs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    // Reject if we're more than 90 minutes off — no useful data.
    return bestDiff < 90 * 60 * 1000 ? bestIdx : -1;
  }

  // ----- Quality factor functions (each returns [0, 1]) -----

  // Wave-height quality: Gaussian centered on the midpoint of [min, max],
  // with width ~half the range. 1.0 inside the range, decays smoothly outside.
  function waveHeightQ(heightFt, minFt, maxFt) {
    if (heightFt == null) return 0;
    var center = (minFt + maxFt) / 2;
    var halfWidth = Math.max(0.5, (maxFt - minFt) / 2);
    if (heightFt >= minFt && heightFt <= maxFt) return 1.0;
    var distance = heightFt < minFt ? (minFt - heightFt) : (heightFt - maxFt);
    // Exponential decay; ~0.6 at 0.5 halfwidths over, ~0.1 at 1.5 halfwidths.
    return Math.exp(-Math.pow(distance / halfWidth, 2));
  }

  // Swell-direction quality: 1.0 if exactly on a favored bearing, decaying to 0
  // at 90° off (anything ≥90° is treated as the wrong-side-of-the-spot).
  function directionQ(dirDeg, favoredList) {
    if (dirDeg == null) return 0;
    var dist = bestAngularDistance(dirDeg, favoredList);
    if (dist >= 90) return 0;
    // Cosine-shaped: 1.0 at 0°, ~0.85 at 22.5°, ~0.5 at 45°, 0 at 90°.
    return Math.cos(dist * Math.PI / 180);
  }

  // Period quality: linear ramp from min-1 (=0) to min+4 (=1.0), capped at 1.
  function periodQ(periodS, minS) {
    if (periodS == null) return 0;
    if (periodS <= minS - 1) return 0;
    if (periodS >= minS + 4) return 1.0;
    return (periodS - (minS - 1)) / 5;
  }

  // Wind quality: combines direction (cosine of angular distance from offshore)
  // with a logistic falloff on speed past the user's tolerance.
  function windQ(speedMph, gustsMph, dirDeg, favoredList, maxMph) {
    if (speedMph == null || dirDeg == null) return 0;
    var effective = Math.max(speedMph, (gustsMph || 0) * 0.6);
    var dist = bestAngularDistance(dirDeg, favoredList);
    // Speed: full credit up to maxMph, smooth falloff to 0 at 2x maxMph.
    var speedFactor;
    if (effective <= maxMph) {
      speedFactor = 1.0;
    } else if (effective >= maxMph * 2) {
      speedFactor = 0;
    } else {
      speedFactor = 1 - (effective - maxMph) / maxMph;
    }
    // Direction: 1.0 at 0°, 0.5 at 90°, 0 at 180° (full onshore).
    var dirFactor = 0.5 + 0.5 * Math.cos(dist * Math.PI / 180);
    // Strong onshore is far worse than light cross — penalize when both bad.
    return clamp01(speedFactor * Math.pow(dirFactor, 1.5));
  }

  // Tide-in-range fraction over the session window, sampled every 15 minutes.
  function tideInRangeFraction(tideService, predictions, start, end, minFt, maxFt) {
    if (!predictions || predictions.length === 0) return 0;
    var samples = 0;
    var inRange = 0;
    var stepMs = 15 * 60 * 1000;
    for (var t = start.getTime(); t <= end.getTime(); t += stepMs) {
      var h = tideService.getTideAtTime(predictions, t);
      if (h == null) continue;
      samples++;
      if (h >= minFt && h <= maxFt) inRange++;
    }
    return samples > 0 ? inRange / samples : 0;
  }

  // Time-of-day multiplier — emphasizes morning glass + evening glass-off,
  // de-emphasizes the windy middle of the day.
  function timeOfDayFactor(hour) {
    if (hour < 5 || hour > 19) return 0.5; // dark / late
    // Peak at 7am, secondary peak at 5pm, dip at noon.
    var morningPeak = Math.exp(-Math.pow((hour - 7) / 2.5, 2));
    var eveningPeak = 0.85 * Math.exp(-Math.pow((hour - 17) / 2.0, 2));
    return Math.max(0.55, morningPeak, eveningPeak);
  }

  // ----- Engine -----

  function ScoringEngine() {
    this.tideService = window.TideService ? new window.TideService() : null;
  }

  ScoringEngine.prototype.scoreAllWindows = function(spot, tideData, windData, swellData) {
    var windows = [];
    var now = new Date();
    var sessionMs = (spot.sessionDurationHrs || 2) * 60 * 60 * 1000;

    for (var day = 0; day < FORECAST_DAYS; day++) {
      for (var hour = FIRST_HOUR; hour <= LAST_HOUR; hour++) {
        var sessionStart = new Date(now);
        sessionStart.setDate(now.getDate() + day);
        sessionStart.setHours(hour, 0, 0, 0);
        if (sessionStart.getTime() < now.getTime()) continue;
        var sessionEnd = new Date(sessionStart.getTime() + sessionMs);

        windows.push(this.scoreWindow(spot, sessionStart, sessionEnd, tideData, windData, swellData));
      }
    }

    windows.sort(function(a, b) { return b.score - a.score; });
    return windows;
  };

  ScoringEngine.prototype.scoreWindow = function(spot, sessionStart, sessionEnd, tideData, windData, swellData) {
    var ideal = spot.idealConditions;

    // Sample wind/swell at every hour inside the session window; use the worst.
    var hourSamples = [];
    var stepMs = 60 * 60 * 1000;
    for (var t = sessionStart.getTime(); t <= sessionEnd.getTime(); t += stepMs) {
      hourSamples.push(this._sampleHour(spot, new Date(t), windData, swellData));
    }

    // Worst (lowest) wind quality and swell quality across the window.
    var windQual = 1, swellQual = 1, anyData = false;
    var midSample = hourSamples[Math.floor(hourSamples.length / 2)] || hourSamples[0];
    for (var i = 0; i < hourSamples.length; i++) {
      var s = hourSamples[i];
      if (s.hasData) anyData = true;
      windQual = Math.min(windQual, s.windQ);
      swellQual = Math.min(swellQual, s.swellQ);
    }
    if (!anyData) {
      return { timestamp: sessionStart, score: 0, rating: 'red', conditions: midSample.conditions, factors: null };
    }

    var tideQual = tideInRangeFraction(this.tideService, tideData, sessionStart, sessionEnd,
      ideal.tideRangeFt[0], ideal.tideRangeFt[1]);

    // Tide movement preference: optional small bias.
    if (ideal.tideMovement && ideal.tideMovement !== 'any' && this.tideService) {
      var sessionMid = new Date((sessionStart.getTime() + sessionEnd.getTime()) / 2);
      var movement = this.tideService.getTideMovement(tideData, sessionMid);
      if (movement === ideal.tideMovement) tideQual = clamp01(tideQual * 1.1 + 0.05);
      else if (movement && movement !== ideal.tideMovement) tideQual = tideQual * 0.85;
    }

    var timeFactor = timeOfDayFactor(sessionStart.getHours());

    // Multiplicative composition. Wind and tide can degrade but never zero unless extreme.
    var windFactor = 0.35 + 0.65 * windQual;     // wind contributes up to 65%
    var tideFactor = 0.55 + 0.45 * tideQual;     // tide contributes up to 45%
    var totalFactor = swellQual * windFactor * tideFactor * timeFactor;
    var score = Math.round(100 * totalFactor);

    return {
      timestamp: sessionStart,
      score: score,
      rating: ratingForScore(score),
      conditions: midSample.conditions,
      factors: {
        swell: swellQual,
        wind: windQual,
        tide: tideQual,
        time: timeFactor
      }
    };
  };

  // Compute swell + wind quality at a single hour, plus capture conditions for display.
  ScoringEngine.prototype._sampleHour = function(spot, time, windData, swellData) {
    var ideal = spot.idealConditions;
    var conditions = {};
    var swellHasData = false, windHasData = false;
    var swellQual = 0, windQual = 0;

    if (swellData && swellData.times) {
      var sIdx = findClosestIndex(swellData.times, time);
      if (sIdx >= 0) {
        swellHasData = true;
        var rawHeight = swellData.swellHeight ? swellData.swellHeight[sIdx] : null;
        var dirDeg = swellData.swellDirection ? swellData.swellDirection[sIdx] : null;
        var period = swellData.swellPeriod ? swellData.swellPeriod[sIdx] : null;
        var waveH = (swellData.surflineWaveHeight && swellData.surflineWaveHeight[sIdx] != null)
          ? swellData.surflineWaveHeight[sIdx]
          : (rawHeight != null ? rawHeight * (spot.swellToWaveFactor || 1.0) : null);

        conditions.swellHeight = rawHeight;
        conditions.swellPeriod = period;
        conditions.swellDirectionDeg = dirDeg;
        conditions.swellDirectionCompass = degreesToCompass(dirDeg);
        conditions.waveHeight = waveH != null ? Math.round(waveH * 10) / 10 : null;
        conditions.waveSource = swellData.waveSource ? swellData.waveSource[sIdx] : null;

        var dQ = directionQ(dirDeg, ideal.swellDirections);
        var pQ = periodQ(period, ideal.swellPeriodMinS || 8);
        var hQ = waveHeightQ(waveH, ideal.waveHeightMinFt, ideal.waveHeightMaxFt);
        // Direction is the most important of the three for whether a spot works at all.
        swellQual = Math.pow(dQ, 0.7) * Math.pow(hQ, 0.7) * (0.5 + 0.5 * pQ);
      }
    }

    if (windData && windData.times) {
      var wIdx = findClosestIndex(windData.times, time);
      if (wIdx >= 0) {
        windHasData = true;
        var ws = windData.windSpeed[wIdx];
        var wg = windData.windGusts ? windData.windGusts[wIdx] : null;
        var wd = windData.windDirection[wIdx];
        conditions.windSpeed = ws;
        conditions.windGusts = wg;
        conditions.windDirectionDeg = wd;
        conditions.windDirectionCompass = degreesToCompass(wd);
        windQual = windQ(ws, wg, wd, ideal.windDirections, ideal.maxWindSpeedMph || 12);
      }
    }

    return {
      hasData: swellHasData || windHasData,
      swellQ: swellQual,
      windQ: windQual,
      conditions: conditions
    };
  };

  function ratingForScore(score) {
    if (score >= 65) return 'green';
    if (score >= 40) return 'yellow';
    return 'red';
  }

  ScoringEngine.prototype.getRating = ratingForScore;

  // Expose helpers used elsewhere.
  ScoringEngine.degreesToCompass = degreesToCompass;
  window.ScoringEngine = ScoringEngine;
})();
