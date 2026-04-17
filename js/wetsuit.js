// Wetsuit recommendation by water temperature (°F).
// Tuned for SoCal / temperate-water surfers.

(function() {
  'use strict';

  function recommend(tempF) {
    if (tempF == null || isNaN(tempF)) return null;
    if (tempF >= 72) return { suit: 'Trunks', short: 'trunks' };
    if (tempF >= 68) return { suit: '2mm springsuit', short: '2mm' };
    if (tempF >= 64) return { suit: '3/2 fullsuit', short: '3/2' };
    if (tempF >= 58) return { suit: '4/3 fullsuit', short: '4/3' };
    if (tempF >= 52) return { suit: '5/4 + booties', short: '5/4' };
    return { suit: '5/4 + hood + booties', short: '5/4 + hood' };
  }

  window.Wetsuit = { recommend: recommend };
})();
