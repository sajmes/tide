// Surfer-language descriptions of conditions.
// Turns raw numbers into short phrases like "head-high, light offshore, mid-tide pushing".

(function() {
  'use strict';

  function waveSize(heightFt) {
    if (heightFt == null) return null;
    if (heightFt < 1) return 'flat';
    if (heightFt < 1.5) return 'knee-high';
    if (heightFt < 2.5) return 'thigh-high';
    if (heightFt < 3.5) return 'waist-high';
    if (heightFt < 4.5) return 'chest-high';
    if (heightFt < 5.5) return 'shoulder-high';
    if (heightFt < 7) return 'head-high';
    if (heightFt < 9) return 'overhead';
    if (heightFt < 12) return 'well overhead';
    return 'big';
  }

  function windPhrase(speedMph, dirCompass, favoredDirections) {
    if (speedMph == null) return null;
    var strength;
    if (speedMph < 3) strength = 'glassy';
    else if (speedMph < 7) strength = 'light';
    else if (speedMph < 12) strength = 'moderate';
    else if (speedMph < 18) strength = 'strong';
    else strength = 'blown out';

    var quality = 'cross';
    if (favoredDirections && dirCompass) {
      if (favoredDirections.indexOf(dirCompass) !== -1) quality = 'offshore';
      else {
        var onshoreSet = inferOnshore(favoredDirections);
        if (onshoreSet.indexOf(dirCompass) !== -1) quality = 'onshore';
      }
    }
    if (strength === 'glassy') return 'glassy';
    if (strength === 'blown out') return 'blown out';
    return strength + ' ' + quality;
  }

  // Onshore = roughly opposite compass to the favored offshore directions.
  function inferOnshore(favored) {
    var allCompass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    var onshore = [];
    for (var i = 0; i < favored.length; i++) {
      var idx = allCompass.indexOf(favored[i]);
      if (idx === -1) continue;
      var oppIdx = (idx + 8) % 16;
      onshore.push(allCompass[oppIdx]);
    }
    return onshore;
  }

  function tidePhrase(heightFt, movement, idealRange) {
    if (heightFt == null) return null;
    var bucket;
    var lo = idealRange ? idealRange[0] : 1.5;
    var hi = idealRange ? idealRange[1] : 4.0;
    var mid = (lo + hi) / 2;
    if (heightFt < lo - 0.5) bucket = 'low';
    else if (heightFt > hi + 0.5) bucket = 'high';
    else if (Math.abs(heightFt - mid) < 0.7) bucket = 'mid';
    else bucket = heightFt < mid ? 'low-mid' : 'mid-high';
    var direction = movement === 'incoming' ? 'pushing' : (movement === 'outgoing' ? 'dropping' : '');
    return direction ? bucket + ' tide ' + direction : bucket + ' tide';
  }

  function fullPhrase(conditions, ideal) {
    if (!conditions) return '';
    var parts = [];
    var size = waveSize(conditions.waveHeight);
    if (size) parts.push(size);
    var wind = windPhrase(conditions.windSpeed, conditions.windDirectionCompass,
      ideal && ideal.windDirections);
    if (wind) parts.push(wind);
    var tide = tidePhrase(conditions.tideHeight, conditions.tideMovement,
      ideal && ideal.tideRangeFt);
    if (tide) parts.push(tide);
    return parts.join(', ');
  }

  function formatHourRange(start, end) {
    return formatHour(start) + '–' + formatHour(end);
  }

  function formatHour(d) {
    var h = d.getHours();
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    return h12 + ampm;
  }

  function formatTimeOfDay(d) {
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ampm;
  }

  function countdownTo(future) {
    var msAhead = new Date(future).getTime() - Date.now();
    if (msAhead <= 0) return 'now';
    var hrs = Math.floor(msAhead / (60 * 60 * 1000));
    var mins = Math.floor((msAhead % (60 * 60 * 1000)) / (60 * 1000));
    if (hrs === 0) return mins + 'm';
    if (mins === 0) return hrs + 'h';
    return hrs + 'h ' + mins + 'm';
  }

  window.Describe = {
    waveSize: waveSize,
    wind: windPhrase,
    tide: tidePhrase,
    full: fullPhrase,
    hour: formatHour,
    hourRange: formatHourRange,
    time: formatTimeOfDay,
    countdown: countdownTo
  };
})();
