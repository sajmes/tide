// UI renderer — three components:
//   1. Now strip      — current water/air temp, wind, wetsuit
//   2. Decision hero  — Today + Tomorrow side-by-side cards
//   3. 7-day outlook  — compact band, ~6 key hours per day, weekend emphasis
//
// Plus tap-to-expand cell tooltips for the outlook grid.

(function() {
  'use strict';

  var KEY_HOURS = [6, 7, 8, 9, 16, 17];
  var DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var FORECAST_DAYS = 7;

  function Renderer() {
    this._dismissTooltip = this._dismissTooltip.bind(this);
    this._activeTooltip = null;
    this._spotsById = {};
  }

  Renderer.prototype.setSpots = function(spots) {
    this._spotsById = {};
    for (var i = 0; i < spots.length; i++) this._spotsById[spots[i].id] = spots[i];
  };

  // ---------- Now strip ----------

  Renderer.prototype.renderNowStrip = function(state) {
    var el = document.getElementById('now-strip');
    if (!el) return;
    var parts = [];

    var waterTemp = state.waterTempF;
    if (waterTemp != null) {
      var w = window.Wetsuit.recommend(waterTemp);
      var suit = w ? ' · ' + w.short : '';
      parts.push('<span class="now-item"><span class="now-label">Water</span><span class="now-val">' + Math.round(waterTemp) + '°F' + suit + '</span></span>');
    }
    if (state.airTempF != null) {
      parts.push('<span class="now-item"><span class="now-label">Air</span><span class="now-val">' + Math.round(state.airTempF) + '°F</span></span>');
    }
    if (state.currentWind && state.currentWind.speed != null) {
      var dir = state.currentWind.dir ? ' ' + state.currentWind.dir : '';
      var gust = (state.currentWind.gusts != null && state.currentWind.gusts > state.currentWind.speed)
        ? ' (g' + Math.round(state.currentWind.gusts) + ')' : '';
      parts.push('<span class="now-item"><span class="now-label">Wind</span><span class="now-val">' + Math.round(state.currentWind.speed) + 'mph' + dir + gust + '</span></span>');
    }
    if (state.buoyNow) {
      var b = state.buoyNow;
      parts.push('<span class="now-item now-buoy"><span class="now-label">Buoy</span><span class="now-val">' +
        b.heightFt.toFixed(1) + 'ft @ ' + b.periodS + 's ' + (b.dirCompass || '') + '</span></span>');
    }

    el.innerHTML = parts.join('');
    el.style.display = parts.length ? '' : 'none';
  };

  // ---------- Decision hero ----------
  // Two cards: best Today (or "Tomorrow's outlook" if today is gone), best Tomorrow.

  Renderer.prototype.renderHero = function(state) {
    var el = document.getElementById('hero');
    if (!el) return;

    var allWindows = collectAllWindows(state.scoredWindowsBySpot, this._spotsById);
    var now = Date.now();
    var todayBest = bestForDay(allWindows, 0, now);
    var tomorrowBest = bestForDay(allWindows, 1, now);

    var html = '';
    html += this._renderHeroCard('Today', todayBest, state);
    html += this._renderHeroCard('Tomorrow', tomorrowBest, state);
    el.innerHTML = html;
  };

  Renderer.prototype._renderHeroCard = function(label, entry, state) {
    if (!entry) {
      return '<div class="hero-card hero-empty">' +
        '<div class="hero-label">' + label + '</div>' +
        '<div class="hero-empty-msg">Nothing scoring well</div>' +
        '</div>';
    }
    var win = entry.window;
    var spot = entry.spot;
    var ideal = spot.idealConditions;
    var winDate = new Date(win.timestamp);
    var sessionEnd = new Date(winDate.getTime() + (spot.sessionDurationHrs || 2) * 3600000);

    var conditions = Object.assign({}, win.conditions);
    if (state.tideService && state.tideDataBySpot[spot.id]) {
      conditions.tideHeight = state.tideService.getTideAtTime(state.tideDataBySpot[spot.id], winDate);
      conditions.tideMovement = state.tideService.getTideMovement(state.tideDataBySpot[spot.id], winDate);
    }

    var sunInfo = sunForDay(state.sunData, winDate);
    var phrase = window.Describe.full(conditions, ideal);
    var wetsuit = window.Wetsuit.recommend(state.waterTempF);
    var ratingClass = 'rating-' + win.rating;

    var countdown = '';
    if (winDate.getTime() > Date.now()) {
      countdown = '<div class="hero-countdown">starts in ' + window.Describe.countdown(winDate) + '</div>';
    } else if (sessionEnd.getTime() > Date.now()) {
      countdown = '<div class="hero-countdown hero-now">on now · ' + window.Describe.countdown(sessionEnd) + ' left</div>';
    }

    var sun = '';
    if (sunInfo) {
      sun = '<span class="hero-meta-item">☀ ' + window.Describe.time(sunInfo.sunrise) + ' / ' + window.Describe.time(sunInfo.sunset) + '</span>';
    }
    var suitMeta = wetsuit ? '<span class="hero-meta-item">🩱 ' + wetsuit.suit + '</span>' : '';

    return '<div class="hero-card ' + ratingClass + '">' +
      '<div class="hero-label">' + label + '</div>' +
      '<div class="hero-spot">' + escapeHTML(spot.name) + '</div>' +
      '<div class="hero-time">' + window.Describe.hourRange(winDate, sessionEnd) + '</div>' +
      '<div class="hero-phrase">' + escapeHTML(phrase || '—') + '</div>' +
      countdown +
      '<div class="hero-meta">' + sun + suitMeta + '</div>' +
    '</div>';
  };

  // ---------- 7-day outlook ----------

  Renderer.prototype.renderOutlook = function(state) {
    var el = document.getElementById('outlook');
    if (!el) return;

    var startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    var selectedSpotId = state.selectedSpotId || 'all';
    var filteredScoredWindows = selectedSpotId === 'all'
      ? state.scoredWindowsBySpot
      : (state.scoredWindowsBySpot[selectedSpotId]
          ? (function() { var o = {}; o[selectedSpotId] = state.scoredWindowsBySpot[selectedSpotId]; return o; })()
          : {});

    var bestPerCell = collectBestPerCell(filteredScoredWindows, this._spotsById, startDate);
    var airTempByCell = buildAirTempLookup(state.windSwellDataBySpot, startDate);
    var showSpotName = selectedSpotId === 'all';

    var html = '<table class="outlook-table"><thead><tr><th class="outlook-corner"></th>';
    for (var d = 0; d < FORECAST_DAYS; d++) {
      var dayDate = new Date(startDate);
      dayDate.setDate(startDate.getDate() + d);
      var weekend = (dayDate.getDay() === 0 || dayDate.getDay() === 6) ? ' is-weekend' : '';
      var today = d === 0 ? ' is-today' : '';
      html += '<th class="outlook-day' + weekend + today + '">' +
        '<div class="outlook-dayname">' + DAY_NAMES[dayDate.getDay()] + '</div>' +
        '<div class="outlook-daydate">' + (dayDate.getMonth() + 1) + '/' + dayDate.getDate() + '</div>' +
      '</th>';
    }
    html += '</tr></thead><tbody>';

    for (var hi = 0; hi < KEY_HOURS.length; hi++) {
      var h = KEY_HOURS[hi];
      html += '<tr><th class="outlook-hour">' + window.Describe.hour(new Date(2020, 0, 1, h)) + '</th>';
      for (var di = 0; di < FORECAST_DAYS; di++) {
        var key = di + '-' + h;
        var slot = bestPerCell[key];
        var weekendCell = ((startDate.getDay() + di) % 7 === 0 || (startDate.getDay() + di) % 7 === 6) ? ' is-weekend' : '';
        if (slot) {
          var cls = 'cell-' + slot.window.rating + weekendCell;
          var spotShort = shortName(slot.spot.name);
          var waveStr = slot.window.conditions && slot.window.conditions.waveHeight != null
            ? slot.window.conditions.waveHeight.toFixed(1) + 'ft'
            : '';
          var airTemp = airTempByCell[di + '-' + h];
          var tempStr = airTemp != null ? Math.round(airTemp) + '°' : '';
          var spotLine = showSpotName ? '<div class="outlook-cell-spot">' + escapeHTML(spotShort) + '</div>' : '';
          var tempLine = tempStr ? '<div class="outlook-cell-temp">' + tempStr + '</div>' : '';
          html += '<td class="outlook-cell ' + cls + '" data-day="' + di + '" data-hour="' + h + '" data-spot="' + slot.spot.id + '">' +
            spotLine +
            '<div class="outlook-cell-wave">' + waveStr + '</div>' +
            tempLine +
          '</td>';
        } else {
          var airTemp2 = airTempByCell[di + '-' + h];
          var tempStr2 = airTemp2 != null ? '<div class="outlook-cell-temp">' + Math.round(airTemp2) + '°</div>' : '';
          html += '<td class="outlook-cell cell-empty' + weekendCell + '">' + tempStr2 + '</td>';
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;

    // Wire up cell taps for tooltip
    var self = this;
    var cells = el.querySelectorAll('.outlook-cell');
    for (var c = 0; c < cells.length; c++) {
      cells[c].addEventListener('click', function(e) {
        var cell = e.currentTarget;
        var di = parseInt(cell.dataset.day, 10);
        var h = parseInt(cell.dataset.hour, 10);
        var spotId = cell.dataset.spot;
        if (isNaN(di) || isNaN(h) || !spotId) return;
        self._showTooltip(cell, state, spotId, di, h);
      });
    }
  };

  // ---------- Tooltip ----------

  Renderer.prototype._showTooltip = function(anchor, state, spotId, dayOffset, hour) {
    this._dismissTooltip();
    var spot = this._spotsById[spotId];
    if (!spot) return;
    var windows = state.scoredWindowsBySpot[spotId] || [];
    var startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    var target = new Date(startDate);
    target.setDate(startDate.getDate() + dayOffset);
    target.setHours(hour, 0, 0, 0);

    var win = null;
    for (var i = 0; i < windows.length; i++) {
      var t = new Date(windows[i].timestamp);
      if (t.getDate() === target.getDate() && t.getHours() === hour) { win = windows[i]; break; }
    }
    if (!win) return;

    var winDate = new Date(win.timestamp);
    var sessionEnd = new Date(winDate.getTime() + (spot.sessionDurationHrs || 2) * 3600000);
    var conditions = Object.assign({}, win.conditions);
    if (state.tideService && state.tideDataBySpot[spotId]) {
      conditions.tideHeight = state.tideService.getTideAtTime(state.tideDataBySpot[spotId], winDate);
      conditions.tideMovement = state.tideService.getTideMovement(state.tideDataBySpot[spotId], winDate);
    }
    var phrase = window.Describe.full(conditions, spot.idealConditions);

    var tip = document.createElement('div');
    tip.className = 'tooltip';
    var srcBadge = '';
    if (conditions.waveSource && conditions.waveSource.indexOf('predicted') === 0) {
      srcBadge = '<span class="badge-predicted">predicted</span>';
    } else if (conditions.waveSource === 'surfline') {
      srcBadge = '<span class="badge-surfline">Surfline</span>';
    }
    tip.innerHTML =
      '<div class="tt-spot">' + escapeHTML(spot.name) + ' ' + srcBadge + '</div>' +
      '<div class="tt-time">' + window.Describe.hourRange(winDate, sessionEnd) + '</div>' +
      '<div class="tt-phrase">' + escapeHTML(phrase || '—') + '</div>' +
      '<div class="tt-numbers">' +
        (conditions.waveHeight != null ? conditions.waveHeight.toFixed(1) + 'ft @ ' + (conditions.swellPeriod || '?') + 's ' + (conditions.swellDirectionCompass || '') : '—') +
        ' · ' +
        (conditions.windSpeed != null ? Math.round(conditions.windSpeed) + 'mph ' + (conditions.windDirectionCompass || '') : '—') +
      '</div>';

    var rect = anchor.getBoundingClientRect();
    tip.style.position = 'fixed';
    document.body.appendChild(tip);

    // Position above the cell, but flip below if not enough room.
    var tipRect = tip.getBoundingClientRect();
    var top = rect.top - tipRect.height - 8;
    if (top < 8) top = rect.bottom + 8;
    var left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';

    this._activeTooltip = tip;
    var self = this;
    setTimeout(function() {
      document.addEventListener('click', self._tipClickOff = function(ev) {
        if (!tip.contains(ev.target) && ev.target !== anchor) self._dismissTooltip();
      });
    }, 0);
  };

  Renderer.prototype._dismissTooltip = function() {
    if (this._activeTooltip) {
      this._activeTooltip.remove();
      this._activeTooltip = null;
    }
    if (this._tipClickOff) {
      document.removeEventListener('click', this._tipClickOff);
      this._tipClickOff = null;
    }
  };

  // ---------- Helpers ----------

  function collectAllWindows(scoredWindowsBySpot, spotsById) {
    var out = [];
    var keys = Object.keys(scoredWindowsBySpot);
    for (var i = 0; i < keys.length; i++) {
      var spot = spotsById[keys[i]];
      if (!spot) continue;
      var wins = scoredWindowsBySpot[keys[i]] || [];
      for (var j = 0; j < wins.length; j++) {
        out.push({ window: wins[j], spot: spot });
      }
    }
    return out;
  }

  function bestForDay(allWindows, dayOffset, now) {
    var startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    var dayStart = new Date(startDate);
    dayStart.setDate(startDate.getDate() + dayOffset);
    var dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    var best = null;
    for (var i = 0; i < allWindows.length; i++) {
      var t = new Date(allWindows[i].window.timestamp).getTime();
      if (t < dayStart.getTime() || t >= dayEnd.getTime()) continue;
      // For "today", prefer windows that haven't ended yet.
      if (dayOffset === 0) {
        var sessHrs = (allWindows[i].spot.sessionDurationHrs || 2) * 3600000;
        if (t + sessHrs < now) continue;
      }
      if (!best || allWindows[i].window.score > best.window.score) {
        best = allWindows[i];
      }
    }
    return best;
  }

  // Air temp is essentially identical across the SD spots — pull from the first
  // available wind dataset and key by (dayOffset, hour) so the renderer can
  // look it up cheaply per cell.
  function buildAirTempLookup(windSwellDataBySpot, startDate) {
    var lookup = {};
    if (!windSwellDataBySpot) return lookup;
    var spotIds = Object.keys(windSwellDataBySpot);
    for (var i = 0; i < spotIds.length; i++) {
      var ws = windSwellDataBySpot[spotIds[i]];
      if (!ws || !ws.wind || !ws.wind.times || !ws.wind.airTemp) continue;
      for (var j = 0; j < ws.wind.times.length; j++) {
        var t = new Date(ws.wind.times[j]);
        var dayOffset = Math.floor((t.getTime() - startDate.getTime()) / 86400000);
        if (dayOffset < 0 || dayOffset >= FORECAST_DAYS) continue;
        var hour = t.getHours();
        var temp = ws.wind.airTemp[j];
        if (temp != null) lookup[dayOffset + '-' + hour] = temp;
      }
      break; // any one spot is enough
    }
    return lookup;
  }

  function collectBestPerCell(scoredWindowsBySpot, spotsById, startDate) {
    var out = {};
    var keys = Object.keys(scoredWindowsBySpot);
    for (var i = 0; i < keys.length; i++) {
      var spot = spotsById[keys[i]];
      if (!spot) continue;
      var wins = scoredWindowsBySpot[keys[i]] || [];
      for (var j = 0; j < wins.length; j++) {
        var win = wins[j];
        var t = new Date(win.timestamp);
        var dayOffset = Math.floor((t.getTime() - startDate.getTime()) / 86400000);
        var hour = t.getHours();
        if (dayOffset < 0 || dayOffset >= FORECAST_DAYS) continue;
        if (KEY_HOURS.indexOf(hour) === -1) continue;
        var key = dayOffset + '-' + hour;
        if (!out[key] || win.score > out[key].window.score) {
          out[key] = { window: win, spot: spot };
        }
      }
    }
    return out;
  }

  function sunForDay(sunData, date) {
    if (!sunData || !sunData.sunrise) return null;
    for (var i = 0; i < sunData.sunrise.length; i++) {
      var sr = sunData.sunrise[i] instanceof Date ? sunData.sunrise[i] : new Date(sunData.sunrise[i]);
      if (sr.getDate() === date.getDate() && sr.getMonth() === date.getMonth()) {
        var ss = sunData.sunset[i] instanceof Date ? sunData.sunset[i] : new Date(sunData.sunset[i]);
        return { sunrise: sr, sunset: ss };
      }
    }
    return null;
  }

  function shortName(name) {
    if (name.length <= 10) return name;
    var words = name.split(' ');
    if (words.length === 1) return name.slice(0, 9) + '…';
    return words.map(function(w) { return w[0]; }).join('').slice(0, 4);
  }

  function escapeHTML(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  window.Renderer = Renderer;
})();
