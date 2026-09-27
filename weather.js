/* ============================================================================
 * weather.js — live conditions for Anwaa via Open-Meteo (no API key required)
 * ----------------------------------------------------------------------------
 * Privacy stance:
 *   Geolocation is never requested on page load. A default city (Riyadh) is
 *   fetched immediately so the widget is populated with zero prompting, and
 *   navigator.geolocation is touched only when the user explicitly picks
 *   "locate me" from the city menu.
 *
 * Failure policy: nothing here throws. Every failure path resolves to null so
 * weather stays an enhancement rather than a gate on the observatory.
 *
 * Public surface (window.AnwaaWeather):
 *   cities()             -> [{ id, name, region, lat, lon }]
 *   getCity()            -> current city record
 *   setCity(id)          -> switch by id, invalidates cache
 *   locate()             -> opt-in geolocation; Promise -> city | null
 *   fetchLive(options)   -> Promise -> readings | null
 *   describe(code)       -> Arabic label for a WMO weather code
 *   versus(talea, live)  -> proverb-vs-reality sentence
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  /* --------------------------------------------------------------------------
   * Kingdom cities, ordered by administrative region. Coordinates are city
   * centres, which is the precision Open-Meteo needs for local conditions.
   * ------------------------------------------------------------------------ */
  var CITIES = [
    // منطقة الرياض
    { id: 'riyadh', name: 'الرياض', region: 'منطقة الرياض', lat: 24.7136, lon: 46.6753 },
    { id: 'kharj', name: 'الخرج', region: 'منطقة الرياض', lat: 24.1554, lon: 47.3346 },
    { id: 'wadi-ad-dawasir', name: 'وادي الدواسر', region: 'منطقة الرياض', lat: 20.4607, lon: 44.7873 },

    // منطقة مكة المكرمة
    { id: 'makkah', name: 'مكة المكرمة', region: 'منطقة مكة المكرمة', lat: 21.3891, lon: 39.8579 },
    { id: 'jeddah', name: 'جدة', region: 'منطقة مكة المكرمة', lat: 21.5433, lon: 39.1728 },
    { id: 'taif', name: 'الطائف', region: 'منطقة مكة المكرمة', lat: 21.2854, lon: 40.4151 },

    // المنطقة الشرقية
    { id: 'dammam', name: 'الدمام', region: 'المنطقة الشرقية', lat: 26.4207, lon: 50.0888 },
    { id: 'khobar', name: 'الخبر', region: 'المنطقة الشرقية', lat: 26.2172, lon: 50.1971 },
    { id: 'al-ahsa', name: 'الأحساء', region: 'المنطقة الشرقية', lat: 25.3838, lon: 49.5857 },
    { id: 'jubail', name: 'الجبيل', region: 'المنطقة الشرقية', lat: 27.0046, lon: 49.6460 },
    { id: 'hafr-al-batin', name: 'حفر الباطن', region: 'المنطقة الشرقية', lat: 28.4328, lon: 45.9708 },

    // منطقة المدينة المنورة
    { id: 'madinah', name: 'المدينة المنورة', region: 'منطقة المدينة المنورة', lat: 24.5247, lon: 39.5692 },
    { id: 'yanbu', name: 'ينبع', region: 'منطقة المدينة المنورة', lat: 24.0895, lon: 38.0618 },
    { id: 'al-ula', name: 'العلا', region: 'منطقة المدينة المنورة', lat: 26.6085, lon: 37.9232 },

    // منطقة عسير
    { id: 'abha', name: 'أبها', region: 'منطقة عسير', lat: 18.2164, lon: 42.5053 },
    { id: 'khamis-mushait', name: 'خميس مشيط', region: 'منطقة عسير', lat: 18.3000, lon: 42.7333 },
    { id: 'al-namas', name: 'النماص', region: 'منطقة عسير', lat: 19.1455, lon: 42.1201 },

    // منطقة القصيم
    { id: 'buraydah', name: 'بريدة', region: 'منطقة القصيم', lat: 26.3592, lon: 43.9818 },
    { id: 'unayzah', name: 'عنيزة', region: 'منطقة القصيم', lat: 26.0843, lon: 43.9936 },

    // منطقة تبوك
    { id: 'tabuk', name: 'تبوك', region: 'منطقة تبوك', lat: 28.3838, lon: 36.5550 },
    { id: 'al-wajh', name: 'الوجه', region: 'منطقة تبوك', lat: 26.2455, lon: 36.4525 },

    // منطقة حائل
    { id: 'hail', name: 'حائل', region: 'منطقة حائل', lat: 27.5114, lon: 41.7208 },

    // منطقة جازان
    { id: 'jazan', name: 'جازان', region: 'منطقة جازان', lat: 16.8892, lon: 42.5706 },
    { id: 'farasan', name: 'فرسان', region: 'منطقة جازان', lat: 16.7022, lon: 42.1189 },

    // منطقة نجران
    { id: 'najran', name: 'نجران', region: 'منطقة نجران', lat: 17.5650, lon: 44.2289 },

    // منطقة الباحة
    { id: 'al-baha', name: 'الباحة', region: 'منطقة الباحة', lat: 20.0129, lon: 41.4677 },
    { id: 'baljurashi', name: 'بلجرشي', region: 'منطقة الباحة', lat: 19.8653, lon: 41.5597 },

    // منطقة الجوف
    { id: 'sakaka', name: 'سكاكا', region: 'منطقة الجوف', lat: 29.9697, lon: 40.2064 },
    { id: 'al-qurayyat', name: 'القريات', region: 'منطقة الجوف', lat: 31.3318, lon: 37.3428 },

    // منطقة الحدود الشمالية
    { id: 'arar', name: 'عرعر', region: 'منطقة الحدود الشمالية', lat: 30.9753, lon: 41.0381 },
    { id: 'turaif', name: 'طريف', region: 'منطقة الحدود الشمالية', lat: 31.6725, lon: 38.6637 }
  ];

  var CACHE_TTL = 10 * 60 * 1000;   // 10 minutes
  var GEO_TIMEOUT = 8000;            // opt-in geolocation deadline

  // Riyadh is the default purely by position: it is CITIES[0].
  var currentCity = CITIES[0];
  var cache = { key: '', data: null, at: 0 };

  /* Compass points, indexed by 45-degree sector starting at north. */
  var WIND_DIRS = ['شمالية', 'شمالية شرقية', 'شرقية', 'جنوبية شرقية',
    'جنوبية', 'جنوبية غربية', 'غربية', 'شمالية غربية'];

  /** Compass label for a bearing in degrees; null when not a finite number. */
  function windDirection(deg) {
    if (typeof deg !== 'number' || !isFinite(deg)) return null;
    var idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
    return WIND_DIRS[idx];
  }

  /* WMO weather interpretation codes -> short Arabic labels. */
  var CODE_LABELS = {
    0: 'سماء صافية', 1: 'صحو غالباً', 2: 'غائم جزئياً', 3: 'غائم',
    45: 'ضباب', 48: 'ضباب متجمّد', 51: 'رذاذ خفيف', 53: 'رذاذ',
    55: 'رذاذ كثيف', 56: 'رذاذ متجمّد', 57: 'رذاذ متجمّد',
    61: 'مطر خفيف', 63: 'مطر', 65: 'مطر غزير',
    66: 'مطر متجمّد خفيف', 67: 'مطر متجمّد',
    71: 'ثلج خفيف', 73: 'ثلج', 75: 'ثلج كثيف', 77: 'حبيبات ثلجية',
    80: 'زخّات خفيفة', 81: 'زخّات', 82: 'زخّات غزيرة',
    85: 'زخّات ثلجية', 86: 'زخّات ثلجية كثيفة',
    95: 'رعد', 96: 'رعد وبَرَد خفيف', 99: 'رعد وبَرَد'
  };

  function describe(code) {
    return CODE_LABELS[code] || 'أجواء متقلبة';
  }

  /** Copy of the current city, so callers cannot mutate internal state. */
  function getCity() {
    return {
      id: currentCity.id, name: currentCity.name, region: currentCity.region,
      lat: currentCity.lat, lon: currentCity.lon
    };
  }

  /** Select a city by id; resets the cache so readings are refetched. */
  function setCity(id) {
    for (var i = 0; i < CITIES.length; i++) {
      if (CITIES[i].id === id) {
        currentCity = CITIES[i];
        cache = { key: '', data: null, at: 0 };
        return getCity();
      }
    }
    return null;
  }

  /**
   * Opt-in geolocation. Never called during boot.
   *
   * Guards against three distinct hangs: a missing API, a user who never
   * answers the permission prompt, and a provider that simply errors. The
   * `done` latch plus an explicit timer guarantees the promise settles
   * exactly once on every path, whichever callback arrives first.
   */
  function locate() {
    return new Promise(function (resolve) {
      try {
        if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
          resolve(null);
          return;
        }
        var done = false;
        var timer = setTimeout(function () {
          if (!done) { done = true; resolve(null); }
        }, GEO_TIMEOUT);

        navigator.geolocation.getCurrentPosition(function (pos) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          var c = pos && pos.coords ? pos.coords : {};
          var lat = +c.latitude, lon = +c.longitude;
          if (!isFinite(lat) || !isFinite(lon)) { resolve(null); return; }
          currentCity = {
            id: 'geo', name: 'موقعي الحالي', region: 'بحسب إحداثيات جهازك',
            lat: lat, lon: lon
          };
          cache = { key: '', data: null, at: 0 };
          resolve(getCity());
        }, function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(null);
        }, { maximumAge: 600000, timeout: GEO_TIMEOUT - 1000, enableHighAccuracy: false });
      } catch (err) { resolve(null); }
    });
  }

  /**
   * Raw Open-Meteo round-trip, hardened into a total function.
   *
   * Network rejection, non-2xx status, malformed JSON and a payload missing
   * `current.temperature_2m` all collapse to null rather than propagating.
   */
  function fetchLiveWeather(lat, lon) {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' +
      encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) +
      '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m' +
      '&timezone=auto&wind_speed_unit=kmh';
    return fetch(url, { mode: 'cors' }).then(function (res) {
      if (!res || !res.ok) return null;
      return res.json();
    }).then(function (json) {
      var cur = json && json.current ? json.current : null;
      if (!cur || typeof cur.temperature_2m !== 'number') return null;
      return {
        tempC: Math.round(cur.temperature_2m),
        windKmh: (typeof cur.wind_speed_10m === 'number') ? Math.round(cur.wind_speed_10m) : null,
        windDeg: (typeof cur.wind_direction_10m === 'number') ? cur.wind_direction_10m : null,
        windDir: windDirection(cur.wind_direction_10m),
        code: (typeof cur.weather_code === 'number') ? cur.weather_code : -1,
        label: describe(cur.weather_code)
      };
    }).catch(function () { return null; });
  }

  /**
   * Current city -> live readings, memoised for CACHE_TTL.
   *
   * The cache key is the rounded coordinate pair rather than the city id, so
   * an opt-in geolocated city and a listed city sharing a location still hit
   * the same entry. Never rejects.
   */
  function fetchLive(options) {
    var opts = options || {};
    var useCache = opts.cache !== false;
    var city = opts.city ? (setCity(opts.city) || currentCity) : currentCity;
    var key = city.lat.toFixed(2) + ',' + city.lon.toFixed(2);
    var now = Date.now();

    if (useCache && cache.data && cache.key === key && (now - cache.at) < CACHE_TTL) {
      return Promise.resolve(withCity(cache.data));
    }
    return fetchLiveWeather(city.lat, city.lon).then(function (live) {
      if (live && useCache) cache = { key: key, data: live, at: now };
      return live ? withCity(live) : null;
    }).catch(function () { return null; });
  }

  /** Attach the city name so the widget can label the readings. */
  function withCity(live) {
    var out = {};
    for (var k in live) { if (Object.prototype.hasOwnProperty.call(live, k)) out[k] = live[k]; }
    out.city = currentCity.name;
    out.cityRegion = currentCity.region;
    return out;
  }

  /**
   * Rhetorical line tying the mansion's proverb to real conditions.
   *
   * The mansion's seasonal intent is inferred from keyword classes (cold, hot,
   * rain); a mismatch against the live reading is what makes the comparison
   * worth reading. Returns '' when no reading is available.
   */
  function versus(talea, live) {
    if (!live) return '';
    var proverb = (talea && talea.proverb) ? talea.proverb : '';
    var cold = /برد|صقيع|ثلج|جليد|زمهرير|البولة|العويل|الكلب/.test(proverb);
    var hot = /حر|الوقعة|الحصيرة|البركان|الغدران|استعر/.test(proverb);
    var rain = /مطر|سيل|المزخرف|الغدران|الوديان|الأودية/.test(proverb);
    var mood;
    if (cold && live.tempC >= 30) mood = 'واليومُ حرٌّ — فالحكمةُ ذكرى الموسم لا وصفُ الساعة';
    else if (hot && live.tempC <= 18) mood = 'واليومُ بردٌ لطيف — كأن الموسم يهمس قبل أوانه';
    else if (rain && (live.code === 0 || live.code === 1)) mood = 'والسماءُ صافيةٌ الآن — فانتظرْ وعدَ الغيث';
    else if (!cold && !hot && live.tempC >= 38) mood = 'والقيظُ شاهدٌ على صدق المثل';
    else if (!cold && !hot && live.tempC <= 10) mood = 'والبردُ الليلةَ يوافق حكمةَ الأجداد';
    else mood = 'والأجواءُ الليلةَ على موعدٍ مع حكمة الأجداد';
    return '«' + proverb + '» — الآن ' + live.tempC + '° (' + live.label + ')، ' + mood + '.';
  }

  window.AnwaaWeather = {
    version: '2.0.0',
    cities: function () { return CITIES.slice(); },
    getCity: getCity,
    setCity: setCity,
    locate: locate,
    describe: describe,
    windDirection: windDirection,
    fetchLive: fetchLive,
    versus: versus
  };
})();