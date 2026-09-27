/* ============================================================================
 * app.js — منطق واجهة مرصد «أَنْوَاء: مَطَالِعُ النُّجُومِ وَقَوَاسِيمُ الأَرْضِ»
 * ----------------------------------------------------------------------------
 * يجمع طبقة التحكّم في الصفحة (التي كانت مضمّنة داخل index.html) في ملف مستقل،
 * ويتكامل مع المحرّكات المنفصلة عبر واجهاتها العامة:
 *   • anwaa.js   : بيانات الطوالع والمواسم + الحسابات الفلكية (دوال عامة)
 *   • sky.js     : window.AnwaaSky   — خلفية الفضاء ورحلة الرصد
 *   • audio.js   : window.playChime / window.playWarpSound
 *   • weather.js : window.AnwaaWeather — الطقس المباشر والمقارنة البلاغية
 *
 * الأقسام:
 *   1) حالة الطالع المعروض وربط العناصر
 *   2) الشريط الزمني للمواسم
 *   3) نافذة التقويم (ميلادي/هجري بأم القرى)
 *   4) الطقس المباشر
 *   5) لحظة الرصد والرجوع إلى السماء
 *   6) المشاركة والتصدير كصورة ستوري
 *   7) النبذة الفلكية والمناخية
 *   8) الأحداث العامة والإقلاع
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  /* ==========================================================================
   * 0) ثوابت عامة
   * ======================================================================== */

  /**
   * أيقونات SVG خطية أحادية اللون (Monoline) بدل الإيموجي الملوّنة.
   * كلها ترث لون النص عبر currentColor، فتبقى ضمن هوية أنواء الهادئة.
   *   viewBox 24×24 · بلا تعبئة · stroke فقط · بنية موحّدة.
   */
  var SVG = {
    /** الشتلة: Agriculture / الزراعة والغرس */
    sprout: '<path d="M12 21v-7"/><path d="M12 14c0-3.3-2.2-5.6-5.5-5.8C6.4 11 8.2 13.7 12 14z"/><path d="M12 14c0-3.9 2.6-6.3 6-6.4.1 3.9-2.1 6.2-6 6.4z"/><path d="M8 21h8"/>',
    /** السترة/المعطف: Climate & lifestyle / نمط الحياة والمناخ */
    coat: '<path d="M9 3.5 12 6l3-2.5 3.2 1.8a1.6 1.6 0 0 1 .7 1.5l-.4 2.4-1.9-.5V21H7.4v-12.3l-1.9.5-.4-2.4a1.6 1.6 0 0 1 .7-1.5L9 3.5z"/>',
    /** المنظار: Observation angle / زاوية الرصد */
    scope: '<path d="M4 7.5h4l6-1.5h6v12h-6L8 16.5H4z"/><path d="M14 12h2"/><path d="M8 7.5v9"/><path d="M20 10.5v3"/>',
    /** المطر: الوسم */
    rain: '<path d="M7 15.5a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.3 1.6A3.6 3.6 0 0 1 17.5 15.5"/><path d="M9 18.5l-.6 1.6M12.5 18.5l-.6 1.6M16 18.5l-.6 1.6"/>',
    /** البلّورة/الصقيع: المربعانية والشبط */
    crystal: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M12 8.2 9.4 12l2.6 3.8L14.6 12 12 8.2z"/>',
    /** القطرة: العقارب */
    drop: '<path d="M12 4.5c3 3.6 5 6.2 5 8.6a5 5 0 0 1-10 0c0-2.4 2-5 5-8.6z"/>',
    /** النجم: سهيل وكنّة الثريا */
    star: '<path d="M12 4.5 13.7 10l5.8.4-4.5 3.6 1.6 5.5L12 16.2 7.4 19.5 9 14 4.5 10.4 10.3 10 12 4.5z"/>'
  };

  /** أيقونات المواسم الستة المعروضة على الشريط الزمني (SVG لا إيموجي) */
  var SEASON_ICONS = {
    'سهيل': 'star',
    'الوسم': 'rain',
    'المربعانية': 'crystal',
    'الشبط': 'crystal',
    'العقارب': 'drop',
    'كنّة الثريا': 'star'
  };

  /** نبذة فلكية لكل موسم تُعرض في نافذة النبذة */
  var SEASON_ASTRONOMY = {
    'سهيل': 'موسم يحمل اسم نجم سهيل (كانوب)، ثاني ألمع نجوم السماء بعد سيريوس، الذي يبدو متواضعاً في أفق الجنوب؛ وفيه يميل الجوّ نحو الخريف وتهدأ رياح الصيف.',
    'الوسم': 'أول منازل المطر في السنة؛ يتعاقب في طوالعه العواء والسماك والغفر والزبانا، وهي منازل تسبق موسم الحرّ وتفتح باب الشتاء المبكر في مطلع أكتوبر.',
    'المربعانية': 'يقع بعد الانقلاب الشتوي مباشرة حين يكون النهار في أقصر حالاته؛ ومنه اشتُقّ اسمه بالبرد المبرق، فيشدّ البرد ويُصعد الصقيع في لياليه الطويلة.',
    'الشبط': 'أشدّ المنازل برودةً وصقيعاً في التراث العربي، واسمها مشتقّ من الشَّبَط أي البياض؛ ولطوالعها: «إذا طلعت النعائم، ابيضت البهائم من الصقيع الدائم».',
    'العقارب': 'ينقلنا من عمق الشتاء إلى مطلع الاعتدال الربيعي؛ تتتابع فيه طوالع سعد الثلاثة التي يربطها أهل التراث بجريان الماء وطراوة المرعى.',
    'كنّة الثريا': 'تسبق طلوع الثريّا بنحو أسبوعين إلى ثلاثة كأنها تمهّد لمجيئها؛ اعتدال ونسيم ربيعي، وترى في لياليها أجرام السماء متلألئة بعد منتصف الليل.'
  };

  /** الخصائص المناخية المعروضة لكل طبيعة موسم */
  var KIND_CLIMATE = {
    clear: ['رؤية فلكية ممتازة وسماء صافية', 'نجوم لؤلؤية متلألئة بكثافة عالية', 'ليل معتدل ونهار يميل إلى الدفء'],
    rain: ['رذاذ خفيف وأمطار متفرقة', 'ضباب كوني خفيف ينساب بين النجوم', 'رطوبة معتدلة وتربة راضية'],
    frost: ['صقيع وبرد ليلي شديد', 'بلورات ثلجية دقيقة وهواء جاف', 'صباحات باردة وليل أزرق جليدي']
  };

  /** أسماء الأشهر والأيام بالعربية للتقويم المخصص */
  var GREG_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var HIJRI_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر',
    'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان',
    'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
  var WEEKDAYS = ['أحد', 'اثنين', 'ثلا', 'أربع', 'خميس', 'جمعة', 'سبت'];

  var MS_PER_DAY = 86400000;
  var TOAST_MS = 2600;          // عمر إشعار النسخ
  var HALO_RESIZE_MS = 220;     // تأجيل إعادة إسناد الهالة بعد تغيير الحجم
  var OBSERVE_FALLBACK_MS = 1250;   // احتياط زمني إن لم يُعد sky.observe وعداً
  var RELEASE_FALLBACK_MS = 700;
  var SWAP_MS = 180;             // مدّة تلاشٍ انتقال المحتوى بين الطوالع (ناعم بلا تأخير محسوس)
  var STORY_W = 1080;           // أبعاد ستوري إنستغرام (9:16)
  var STORY_H = 1920;

  /* ==========================================================================
   * 1) حالة الطالع المعروض وربط العناصر
   * ======================================================================== */

  var todayDate = new Date();
  var currentToday = getCurrentTalea(todayDate);
  var currentTodaySeason = getSeasonOfTalea(currentToday);
  var activeTalea = currentToday;
  var activeSeasonKey = currentTodaySeason ? currentTodaySeason.key : currentToday.season;

  /* هل الطالع المعروض هو طالع اليوم الفعلي؟
     الطقس اللحظي يُعرض فقط في هذه الحالة (أو عند الرصد المباشر)؛
     وعند تصفّح أي طالع آخر يُخفى تماماً ويبقى المثل والرصد والدليل. */
  var isTodayTalea = true;

  var sky = window.AnwaaSky || null;
  var body = document.body;

  var el = {
    seasonBadge: document.getElementById('seasonBadge'),
    starName: document.getElementById('starName'),
    proverb: document.getElementById('proverb'),
    dateDisplay: document.getElementById('dateDisplay'),
    liveWeather: document.getElementById('liveWeather'),
    weatherWidget: document.getElementById('weatherWidget'),
    wwCity: document.getElementById('wwCity'),
    wwChips: document.getElementById('wwChips'),
    wwSight: document.getElementById('wwSight'),
    agroFarm: document.getElementById('agroFarm'),
    agroLife: document.getElementById('agroLife'),
    cityPicker: document.querySelector('.city-picker'),
    cityBtn: document.getElementById('cityBtn'),
    cityBtnName: document.getElementById('cityBtnName'),
    cityMenu: document.getElementById('cityMenu'),
    cityList: document.getElementById('cityList'),
    geoBtn: document.getElementById('geoBtn'),
    seasonsScroll: document.getElementById('seasonsScroll'),
    todayBtn: document.getElementById('todayBtn'),
    weatherHint: document.getElementById('timelineWeatherHint'),
    observeBtn: document.getElementById('observeBtn'),
    backBtn: document.getElementById('backBtn'),
    card: document.getElementById('taleaCard'),
    shareBtn: document.getElementById('shareBtn'),
    saveImgBtn: document.getElementById('saveImgBtn'),
    infoBtn: document.getElementById('infoBtn'),
    toast: document.getElementById('toast')
  };

  var busy = false;                 // منع تداخل رحلة الرصد مع الرجوع
  var toastTimer = 0;
  var resizeTimer = 0;
  var swapTimer = 0;             // مؤقّت انتقال المحتوى بين الطوالع
  var liveWeatherData = null;
  var liveWeatherNote = '';
  var capturingCard = false;

  /** نصوصا التاريخ الثابتان لليوم (هجري أم القرى + ميلادي) */
  var hijriText = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { dateStyle: 'long' }).format(todayDate);
  var gregorianText = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long' }).format(todayDate);

  // ربط هالة السماء ولون السديم وطقس الموسم بطالع اليوم الحالي
  if (sky && sky.setTalea) sky.setTalea(currentToday);

  /* ==========================================================================
   * 2) الشريط الزمني للمواسم
   * ======================================================================== */

  var seasonButtons = [];

  /**
   * توليد أيقونة SVG خطية جاهزة للإدراج.
   * @param {string} name  مفتاح الأيقونة من SVG
   * @param {string} [cls] صنف اختياري للتحكّم بالقياس واللون
   */
  function svgIcon(name, cls) {
    var body = SVG[name] || SVG.star;
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" ' +
      'aria-hidden="true" focusable="false" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      body + '</svg>';
  }

  function getSeasonIcon(name) {
    return svgIcon(SEASON_ICONS[name] || 'star');
  }

  /** إبراز الموسم النشط على الشريط + تحديث سطر وصف الطقس الفلكي */
  function updateTimelineActiveState(seasonKey, isToday) {
    activeSeasonKey = seasonKey;
    for (var i = 0; i < seasonButtons.length; i++) {
      var item = seasonButtons[i];
      var active = item.season.key === seasonKey;
      item.btn.classList.toggle('is-active', active);
      item.btn.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) {
        // ضمان ظهور الزر النشط في الرؤية عند التمرير الأفقي
        try {
          item.btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } catch (err) { /* تجاهل: التمرير تحسين */ }
      }
    }
    el.todayBtn.classList.toggle('is-today-active', !!isToday);

    var season = findSeasonByKey(seasonKey);
    if (season && season.sky) {
      el.weatherHint.innerHTML = '<strong>' + season.label + '</strong>: ' + season.sky;
    }
  }

  function findSeasonByKey(key) {
    for (var i = 0; i < anwaaSeasons.length; i++) {
      if (anwaaSeasons[i].key === key) return anwaaSeasons[i];
    }
    return null;
  }

  /** نص المدى الزمني للموسم على زر الشريط: «24/8 - 15/10» */
  function seasonRangeText(season) {
    if (!season.range || !season.range[0] || !season.range[1]) return '';
    var from = season.range[0];
    var to = season.range[1];
    return from[1] + '/' + from[0] + ' - ' + to[1] + '/' + to[0];
  }

  /** توليد أزرار المواسم الستة من anwaaSeasons */
  function buildSeasonButtons() {
    for (var i = 0; i < anwaaSeasons.length; i++) {
      (function (season) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'season-btn';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', 'false');

        if (currentTodaySeason && currentTodaySeason.key === season.key) {
          btn.classList.add('is-current');
          btn.setAttribute('title', season.label + ' (الموسم الحالي)');
        }

        btn.innerHTML =
          '<span class="season-btn-name">' +
          '<span class="season-btn-icon" aria-hidden="true">' + getSeasonIcon(season.key) + '</span>' +
          '<span>' + season.label + '</span>' +
          '</span>' +
          '<span class="season-btn-range">' + seasonRangeText(season) + '</span>';

        btn.addEventListener('click', function () { selectSeason(season, true); });

        el.seasonsScroll.appendChild(btn);
        seasonButtons.push({ season: season, btn: btn });
      })(anwaaSeasons[i]);
    }
  }

  /** اختيار موسم: يحدّث السماء بنبضة ناعمة ويعرض أول طالع في الموسم */
  function selectSeason(season, pulse) {
    if (!season) return;
    if (window.playChime) window.playChime();   // رنين بلوري خفيف عند اختيار موسم

    var firstTalea = getSeasonFirstTalea(season) ||
      { name: season.label, season: season.label, proverb: '' };
    var isCurrentSeason = currentTodaySeason && currentTodaySeason.key === season.key;
    // هل أول طوالع هذا الموسم هو طالع اليوم الفعلي؟
    var picksToday = isCurrentSeason && currentToday.name === firstTalea.name;

    renderTalea(picksToday ? currentToday : firstTalea, picksToday);

    if (sky) {
      if (sky.setSeason) sky.setSeason(season.key, pulse !== false);
      else if (sky.setTalea) sky.setTalea(firstTalea);
    }
    updateTimelineActiveState(season.key, picksToday);
  }

  /** الرجوع إلى طالع اليوم الحالي وطقسه */
  function resetToToday() {
    if (window.playChime) window.playChime();
    renderTalea(currentToday, true);
    if (sky && sky.setTalea) {
      sky.setTalea(currentToday);
      if (sky.pulse) sky.pulse(0.85);
    }
    updateTimelineActiveState(currentTodaySeason ? currentTodaySeason.key : currentToday.season, true);
  }

  /* ==========================================================================
   * 3) نافذة التقويم: ميلادي/هجري (أم القرى) بتصميم زجاجي داكن
   * ======================================================================== */

  var dateBtnEl = document.getElementById('dateBtn');
  var dateModalEl = document.getElementById('dateModal');
  var dateCloseEl = document.getElementById('dateClose');
  var calTabGregEl = document.getElementById('calTabGreg');
  var calTabHijriEl = document.getElementById('calTabHijri');
  var calMonthSelectEl = document.getElementById('calMonthSelect');
  var calYearSelectEl = document.getElementById('calYearSelect');
  var calWeekEl = document.getElementById('calWeek');
  var calGridEl = document.getElementById('calGrid');
  var calPrevEl = document.getElementById('calPrev');
  var calNextEl = document.getElementById('calNext');
  var dateHintEl = document.getElementById('dateHint');

  var calMode = 'greg';   // 'greg' | 'hijri'
  var calView = { y: todayDate.getFullYear(), m: todayDate.getMonth() + 1, hy: 1447, hm: 1 };
  var lastDateFocus = null;

  /* مدى السنوات المعروضة في القائمة المنسدلة لكل تقويم */
  var CAL_YEAR_MIN = { greg: 1950, hijri: 1370 };
  var CAL_YEAR_MAX = { greg: 2030, hijri: 1452 };

  /** تلميح النافذة: رسالة هادئة تحت التقويم (aria-live) */
  function setDateHint(message) {
    if (dateHintEl) dateHintEl.textContent = message || '';
  }

  /** أرقام عربية مشرقية للعرض */
  function arDigits(n) {
    return String(n).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[+d]; });
  }

  /** أجزاء التاريخ الهجري (أم القرى) لتاريخ ميلادي — بلا رمي أبداً */
  function hijriPartsOf(date) {
    try {
      var parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura',
        { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(date);
      var pick = function (type) {
        for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
        return '';
      };
      var y = parseInt(pick('year'), 10);
      var m = parseInt(pick('month'), 10);
      var d = parseInt(pick('day'), 10);
      if (y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 30) return { y: y, m: m, d: d };
    } catch (err) { /* احتياط أدناه */ }
    return null;
  }

  /** أول يوم هجري → ميلادي: تقدير الكويت ثم تصحيحه بمطابقة أم القرى (دقيق) */
  function hijriMonthStart(hy, hm) {
    var guess = hijriToGregorian(hy, hm, 1);
    if (!guess || isNaN(guess.getTime())) guess = new Date(Date.UTC(2026, 0, 1));
    for (var shift = -3; shift <= 3; shift++) {
      var d = new Date(guess.getFullYear(), guess.getMonth(), guess.getDate() + shift);
      var hp = hijriPartsOf(d);
      if (hp && hp.y === hy && hp.m === hm && hp.d === 1) return d;
    }
    return guess;   // تعذّرت المطابقة (Intl قديم): نبقى على التقدير
  }

  /** طول الشهر الهجري (29/30) عبر الفرق بين أول الشهر وأول التالي */
  function hijriMonthLength(hy, hm) {
    var nm = hm + 1, ny = hy;
    if (nm > 12) { nm = 1; ny++; }
    var a = hijriMonthStart(hy, hm);
    var b = hijriMonthStart(ny, nm);
    if (a && b) {
      var diff = Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
      if (diff === 29 || diff === 30) return diff;
    }
    return 30;
  }

  /** أول أيام الأسبوع (0=أحد..6=سبت) لأول يوم في الشهر المعروض */
  function calFirstWeekday() {
    if (calMode === 'greg') return new Date(calView.y, calView.m - 1, 1).getDay();
    var g = hijriMonthStart(calView.hy, calView.hm);
    return g ? g.getDay() : 6;   // احتياط: السبت
  }

  /** عدد أيام الشهر المعروض */
  function calMonthLength() {
    if (calMode === 'greg') return new Date(calView.y, calView.m, 0).getDate();
    return hijriMonthLength(calView.hy, calView.hm);
  }

  /** مزامنة الشهر المعروض مع اليوم عند الفتح */
  function calSyncToToday() {
    calView.y = todayDate.getFullYear();
    calView.m = todayDate.getMonth() + 1;
    var hp = hijriPartsOf(todayDate);
    if (hp) { calView.hy = hp.y; calView.hm = hp.m; }
  }

  /** تفريغ قائمة <select> من كل خياراتها (يتعامل مع options وchildren معاً) */
  function clearSelect(select) {
    if (!select) return;
    if (select.options) select.options.length = 0;
    while (select.firstChild) select.removeChild(select.firstChild);
    select.textContent = '';
  }

  /**
   * تعبئة القائمتين المنسدلتين (الشهر/السنة) بحسب نوع التقويم الحالي.
   * يُعاد البناء فقط عند تغيّر عدد الخيارات، وتبقى القائمة على الشهر المعروض.
   */
  function syncCalendarPickers() {
    var isGreg = calMode === 'greg';
    var months = isGreg ? GREG_MONTHS : HIJRI_MONTHS;
    var year = isGreg ? calView.y : calView.hy;
    var min = CAL_YEAR_MIN[isGreg ? 'greg' : 'hijri'];
    var max = CAL_YEAR_MAX[isGreg ? 'greg' : 'hijri'];

    if (calMonthSelectEl) {
      if (calMonthSelectEl.options.length !== months.length) {
        clearSelect(calMonthSelectEl);
        for (var i = 0; i < months.length; i++) {
          var opt = document.createElement('option');
          opt.value = String(i + 1);
          opt.textContent = months[i];
          calMonthSelectEl.appendChild(opt);
        }
      }
      calMonthSelectEl.value = String(isGreg ? calView.m : calView.hm);
    }

    if (calYearSelectEl) {
      if (calYearSelectEl.options.length !== (max - min + 1)) {
        clearSelect(calYearSelectEl);
        for (var y = min; y <= max; y++) {
          var yOpt = document.createElement('option');
          yOpt.value = String(y);
          yOpt.textContent = arDigits(y) + (isGreg ? '' : 'هـ');
          calYearSelectEl.appendChild(yOpt);
        }
      }
      calYearSelectEl.value = String(year);
      calYearSelectEl.setAttribute('aria-label', isGreg ? 'اختيار السنة الميلادية' : 'اختيار السنة الهجرية');
    }
  }

  /** اختيار شهر من القائمة المنسدلة (1..12) */
  function calSelectMonth(value) {
    var month = parseInt(value, 10);
    if (!(month >= 1 && month <= 12)) return;
    if (calMode === 'greg') calView.m = month;
    else calView.hm = month;
    if (window.playChime) window.playChime();
    renderCalendar();
  }

  /** اختيار سنة من القائمة المنسدلة (تقتصر على المدى المتاح) */
  function calSelectYear(value) {
    var year = parseInt(value, 10);
    if (!isFinite(year)) return;
    var isGreg = calMode === 'greg';
    var min = CAL_YEAR_MIN[isGreg ? 'greg' : 'hijri'];
    var max = CAL_YEAR_MAX[isGreg ? 'greg' : 'hijri'];
    if (year < min || year > max) return;
    if (isGreg) calView.y = year;
    else calView.hy = year;
    if (window.playChime) window.playChime();
    renderCalendar();
  }

  /** رسم شبكة الشهر: عنوان + أسماء الأيام + خلايا الأيام */
  function renderCalendar() {
    if (!calGridEl) return;
    calGridEl.innerHTML = '';

    if (calWeekEl && !calWeekEl.children.length) {
      for (var w = 0; w < WEEKDAYS.length; w++) {
        var cell = document.createElement('span');
        cell.className = 'cal-weekday';
        cell.textContent = WEEKDAYS[w];
        calWeekEl.appendChild(cell);
      }
    }

    var isGreg = calMode === 'greg';
    calTabGregEl.classList.toggle('is-active', isGreg);
    calTabGregEl.setAttribute('aria-selected', isGreg ? 'true' : 'false');
    calTabHijriEl.classList.toggle('is-active', !isGreg);
    calTabHijriEl.setAttribute('aria-selected', isGreg ? 'false' : 'true');
    syncCalendarPickers();   // عنوان الشهر والسنة صار قائمتين منسدلتين

    // خلايا فارغة لمحاذاة أول الشهر (التقويم عربي RTL فيتدفق تلقائياً)
    var lead = calFirstWeekday();
    for (var k = 0; k < lead; k++) {
      var pad = document.createElement('span');
      pad.className = 'cal-pad';
      pad.setAttribute('aria-hidden', 'true');
      calGridEl.appendChild(pad);
    }

    var monthLabel = isGreg ? GREG_MONTHS[calView.m - 1] : HIJRI_MONTHS[calView.hm - 1];
    var yearLabel = isGreg ? arDigits(calView.y) : arDigits(calView.hy) + 'هـ';
    var todayHp = hijriPartsOf(todayDate);
    var len = calMonthLength();

    for (var day = 1; day <= len; day++) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      btn.textContent = arDigits(day);
      btn.setAttribute('aria-label', arDigits(day) + ' ' + monthLabel + ' ' + yearLabel);

      var isToday = isGreg
        ? (day === todayDate.getDate() && calView.m === todayDate.getMonth() + 1 &&
          calView.y === todayDate.getFullYear())
        : !!(todayHp && day === todayHp.d && calView.hm === todayHp.m && calView.hy === todayHp.y);
      if (isToday) btn.classList.add('is-today');

      (function (picked) {
        btn.addEventListener('click', function () { pickCalendarDay(picked); });
      })(day);

      calGridEl.appendChild(btn);
    }
  }

  /** تنقّل الشهور (يلتفّ حول السنة داخل المدى المتاح) */
  function calStep(delta) {
    var isGreg = calMode === 'greg';
    var min = CAL_YEAR_MIN[isGreg ? 'greg' : 'hijri'];
    var max = CAL_YEAR_MAX[isGreg ? 'greg' : 'hijri'];
    if (isGreg) {
      var m = calView.m + delta, y = calView.y;
      while (m < 1) { m += 12; y--; }
      while (m > 12) { m -= 12; y++; }
      if (y < min || y > max) return;   // حدود القائمة المنسدلة نفسها
      calView.m = m; calView.y = y;
    } else {
      var hm = calView.hm + delta, hy = calView.hy;
      while (hm < 1) { hm += 12; hy--; }
      while (hm > 12) { hm -= 12; hy++; }
      if (hy < min || hy > max) return;
      calView.hm = hm; calView.hy = hy;
    }
    if (window.playChime) window.playChime();
    renderCalendar();
  }

  /** اختيار يوم: ميلادي مباشر، وهجري عبر التحويل الحسابي (± يوم) */
  function pickCalendarDay(day) {
    var date;
    var extraNote = '';
    if (calMode === 'greg') {
      date = new Date(calView.y, calView.m - 1, day);
      if (isNaN(date.getTime())) { setDateHint('تاريخ غير صالح'); return; }
    } else {
      var start = hijriMonthStart(calView.hy, calView.hm);
      date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day - 1);
      if (isNaN(date.getTime())) { setDateHint('تعذّر تحويل هذا اليوم الهجري'); return; }
      extraNote = ' • (تقويم هجري حسابي)';
    }
    jumpToDateTalea(date, extraNote);
  }

  /** فتح نافذة التقويم: يزامن الشهر المعروض مع اليوم ويرسم الشبكة */
  function openDateModal() {
    if (!dateModalEl) return;
    lastDateFocus = document.activeElement;
    setDateHint('');
    calSyncToToday();
    renderCalendar();
    dateModalEl.classList.add('is-open');
    dateModalEl.setAttribute('aria-hidden', 'false');
    focusQuietly(calTabGregEl || dateCloseEl);
  }

  /** إغلاق نافذة التاريخ وإعادة التركيز لزرها */
  function closeDateModal() {
    if (!dateModalEl) return;
    dateModalEl.classList.remove('is-open');
    dateModalEl.setAttribute('aria-hidden', 'true');
    setDateHint('');
    focusQuietly(lastDateFocus || dateBtnEl);
  }

  /** الانتقال إلى طالع تاريخ معيّن: إغلاق النافذة وتحديث السماء والبطاقة */
  function jumpToDateTalea(date, extraNote) {
    closeDateModal();
    var greg = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long' }).format(date);
    var hijri = '';
    try {
      hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { dateStyle: 'long' }).format(date);
    } catch (err) { hijri = ''; }

    var talea = getCurrentTalea(date);
    var label = 'طالع ' + greg + (hijri ? ' • الموافق ' + hijri : '') + (extraNote || '');
    var season = getSeasonOfTalea(talea);

    if (season) {
      selectSeason(season, true);
      var isTodayPick = currentTodaySeason && currentTodaySeason.key === season.key &&
        currentToday.name === talea.name;
      renderTalea(isTodayPick ? currentToday : talea, isTodayPick, label);
      if (sky && sky.setTalea) sky.setTalea(isTodayPick ? currentToday : talea);
    } else {
      if (window.playChime) window.playChime();
      renderTalea(talea, false, label);
      if (sky && sky.setTalea) {
        sky.setTalea(talea);
        if (sky.pulse) sky.pulse(0.7);
      }
    }
    observe();
  }

  /** تبديل نوع التقويم: يحوّل الشهر المعروض إلى ما يوافقه في الآخر */
  function calSetMode(mode) {
    if (calMode === mode) return;
    calMode = mode;
    if (mode === 'hijri') {
      var hp = hijriPartsOf(new Date(calView.y, calView.m - 1, 1));
      if (hp) { calView.hy = hp.y; calView.hm = hp.m; }
      setDateHint('التقويم الهجري حسابي (أم القرى) — قد تختلف الرؤية المحليّة بيوم');
    } else {
      var g = hijriMonthStart(calView.hy, calView.hm);
      if (g) { calView.y = g.getFullYear(); calView.m = g.getMonth() + 1; }
      setDateHint('');
    }
    if (window.playChime) window.playChime();
    renderCalendar();
  }

  /** تنقّل الأسهم داخل الشبكة: يحرّك التركيز بين الأيام */
  function calArrowNav(e) {
    var keys = { ArrowRight: -1, ArrowLeft: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in keys)) return;
    var days = calGridEl.querySelectorAll('.cal-day');
    if (!days.length) return;
    var idx = -1;
    for (var i = 0; i < days.length; i++) if (days[i] === document.activeElement) idx = i;
    if (idx === -1) { days[0].focus({ preventScroll: true }); e.preventDefault(); return; }
    var next = idx + keys[e.key];
    if (next < 0 || next >= days.length) return;
    e.preventDefault();
    days[next].focus({ preventScroll: true });
  }

  /* ==========================================================================
   * 4) الطقس المباشر ومنتقي المدينة
   *    لا يُطلب إذن الموقع تلقائياً — تُجلب المدينة الافتراضية فوراً،
   *    ومن أراد دقة موقعه يختاره بنفسه من قائمة المدن.
   * ======================================================================== */

  /** رسم شرائح القياس (الحرارة والرياح) داخل الويدجت */
  function renderWeatherChips() {
    if (!el.wwChips) return;
    el.wwChips.textContent = '';
    if (!liveWeatherData) return;

    var chips = [];
    if (typeof liveWeatherData.tempC === 'number') {
      chips.push({
        icon: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z" />',
        text: arDigits(liveWeatherData.tempC) + '° مئوية'
      });
    }
    if (typeof liveWeatherData.windKmh === 'number') {
      var wind = arDigits(liveWeatherData.windKmh) + ' كم/س';
      if (liveWeatherData.windDir) wind += ' ' + liveWeatherData.windDir;
      chips.push({ icon: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h14a3 3 0 1 1-3 3M3 16h7" />', text: wind });
    }
    if (liveWeatherData.label) {
      chips.push({ icon: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>', text: liveWeatherData.label });
    }

    for (var i = 0; i < chips.length; i++) {
      var chip = document.createElement('span');
      chip.className = 'ww-chip';
      chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" ' +
        'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        chips[i].icon + '</svg><span></span>';
      chip.lastChild.textContent = chips[i].text;
      el.wwChips.appendChild(chip);
    }
  }

  /** سطر المقارنة البلاغية بين المثل الشعبي وطقس اللحظة */
  function renderLiveWeather() {
    if (!el.liveWeather) return;
    var hasVersus = window.AnwaaWeather && typeof window.AnwaaWeather.versus === 'function';
    if (!liveWeatherData || !hasVersus) {
      el.liveWeather.textContent = liveWeatherNote;
      el.liveWeather.classList.toggle('is-live', false);
      return;
    }
    el.liveWeather.textContent = window.AnwaaWeather.versus(activeTalea, liveWeatherData);
    el.liveWeather.classList.toggle('is-live', true);
  }

/**
   * إظهار/إخفاء الطقس اللحظي (المدينة + شرائح الحرارة والرياح + سطر المقارنة).
   * يظهر فقط لطالع اليوم الفعلي؛ وعند تصفّح طالع آخر يُخفى تماماً.
   * زاوية الرصد تبقى ظاهرة دائماً لأنها خاصية فلكية للطالع لا طقس لحظي.
   */
  function setWeatherVisibility(show) {
    if (el.weatherWidget) el.weatherWidget.hidden = !show;
    el.weatherWidget.classList.toggle('is-hidden', !show);
    el.weatherWidget.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  /** مزامنة اسم المدينة في الويدجت وزر الزاوية */
  function renderCityName() {
    var cityName = (liveWeatherData && liveWeatherData.city) ||
      (window.AnwaaWeather && window.AnwaaWeather.getCity ? window.AnwaaWeather.getCity().name : '—');
    if (el.wwCity) el.wwCity.textContent = cityName;
    if (el.cityBtnName) el.cityBtnName.textContent = cityName;
  }

  /** الجلب الرئيسي: مدينة افتراضية أو مختارة — بلا أي طلب إذن موقع */
  function refreshLiveWeather() {
    renderCityName();
    liveWeatherNote = '…جارٍ رصد طقس السماء فوقك';
    renderLiveWeather();

    if (!window.AnwaaWeather || !window.AnwaaWeather.fetchLive) {
      // ملف weather.js غائب: تبقى البطاقة عاملة بدونه
      liveWeatherData = null;
      liveWeatherNote = '';
      renderLiveWeather();
      renderWeatherChips();
      return;
    }
    window.AnwaaWeather.fetchLive().then(function (live) {
      liveWeatherData = live;
      liveWeatherNote = live ? '' : 'تعذّر جلب الطقس الآن — المثل الشعبي يكفي الليلة';
      renderCityName();
      renderLiveWeather();
      renderWeatherChips();
    }).catch(function () {
      // الفشل الصامت مقصود: الطقس تحسين، والبطاقة تعمل بدونه
      liveWeatherData = null;
      liveWeatherNote = 'تعذّر جلب الطقس الآن — المثل الشعبي يكفي الليلة';
      renderLiveWeather();
      renderWeatherChips();
    });
  }

  /* ---------- قائمة المدن ---------- */

  /** بناء أزرار المدن من قائمة weather.js */
  function buildCityList() {
    if (!el.cityList) return;
    el.cityList.textContent = '';
    var cities = (window.AnwaaWeather && window.AnwaaWeather.cities)
      ? window.AnwaaWeather.cities() : [];
    var current = (window.AnwaaWeather && window.AnwaaWeather.getCity)
      ? window.AnwaaWeather.getCity() : null;

    for (var i = 0; i < cities.length; i++) {
      (function (city) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'city-item';
        btn.setAttribute('role', 'option');
        btn.dataset.cityId = city.id;

        var nameEl = document.createElement('span');
        nameEl.textContent = city.name;
        var regionEl = document.createElement('span');
        regionEl.className = 'city-item-region';
        regionEl.textContent = city.region;
        btn.appendChild(nameEl);
        btn.appendChild(regionEl);

        btn.addEventListener('click', function () { selectCity(city.id); });
        el.cityList.appendChild(btn);
      })(cities[i]);
    }
    markActiveCity(current ? current.id : null);
  }

  /** إبراز المدينة المختارة حالياً */
  function markActiveCity(id) {
    var items = el.cityList ? el.cityList.querySelectorAll('.city-item') : [];
    for (var i = 0; i < items.length; i++) {
      var active = items[i].dataset.cityId === id;
      items[i].classList.toggle('is-active', active);
      items[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  /** اختيار مدينة: يحدّث الطقس فوراً ويغلق القائمة */
  function selectCity(id) {
    if (!window.AnwaaWeather || !window.AnwaaWeather.setCity) return;
    var city = window.AnwaaWeather.setCity(id);
    if (!city) return;
    if (window.playChime) window.playChime();
    closeCityMenu();
    markActiveCity(city.id);
    liveWeatherData = null;          // لا نعرض طقس مدينة سابقة
    renderCityName();
    refreshLiveWeather();
  }

  /** تحديد الموقع تلقائياً — يُستدعى من زر داخلي، وعنده فقط يُطلب الإذن */
  function useMyLocation() {
    if (!window.AnwaaWeather || !window.AnwaaWeather.locate) return;
    var btn = el.geoBtn;
    btn.classList.add('is-busy');
    btn.disabled = true;

    window.AnwaaWeather.locate().then(function (city) {
      btn.classList.remove('is-busy');
      btn.disabled = false;
      if (!city) { showToast('تعذّر تحديد الموقع — اختر مدينتك يدوياً', true); return; }
      closeCityMenu();
      liveWeatherData = null;
      renderCityName();
      refreshLiveWeather();
      showToast('تم تحديد موقعك');
    }).catch(function () {
      btn.classList.remove('is-busy');
      btn.disabled = false;
      showToast('تعذّر تحديد الموقع — اختر مدينتك يدوياً', true);
    });
  }

  function openCityMenu() {
    el.cityPicker.classList.add('is-open');
    el.cityBtn.setAttribute('aria-expanded', 'true');
    el.cityMenu.setAttribute('aria-hidden', 'false');
  }

  function closeCityMenu() {
    el.cityPicker.classList.remove('is-open');
    el.cityBtn.setAttribute('aria-expanded', 'false');
    el.cityMenu.setAttribute('aria-hidden', 'true');
  }

  function toggleCityMenu() {
    if (el.cityPicker.classList.contains('is-open')) closeCityMenu();
    else { if (window.playChime) window.playChime(); openCityMenu(); }
  }

  /* ==========================================================================
   * 5) البطاقة: العرض، الإشعار، والرحلة السينمائية
   * ======================================================================== */

  /**
   * تحديث محتويات البطاقة لعرض طالع معيّن.
   * يمرّ بانتقال موحّد: تلاشٍ سريع للمحتوى القديم قبل كتابة الجديد، فيتحوّل
   * المشهد بهدوء دون قفزة. نعتمد opacity/transform فقط فلا نُعيد حساب التخطيط.
   * @param {object}  talea       الطالع المعروض
   * @param {boolean} isToday     هل هو طالع تاريخ اليوم الفعلي؟
   * @param {string} [dateLabel]  نص تاريخ مخصص (من نافذة التقويم)
   */
  function renderTalea(talea, isToday, dateLabel) {
    // الطالع نفسه: نكتب المحتوى مباشرة بلا تلاشٍ (لا داعي لتكرار الحركة)
    if (activeTalea && activeTalea.name === talea.name) {
      paintTalea(talea, isToday, dateLabel);
      return;
    }
    body.classList.add('is-swapping');           // تلاشٍ سريع للمحتوى القديم
    clearTimeout(swapTimer);
    swapTimer = setTimeout(function () {
      paintTalea(talea, isToday, dateLabel);
      requestAnimationFrame(function () {        // إظهار المحتوى الجديد
        body.classList.remove('is-swapping');
      });
    }, SWAP_MS);
  }

  /** كتابة محتوى الطالع داخل البطاقة */
  function paintTalea(talea, isToday, dateLabel) {
    activeTalea = talea;
    isTodayTalea = !!isToday;      // المصدر الوحيد لقرار إظهار الطقس اللحظي

    el.seasonBadge.textContent = 'موسم ' + talea.season;
    el.starName.textContent = 'طالع ' + talea.name;
    el.proverb.textContent = '"' + talea.proverb + '"';

    // دليل الطالع العملي: الزراعة والغرس + نمط الحياة والمناخ
    el.agroFarm.textContent = talea.farm || '';
    el.agroLife.textContent = talea.life || '';
    // زاوية الرصد الفلكية: تبقى ظاهرة لكل الطوالع (ليست طقساً لحظياً)
    el.wwSight.textContent = talea.sight || '';

    // الطقس اللحظي (المدينة والشرائح وسطر المقارنة) لطالع اليوم وحده
    setWeatherVisibility(isTodayTalea);
    if (isTodayTalea) {
      renderLiveWeather();
      renderWeatherChips();
    }
    renderCityName();

    if (dateLabel) {
      el.dateDisplay.textContent = dateLabel;
    } else if (isToday) {
      el.dateDisplay.textContent = hijriText + ' • الموافق ' + gregorianText;
    } else {
      var season = getSeasonOfTalea(talea);
      el.dateDisplay.textContent = formatTaleaDate(talea) +
        (season ? ' • ' + formatSeasonRange(season) : '');
    }
  }

  /**
   * ضمان وجود طقس لحظي محدّث لطالع اليوم.
   * لا يفعل شيئاً إن كان الطقس موجوداً بالفعل، فلا نُثقل الشبكة بطلب مكرّر.
   */
  function ensureWeatherFresh() {
    if (!isTodayTalea) return;              // الطقس لا يخصّ إلا طالع اليوم
    if (liveWeatherData) { renderLiveWeather(); renderWeatherChips(); return; }
    refreshLiveWeather();
  }

  /** إشعار ناعم مؤقت أسفل الشاشة (نجاح النسخ أو فشله) */
  function showToast(message, isError) {
    el.toast.textContent = message;
    el.toast.classList.toggle('error', !!isError);
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, TOAST_MS);
  }

  /** تركيز هادئ بلا تمرير مفاجئ */
  function focusQuietly(node) {
    if (!node || typeof node.focus !== 'function') return;
    try { node.focus({ preventScroll: true }); } catch (err) { node.focus(); }
  }

  /** تنفيذ بعد انتهاء وعد الرحلة، أو بعد مهلة احتياطية إن لم يُعَد وعد */
  function afterSky(value, fallbackMs, fn) {
    if (value && typeof value.then === 'function') { value.then(fn); return; }
    setTimeout(fn, fallbackMs);
  }

  /**
   * إسناد هالة السماء إلى مركز البطاقة ليقع التوهّج خلفها تماماً.
   * نعتمد offsetTop/offsetHeight لأنها لا تتأثّر بـ transform أثناء الحركة.
   */
  function alignHaloToCard() {
    if (!sky || !sky.setHaloAnchorY || !window.innerHeight) return;
    var top = 0;
    var node = el.card;
    while (node) { top += node.offsetTop || 0; node = node.offsetParent; }
    var h = el.card.offsetHeight;
    if (!h) return;
    sky.setHaloAnchorY((top - window.scrollY + h / 2) / window.innerHeight);
  }

  /**
   * رصد طالع الليلة الحقيقي (من زر «ارصُد طالعَ اللّيلة»).
   * يعيد العرض إلى طالع اليوم أولاً — فالطقس اللحظي يخصّه وحده — ثم يرصد.
   * نكتب المحتوى فوراً هنا (بلا تلاشٍ) لأن رحلة الرصد تتولّى الانتقال،
   * فلا داعي لطبقة حركة فوق بعضها.
   */
  function observeToday() {
    clearTimeout(swapTimer);                   // إلغاء أي انتقال معلّق
    body.classList.remove('is-swapping');
    paintTalea(currentToday, true);            // طالع اليوم ← يظهر معه الطقس اللحظي
    if (sky && sky.setTalea) sky.setTalea(currentToday);
    updateTimelineActiveState(
      currentTodaySeason ? currentTodaySeason.key : currentToday.season, true);
    ensureWeatherFresh();                   // تأكيد جلب طقس اليوم عند الطلب المباشر
    observe();
  }

  /** لحظة الرصد: تقريب سينمائي ثم انبثاق البطاقة */
  function observe() {
    if (busy || body.classList.contains('is-observed')) return;
    busy = true;

    // الصوت مباشرة من حدث النقر: ينشئ السياق ويفكّ تعليق المتصفح (resume)
    // فوراً قبل الحركة، فيُسمع الاندفاع بوضوح مع بداية Zoom In.
    try {
      if (typeof window.playWarpSound === 'function') window.playWarpSound();
    } catch (err) { /* الصوت تحسين؛ لا يوقف الرحلة */ }

    body.classList.add('is-observing');              // يتلاشى الزرّان بهدوء
    var trip = sky && sky.observe ? sky.observe() : null;
    afterSky(trip, OBSERVE_FALLBACK_MS, function () { // عند استقرار الحركة وكشف البطاقة
      alignHaloToCard();
      body.classList.add('is-observed');             // تنبثق البطاقة بهالة ذهبية دافئة
      focusQuietly(el.card);
      setTimeout(function () { busy = false; }, 1200);
    });
  }

  /** الرجوع إلى السماء الواسعة */
  function release() {
    if (busy || !body.classList.contains('is-observed')) return;
    busy = true;
    body.classList.remove('is-observed');            // تتلاشى البطاقة أولاً
    setTimeout(function () {
      var back = sky && sky.release ? sky.release() : null;
      afterSky(back, RELEASE_FALLBACK_MS, function () {
        body.classList.remove('is-observing');       // يعود زر الرصد
        busy = false;
        focusQuietly(el.observeBtn);
      });
    }, 420);
  }

  /* ==========================================================================
   * 6) المشاركة والتصدير كصورة ستوري 1080×1920
   * ======================================================================== */

  /** نص المشاركة: اسم الطالع ومدته ومثله + رابط الموقع */
  function buildShareText() {
    var season = getSeasonOfTalea(activeTalea);
    var range = season ? formatSeasonRange(season) : '';
    return 'طالع ' + activeTalea.name + ' — ' + activeTalea.season +
      (range ? '\nمدة الموسم: ' + range : '') +
      '\n«' + activeTalea.proverb + '»' +
      '\n— مرصد أَنْوَاء' +
      '\n' + location.href.split('#')[0];
  }

  /** نسخ احتياطي للمنصات التي تمنع Clipboard API (أو الملفات المحلية) */
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(ok ? 'تم النسخ بنجاح' : 'تعذّر النسخ — انسخه يدوياً', !ok);
    } catch (err) { showToast('تعذّر النسخ — انسخه يدوياً', true); }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () {
        showToast('تم النسخ بنجاح');
      }).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  /** مولّد أرقام شبه عشوائي مزروع (mulberry32) لاستقرار شكل الستوري */
  function seededRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** بذرة من اسم الطالع ليكون لكل ليلة شكل نجوم مختلف ثابت */
  function seedFromName(name) {
    var h = 5381;
    var str = String(name || '');
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h;
  }

  /** مسار مستدير متوافق مع كل المتصفحات (بلا canvas.roundRect) */
  function roundRectPath(g, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  /** تجزئة نص عربي إلى أسطر متوسطة داخل عرض معيّن */
  function drawCenteredWrapped(g, text, x, y, maxWidth, lineHeight) {
    var words = String(text).split(' ');
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else { line = test; }
    }
    if (line) lines.push(line);
    var top = y - ((lines.length - 1) * lineHeight) / 2;
    for (var j = 0; j < lines.length; j++) g.fillText(lines[j], x, top + j * lineHeight);
    return lines.length;
  }

  /** تنظيف اسم الطالع لتصير صالحاً كاسم ملف: ستوري-طالع-الزبرة.png */
  function cardFileName(name, prefix) {
    var safe = String(name || 'الطالع')
      .replace(/[\\/:*?"<>|()]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return (prefix || '') + 'طالع-' + (safe || 'الطالع') + '.png';
  }

  /** رسم لوحة الستوري: خلفية + شعار + بطاقة زجاجية + تذييل */
  function drawStoryCard(canvas) {
    var g = canvas.getContext('2d');
    var W = STORY_W;
    var H = STORY_H;
    var talea = activeTalea;
    var rng = seededRng(seedFromName(talea.name));
    var season = getSeasonOfTalea(talea);
    var seasonLabel = (season && season.label) || talea.season;

    // 1) خلفية ليلية كحلية عميقة
    var bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#04060d');
    bg.addColorStop(0.45, '#0a1226');
    bg.addColorStop(1, '#060a14');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // 2) سديم كوني ناعم: نَفَس أزرق بارد أعلى وتوهّج ذهبي أسفل
    var neb1 = g.createRadialGradient(W * 0.26, H * 0.28, 0, W * 0.26, H * 0.28, 640);
    neb1.addColorStop(0, 'rgba(43, 84, 150, 0.34)');
    neb1.addColorStop(1, 'rgba(43, 84, 150, 0)');
    g.fillStyle = neb1;
    g.fillRect(0, 0, W, H);
    var neb2 = g.createRadialGradient(W * 0.78, H * 0.74, 0, W * 0.78, H * 0.74, 560);
    neb2.addColorStop(0, 'rgba(229, 185, 103, 0.14)');
    neb2.addColorStop(1, 'rgba(229, 185, 103, 0)');
    g.fillStyle = neb2;
    g.fillRect(0, 0, W, H);

    // 3) نجوم متناثرة (بعضها بارز بهالة صغيرة) ببذرة اسم الطالع
    for (var i = 0; i < 260; i++) {
      var x = rng() * W;
      var y = rng() * H;
      var r = 0.7 + rng() * 2.1;
      var a = 0.22 + rng() * 0.7;
      var gold = rng() < 0.18;
      g.globalAlpha = a;
      g.fillStyle = gold ? '#f0d69b' : '#e9f1ff';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      if (r > 2.3) {
        var glow = g.createRadialGradient(x, y, 0, x, y, r * 6);
        glow.addColorStop(0, 'rgba(233, 241, 255, 0.35)');
        glow.addColorStop(1, 'rgba(233, 241, 255, 0)');
        g.fillStyle = glow;
        g.beginPath();
        g.arc(x, y, r * 6, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;

    // 4) إطار سينمائي رفيع
    g.strokeStyle = 'rgba(229, 185, 103, 0.3)';
    g.lineWidth = 3;
    roundRectPath(g, 44, 44, W - 88, H - 88, 40);
    g.stroke();

    // 5) الترويسة: الشعار بخط عريق والعبارة المباركة
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#e5b967';
    g.font = '700 150px Amiri, serif';
    g.fillText('أَنْوَاء', W / 2, 235);
    g.fillStyle = '#8b9bb4';
    g.font = '500 42px Tajawal, sans-serif';
    g.fillText('مَطَالِعُ النُّجُومِ وَقَوَاسِيمُ الأَرْضِ', W / 2, 322);
    g.strokeStyle = 'rgba(229, 185, 103, 0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W / 2 - 170, 374);
    g.lineTo(W / 2 + 170, 374);
    g.stroke();
    g.fillStyle = '#e5b967';
    g.font = '34px Tajawal, sans-serif';
    g.fillText('✧', W / 2, 392);

    drawStoryBody(g, W, H, rng, talea, seasonLabel);
  }

  /** متن البطاقة: زجاج + كوكبة خافتة + اسم الطالع والموسم والمثل + التذييل */
  function drawStoryBody(g, W, H, rng, talea, seasonLabel) {
    var cx = 90;
    var cy = 620;
    var cw = W - 180;
    var ch = 830;
    var cr = 56;

    // 6) البطاقة الزجاجية الفاخرة في المنتصف
    roundRectPath(g, cx, cy, cw, ch, cr);
    g.fillStyle = 'rgba(16, 24, 40, 0.58)';
    g.fill();
    var sheen = g.createLinearGradient(0, cy, 0, cy + ch);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    sheen.addColorStop(0.45, 'rgba(229, 185, 103, 0.05)');
    sheen.addColorStop(1, 'rgba(10, 16, 28, 0.25)');
    g.fillStyle = sheen;
    g.fill();
    g.strokeStyle = 'rgba(229, 185, 103, 0.6)';
    g.lineWidth = 3;
    g.stroke();
    roundRectPath(g, cx + 16, cy + 16, cw - 32, ch - 32, cr - 14);
    g.strokeStyle = 'rgba(229, 185, 103, 0.22)';
    g.lineWidth = 1.5;
    g.stroke();

    // رسمة خافتة لخطوط كوكبة خلف النص داخل البطاقة
    var nodes = [];
    for (var i = 0; i < 7; i++) {
      nodes.push({
        x: cx + 80 + rng() * (cw - 160),
        y: cy + 110 + rng() * (ch - 220)
      });
    }
    g.strokeStyle = 'rgba(233, 241, 255, 0.13)';
    g.lineWidth = 2;
    g.beginPath();
    for (var n = 0; n < nodes.length - 1; n++) {
      g.moveTo(nodes[n].x, nodes[n].y);
      g.lineTo(nodes[n + 1].x, nodes[n + 1].y);
    }
    g.stroke();
    g.fillStyle = 'rgba(240, 214, 155, 0.32)';
    for (var d = 0; d < nodes.length; d++) {
      g.beginPath();
      g.arc(nodes[d].x, nodes[d].y, 4.5, 0, Math.PI * 2);
      g.fill();
    }

    // 7) اسم الطالع ثم الموسم بهالة ذهبية ثم المثل الشعبي منسّقاً
    g.textAlign = 'center';
    g.fillStyle = '#8b9bb4';
    g.font = '500 36px Tajawal, sans-serif';
    g.fillText('طالعُ الليلة', W / 2, cy + 110);

    g.fillStyle = '#f7e3b6';
    g.font = '700 132px Amiri, serif';
    g.fillText(talea.name, W / 2, cy + 268);

    g.font = '500 46px Tajawal, sans-serif';
    var seasonText = 'موسم ' + seasonLabel;
    var pw = g.measureText(seasonText).width + 120;
    var ph = 92;
    var px = (W - pw) / 2;
    var py = cy + 320;
    var halo = g.createRadialGradient(W / 2, py + ph / 2, 0, W / 2, py + ph / 2, pw * 0.75);
    halo.addColorStop(0, 'rgba(229, 185, 103, 0.32)');
    halo.addColorStop(1, 'rgba(229, 185, 103, 0)');
    g.fillStyle = halo;
    g.fillRect(px - 120, py - 70, pw + 240, ph + 140);
    roundRectPath(g, px, py, pw, ph, 46);
    g.fillStyle = 'rgba(229, 185, 103, 0.12)';
    g.fill();
    g.strokeStyle = 'rgba(229, 185, 103, 0.8)';
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = '#f3d9a2';
    g.textBaseline = 'middle';
    g.fillText(seasonText, W / 2, py + ph / 2 + 3);
    g.textBaseline = 'alphabetic';

    g.fillStyle = '#e8e2d2';
    g.font = 'italic 400 54px Amiri, serif';
    drawCenteredWrapped(g, '«' + talea.proverb + '»', W / 2, cy + 560, cw - 150, 84);

    // دليل عملي مختصر في أسفل البطاقة: زراعة + مناخ
    // عنوان الدليل فوق الشتلة المرسومة خطياً (بلا إيموجي)
    g.font = '500 34px Tajawal, sans-serif';
    g.fillStyle = 'rgba(229, 185, 103, 0.9)';
    g.fillText('دليل الطالع العملي', W / 2, cy + ch - 128);

    g.save();
    g.strokeStyle = 'rgba(229, 185, 103, 0.72)';
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    var sx = W / 2;
    var sy = cy + ch - 148;
    g.beginPath();
    g.moveTo(sx, sy + 13);
    g.lineTo(sx, sy);
    g.moveTo(sx, sy + 2);
    g.bezierCurveTo(sx, sy - 4, sx - 6, sy - 6, sx - 9, sy - 5);
    g.moveTo(sx, sy + 1);
    g.bezierCurveTo(sx, sy - 5, sx + 6, sy - 7, sx + 9, sy - 6);
    g.stroke();
    g.restore();

    g.font = '400 32px Tajawal, sans-serif';
    g.fillStyle = 'rgba(207, 217, 232, 0.92)';
    if (talea.farm) drawCenteredWrapped(g, talea.farm, W / 2, cy + ch - 74, cw - 130, 46);

    g.fillStyle = 'rgba(229, 185, 103, 0.75)';
    g.font = '34px Tajawal, sans-serif';
    g.fillText('✦ ✦ ✦', W / 2, cy + ch + 4);

    // 8) التذييل: التاريخ الهجري والميلادي وسطر التوثيق
    g.fillStyle = '#c9d4e4';
    g.font = '500 40px Tajawal, sans-serif';
    g.fillText(hijriText, W / 2, H - 300);
    g.fillStyle = '#8b9bb4';
    g.font = '300 34px Tajawal, sans-serif';
    g.fillText(gregorianText, W / 2, H - 240);

    g.strokeStyle = 'rgba(229, 185, 103, 0.4)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(W / 2 - 130, H - 192);
    g.lineTo(W / 2 + 130, H - 192);
    g.stroke();

    g.fillStyle = 'rgba(229, 185, 103, 0.85)';
    g.font = '500 32px Tajawal, sans-serif';
    g.fillText('رُصِد عبر مَرصد أَنْوَاء', W / 2, H - 132);
  }

  /** تنزيل ملف من الذاكرة المؤقتة كتحميل عادي */
  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /** إعادة الزر إلى حالته بعد الاكتمال أو الفشل */
  function endCapture(oldLabel) {
    capturingCard = false;
    el.saveImgBtn.classList.remove('is-busy');
    el.saveImgBtn.removeAttribute('aria-busy');
    el.card.classList.remove('is-flashing');
    var label = el.saveImgBtn.querySelector('span');
    if (label && oldLabel) label.textContent = oldLabel;
  }

  /** تسليم الصورة: مشاركة مباشرة إن دعمها المتصفح، وإلا تنزيل تلقائي */
  function deliverStoryBlob(blob, fileName, oldLabel) {
    if (!blob) {
      showToast('تعذّر إنشاء الصورة', true);
      endCapture(oldLabel);
      return;
    }
    var file = (typeof File === 'function') ? new File([blob], fileName, { type: 'image/png' }) : null;
    var canShareFiles = false;
    if (file && navigator.canShare && navigator.share) {
      try { canShareFiles = navigator.canShare({ files: [file] }); }
      catch (err) { canShareFiles = false; }
    }
    if (canShareFiles) {
      navigator.share({ files: [file] }).then(function () {
        showToast('تمت مشاركة الستوري');
        endCapture(oldLabel);
      }).catch(function (err) {
        if (err && err.name === 'AbortError') showToast('أُلغيت المشاركة');
        else {
          downloadBlob(blob, fileName);
          showToast('تم حفظ صورة الستوري');
        }
        endCapture(oldLabel);
      });
    } else {
      // الحاسوب أو غياب الدعم: تنزيل تلقائي باسم الطالع
      downloadBlob(blob, fileName);
      showToast('تم حفظ صورة الستوري');
      endCapture(oldLabel);
    }
  }

  /**
   * توليد ستوري إنستغرام 1080×1920 (نسبة 9:16) في عنصر Canvas مخفي
   * لا يُضاف إلى الصفحة — بديلاً عن التقاط بطاقة الصفحة الصغيرة.
   */
  function exportStoryCard() {
    if (capturingCard) return;
    capturingCard = true;
    var label = el.saveImgBtn.querySelector('span');
    var oldLabel = label ? label.textContent : '';
    el.saveImgBtn.classList.add('is-busy');
    el.saveImgBtn.setAttribute('aria-busy', 'true');
    if (label) label.textContent = 'جارٍ التحضير…';
    el.card.classList.add('is-flashing');   // وميض خفيف لحظة التوليد

    // ننتظر انقضاء الوميض، ثم نرسم بعد جهوزية الخطوط العربية
    setTimeout(function () {
      el.card.classList.remove('is-flashing');
      var fontsReady = (document.fonts && document.fonts.ready)
        ? document.fonts.ready : Promise.resolve();
      Promise.resolve(fontsReady).then(function () {
        var canvas = document.createElement('canvas');
        canvas.width = STORY_W;
        canvas.height = STORY_H;              // نسبة 9:16 الرسمية للستوري
        drawStoryCard(canvas);
        canvas.toBlob(function (blob) {
          deliverStoryBlob(blob, cardFileName(activeTalea.name, 'ستوري-'), oldLabel);
        }, 'image/png');
      }).catch(function () {
        showToast('تعذّر توليد صورة الستوري', true);
        endCapture(oldLabel);
      });
    }, 430);
  }

  /* ==========================================================================
   * 7) النبذة الفلكية والمناخية
   * ======================================================================== */

  var infoModal = document.getElementById('infoModal');
  var infoClose = document.getElementById('infoClose');

  function openInfoModal() {
    var talea = activeTalea;
    var season = getSeasonOfTalea(talea) || { label: talea.season, kind: 'clear', sky: '', tales: [] };

    document.getElementById('infoModalTitle').textContent = 'موسم ' + season.label;
    document.getElementById('infoSeasonRange').textContent = formatSeasonRange(season);
    document.getElementById('infoAstronomy').textContent = SEASON_ASTRONOMY[season.label] || '';

    // طوالع الموسم متتابعة مع تظليل الطالع الحالي
    var tales = Array.isArray(season.tales) ? season.tales : [];
    document.getElementById('infoTaleaLine').innerHTML = tales.length
      ? 'طوالع الموسم متتابعة: ' + tales.map(function (name) {
        return name === talea.name ? '<strong>' + name + '</strong>' : name;
      }).join('، ') + '.'
      : '';

    // المناخ: وصف السماء الرسمي + نقاط حسب طبيعة الموسم
    var list = document.getElementById('infoClimateList');
    list.textContent = '';
    var bullets = (season.sky ? [season.sky] : []).concat(KIND_CLIMATE[season.kind] || KIND_CLIMATE.clear);
    for (var i = 0; i < bullets.length; i++) {
      var li = document.createElement('li');
      li.textContent = bullets[i];
      list.appendChild(li);
    }

    document.getElementById('infoProverb').textContent =
      '«' + talea.proverb + '» — مثلٌ يحمل حكمة هذا الطالع في الزراعة والرعي.';

    // دليل الطالع العملي داخل النافذة
    document.getElementById('infoFarm').textContent = talea.farm || '';
    document.getElementById('infoLife').textContent = talea.life || '';
    document.getElementById('infoSight').textContent = talea.sight || '';

    document.getElementById('infoDate').textContent = el.dateDisplay.textContent;

    infoModal.classList.add('is-open');
    infoModal.setAttribute('aria-hidden', 'false');
    infoClose.focus();
  }

  function closeInfoModal() {
    infoModal.classList.remove('is-open');
    infoModal.setAttribute('aria-hidden', 'true');
    focusQuietly(el.infoBtn);
  }

  /* ==========================================================================
   * 8) الإقلاع وربط الأحداث
   * ======================================================================== */

  function bindEvents() {
    // الشريط الزمني
    buildSeasonButtons();
    el.todayBtn.addEventListener('click', resetToToday);

    // نافذة التقويم
    dateBtnEl.addEventListener('click', function () {
      if (window.playChime) window.playChime();
      openDateModal();
    });
    dateCloseEl.addEventListener('click', closeDateModal);
    calPrevEl.addEventListener('click', function () { calStep(-1); });
    calNextEl.addEventListener('click', function () { calStep(1); });
    calMonthSelectEl.addEventListener('change', function () { calSelectMonth(this.value); });
    calYearSelectEl.addEventListener('change', function () { calSelectYear(this.value); });
    calTabGregEl.addEventListener('click', function () { calSetMode('greg'); });
    calTabHijriEl.addEventListener('click', function () { calSetMode('hijri'); });
    calGridEl.addEventListener('keydown', calArrowNav);
    var dateBackdrop = dateModalEl.querySelector('.date-backdrop');
    if (dateBackdrop) dateBackdrop.addEventListener('click', closeDateModal);

    // الطقس: النقر على سطر المقارنة يعيد الجلب
    if (el.liveWeather) {
      el.liveWeather.classList.add('is-clickable');
      el.liveWeather.setAttribute('role', 'button');
      el.liveWeather.setAttribute('tabindex', '0');
      el.liveWeather.title = 'اضغط لإعادة جلب الطقس';
      el.liveWeather.addEventListener('click', refreshLiveWeather);
      el.liveWeather.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refreshLiveWeather(); }
      });
    }

    // البطاقة
    el.observeBtn.addEventListener('click', observeToday);
    el.backBtn.addEventListener('click', release);
    el.shareBtn.addEventListener('click', function () {
      if (window.playChime) window.playChime();
      copyToClipboard(buildShareText());
    });
    el.saveImgBtn.addEventListener('click', function () {
      if (window.playChime) window.playChime();
      exportStoryCard();
    });
    el.infoBtn.addEventListener('click', function () {
      if (window.playChime) window.playChime();
      openInfoModal();
    });
    infoClose.addEventListener('click', closeInfoModal);
    var infoBackdrop = infoModal.querySelector('.info-backdrop');
    if (infoBackdrop) infoBackdrop.addEventListener('click', closeInfoModal);

    // منتقي المدينة: زر القائمة + اختيار مدينة + تحديد الموقع اليدوي
    el.cityBtn.addEventListener('click', toggleCityMenu);
    el.geoBtn.addEventListener('click', useMyLocation);

    // نقر خارج القائمة يغلقها + Escape نفسه مغلق عبر مستمع الوثيقة أدناه
    document.addEventListener('click', function (e) {
      if (!el.cityPicker.classList.contains('is-open')) return;
      if (el.cityPicker.contains(e.target)) return;
      closeCityMenu();
    });

    // مفتاح Escape يغلق النوافذ المفتوحة أولاً، وإلا يعيد الزائر إلى السماء
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (el.cityPicker.classList.contains('is-open')) closeCityMenu();
      else if (infoModal.classList.contains('is-open')) closeInfoModal();
      else if (dateModalEl.classList.contains('is-open')) closeDateModal();
      else release();
    });

    // إعادة إسناد الهالة إن تغيّر حجم النافذة أثناء عرض البطاقة
    window.addEventListener('resize', function () {
      if (!body.classList.contains('is-observed')) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(alignHaloToCard, HALO_RESIZE_MS);
    }, { passive: true });
  }

  // العرض المبدئي لطالع الليلة الحقيقي
  renderTalea(currentToday, true);

  // تفعيل حالة اليوم على الشريط (بعد بناء الأزرار في bindEvents)
  bindEvents();
  updateTimelineActiveState(activeSeasonKey, true);

  // قائمة المدن: تُبنى من weather.js وتُظهر المدينة الافتراضية بلا طلب إذن موقع
  buildCityList();
  refreshLiveWeather();

  // رابط مباشر للرصد: index.html?observe=1 يبدأ الرحلة تلقائياً
  var flags = location.search.replace(/^\?/, '').split('&');
  if (flags.indexOf('observe') >= 0 || flags.indexOf('observe=1') >= 0) {
    setTimeout(observe, 260);
  }
})();