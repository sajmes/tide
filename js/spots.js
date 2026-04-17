// Surf Spot Configuration
// Each spot defines location, NOAA station, and ideal conditions.
// waveHeightMinFt/MaxFt are wave-face heights (what you'd see from the beach).
// swellToWaveFactor is kept only as a last-resort fallback for spots without
// Surfline data; the runtime calibration in surfline.js learns this dynamically.

const DEFAULT_SPOTS = [
  {
    id: 'beacons-encinitas',
    name: 'Beacons',
    lat: 33.0467,
    lng: -117.2960,
    noaaStationId: '9410230',
    surflineSpotId: '5842041f4e65fad6a770882b',
    swellToWaveFactor: 1.1,
    idealConditions: {
      tideRangeFt: [1.0, 4.0],
      tideMovement: 'any',
      windDirections: ['E', 'NE', 'SE'],
      maxWindSpeedMph: 12,
      swellDirections: ['SW', 'S', 'W', 'WSW', 'SSW'],
      swellPeriodMinS: 8,
      waveHeightMinFt: 2,
      waveHeightMaxFt: 6.5
    },
    sessionDurationHrs: 2.5,
    driveTimeMin: 10
  },
  {
    id: 'san-elijo',
    name: 'San Elijo',
    lat: 33.0175,
    lng: -117.2810,
    noaaStationId: '9410230',
    surflineSpotId: '5842041f4e65fad6a7708814',
    swellToWaveFactor: 1.3,
    idealConditions: {
      tideRangeFt: [2.0, 5.0],
      tideMovement: 'incoming',
      windDirections: ['E', 'NE', 'SE'],
      maxWindSpeedMph: 10,
      swellDirections: ['SW', 'S', 'W', 'WSW'],
      swellPeriodMinS: 10,
      waveHeightMinFt: 4,
      waveHeightMaxFt: 10
    },
    sessionDurationHrs: 2.5,
    driveTimeMin: 10
  },
  {
    id: 'cardiff-reef',
    name: 'Cardiff Reef',
    lat: 33.0136,
    lng: -117.2790,
    noaaStationId: '9410230',
    surflineSpotId: '5842041f4e65fad6a770882a',
    swellToWaveFactor: 1.3,
    idealConditions: {
      tideRangeFt: [2.0, 5.0],
      tideMovement: 'incoming',
      windDirections: ['E', 'NE', 'SE'],
      maxWindSpeedMph: 10,
      swellDirections: ['SW', 'S', 'W', 'WSW', 'SSW'],
      swellPeriodMinS: 10,
      waveHeightMinFt: 4,
      waveHeightMaxFt: 10
    },
    sessionDurationHrs: 2.5,
    driveTimeMin: 12
  },
  {
    id: 'la-jolla-shores',
    name: 'La Jolla Shores',
    lat: 32.8567,
    lng: -117.2575,
    noaaStationId: '9410230',
    surflineSpotId: '5842041f4e65fad6a7708846',
    swellToWaveFactor: 0.9,
    idealConditions: {
      tideRangeFt: [1.0, 4.0],
      tideMovement: 'any',
      windDirections: ['E', 'NE', 'SE'],
      maxWindSpeedMph: 12,
      swellDirections: ['SW', 'S', 'W', 'NW', 'SSW'],
      swellPeriodMinS: 8,
      waveHeightMinFt: 2,
      waveHeightMaxFt: 4.5
    },
    sessionDurationHrs: 2.5,
    driveTimeMin: 25
  },
  {
    id: 'old-mans-san-onofre',
    name: "Old Man's",
    lat: 33.3725,
    lng: -117.5600,
    noaaStationId: '9410230',
    surflineSpotId: '5842041f4e65fad6a77088a2',
    swellToWaveFactor: 0.7,
    idealConditions: {
      tideRangeFt: [1.0, 4.0],
      tideMovement: 'any',
      windDirections: ['E', 'NE', 'N'],
      maxWindSpeedMph: 12,
      swellDirections: ['S', 'SW', 'SSW', 'SSE'],
      swellPeriodMinS: 8,
      waveHeightMinFt: 1.5,
      waveHeightMaxFt: 3.5
    },
    sessionDurationHrs: 2.5,
    driveTimeMin: 30
  },
  {
    id: 'doheny-beach',
    name: 'Doheny',
    lat: 33.4600,
    lng: -117.6870,
    noaaStationId: '9410230',
    surflineSpotId: '5842041f4e65fad6a770889e',
    swellToWaveFactor: 0.7,
    idealConditions: {
      tideRangeFt: [1.0, 4.0],
      tideMovement: 'any',
      windDirections: ['E', 'NE', 'N'],
      maxWindSpeedMph: 12,
      swellDirections: ['S', 'SW', 'SSW', 'SSE'],
      swellPeriodMinS: 8,
      waveHeightMinFt: 1.5,
      waveHeightMaxFt: 3.5
    },
    sessionDurationHrs: 2.5,
    driveTimeMin: 35
  }
];

class SpotManager {
  constructor() {
    this.spots = this.load();
  }

  load() {
    const saved = localStorage.getItem('surf-spots');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map(this._migrate);
      } catch (e) {
        console.warn('Failed to load spots from localStorage, using defaults');
      }
    }
    return [...DEFAULT_SPOTS];
  }

  // Migrate idealConditions.swellHeightMin/MaxFt → waveHeightMin/MaxFt by
  // multiplying through the spot's swellToWaveFactor (or 1.0 if absent).
  _migrate(spot) {
    if (!spot || !spot.idealConditions) return spot;
    const ic = spot.idealConditions;
    if (ic.waveHeightMinFt == null && ic.swellHeightMinFt != null) {
      const f = spot.swellToWaveFactor || 1.0;
      ic.waveHeightMinFt = Math.round(ic.swellHeightMinFt * f * 2) / 2;
      ic.waveHeightMaxFt = Math.round(ic.swellHeightMaxFt * f * 2) / 2;
      delete ic.swellHeightMinFt;
      delete ic.swellHeightMaxFt;
    }
    return spot;
  }

  save() {
    localStorage.setItem('surf-spots', JSON.stringify(this.spots));
  }

  getAll() {
    return this.spots;
  }

  getById(id) {
    return this.spots.find(s => s.id === id);
  }

  addSpot(spot) {
    spot.id = spot.id || spot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    this.spots.push(spot);
    this.save();
    return spot;
  }

  updateSpot(id, updates) {
    const idx = this.spots.findIndex(s => s.id === id);
    if (idx >= 0) {
      this.spots[idx] = { ...this.spots[idx], ...updates };
      this.save();
      return this.spots[idx];
    }
    return null;
  }

  removeSpot(id) {
    this.spots = this.spots.filter(s => s.id !== id);
    this.save();
  }
}

window.SpotManager = SpotManager;
