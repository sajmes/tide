// Open-Meteo Weather + Marine + Sun fetchers.

(function() {
  'use strict';

  var FORECAST_DAYS = 14;

  function WindSwellService() {}

  WindSwellService.prototype.fetchWindForecast = async function(lat, lng) {
    var cacheKey = 'wind-' + lat + '-' + lng;
    var cached = window.TideCache.get(cacheKey);
    if (cached) return cached;

    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat
      + '&longitude=' + lng
      + '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m'
      + '&wind_speed_unit=mph'
      + '&temperature_unit=fahrenheit'
      + '&timezone=auto'
      + '&forecast_days=' + FORECAST_DAYS;

    try {
      var response = await fetch(url);
      if (!response.ok) {
        console.warn('Wind API returned status ' + response.status);
        return null;
      }
      var json = await response.json();
      var data = {
        times: parseTimeArray(json.hourly.time),
        windSpeed: json.hourly.wind_speed_10m,
        windDirection: json.hourly.wind_direction_10m,
        windGusts: json.hourly.wind_gusts_10m,
        airTemp: json.hourly.temperature_2m
      };
      window.TideCache.set(cacheKey, data);
      return data;
    } catch (e) {
      console.warn('Failed to fetch wind forecast:', e);
      return null;
    }
  };

  WindSwellService.prototype.fetchSwellForecast = async function(lat, lng) {
    var cacheKey = 'swell-' + lat + '-' + lng;
    var cached = window.TideCache.get(cacheKey);
    if (cached) return cached;

    var url = 'https://marine-api.open-meteo.com/v1/marine'
      + '?latitude=' + lat
      + '&longitude=' + lng
      + '&hourly=swell_wave_height,swell_wave_direction,swell_wave_period,wave_height'
      + '&length_unit=imperial'
      + '&timezone=auto'
      + '&forecast_days=' + FORECAST_DAYS;

    try {
      var response = await fetch(url);
      if (!response.ok) {
        console.warn('Marine API returned status ' + response.status);
        return null;
      }
      var json = await response.json();
      var data = {
        times: parseTimeArray(json.hourly.time),
        swellHeight: json.hourly.swell_wave_height,
        swellDirection: json.hourly.swell_wave_direction,
        swellPeriod: json.hourly.swell_wave_period,
        waveHeight: json.hourly.wave_height
      };
      window.TideCache.set(cacheKey, data);
      return data;
    } catch (e) {
      console.warn('Failed to fetch swell forecast:', e);
      return null;
    }
  };

  WindSwellService.prototype.fetchSunTimes = async function(lat, lng) {
    var cacheKey = 'sun-' + lat + '-' + lng;
    var cached = window.TideCache.get(cacheKey);
    if (cached) {
      cached.sunrise = cached.sunrise.map(function(t) { return new Date(t); });
      cached.sunset = cached.sunset.map(function(t) { return new Date(t); });
      return cached;
    }

    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat
      + '&longitude=' + lng
      + '&daily=sunrise,sunset'
      + '&timezone=auto'
      + '&forecast_days=' + FORECAST_DAYS;

    try {
      var response = await fetch(url);
      if (!response.ok) return null;
      var json = await response.json();
      var data = {
        dates: json.daily.time,
        sunrise: json.daily.sunrise.map(function(t) { return new Date(t); }),
        sunset: json.daily.sunset.map(function(t) { return new Date(t); })
      };
      window.TideCache.set(cacheKey, data);
      return data;
    } catch (e) {
      console.warn('Failed to fetch sun times:', e);
      return null;
    }
  };

  WindSwellService.prototype.fetchAll = async function(lat, lng) {
    var results = await Promise.all([
      this.fetchWindForecast(lat, lng),
      this.fetchSwellForecast(lat, lng),
      this.fetchSunTimes(lat, lng)
    ]);
    return { wind: results[0], swell: results[1], sun: results[2] };
  };

  function parseTimeArray(timeStrings) {
    if (!timeStrings) return [];
    var dates = [];
    for (var i = 0; i < timeStrings.length; i++) {
      dates.push(new Date(timeStrings[i]));
    }
    return dates;
  }

  window.WindSwellService = WindSwellService;
})();
