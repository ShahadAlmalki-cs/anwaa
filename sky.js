/* ============================================================================
 * sky.js — the living sky behind the Anwaa observatory.
 * ----------------------------------------------------------------------------
 * Dependency-free Canvas engine, one <canvas>, no build step. Layers, painted
 * back to front each frame:
 *
 *   nebula   pre-rendered Milky Way band + deep-space base
 *   weather  season-driven rain / mist / frost / heat / pearl dust
 *   lens     pointer-following soft glow, drawn under the stars
 *   stars    three depth layers, each star twinkling on its own phase
 *   meteor   occasional streaker with a fading tail
 *   halo     slow pulse marking tonight's mansion
 *   stardust particle burst on click, additive gold/silver
 *   flash    wipe that masks the snap-back at the end of a warp
 *
 * Public surface (window.AnwaaSky):
 *   setTalea(talea)     { name, season } from anwaa.js
 *   observe()           warp in; resolves at the card reveal beat
 *   release()           ease back out; also a promise
 *   setHaloAnchorY(y)   anchor the halo vertically, 0..1 of viewport height
 *   setHaloColor(c)     override the halo tint
 *   isBusy() / pause() / resume() / destroy() / stats()
 * ========================================================================== */
(function () {
  'use strict';

  // Bail outside the browser so the file stays lintable and node-parseable.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const TAU = Math.PI * 2;

  /* ------------------------------------------------------------------
   * 1) Tunables — every measured constant in one place.
   * ---------------------------------------------------------------- */
  const CONFIG = {
    maxDpr: 2,             // سقف دقة الشاشة لتوفير المعالج
    density: 0.0006,       // عدد النجوم لكل بكسل مربع (بكسل CSS)
    minStars: 300,
    maxStars: 1100,

    /* Frame throttling while idle, to spare CPU and battery. */
    idleFrameMs: 33,       // ~30 إطاراً/ث في الخمول بدل 60
    idleDelayMs: 1400,     // مدّة السكون قبل خفض الإطارات (مللي ثانية)
    lowPowerCores: 4,      // الأجهزة ذات الأنوية القليلة...
    lowPowerFactor: 0.6,   // ...تُخفَّض نجومها بهذه النسبة
    layerRatios: [0.55, 0.32, 0.13],  // توزيع النجوم على طبقات العمق (غبار/متوسط/طوالع)
    layerDepth: [0.2, 0.5, 1],        // معامل الإزاحة النسبي لكل طبقة
    layerBrightness: [0.55, 0.78, 1], // سطوع كل طبقة
    // Three star layers: fine dust, mid-range, and prominent mansion stars.
    dustRadius: [0.4, 0.6],           // نصف قطر الغبار النجمي الدقيق (باليكسل)
    dustAlpha: [0.05, 0.2],
    dustTwinkle: [0.06, 0.22],        // وميض بطيء جداً للغبار
    midRadius: [0.7, 1.35],
    midAlpha: [0.22, 0.64],
    midTwinkle: [0.16, 0.42],         // وميض بطيء (Shimmer)
    heroRadius: [1.6, 3.1],
    twinkleSpeed: [0.3, 1.15],        // مدى سرعة التلألؤ (راديان/ثانية)
    flareChance: 0.05,                // نسبة النجوم ذات صليب الانعراج الرفيع
    heroCount: 6,                     // نجوم بارزة أكبر على هيئة سهيل/الثريا
    nebulaScale: 0.5,                 // دقة رسم السديم المصغّرة (أداء أفضل)
    spriteRefreshMs: 130,             // أدنى فاصل بين إعادة رسم السديم أثناء تغيّر الموسم
    parallax: {
      maxOffset: 34,       // أقصى إزاحة بالكسل للطبقة الأقرب
      ease: 0.05,          // نعومة التتبّع: كلما صغرت زاد التأخّر اللطيف
      reduceFactor: 0.3    // تقليل الحركة عند تفعيل prefers-reduced-motion
    },
    halo: {
      radius: 0.26,        // نصف القطر نسبةً لأصغر بُعد في الشاشة
      y: 0.33,             // الموضع الرأسي للهالة في مشهد السماء الواسعة
      focusY: 0.54,        // موضعها الافتراضي عند الرصد (خلف البطاقة) إن لم تُسند الصفحة موضعاً
      pulseMs: 6200,       // دورة النبض البطيء
      minAlpha: 0.17,
      maxAlpha: 0.4
    },
    meteor: {
      minGap: 8000,        // أقصر/أطول فاصل بين شهابين (مللي ثانية)
      maxGap: 22000,
      speed: 760,          // سرعة الشهاب (بكسل/ثانية)
      life: 850,           // عمره (مللي ثانية)
      firstAt: 5000
    },

    /* Stardust: click burst, drawn from a fixed particle pool. */
    stardust: {
      pool: 110,            // سقف الجزيئات النشطة في كل الأوقات (يُبنى مرة واحدة)
      perBurst: 22,         // عدد جزيئات النقرة الواحدة
      perBurstReduced: 8,   // عدد أقل عند تفضيل تقليل الحركة
      life: [700, 1700],    // مدى عمر الجزيء (مللي ثانية)
      speed: [35, 240],     // مدى سرعة الانطلاق الأولية (بكسل/ثانية)
      drag: 2.6,            // مقاومة الهواء: تُبديد السرعة ليبقى الانفجار محلياً
      gravity: 14,          // جاذبية خفيفة هادئة (بكسل/ثانية المربّعة)
      size: [1.1, 2.4],     // مدى نصف قطر الجزيء
      warmShare: 0.55       // نسبة الذهب مقابل الفضة
    },

    /* Constellation lines linking the mansion's stars, pulsing at the nodes. */
    constellation: {
      nodes: [5, 7],        // مدى عدد العقد (نجوم) في الشبكة
      alpha: 0.15,          // أقصى شدّة للخطوط الخافتة
      glowAlpha: 0.55,      // أقصى شدّة لتوهّج الأطراف
      pulseMs: 4800,        // دورة نبض الأطراف
      fade: 0.06,           // نعومة الظهور والاختفاء
      depth: 0.5            // مشاركة الشبكة في Parallax (طبقة متوسطة)
    },

    /* Exploration lens: the pointer gently brightens nearby stars. */
    lens: {
      radius: 200,         // نصف قطر العدسة بالكسل
      strength: 1.3,       // مقدار زيادة السطوع في مركز العدسة
      radiusBoost: 0.8,    // مقدار تضخيم حجم النجم في مركز العدسة
      glow: 0.15,          // شدّة وهج العدسة نفسه (تحت النجوم)
      ease: 0.14,          // نعومة تتبّع المؤشر
      idleMs: 2600         // خفوت العدسة بعد سكون المؤشر (0 = لا خفوت)
    },

    /* Observation run: cinematic warp toward tonight's mansion. */
    warp: {
      inMs: 2000,          // مدة التقريب الكامل
      outMs: 1050,         // مدة الرجوع إلى السماء الواسعة
      revealAt: 0.62,      // عند هذه النسبة من الرحلة تُعلَن لحظة كشف البطاقة
      maxScale: 9,         // أقصى معامل تقريب للطبقة الأقرب
      accel: 2.3,          // أسّ تسارع الرحلة (أكبر = اندفاع أشدّ في النهاية)
      farFactor: 0.35,     // مشاركة الطبقة الأبعد في الرحلة (تُضاعف الإحساس بالعمق)
      trail: 0.055,        // طول أثر النجوم (نسبة من زمن الرحلة)
      resetAt: 0.8,        // لحظة إرجاع التقريب إلى الوضع الطبيعي خلف الوميض
      flashAt: 0.6,        // بداية الوميض الكاسح
      flashMax: 0.72,      // أقصى شدّة للوميض
      reduced: 0.35        // معامل تقصير الرحلة عند prefers-reduced-motion
    },

    /* Season weather: rain, cosmic mist, frost, heat, and clear pearl skies. */
    weather: {
      blendMs: 900,          // مدّة التدرّج الناعم بين طقس وآخر
      pulseMs: 1200,         // عمر نبضة تبديل الموسم
      pulseAlpha: 0.1,       // أقصى شدّة لتلك النبضة
      rain: {
        density: 0.00016,    // قطرات لكل بكسل مربع
        min: 40, max: 190,
        speed: [430, 790],   // سرعة السقوط (بكسل/ثانية)
        slant: 0.2,          // ميل الرذاذ أفقياً
        len: [15, 33],       // طول خط الرذاذ
        alpha: 0.32,         // أقصى شفافية
        top: 0.06            // هامش أعلى الشاشة حيث يظهر الرذاذ
      },
      mist: { alpha: 0.17, drift: 0.000019, scale: 1.22 },
      frost: {
        density: 0.00012,    // بلورات لكل بكسل مربع
        min: 60, max: 175,
        speed: [9, 27],      // انسياب بطيء جداً
        sway: 24,            // تمايل أفقي (بكسل)
        size: [0.75, 2.1],
        alpha: 0.4
      },
      heat: {
        alpha: 0.34,         // شدّة الوهج النحاسي المتصاعد
        wash: 0.2,           // مسحة ذهبية عامة
        bands: 7,            // عدد أشرطة التموّج
        wave: 2.4,           // سعة التموّج (بكسل)
        pulseMs: 9000
      },
      clear: { dust: 620, alpha: 0.4 }   // نجوم لؤلؤية إضافية بالكثافة
    }
  };

  /* Star tints: white, cool blue, warm gold. */
  const STAR_TINTS = ['#ffffff', '#e9f1ff', '#d8e5ff', '#ffeecd', '#ffd9a8'];
  const TINT_WEIGHTS = [0.34, 0.28, 0.22, 0.1, 0.06];

  /* Deep-space floor the nebula composites over. */
  const DEEP_SPACE = [6, 10, 19];

  /* Stardust tints; the additive pass doubles their apparent intensity. */
  const STARDUST_TINTS = ['rgb(247,214,143)', 'rgb(231,239,255)'];

  const CONSTELLATION_TINT = 'rgb(196,214,246)';

  /* ------------------------------------------------------------------
   * 2) Small helpers
   * ---------------------------------------------------------------- */
  function c(hex) {
    const v = hex.replace('#', '');
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const rgb = (col) => 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')';
  const rgba = (col, a) => 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',' + a + ')';

  /** Arabic text folding for season key comparison. */
  function normalizeKey(text) {
    return String(text == null ? '' : text)
      .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
      .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
      .replace(/\u0649/g, '\u064A')
      .trim();
  }

  /* ------------------------------------------------------------------
   * 3) Season palettes — the halo and nebula retint with tonight's mansion.
   * ---------------------------------------------------------------- */
  const SEASON_PALETTES = {
    'المربعانية':     { core: c('#cfe3ff'), mid: c('#2b5c96'), haze: c('#0d1729') }, // برد قارس، كحلي بارد
    'الشبط':          { core: c('#b9d4f0'), mid: c('#2f5c8c'), haze: c('#101b2e') }, // جفاف وبرودة أعمق
    'العقارب':        { core: c('#bcd8ea'), mid: c('#2f6f83'), haze: c('#0e1d26') }, // فيروزي ليلي
    'الحميمين':       { core: c('#c3dce6'), mid: c('#35707a'), haze: c('#0f1e22') }, // بين البرد والاعتدال
    'الذرعان':        { core: c('#c9e6d8'), mid: c('#356e5e'), haze: c('#101f1c') }, // اعتدال أخضر خفيف
    'كنة الثريا':     { core: c('#cfe9df'), mid: c('#3a6f63'), haze: c('#111f1d') }, // نسيم الربيع
    'مربعانية القيظ': { core: c('#ffd7a1'), mid: c('#a35c1f'), haze: c('#241406') }, // حرارة ناعمة
    'طباخ العنب':     { core: c('#ffcf9a'), mid: c('#9d5518'), haze: c('#221305') }, // لهب الصيف
    'طباخ التمر':     { core: c('#ffcf9a'), mid: c('#9d5518'), haze: c('#221305') },
    'سهيل':           { core: c('#ffd98a'), mid: c('#b8802c'), haze: c('#2a1c07') }, // ذهبي دافئ
    'الوسم':          { core: c('#d9c2e8'), mid: c('#6a4a86'), haze: c('#1a1026') }  // بشائر المطر، بنفسجي ترابي
  };

  /* ------------------------------------------------------------------
   * 2.b) Season weather profiles.
   *     Channels: rain · mist · frost · ice · heat · pearl · vis · twinkle.
   *     Every channel not named here defaults to 0, and 1 means neutral.
   * ---------------------------------------------------------------- */

  /** Channel names, also used to interpolate one season into the next. */
  const WEATHER_CHANNELS = ['rain', 'mist', 'frost', 'ice', 'heat', 'pearl', 'vis', 'twinkle'];

  /** Expand a kind + overrides into a full channel record. */
  function weatherProfile(kind, over) {
    const p = { kind: kind, rain: 0, mist: 0, frost: 0, ice: 0, heat: 0, pearl: 0, vis: 1, twinkle: 1 };
    for (const k in over) { if (hasOwn(over, k)) p[k] = over[k]; }
    return p;
  }

  const SEASON_WEATHER = {
    // سهيل: وداع القيظ وسماء صافية بنجوم لؤلؤية متلألئة بكثافة
    'سهيل':           weatherProfile('clear', { pearl: 1, vis: 1.13, twinkle: 1.3 }),
    // الوسم: موسم المطر — رذاذ ناعم وضباب كوني ضوئي رقيق بين النجوم
    'الوسم':          weatherProfile('rain', { rain: 1, mist: 1, pearl: 0.2, ice: 0.15, vis: 0.9, twinkle: 0.92 }),
    // المربعانية: صقيع وبرد قارس في أزرق جليدي عميق
    'المربعانية':     weatherProfile('frost', { frost: 1, ice: 1.1, pearl: 0.35, vis: 1.02, twinkle: 1.05 }),
    // الشبط: أشدّ الصقيع وأعمق زرقة
    'الشبط':          weatherProfile('frost', { frost: 0.85, ice: 1.35, pearl: 0.25, vis: 0.97 }),
    // العقارب: بقايا صقيع ورذاذ خفيف يعبر السماء
    'العقارب':        weatherProfile('rain', { rain: 0.42, mist: 0.5, ice: 0.4, frost: 0.18, pearl: 0.3, vis: 1.0, twinkle: 1.05 }),
    // كنّة الثريا والاعتدال: سماء صافية بنجوم لؤلؤية
    'كنة الثريا':     weatherProfile('clear', { pearl: 0.8, vis: 1.08, twinkle: 1.15 }),
    'الحميمين':       weatherProfile('clear', { pearl: 0.62, vis: 1.05, twinkle: 1.1 }),
    'الذرعان':        weatherProfile('clear', { pearl: 0.72, vis: 1.06, twinkle: 1.12 }),
    // القيظ والصيف: وهج ذهبي ونحاسي دافئ مع تموّج هادئ
    'مربعانية القيظ': weatherProfile('heat', { heat: 1, pearl: 0.15, vis: 0.88, twinkle: 0.86 }),
    'طباخ العنب':     weatherProfile('heat', { heat: 1.12, pearl: 0.12, vis: 0.85, twinkle: 0.82 }),
    'طباخ التمر':     weatherProfile('heat', { heat: 1.18, pearl: 0.1, vis: 0.84, twinkle: 0.8 })
  };

  const DEFAULT_WEATHER = weatherProfile('clear', { pearl: 0.5 });

  /* ------------------------------------------------------------------
   * 4) Deterministic generation
   * ---------------------------------------------------------------- */

  /** Seeded PRNG (mulberry32) so a given day always yields the same sky. */
  function createRng(seed) {
    let s = seed >>> 0;
    return function rng() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * A promise the page resolves from the outside.
   * Falls back to a null handle where Promise is unavailable; the page then
   * drives the same beat on a timer instead.
   */
  function defer() {
    if (typeof Promise !== 'function') return { promise: null, resolve: function () {} };
    let res = null;
    const promise = new Promise(function (r) { res = r; });
    return { promise: promise, resolve: res };
  }

  /**
   * Frame-rate-independent smoothing: `base` is the fraction applied per
   * 16.7ms frame, rescaled for the actual elapsed time.
   */
  function smoothFactor(base, dt) {
    return 1 - Math.pow(1 - clamp(base, 0.01, 0.95), dt / 16.67);
  }

  /** Daily seed: the sky reshuffles each day, tracking the changing mansion. */
  function dailySeed() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /** Weighted pick across the star tint table. */
  function pickTint(rng) {
    const r = rng();
    let acc = 0;
    for (let i = 0; i < TINT_WEIGHTS.length; i++) {
      acc += TINT_WEIGHTS[i];
      if (r <= acc) return i;
    }
    return 0;
  }

  /** Fallback palette derived from the --gold-accent custom property. */
  function fallbackPalette() {
    let gold = '#e5b967';
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--gold-accent').trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) gold = v;
    } catch (err) { /* تجاهل: نبقى على الذهبي الافتراضي */ }
    return { core: c('#f4e2bd'), mid: c(gold), haze: c('#1b1608') };
  }

  /* ------------------------------------------------------------------
   * 4) Internal state — one object, so teardown is a single call.
   * ---------------------------------------------------------------- */
  const state = {
    canvas: null,
    ctx: null,
    w: 0,                 // عرض المنصة ببكسل CSS
    h: 0,
    dpr: 1,
    ready: false,
    running: false,
    rafId: 0,
    lastTime: 0,
    lastDraw: 0,           // آخر رسم فعلي (لعدّاد خفض الإطارات في الخمول)
    /**
     * Minimum gap between frames in ms; 0 disables throttling.
     * Any interaction (pointer, click, warp) drops this to 0, and it climbs
     * back once the pointer goes idle.
     */
    minFrameMs: 33,
    elapsed: 0,
    fps: 60,
    reducedMotion: false,
    rng: null,            // مولّد النجوم
    clouds: null,         // مواصفات حزام درب التبانة (زاوية/مركز/عرض — ثابتة لكل يوم)
    layers: [],
    nebula: null,         // صورة السديم المخبّأة
    halo: null,           // صورة الهالة المخبّأة
    spritesDirty: true,
    spriteKey: '',
    lastSpriteAt: -1e9,
    pointerX: 0,          // هدف الإزاحة من الفأرة (-1..1)
    pointerY: 0,
    offsetX: 0,           // الإزاحة المُنعَّمة الحالية
    offsetY: 0,
    palette: null,        // اللوحة المعروضة (تتدرّج نحو الهدف)
    targetPalette: null,
    haloShift: 0,         // انزياح أفقي بسيط لهالة الطالع
    pending: null,        // طالع مُمرَّر قبل اكتمال التهيئة
    meteor: { active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, len: 0 },
    nextMeteorAt: CONFIG.meteor.firstAt,
    stardust: { pool: null, cursor: 0 },   // مخزون جزيئات النقر (يُبنى مرة واحدة)
    constellation: { key: null, nodes: [], edges: [], pos: [], alpha: 0 },  // شبكة أبراج الطالع
    lensTX: -9999,          // هدف العدسة (موضع المؤشر الخام)
    lensTY: -9999,
    lensX: -9999,           // موضع العدسة المُنعَّم
    lensY: -9999,
    lensOn: false,          // هل المؤشر فوق الصفحة؟
    lensIdle: 1e9,          // زمن السكون منذ آخر حركة (مللي ثانية)
    lensFade: 0,            // شدّة ظهور العدسة 0..1 (تتلاشى عند السكون)
    lensSprite: null,       // وهج العدسة المخبّأ
    haloY: CONFIG.halo.y,   // موضع الهالة الحالي (يتحرّك بنعومة)
    haloYTarget: CONFIG.halo.y,
    haloBoost: 1,           // تضخيم الهالة أثناء رحلة التقريب
    warp: { active: false, dir: 1, t: 0, u: 0, dur: 0, started: 0, z: 1, flash: 0, revealed: true, def: null, promise: null },
    pendingWarp: null,      // رحلة طُلبت قبل اكتمال التهيئة
    seasonPulse: 0,         // نبضة ضوئية قصيرة تُغطّي تبديل الموسم
    wSprite: null,          // صور الطقس المخبّأة (مطر/صقيع/قيظ/ضباب/غبار لؤلؤي)
    wSpritesDirty: true,
    wRng: null,             // مولّد خاص بجزيئات الطقس (معزول عن نجوم السماء)
    weather: {
      key: 'clear',         // طبيعة الطقس الحالية (مطر/صقيع/قيظ/صافٍ)
      label: '',            // اسم الموسم المالك للطقس (للتشخيص والعرض)
      now: null,            // القيم المعروضة (تتدرّج نحو الهدف)
      goal: null,           // القيم الهدف للطقس المطلوب
      parts: { rain: [], frost: [] },   // جزيئات الرذاذ وبلورات الصقيع
      partSig: '',          // بصمة تمنع إعادة بناء الجزيئات بلا داعٍ
      partIn: { rain: 0, frost: 0 }     // شدّة الظهور الحالية لكل نوع جزيئات
    }
  };

  /* ------------------------------------------------------------------
   * 5) Star and nebula construction
   * ---------------------------------------------------------------- */

  /**
   * Milky Way band spec, built once from the daily seed: angle, centre, width
   * and dust density. The band itself is drawn as gradients in
   * buildNebulaSprite; the slight daily variation keeps nights distinguishable.
   */
  function buildCloudSpecs(rng) {
    const band = {
      angle: -0.38 + (rng() - 0.5) * 0.12,   // ميل الحزام (قريب من قطري)
      cx: 0.5 + (rng() - 0.5) * 0.1,          // مركز الحزام أفقياً
      cy: 0.52 + (rng() - 0.5) * 0.1,         // مركز الحزام رأسياً
      width: 0.34 * (0.9 + rng() * 0.24),     // نصف عرض الحزام (نسبة من أصغر بُعد)
      dust: 0.42 * (0.85 + rng() * 0.3),      // كثافة غبار الحزام الداخلي
      glow: 0.5 + rng() * 0.16                // سطوع نواة المجرة
    };
    return band;
  }

  /**
   * Build the three star layers declared in CONFIG:
   *   1) fine dust, 0.4..0.6px, very slow twinkle — the bulk of the field
   *   2) mid-range, 0.7..1.35px, slow independent shimmer
   *   3) mansion stars, 1.6..3.1px, drawn with a radial glow
   *
   * Every star keeps its own phase, so the field shimmers rather than
   * pulsing as one block.
   */
  function buildStars() {
    const rng = state.rng;
    const area = state.w * state.h;
    const cores = navigator.hardwareConcurrency || 8;
    const power = cores <= CONFIG.lowPowerCores ? CONFIG.lowPowerFactor : 1;
    const total = clamp(Math.round(area * CONFIG.density * power), CONFIG.minStars, CONFIG.maxStars);

    const layers = [];
    for (let i = 0; i < CONFIG.layerRatios.length; i++) {
      const depth = CONFIG.layerDepth[i];
      const brightness = CONFIG.layerBrightness[i];
      const isDust = i === 0;
      const isMid = i === 1;
      const kind = isDust ? 'dust' : isMid ? 'mid' : 'hero';
      const count = Math.max(12, Math.round(total * CONFIG.layerRatios[i]));
      const buckets = STAR_TINTS.map(function () { return []; });
      const flares = [];

      // Prominent mansion stars: near layer only.
      const heroes = i === 2 ? CONFIG.heroCount : 0;
      for (let n = 0; n < heroes; n++) {
        const hero = {
          x: rng(), y: rng(),
          r: lerp(CONFIG.heroRadius[0], CONFIG.heroRadius[1], rng()),
          alpha: 0.82 + rng() * 0.18,
          spd: lerp(CONFIG.twinkleSpeed[0], CONFIG.twinkleSpeed[1], rng()) * 0.62,
          phase: rng() * TAU,
          bright: true,
          hero: true
        };
        buckets[pickTint(rng)].push(hero);
        flares.push(hero);
      }

      for (let n = 0; n < count; n++) {
        // Radius and twinkle come from the layer's CONFIG profile.
        const spec = isDust ? CONFIG.dustRadius : isMid ? CONFIG.midRadius : CONFIG.heroRadius;
        const alphas = isDust ? CONFIG.dustAlpha : isMid ? CONFIG.midAlpha : null;
        const twinkles = isDust ? CONFIG.dustTwinkle : isMid ? CONFIG.midTwinkle : null;
        const radius = lerp(spec[0], spec[1], rng());
        const star = {
          x: rng(), y: rng(),
          r: radius,
          alpha: alphas
            ? lerp(alphas[0], alphas[1], rng())
            : (0.5 + rng() * 0.42) * brightness,
          spd: twinkles
            ? lerp(twinkles[0], twinkles[1], rng())
            : lerp(CONFIG.twinkleSpeed[0], CONFIG.twinkleSpeed[1], rng()) * (0.55 + depth * 0.55),
          phase: rng() * TAU,
          bright: false,
          hero: false
        };
        // Diffraction spikes only on bright mid and near stars.
        if (!isDust && star.r > 1.05 && rng() < CONFIG.flareChance * (i === 2 ? 1.35 : 0.7)) {
          star.bright = true;
        }
        buckets[pickTint(rng)].push(star);
        if (star.bright) flares.push(star);
      }

      layers.push({ buckets: buckets, flares: flares, depth: depth, brightness: brightness, kind: kind });
    }
    state.layers = layers;
  }

  /**
   * Constellation derived from the mansion name.
   *
   * Nodes are strung along a wandering path across the sky's middle and joined
   * in sequence plus a couple of random branches. Seeding on the name means
   * each mansion always draws the same recognisable figure.
   */
  function buildConstellation(name) {
    const key = normalizeKey(name || '');
    const C = state.constellation;
    if (C.key === key && C.nodes.length) return;  // نفس الشبكة: لا إعادة بناء
    const cfg = CONFIG.constellation;
    const rng = createRng(hashString(key || 'أنواء'));
    const count = cfg.nodes[0] + Math.floor(rng() * (cfg.nodes[1] - cfg.nodes[0] + 1));
    const nodes = [];
    let x = 0.2 + rng() * 0.6;
    let y = 0.16 + rng() * 0.34;
    let ang = rng() * TAU;
    for (let i = 0; i < count; i++) {
      nodes.push({ x: x, y: y, phase: rng() * TAU });
      ang += (rng() - 0.5) * 1.7;               // انعطاف هادئ يمنع تدحرج المسار
      const step = 0.07 + rng() * 0.09;
      // Wider horizontal stride plus a gentle pull to centre keeps the figure framed.
      x = clamp(x + Math.cos(ang) * step * 1.45 + (0.5 - x) * 0.08, 0.08, 0.92);
      y = clamp(y + Math.sin(ang) * step * 0.9 + (0.45 - y) * 0.08, 0.1, 0.75);
    }
    const edges = [];
    for (let i = 0; i < count - 1; i++) edges.push([i, i + 1]);  // المسار الأساسي
    if (count >= 6 && rng() < 0.8) edges.push([0, 2]);           // غصن قصير
    if (count >= 7 && rng() < 0.6) edges.push([2, 5]);           // غصن إضافي
    C.key = key;
    C.nodes = nodes;
    C.edges = edges;
    C.alpha = 0;                              // تظهر تدريجياً في الإطارات التالية
  }

  /**
   * Pre-render the Milky Way once onto an offscreen canvas.
   *
   * The galaxy is a single diagonal dust band rather than a set of discrete
   * blobs: indigo and deep violet gradients, an ivory galactic core, and
   * faint dark dust lanes. Composited in one blit per frame.
   */
  function buildNebulaSprite() {
    const pal = state.palette || fallbackPalette();
    const sw = Math.max(180, Math.round(state.w * CONFIG.nebulaScale));
    const sh = Math.max(140, Math.round(state.h * CONFIG.nebulaScale));
    const cv = document.createElement('canvas');
    cv.width = sw;
    cv.height = sh;
    const g = cv.getContext('2d');
    if (!g) return null;

    // Deep velvet night: dark indigo falling away to near-black.
    g.fillStyle = '#040714';
    g.fillRect(0, 0, sw, sh);
    const depth = g.createLinearGradient(0, 0, sw, sh);
    depth.addColorStop(0, 'rgba(3, 5, 16, 0.96)');
    depth.addColorStop(0.48, 'rgba(9, 14, 34, 0.42)');
    depth.addColorStop(1, 'rgba(1, 3, 10, 0.98)');
    g.fillStyle = depth;
    g.fillRect(0, 0, sw, sh);

    // Band geometry from the daily seed.
    const B = state.clouds || { angle: -0.38, cx: 0.5, cy: 0.52, width: 0.34, dust: 0.42, glow: 0.55 };

    // Milky Way: a soft diagonal gradient band (indigo -> ivory core ->
    // dark violet -> black), painted across the axis normal to the band
    // after rotation. Every stop returns to transparent at the edges, so the
    // band has no hard rim.
    const cx = sw * B.cx;
    const cy = sh * B.cy;
    const diagonal = Math.sqrt(sw * sw + sh * sh) * 1.45;
    const bandWidth = Math.max(96, Math.min(sw, sh) * B.width * 2);
    g.save();
    g.translate(cx, cy);
    g.rotate(B.angle);

    // 1) Outer band falloff, dissolving gradually into space.
    const outer = g.createLinearGradient(0, -bandWidth, 0, bandWidth);
    outer.addColorStop(0.00, 'rgba(3, 5, 16, 0)');
    outer.addColorStop(0.16, 'rgba(16, 22, 58, 0.045)');
    outer.addColorStop(0.33, 'rgba(34, 46, 104, 0.085)');
    outer.addColorStop(0.50, 'rgba(122, 132, 178, 0.135)');
    outer.addColorStop(0.67, 'rgba(74, 62, 122, 0.085)');
    outer.addColorStop(0.84, 'rgba(20, 24, 60, 0.04)');
    outer.addColorStop(1.00, 'rgba(3, 5, 16, 0)');
    g.fillStyle = outer;
    g.fillRect(-diagonal * 0.5, -bandWidth, diagonal, bandWidth * 2);

    // 2) Galactic core: a narrower, brighter strip giving the band density.
    g.globalCompositeOperation = 'screen';
    const coreWidth = bandWidth * 0.34;
    const core = g.createLinearGradient(0, -coreWidth, 0, coreWidth);
    core.addColorStop(0.00, 'rgba(58, 62, 122, 0)');
    core.addColorStop(0.28, 'rgba(120, 122, 176, 0.055)');
    core.addColorStop(0.50, 'rgba(236, 228, 208, 0.105)');  // نواة المجالة العاجية
    core.addColorStop(0.72, 'rgba(96, 72, 106, 0.04)');
    core.addColorStop(1.00, 'rgba(58, 62, 122, 0)');
    g.fillStyle = core;
    g.fillRect(-diagonal * 0.5, -coreWidth, diagonal, coreWidth * 2);

    // 3) Dark dust lanes breaking up the glow.
    const laneWidth = bandWidth * B.dust;
    const lanes = g.createLinearGradient(0, -laneWidth, 0, laneWidth);
    lanes.addColorStop(0.00, 'rgba(72, 60, 110, 0)');
    lanes.addColorStop(0.34, 'rgba(14, 12, 30, 0.075)');
    lanes.addColorStop(0.50, 'rgba(6, 5, 16, 0.10)');
    lanes.addColorStop(0.66, 'rgba(18, 14, 34, 0.065)');
    lanes.addColorStop(1.00, 'rgba(72, 60, 110, 0)');
    g.fillStyle = lanes;
    g.fillRect(-diagonal * 0.5, -laneWidth, diagonal, laneWidth * 2);

    // 4) Very faint dusty-gold bulge at the galactic centre.
    const bulge = g.createRadialGradient(0, 0, 0, 0, 0, bandWidth * 0.9);
    bulge.addColorStop(0, 'rgba(178, 138, 82, ' + (0.05 * B.glow).toFixed(3) + ')');
    bulge.addColorStop(0.5, 'rgba(120, 86, 62, ' + (0.022 * B.glow).toFixed(3) + ')');
    bulge.addColorStop(1, 'rgba(60, 40, 40, 0)');
    g.fillStyle = bulge;
    g.fillRect(-bandWidth, -bandWidth, bandWidth * 2, bandWidth * 2);
    g.restore();

    // Broad violet/indigo wash across the whole frame.
    const colorWash = g.createLinearGradient(0, sh, sw, 0);
    colorWash.addColorStop(0, 'rgba(38, 22, 70, 0)');
    colorWash.addColorStop(0.38, 'rgba(46, 30, 84, 0.042)');
    colorWash.addColorStop(0.60, 'rgba(96, 62, 96, 0.026)');
    colorWash.addColorStop(1, 'rgba(38, 22, 70, 0)');
    g.globalCompositeOperation = 'screen';
    g.fillStyle = colorWash;
    g.fillRect(0, 0, sw, sh);
    g.globalCompositeOperation = 'source-over';

    // Vignette: deepens the edges and settles attention on the band.
    const vig = g.createRadialGradient(
      sw * 0.5, sh * 0.5, Math.min(sw, sh) * 0.16,
      sw * 0.5, sh * 0.5, Math.max(sw, sh) * 0.72
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vig;
    g.fillRect(0, 0, sw, sh);

    // Fine grain breaks up gradient banding for a natural nebula texture.
    addGrain(g, sw, sh, 1707, 11);

    return cv;
  }

  /** Additive noise pass; only ever run once, at nebula build time. */
  function addGrain(g, sw, sh, seed, amount) {
    let img;
    try {
      img = g.getImageData(0, 0, sw, sh);
    } catch (err) { return; }   // some contexts forbid pixel read-back

    const px = img.data;
    const rng = createRng(seed);
    for (let i = 0; i < px.length; i += 4) {
      const n = (rng() - 0.5) * amount;
      px[i] = clamp(px[i] + n, 0, 255);
      px[i + 1] = clamp(px[i + 1] + n * 0.9, 0, 255);
      px[i + 2] = clamp(px[i + 2] + n * 0.8, 0, 255);
    }
    g.putImageData(img, 0, 0);
  }

  /** هالة الطالع: نواة دافئة تتلاشى إلى الخارج، مخبّأة في صورة صغيرة تُرسم بمزج ضوئي */
  function buildHaloSprite() {
    const pal = state.palette || fallbackPalette();
    const size = 256;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const g = cv.getContext('2d');
    if (!g) return null;
    const half = size / 2;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, rgba(pal.core, 0.95));
    grad.addColorStop(0.08, rgba(pal.core, 0.5));
    grad.addColorStop(0.2, rgba(pal.mid, 0.3));
    grad.addColorStop(0.45, rgba(pal.mid, 0.14));
    grad.addColorStop(0.72, rgba(pal.haze, 0.07));
    grad.addColorStop(1, rgba(pal.haze, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return cv;
  }

  /** وهج عدسة الاستكشاف: نقطة ضوء ناعمة تُرسم تحت النجوم بمزج ضوئي خفيف */
  function buildLensSprite() {
    const pal = state.palette || fallbackPalette();
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const g = cv.getContext('2d');
    if (!g) return null;
    const half = size / 2;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, rgba(pal.core, 0.95));
    grad.addColorStop(0.32, rgba(pal.core, 0.42));
    grad.addColorStop(0.68, rgba(pal.mid, 0.14));
    grad.addColorStop(1, rgba(pal.mid, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return cv;
  }

  /* ------------------------------------------------------------------
   * 5.b) صور الطقس المخبّأة — تُبنى مرة عند كل تغيير حجم فقط،
   *      فيبقى رسم الطقس في كل إطار بضع صور لا أكثر (أداء عالية)
   * ---------------------------------------------------------------- */

  /** منصة مخفية صغيرة لبناء صورة طقس */
  function weatherCanvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(w));
    cv.height = Math.max(2, Math.round(h));
    return cv;
  }

  /** تدرّج أفقي/رأسي بسيط (بعرض 6 بكسل) يُمدّ فوق الشاشة عند الرسم */
  function buildGradientSprite(stops) {
    const cv = weatherCanvas(6, 192);
    const g = cv.getContext('2d');
    if (!g) return null;
    const grad = g.createLinearGradient(0, 0, 0, 192);
    for (let i = 0; i < stops.length; i++) grad.addColorStop(stops[i][0], stops[i][1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, 6, 192);
    return cv;
  }

  /** وهج القيظ: قرص نحاسي دافئ يتصاعد من أسفل الشاشة */
  function buildHeatSprite() {
    const size = 224;
    const half = size / 2;
    const cv = weatherCanvas(size, size);
    const g = cv.getContext('2d');
    if (!g) return null;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(255,198,112,0.62)');
    grad.addColorStop(0.3, 'rgba(232,142,54,0.34)');
    grad.addColorStop(0.62, 'rgba(176,86,26,0.12)');
    grad.addColorStop(1, 'rgba(120,52,12,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return cv;
  }

  /** الضباب الكوني الضوئي: سحب بيضاء/كحلية ناعمة تسبح بين النجوم */
  function buildMistSprite() {
    const sw = Math.max(180, Math.round(state.w * 0.4));
    const sh = Math.max(130, Math.round(state.h * 0.4));
    const cv = weatherCanvas(sw, sh);
    const g = cv.getContext('2d');
    if (!g) return null;
    const rng = createRng(7413);
    const blobs = Math.max(16, Math.round(sw / 30));
    for (let i = 0; i < blobs; i++) {
      const x = rng() * sw;
      const y = sh * (0.08 + rng() * 0.86);
      const r = Math.max(26, (0.13 + rng() * 0.26) * sw);
      const a = 0.07 + rng() * 0.11;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(228,238,255,' + a.toFixed(3) + ')');
      grad.addColorStop(0.45, 'rgba(206,222,248,' + (a * 0.42).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(188,210,240,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    return cv;
  }

  /** بلورة صقيع صغيرة: نواة بيضاء + نجمة رباعية رفيعة */
  function buildCrystalSprite() {
    const size = 24;
    const half = size / 2;
    const cv = weatherCanvas(size, size);
    const g = cv.getContext('2d');
    if (!g) return null;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.32, 'rgba(214,236,255,0.34)');
    grad.addColorStop(1, 'rgba(190,220,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(half, half, half, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(242,250,255,0.72)';
    g.lineWidth = 1.1;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(half, 2.5);
    g.lineTo(half, size - 2.5);
    g.moveTo(2.5, half);
    g.lineTo(size - 2.5, half);
    g.stroke();
    return cv;
  }

  /** غبار لؤلؤي: مئات النجوم الدقيقة التي تُكثّف السماء الصافية */
  function buildDustSprite() {
    const sw = Math.max(220, Math.round(state.w * 0.35));
    const sh = Math.max(150, Math.round(state.h * 0.35));
    const cv = weatherCanvas(sw, sh);
    const g = cv.getContext('2d');
    if (!g) return null;
    const rng = createRng(2408);
    const count = clamp(Math.round((state.w * state.h) / 2200), 200, 900);
    for (let i = 0; i < count; i++) {
      const x = rng() * sw;
      const y = rng() * sh;
      const a = 0.18 + rng() * 0.6;
      const big = rng() < 0.12;
      g.fillStyle = 'rgba(246,251,255,' + a.toFixed(3) + ')';
      g.fillRect(x, y, big ? 2 : 1, big ? 2 : 1);
      if (big) {
        const grad = g.createRadialGradient(x + 1, y + 1, 0, x + 1, y + 1, 7);
        grad.addColorStop(0, 'rgba(255,255,255,0.34)');
        grad.addColorStop(1, 'rgba(220,236,255,0)');
        g.fillStyle = grad;
        g.fillRect(x - 6, y - 6, 15, 15);
      }
    }
    return cv;
  }

  /** بناء كل صور الطقس (يُستدعى عند تغيّر الحجم فقط) */
  function buildWeatherSprites() {
    state.wSprite = {
      // أزرق جليدي عميق يغمق أطراف الشاشة في ليالي الصقيع
      iceDeep: buildGradientSprite([
        [0, 'rgba(9,22,44,0.92)'], [0.3, 'rgba(10,24,46,0)'],
        [0.62, 'rgba(10,26,48,0)'], [0.86, 'rgba(12,30,54,0.42)'], [1, 'rgba(14,36,64,0.78)']
      ]),
      // توهّج جليدي فاتح أعلى وأسفل الشاشة بمزج ضوئي
      iceGlow: buildGradientSprite([
        [0, 'rgba(168,208,255,0.5)'], [0.34, 'rgba(120,170,235,0.05)'],
        [0.7, 'rgba(132,182,240,0.04)'], [1, 'rgba(190,226,255,0.42)']
      ]),
      // مسحة ذهبية/نحاسية دافئة لمواسم القيظ
      heatWash: buildGradientSprite([
        [0, 'rgba(255,188,96,0)'], [0.55, 'rgba(226,144,54,0.16)'], [1, 'rgba(198,110,36,0.52)']
      ]),
      heat: buildHeatSprite(),
      mist: buildMistSprite(),
      dust: buildDustSprite(),
      crystal: buildCrystalSprite()
    };
    state.wSpritesDirty = false;
  }

  /** مفتاح مختصر للوحة الحالية: يمنع إعادة بناء السديم عند كل إطار أثناء التدرّج */
  function paletteKey() {
    const p = state.palette;
    if (!p) return '';
    return (p.core[0] / 24 | 0) + ':' + (p.mid[1] / 24 | 0) + ':' + (p.haze[2] / 24 | 0);
  }

  /** إعادة ضبط أبعاد المنصة ودقّتها وعدد النجوم بحسب المساحة الجديدة */
  function resize() {
    const canvas = state.canvas;
    if (!canvas || !state.ctx) return;
    const cssW = Math.max(320, canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(240, canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
    if (state.ready && cssW === state.w && cssH === state.h && dpr === state.dpr) return;

    state.w = cssW;
    state.h = cssH;
    state.dpr = dpr;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.rng = createRng(dailySeed());        // نفس البذرة ⇒ نفس شكل السماء
    buildStars();
    state.spritesDirty = true;
    state.wSpritesDirty = true;
    state.weather.partSig = '';
    state.lastSpriteAt = -1e9;
  }

  /* ------------------------------------------------------------------
   * 6) اللوحة اللونية والحركة: تدرّج الألوان + Parallax + الشهب
   * ---------------------------------------------------------------- */
  const PALETTE_KEYS = ['core', 'mid', 'haze'];

  function clonePalette(p) {
    return { core: p.core.slice(), mid: p.mid.slice(), haze: p.haze.slice() };
  }

  /** مزج رقمي بسيط لتوليد موضع ثابت لكل طالع */
  function hashString(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return h;
  }

  /** انتقال ناعم بين لوحتي الألوان عند تغيّر الطالع بدل القفز المفاجئ */
  function updatePalette(dt) {
    const cur = state.palette;
    const goal = state.targetPalette;
    if (!cur || !goal) return;
    const k = clamp(dt / 850, 0, 0.25);
    for (let kIdx = 0; kIdx < PALETTE_KEYS.length; kIdx++) {
      const name = PALETTE_KEYS[kIdx];
      for (let ch = 0; ch < 3; ch++) {
        cur[name][ch] = lerp(cur[name][ch], goal[name][ch], k);
      }
    }
  }

  /** إعادة بناء صور السديم والهالة عند تغيّر الموسم أو الحجم فقط (مُقيَّدة زمنياً) */
  function ensureSprites(t) {
    if (state.wSpritesDirty) {
      buildWeatherSprites();
    }
    const changed = paletteKey() !== state.spriteKey;
    if (!state.spritesDirty && !changed) return;
    if (state.nebula && t - state.lastSpriteAt < CONFIG.spriteRefreshMs) return;

    const nebula = buildNebulaSprite();
    const halo = buildHaloSprite();
    const lens = buildLensSprite();
    if (nebula) state.nebula = nebula;
    if (halo) state.halo = halo;
    if (lens) state.lensSprite = lens;
    state.spritesDirty = false;
    state.lastSpriteAt = t;
    state.spriteKey = paletteKey();
  }

  /** تتبّع ناعم لمؤشر الفأرة داخل الإطار: القيم من -1 إلى 1 ثم تُنعَّم بالتدريج */
  function updateParallax(dt) {
    const k = smoothFactor(CONFIG.parallax.ease, dt);
    state.offsetX += (state.pointerX - state.offsetX) * k;
    state.offsetY += (state.pointerY - state.offsetY) * k;
  }

  function setPointer(clientX, clientY) {
    const scale = state.reducedMotion ? CONFIG.parallax.reduceFactor : 1;
    state.pointerX = clamp((clientX / state.w - 0.5) * 2, -1, 1) * scale;
    state.pointerY = clamp((clientY / state.h - 0.5) * 2, -1, 1) * scale;

    // هدف عدسة الاستكشاف: يتبع المؤشر، وإن عاد بعد غياب نبدأ من موضعه بلا قفز
    if (!state.lensOn) {
      state.lensX = clientX;
      state.lensY = clientY;
    }
    state.lensTX = clientX;
    state.lensTY = clientY;
    state.lensOn = true;
    state.lensIdle = 0;
  }

  function clearPointer() {
    state.lensOn = false;
    state.pointerX = 0;
    state.pointerY = 0;
  }

  /** عدسة الاستكشاف: تتقدّم بنعومة نحو المؤشر وتخفت تدريجياً عند سكونه */
  function updateLens(dt) {
    const L = CONFIG.lens;
    state.lensIdle += dt;
    if (state.lensOn) {
      const k = smoothFactor(L.ease, dt);
      state.lensX += (state.lensTX - state.lensX) * k;
      state.lensY += (state.lensTY - state.lensY) * k;
    }
    const quiet = L.idleMs > 0 && state.lensIdle > L.idleMs;
    const wanted = state.lensOn && !state.warp.active && !quiet;
    const target = wanted ? (state.reducedMotion ? 0.35 : 1) : 0;
    state.lensFade += (target - state.lensFade) * smoothFactor(0.1, dt);
  }

  /** تحريك الهالة وازديادها بنعومة (موضعها يُسند من الصفحة عند كشف البطاقة) */
  function updateHaloMotion(dt) {
    const k = smoothFactor(0.12, dt);
    state.haloY += (state.haloYTarget - state.haloY) * k;
    if (!state.warp.active) state.haloBoost += (1 - state.haloBoost) * k;
  }

  /** إطلاق شهاب عابر من حافة عشوائية بزاوية هادئة */
  function spawnMeteor() {
    const rng = state.rng;
    const fromStart = rng() < 0.5;
    const angle = (16 + rng() * 26) * Math.PI / 180;
    const speed = CONFIG.meteor.speed * (0.75 + rng() * 0.6);
    const m = state.meteor;
    m.active = true;
    m.x = fromStart ? -0.04 * state.w : 1.04 * state.w;
    m.y = state.h * (0.04 + rng() * 0.42);
    m.vx = (fromStart ? 1 : -1) * Math.cos(angle) * speed;
    m.vy = Math.sin(angle) * speed;
    m.age = 0;
    m.life = CONFIG.meteor.life * (0.8 + rng() * 0.6);
    m.len = 0.8 + rng() * 0.6;
  }

  function updateMeteor(dt, t) {
    const m = state.meteor;
    if (!m.active) {
      if (!state.reducedMotion && t >= state.nextMeteorAt) spawnMeteor();
      return;
    }
    m.age += dt;
    if (m.age >= m.life) {
      m.active = false;
      state.nextMeteorAt = t + CONFIG.meteor.minGap + state.rng() * (CONFIG.meteor.maxGap - CONFIG.meteor.minGap);
      return;
    }
    m.x += m.vx * dt / 1000;
    m.y += m.vy * dt / 1000;
  }

  /* ------------------------------------------------------------------
   * 6.a) سديط النجوم (Stardust) — انفجار لمعان عند النقر على السماء
   * ---------------------------------------------------------------- */

  /** بناء مخزون الجزيئات مرة واحدة عند الإقلاع (بلا تخصيص ذاكرة أثناء التشغيل) */
  function initStardust() {
    const pool = [];
    for (let i = 0; i < CONFIG.stardust.pool; i++) {
      pool.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1, warm: true });
    }
    state.stardust.pool = pool;
    state.stardust.cursor = 0;
  }

  /** انفجار عند موضع النقر الخام (بكسل CSS مطابقة لمنصة الرسم الثابتة) */
  function spawnStardust(clientX, clientY) {
    const S = CONFIG.stardust;
    const pool = state.stardust.pool;
    if (!pool || !pool.length) return;
    const still = state.reducedMotion;
    const count = still ? S.perBurstReduced : S.perBurst;
    for (let i = 0; i < count; i++) {
      const p = pool[state.stardust.cursor];
      state.stardust.cursor = (state.stardust.cursor + 1) % pool.length;
      const ang = Math.random() * TAU;
      const spd = lerp(S.speed[0], S.speed[1], Math.random()) * (still ? 0.55 : 1);
      p.on = true;
      p.x = clientX;
      p.y = clientY;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.age = 0;
      p.life = lerp(S.life[0], S.life[1], Math.random());
      p.size = lerp(S.size[0], S.size[1], Math.random());
      p.warm = Math.random() < S.warmShare;
    }
    // ومضة المركز: نقطة مضيئة أكبر تخفت سريعاً فيبدو الانفجار لمعة واحدة
    const f = pool[state.stardust.cursor];
    state.stardust.cursor = (state.stardust.cursor + 1) % pool.length;
    f.on = true;
    f.x = clientX;
    f.y = clientY;
    f.vx = 0;
    f.vy = 0;
    f.age = 0;
    f.life = 260;
    f.size = 4.4;
    f.warm = Math.random() < S.warmShare;
  }

  /** تقدّم الجزيئات: احتكاك يُبديد السرعة وجاذبية بطيئة هادئة */
  function updateStardust(dt) {
    const pool = state.stardust.pool;
    if (!pool) return;
    const s = dt / 1000;
    const drag = Math.max(0, 1 - CONFIG.stardust.drag * s);
    const gravity = CONFIG.stardust.gravity * s;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) { p.on = false; continue; }
      p.vx *= drag;
      p.vy = p.vy * drag + gravity;
      p.x += p.vx * s;
      p.y += p.vy * s;
    }
  }

  /* ------------- خطوط الأبراج: ظهور ناعم يختفي وسط الرحلة ------------- */

  /** تدرّج شدّة الشبكة: تختفي بلطف عند بدء الرحلة وتعود بعد انتهائها */
  function updateConstellation(dt) {
    const C = state.constellation;
    if (!C.nodes.length) { C.alpha = 0; return; }
    const target = state.warp.active ? 0 : 1;
    C.alpha += (target - C.alpha) * smoothFactor(CONFIG.constellation.fade, dt);
    if (Math.abs(target - C.alpha) < 0.004) C.alpha = target;
  }

  /* ------------------------------------------------------------------
   * 6.b) محاكاة طقس الموسم — رذاذ، ضباب كوني، بلورات صقيع، وهج قيظ
   * ---------------------------------------------------------------- */

  /** نسخة قابلة للتعديل من ملفّ طقس */
  function cloneWeather(p) {
    const src = p || DEFAULT_WEATHER;
    const o = { kind: src.kind };
    for (let i = 0; i < WEATHER_CHANNELS.length; i++) {
      const name = WEATHER_CHANNELS[i];
      o[name] = src[name];
    }
    return o;
  }

  /** تهيئة الطقس قبل أول رسم: سماء صافية هادئة حتى يعيّن الموسم */
  function initWeather() {
    state.weather.now = cloneWeather(DEFAULT_WEATHER);
    state.weather.goal = cloneWeather(DEFAULT_WEATHER);
    state.weather.key = DEFAULT_WEATHER.kind;
    state.weather.label = '';
  }

  /** طلب طقس موسم: تنساب القيم الحالية نحو الهدف فلا يحدث قفز مفاجئ */
  function applyWeather(profile, label) {
    const target = profile || DEFAULT_WEATHER;
    state.weather.goal = cloneWeather(target);
    state.weather.key = target.kind;
    state.weather.label = label || '';
    ensureParticles();
  }

  /** بناء جزيئات الطقس بحسب شدّة الطقس المطلوبة (يُعاد البناء عند تغيّر الحاجة فقط) */
  function ensureParticles() {
    const goal = state.weather.goal;
    if (!goal || !state.ready || !state.w) return;
    const area = state.w * state.h;
    const rm = state.reducedMotion ? 0.45 : 1;      // جزيئات أقل عند تقليل الحركة
    const R = CONFIG.weather.rain;
    const F = CONFIG.weather.frost;
    const rainN = goal.rain > 0.01
      ? clamp(Math.round(area * R.density * goal.rain * rm), R.min, R.max) : 0;
    const frostN = goal.frost > 0.01
      ? clamp(Math.round(area * F.density * goal.frost * rm), F.min, F.max) : 0;
    const sig = rainN + ':' + frostN;
    if (sig === state.weather.partSig) return;
    state.weather.partSig = sig;

    const rng = state.wRng || createRng(5150);
    const rain = [];
    for (let i = 0; i < rainN; i++) {
      const spd = lerp(R.speed[0], R.speed[1], rng());
      rain.push({
        x: rng() * state.w,
        y: rng() * state.h,
        spd: spd,
        len: lerp(R.len[0], R.len[1], rng()),
        a: 0.45 + rng() * 0.55
      });
    }
    const frost = [];
    for (let i = 0; i < frostN; i++) {
      frost.push({
        x: rng() * state.w,
        y: rng() * state.h,
        spd: lerp(F.speed[0], F.speed[1], rng()),
        size: lerp(F.size[0], F.size[1], rng()),
        a: 0.35 + rng() * 0.65,
        phase: rng() * TAU,
        sway: 0.35 + rng() * 0.65,
        dx: 0
      });
    }
    state.weather.parts.rain = rain;
    state.weather.parts.frost = frost;
  }

  /** تقدّم الطقس: تدرّج القنوات + حركة الجزيئات + خفوت نبضة الموسم */
  function updateWeather(dt, t) {
    const w = state.weather;
    if (!w.now || !w.goal) return;

    // معامل التدرّج مضبوط بحيث يكتمل الانتقال في حدود blendMs
    const k = smoothFactor(clamp(38 / CONFIG.weather.blendMs, 0.02, 0.6), dt);
    for (let i = 0; i < WEATHER_CHANNELS.length; i++) {
      const name = WEATHER_CHANNELS[i];
      w.now[name] += (w.goal[name] - w.now[name]) * k;
      if (Math.abs(w.now[name] - w.goal[name]) < 0.0015) w.now[name] = w.goal[name];
    }

    if (state.seasonPulse > 0) {
      state.seasonPulse = Math.max(0, state.seasonPulse - dt / CONFIG.weather.pulseMs);
    }

    ensureParticles();
    updateRain(dt);
    updateFrost(dt, t);
  }

  /** نزول الرذاذ بميل هادئ مع إعادة تدويره من أعلى الشاشة */
  function updateRain(dt) {
    const rain = state.weather.parts.rain;
    if (!rain.length) return;
    const R = CONFIG.weather.rain;
    const s = dt / 1000;
    const w = state.w;
    const h = state.h;
    for (let i = 0; i < rain.length; i++) {
      const p = rain[i];
      p.y += p.spd * s;
      p.x += p.spd * R.slant * s;
      if (p.y > h + 14) {
        p.y = -14;
        p.x = (state.wRng || Math.random)() * w;
      }
      if (p.x > w + 14) p.x -= w + 28;
    }
  }

  /** انسياب بلورات الصقيع ببطء مع تمايل أفقي لطيف */
  function updateFrost(dt, t) {
    const frost = state.weather.parts.frost;
    if (!frost.length) return;
    const F = CONFIG.weather.frost;
    const s = dt / 1000;
    const w = state.w;
    const h = state.h;
    for (let i = 0; i < frost.length; i++) {
      const p = frost[i];
      p.y += p.spd * s;
      p.dx = Math.sin(t * 0.0004 + p.phase) * F.sway * p.sway;
      if (p.y > h + 12) {
        p.y = -12;
        p.x = (state.wRng || Math.random)() * w;
      }
    }
  }

  /* ------------- رحلة الرصد: تقريب سينمائي (Warp / Zoom In) ------------- */

  /** مركز الرحلة = موضع هالة الطالع، أي النجم الذي نسافر نحوه */
  function warpCenterX() { return state.w * (0.5 + state.haloShift); }
  function warpCenterY() { return state.h * state.haloY; }

  /** بدء رحلة: dir = 1 تقريب نحو النجم، dir = -1 رجوع إلى السماء الواسعة */
  function beginWarp(dir, d) {
    const w = state.warp;
    const base = dir > 0 ? CONFIG.warp.inMs : CONFIG.warp.outMs;
    w.active = true;
    w.dir = dir > 0 ? 1 : -1;
    w.t = 0;
    w.u = 0;
    w.started = 0;
    w.revealed = false;
    w.def = d || null;
    w.promise = d ? d.promise : null;
    w.dur = Math.max(260, base * (state.reducedMotion ? CONFIG.warp.reduced : 1));
    w.z = warpZoom(0);
    w.flash = warpFlash(0);
    state.haloBoost = 1;
    state.lensFade = 0;
    state.meteor.active = false;                          // لا شهاب وسط الرحلة
    state.nextMeteorAt = state.elapsed + CONFIG.meteor.firstAt;
  }

  /** منحنى التقريب: تسارع تصاعدي للداخل، وتباطؤ ناعم أثناء الرجوع */
  function warpZoom(u) {
    if (state.reducedMotion) return 1;                    // بلا سفر فعلي عند تقليل الحركة
    const W = CONFIG.warp;
    const span = W.maxScale - 1;
    if (state.warp.dir > 0) {
      if (u >= W.resetAt) return 1;                       // أُعيد المشهد إلى حاله خلف الوميض
      return 1 + span * Math.pow(clamp(u / W.resetAt, 0, 1), W.accel);
    }
    return 1 + span * Math.pow(1 - clamp(u, 0, 1), W.accel);
  }

  /** وميض كاسح يبلغ ذروته لحظة إرجاع التقريب فيُخفي الانتقال تماماً */
  function warpFlash(u) {
    const W = CONFIG.warp;
    const scale = state.reducedMotion ? 0.3 : 1;
    if (state.warp.dir < 0) return W.flashMax * 0.3 * scale * Math.pow(1 - clamp(u, 0, 1), 2);
    if (u <= W.flashAt) return 0;
    if (u >= W.resetAt) {
      return W.flashMax * scale * Math.pow(1 - (u - W.resetAt) / (1 - W.resetAt), 1.5);
    }
    const k = (u - W.flashAt) / (W.resetAt - W.flashAt);
    return W.flashMax * scale * k * k;
  }

  /**
   * تقدّم الرحلة على الزمن الحقيقي المُطلق لا على تراكم الإطارات،
   * فتنتهي في موعدها بالضبط حتى لو تعثّرت بعض الإطارات.
   */
  function updateWarp(now) {
    const w = state.warp;
    if (!w.active) return;
    if (!w.started) w.started = now;                      // أول إطار: نثبّت لحظة الانطلاق
    w.t = clamp(now - w.started, 0, w.dur);
    w.u = w.dur > 0 ? w.t / w.dur : 1;
    w.z = warpZoom(w.u);
    w.flash = warpFlash(w.u);
    // نبضة الهالة ترتفع مع الاندفاع (الوصول إلى النجم) ثم تهدأ بعد الرحلة
    const drive = w.dir > 0 ? w.u : 1 - w.u;
    state.haloBoost = 1 + (state.reducedMotion ? 0.45 : 1.6) * Math.pow(drive, 1.4);
    if (!w.revealed && w.u >= CONFIG.warp.revealAt) {
      w.revealed = true;
      if (w.def) w.def.resolve();                         // لحظة كشف البطاقة في الصفحة
    }
    if (w.u >= 1) endWarp();
  }

  /** إنهاء الرحلة (تلقائياً عند انتهاء مدّتها، أو فوراً عند إخفاء التبويب) */
  function endWarp() {
    const w = state.warp;
    if (!w.active) return;
    w.active = false;
    w.z = 1;
    w.flash = 0;
    if (!w.revealed && w.def) { w.revealed = true; w.def.resolve(); }
    w.def = null;
    w.promise = null;
  }

  /** تشغيل رحلة مع وعد يُحسم عند لحظة الكشف (تُستدعى من الواجهة العامة) */
  function startWarp(dir) {
    wakeNow();                              // رحلة رصد: لا خفض أبداً أثناءها
    if (state.warp.active) return state.warp.promise;      // لا رحلتان في وقت واحد
    const d = defer();
    if (!state.ready) {                                    // طُلبت قبل اكتمال التهيئة (حالة نادرة)
      state.pendingWarp = { dir: dir, def: d };
      return d.promise;
    }
    beginWarp(dir, d);
    return d.promise;
  }

  /* ------------------------------------------------------------------
   * 7) الرسم — نجوم ثم شهاب ثم هالة الطالع
   * ---------------------------------------------------------------- */

  /**
   * أثر نجمي أثناء رحلة التقريب: خط من موضع النجم قبل لحظة إلى موضعه الآن.
   * الطبقات الأبعد تتأخّر فيبدو السفر ثلاثي الأبعاد، والخطوط تُجمع في مسار
   * واحد لكل لون فلا نبدّل حالة المنصة لكل نجم (أداء عالية وسط الاندفاع).
   */
  function drawLayerStreaks(layer, zNow, zPrev, shiftX, shiftY, cx, cy) {
    const ctx = state.ctx;
    const w = state.w;
    const h = state.h;
    const spanX = w * 1.04;
    const spanY = h * 1.04;
    const offX = -w * 0.02;
    const offY = -h * 0.02;
    const depth = layer.depth;
    const mix = CONFIG.warp.farFactor + (1 - CONFIG.warp.farFactor) * depth;
    const z1 = 1 + (zNow - 1) * mix;
    const z0 = 1 + (zPrev - 1) * mix;
    const rush = clamp((z1 - 1) / (CONFIG.warp.maxScale - 1), 0, 1);
    const pad = 40 + 70 * z1;

    ctx.lineWidth = 0.9 + depth * 0.8;
    ctx.globalAlpha = clamp(layer.brightness * (0.45 + 0.55 * rush), 0, 1);

    for (let b = 0; b < layer.buckets.length; b++) {
      const bucket = layer.buckets[b];
      if (!bucket.length) continue;
      ctx.strokeStyle = STAR_TINTS[b];
      ctx.beginPath();
      for (let i = 0; i < bucket.length; i++) {
        const s = bucket[i];
        const bx = offX + s.x * spanX + shiftX - cx;
        const by = offY + s.y * spanY + shiftY - cy;
        const ex = cx + bx * z1;
        const ey = cy + by * z1;
        if (ex < -pad || ex > w + pad || ey < -pad || ey > h + pad) continue;  // خارج الشاشة
        ctx.moveTo(cx + bx * z0, cy + by * z0);
        ctx.lineTo(ex, ey);
      }
      ctx.stroke();
    }

    // رؤوس مضيئة للنجوم البارزة فيبدو الأثر نجومًا مندفعة لا خيوطًا
    const flares = layer.flares;
    if (flares.length) {
      ctx.fillStyle = STAR_TINTS[0];
      ctx.globalAlpha = clamp(layer.brightness * (0.4 + 0.6 * rush), 0, 1);
      for (let i = 0; i < flares.length; i++) {
        const s = flares[i];
        const bx = offX + s.x * spanX + shiftX - cx;
        const by = offY + s.y * spanY + shiftY - cy;
        const ex = cx + bx * z1;
        const ey = cy + by * z1;
        if (ex < -pad || ex > w + pad || ey < -pad || ey > h + pad) continue;
        const size = 1.4 + s.r;
        ctx.fillRect(ex - size * 0.5, ey - size * 0.5, size, size);
      }
    }
  }

  /** وهج عدسة الاستكشاف: تحت النجوم، فيبدو المؤشر عدسة تُقرّب ما حولها */
  function drawLens() {
    const sprite = state.lensSprite;
    if (!sprite || state.lensFade < 0.02 || state.warp.active) return;
    const ctx = state.ctx;
    const r = CONFIG.lens.radius * 1.3;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = CONFIG.lens.glow * state.lensFade;
    ctx.drawImage(sprite, state.lensX - r, state.lensY - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** وميض الرحلة الكاسح: يبلغ ذروته لحظة إرجاع التقريب فيغطّي الانتقال */
  function drawFlash() {
    const a = state.warp.flash;
    if (!state.warp.active || a <= 0.004) return;
    const ctx = state.ctx;
    const pal = state.palette || fallbackPalette();
    const cx = warpCenterX();
    const cy = warpCenterY();
    const r = Math.max(state.w, state.h) * 0.8;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,248,231,' + a.toFixed(3) + ')');
    grad.addColorStop(0.25, rgba(pal.core, Number((a * 0.6).toFixed(3))));
    grad.addColorStop(0.62, rgba(pal.mid, Number((a * 0.22).toFixed(3))));
    grad.addColorStop(1, rgba(pal.haze, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, state.w, state.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------------------------------------------
   * 7.b) رسم الطقس — طبقة خلفية بين السديم والنجوم، وطبقة أمامية فوقها
   * ---------------------------------------------------------------- */

  /** الطبقة الخلفية: ضباب كوني، غبار لؤلؤي، وهج قيظ، وعمق أزرق جليدي */
  function drawWeatherBase(t) {
    const W = state.weather.now;
    const S = state.wSprite;
    if (!W || !S) return;
    const ctx = state.ctx;
    const w = state.w;
    const h = state.h;
    const calm = state.warp.active ? 0.45 : 1;      // نخفّف الطقس أثناء رحلة التقريب

    // 1) الضباب الكوني الضوئي: طبقتان تسبحان ببطء بين النجوم
    if (S.mist && W.mist > 0.01) {
      const m = CONFIG.weather.mist;
      const driftX = Math.sin(t * m.drift) * w * 0.06;
      const driftY = Math.cos(t * m.drift * 0.7) * h * 0.05;
      const dw = w * m.scale;
      const dh = h * m.scale;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(W.mist * m.alpha * calm, 0, 1);
      ctx.drawImage(S.mist, -dw * 0.1 + driftX, -dh * 0.08 + driftY, dw, dh);
      ctx.globalAlpha = clamp(W.mist * m.alpha * 0.55 * calm, 0, 1);
      ctx.drawImage(S.mist, -dw * 0.2 - driftX * 0.6, -dh * 0.16 - driftY * 0.5, dw, dh);
      ctx.globalAlpha = 1;
    }

    // 2) الغبار اللؤلؤي: كثافة نجمية إضافية تنبض ببطء في السماء الصافية
    if (S.dust && W.pearl > 0.01) {
      const pulse = 0.84 + 0.16 * Math.sin(t / 2600);
      const px = state.offsetX * 6;
      const py = state.offsetY * 4;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(W.pearl * CONFIG.weather.clear.alpha * pulse * calm, 0, 1);
      ctx.drawImage(S.dust, px, py, w, h);
      ctx.globalAlpha = clamp(W.pearl * CONFIG.weather.clear.alpha * 0.45 * calm, 0, 1);
      ctx.drawImage(S.dust, px * 1.7 - 16, py * 1.7 - 9, w, h);
      ctx.globalAlpha = 1;
    }

    // 3) وهج القيظ: قرص نحاسي متصاعد بأشرطة متموّجة هادئة + مسحة ذهبية دافئة
    if (S.heat && W.heat > 0.01) {
      const H = CONFIG.weather.heat;
      const bands = H.bands | 0;
      const src = 224;
      const size = Math.max(w, h) * 0.95;
      const dx0 = w * 0.5 - size * 0.5;
      const dy0 = h - size * 0.62;
      const bandH = size / bands;
      const pulse = 0.86 + 0.14 * Math.sin(((t % H.pulseMs) / H.pulseMs) * TAU);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(W.heat * H.alpha * pulse * calm, 0, 1);
      for (let i = 0; i < bands; i++) {
        const dx = Math.sin(t * 0.00042 + i * 0.85) * H.wave;   // تموّج هادئ
        ctx.drawImage(
          S.heat,
          0, (i / bands) * src, src, src / bands + 0.5,
          dx0 + dx, dy0 + i * bandH, size, bandH + 1
        );
      }
      if (S.heatWash) {
        ctx.globalAlpha = clamp(W.heat * H.wash * pulse * calm, 0, 1);
        ctx.drawImage(S.heatWash, 0, 0, w, h);
      }
      ctx.globalAlpha = 1;
    }

    // 4) عمق الصقيع: أزرق جليدي يغمق الأطراف ثم توهّج جليدي فاتح
    if (W.ice > 0.01) {
      const ice = clamp(W.ice, 0, 1.4);
      if (S.iceDeep) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = clamp(ice * 0.34 * calm, 0, 1);
        ctx.drawImage(S.iceDeep, 0, 0, w, h);
      }
      if (S.iceGlow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = clamp(ice * 0.5 * calm, 0, 1);
        ctx.drawImage(S.iceGlow, 0, 0, w, h);
      }
      ctx.globalAlpha = 1;
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  /** الطبقة الأمامية: رذاذ المطر وبلورات الصقيع ونبضة تبديل الموسم */
  function drawWeatherFront() {
    const W = state.weather.now;
    if (!W) return;
    const fade = state.warp.active ? 0.12 : 1;      // لا مطر وسط رحلة التقريب
    if (W.rain > 0.01) drawRain(W.rain * fade);
    if (W.frost > 0.01) drawFrost(W.frost * fade);
    if (state.seasonPulse > 0.01) drawSeasonPulse();
  }

  /**
   * رذاذ المطر: تُجمع القطرات في مسارات قليلة (صنفان × ثلاث مناطق رأسية)،
   * فيبقى رسم المئات من القطرات بخطوات stroke معدودة.
   */
  function drawRain(amt) {
    const rain = state.weather.parts.rain;
    if (!rain.length) return;
    const ctx = state.ctx;
    const R = CONFIG.weather.rain;
    const h = state.h;
    const zoneH = h * 0.16;
    const zones = [0.32, 0.68, 1];           // ظهور تدريجي في أعلى الشاشة
    const classes = [
      { color: 'rgba(198,222,255,1)', scale: 1, min: 0.72 },
      { color: 'rgba(166,196,238,1)', scale: 0.6, max: 0.72 }
    ];
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (let c = 0; c < classes.length; c++) {
      const cl = classes[c];
      const base = clamp(amt * R.alpha * cl.scale, 0, 1);
      for (let z = 0; z < zones.length; z++) {
        ctx.strokeStyle = cl.color;
        ctx.globalAlpha = base * zones[z];
        ctx.beginPath();
        for (let i = 0; i < rain.length; i++) {
          const p = rain[i];
          if (cl.min !== undefined ? p.a < cl.min : p.a >= cl.max) continue;
          if (p.y < -12 || p.y > h + 12) continue;
          const zn = p.y < zoneH ? 0 : (p.y < zoneH * 2 ? 1 : 2);
          if (zn !== z) continue;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.len * R.slant, p.y - p.len);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
  }

  /** بلورات الصقيع: نقاط دقيقة في مسار واحد + بلورات أكبر من صورة نجمية مخبّأة */
  function drawFrost(amt) {
    const frost = state.weather.parts.frost;
    if (!frost.length) return;
    const ctx = state.ctx;
    const F = CONFIG.weather.frost;
    const sprite = state.wSprite ? state.wSprite.crystal : null;
    const w = state.w;
    const h = state.h;
    const big = 1.35;

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(236,246,255,1)';
    ctx.globalAlpha = clamp(amt * F.alpha * 0.7, 0, 1);
    ctx.beginPath();
    for (let i = 0; i < frost.length; i++) {
      const p = frost[i];
      if (p.size > big) continue;
      const x = p.x + p.dx;
      if (x < -4 || x > w + 4 || p.y < -4 || p.y > h + 4) continue;
      ctx.rect(x, p.y, 1, 1);
    }
    ctx.fill();

    if (sprite) {
      for (let i = 0; i < frost.length; i++) {
        const p = frost[i];
        if (p.size <= big) continue;
        const x = p.x + p.dx;
        if (x < -12 || x > w + 12 || p.y < -12 || p.y > h + 12) continue;
        const s = p.size * 4.6;
        ctx.globalAlpha = clamp(amt * F.alpha * p.a * 0.8, 0, 1);
        ctx.drawImage(sprite, x - s * 0.5, p.y - s * 0.5, s, s);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** نبضة ضوئية ناعمة تُغطّي لحظة تبديل الموسم فتنساب الألوان بلا قفز */
  function drawSeasonPulse() {
    const ctx = state.ctx;
    const pal = state.palette || fallbackPalette();
    const cx = state.w * 0.5;
    const cy = state.h * 0.42;
    const r = Math.max(state.w, state.h) * 0.75;
    const alpha = state.seasonPulse * state.seasonPulse * CONFIG.weather.pulseAlpha;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,250,240,' + (alpha * 0.7).toFixed(3) + ')');
    grad.addColorStop(0.35, rgba(pal.core, Number((alpha * 0.4).toFixed(3))));
    grad.addColorStop(1, rgba(pal.mid, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, state.w, state.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * هالات النجوم البارزة: تدرج radial صغير ومتدرج يُرسم قبل النواة،
   * فيبدو نجم الطالع مشعاً بلا صلبان مبالغ فيها أو بقع ضبابية.
   */
  function drawHeroGlows(layer, t, spanX, spanY, offX, offY, shiftX, shiftY) {
    if (layer.kind !== 'hero' || !layer.flares.length) return;
    const ctx = state.ctx;
    const w = state.w;
    const h = state.h;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < layer.flares.length; i++) {
      const star = layer.flares[i];
      const x = offX + star.x * spanX + shiftX;
      const y = offY + star.y * spanY + shiftY;
      if (x < -30 || x > w + 30 || y < -30 || y > h + 30) continue;
      const pulse = state.reducedMotion
        ? 0.72
        : 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(t * 0.001 * star.spd + star.phase));
      const radius = (10 + star.r * 7) * pulse;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, 'rgba(255, 248, 224, 0.45)');
      glow.addColorStop(0.18, 'rgba(235, 241, 255, 0.22)');
      glow.addColorStop(0.52, 'rgba(201, 214, 249, 0.075)');
      glow.addColorStop(1, 'rgba(201, 214, 249, 0)');
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** رسم النجوم مجمّعة بحسب اللون لتقليل تبديل حالة المنصة (أداء أعلى) */
  function drawStars(t) {
    const ctx = state.ctx;
    const w = state.w;
    const h = state.h;
    const spanX = w * 1.04;
    const spanY = h * 1.04;
    const offX = -w * 0.02;
    const offY = -h * 0.02;
    const still = state.reducedMotion;

    // طقس الموسم يضبط ظهور النجوم ومدى تلألؤها (سماء لؤلؤية أكثف، وقيظ أخفت)
    const wx = state.weather.now;
    const vis = wx ? wx.vis : 1;
    const twinkle = wx ? wx.twinkle : 1;
    const twAmp = 0.28 * twinkle;
    const twBase = 1 - twAmp;

    // أثناء الرحلة نرسم الآثار المتسارعة بدل النقاط ونثبّت الإزاحة على مركز النجم
    const warp = state.warp;
    const flying = warp.active && !still && warp.z > 1.0005;
    const zNow = warp.z;
    const zPrev = still ? zNow : warpZoom(clamp(warp.u - CONFIG.warp.trail, 0, 1));
    const cx = warpCenterX();
    const cy = warpCenterY();

    // معطيات عدسة الاستكشاف — تُحسب مرة واحدة لكل إطار
    const lens = CONFIG.lens;
    const lensR = lens.radius;
    const lensR2 = lensR * lensR;
    const lensOn = !warp.active && !still && state.lensFade > 0.02;
    const lensX = state.lensX;
    const lensY = state.lensY;
    const lensAmt = lens.strength * state.lensFade;

    for (let L = 0; L < state.layers.length; L++) {
      const layer = state.layers[L];
      const depth = layer.depth;
      // إزاحة الفأرة + انزياح ذاتي بطيء جداً يُبقي السماء حيّة بلا مؤشر
      const shiftX = flying ? 0 : state.offsetX * CONFIG.parallax.maxOffset * depth +
        Math.sin(t * 0.00007 + L * 1.4) * 7 * depth;
      const shiftY = flying ? 0 : state.offsetY * CONFIG.parallax.maxOffset * depth +
        Math.cos(t * 0.00005 + L * 1.1) * 4 * depth;

      // في قلب الرحلة نكتفي بآثار النجوم (أسرع وأكثر تعبيراً من النقاط)
      if (flying) {
        drawLayerStreaks(layer, zNow, zPrev, 0, 0, cx, cy);
        continue;
      }

      // هالات الطبقة القريبة قبل رسم نوى النجوم.
      drawHeroGlows(layer, t, spanX, spanY, offX, offY, shiftX, shiftY);

      for (let b = 0; b < layer.buckets.length; b++) {
        const bucket = layer.buckets[b];
        const len = bucket.length;
        if (!len) continue;
        ctx.fillStyle = STAR_TINTS[b];
        for (let i = 0; i < len; i++) {
          const s = bucket[i];
          const sx = offX + s.x * spanX + shiftX;
          const sy = offY + s.y * spanY + shiftY;
          if (sx < -8 || sx > w + 8 || sy < -8 || sy > h + 8) continue;  // خارج الشاشة
          let alpha = still
            ? clamp(s.alpha * vis, 0, 1)
            : clamp(s.alpha * vis * (twBase + twAmp * Math.sin(t * 0.001 * s.spd + s.phase)), 0, 1);
          let radius = s.r;

          // عدسة الاستكشاف: توهيج لطيف للنجوم القريبة من المؤشر (الطبقات القريبة فقط)
          if (lensOn && depth > 0.3) {
            const lx = sx - lensX;
            const ly = sy - lensY;
            const d2 = lx * lx + ly * ly;
            if (d2 < lensR2) {
              const f = 1 - Math.sqrt(d2) / lensR;
              const glow = f * f * lensAmt;
              alpha = clamp(alpha * (1 + glow) + glow * 0.22, 0, 1);
              radius = s.r * (1 + f * lens.radiusBoost * state.lensFade);
            }
          }

          ctx.globalAlpha = alpha;
          if (layer.kind === 'dust') {
            // نقطة غبار حقيقية صغيرة: 0.5..1px، لا تُكبّر إلى مربع 1.6px.
            const size = clamp(radius * 1.45, 0.5, 1.25);
            ctx.fillRect(sx - size * 0.5, sy - size * 0.5, size, size);
          } else if (radius < 1.05) {
            const size = clamp(radius * 1.55, 0.85, 1.6);
            ctx.fillRect(sx - size * 0.5, sy - size * 0.5, size, size);
          } else {
            ctx.beginPath();
            ctx.arc(sx, sy, radius, 0, TAU);
            ctx.fill();
          }
        }
      }

      // صلبان الانعراج (Diffraction flare) للنجوم البارزة
      const flares = layer.flares;
      if (flares.length) {
        ctx.strokeStyle = STAR_TINTS[0];
        ctx.lineWidth = 0.7;
        for (let i = 0; i < flares.length; i++) {
          const s = flares[i];
          const sx = offX + s.x * spanX + shiftX;
          const sy = offY + s.y * spanY + shiftY;
          if (sx < -16 || sx > w + 16 || sy < -16 || sy > h + 16) continue;
          const tw = clamp(still ? 0.8 : 0.62 + 0.38 * twinkle * Math.sin(t * 0.001 * s.spd + s.phase), 0, 1);
          let reach = s.r * (3.6 + tw * 1.6);
          let alpha = clamp(s.alpha * vis * tw * 0.4, 0, 1);

          // صليب الانعراج يشتدّ أيضاً داخل عدسة الاستكشاف
          if (lensOn) {
            const lx = sx - lensX;
            const ly = sy - lensY;
            const d2 = lx * lx + ly * ly;
            if (d2 < lensR2) {
              const f = 1 - Math.sqrt(d2) / lensR;
              const glow = f * f * lensAmt;
              reach *= 1 + f * 0.6 * state.lensFade;
              alpha = clamp(alpha * (1 + glow * 1.4) + glow * 0.16, 0, 1);
            }
          }

          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.moveTo(sx - reach, sy);
          ctx.lineTo(sx + reach, sy);
          ctx.moveTo(sx, sy - reach);
          ctx.lineTo(sx, sy + reach);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** رسم الشهاب العابر كخط متدرّج يتلاشى سريعاً */
  function drawMeteor() {
    const m = state.meteor;
    if (!m.active) return;
    const alpha = Math.min(1, m.age / 140) * (1 - clamp(m.age / m.life, 0, 1));
    if (alpha <= 0.01) return;

    const ctx = state.ctx;
    const tailT = 0.13 * m.len;
    const tailX = m.x - m.vx * tailT;
    const tailY = m.y - m.vy * tailT;
    const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
    grad.addColorStop(0, 'rgba(255,250,235,' + alpha.toFixed(3) + ')');
    grad.addColorStop(0.35, 'rgba(205,222,255,' + (alpha * 0.45).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = grad;
    ctx.globalCompositeOperation = 'lighter';

    // أثر واسع ناعم تحت النواة ليبدو الذيل متوهّجاً لا خطاً مسطّحاً
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.32;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    // النواة اللامعة في مقدمة الشهاب
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    // رأس مضيء صغير يشدّ النظر إلى مقدمة الشهاب
    ctx.fillStyle = 'rgb(255,252,244)';
    ctx.globalAlpha = alpha * 0.9;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 2.4, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
  }

  /** سديط النقر: جزيئات ذهبية/فضية بمزج ضوئي في مرّتين (ذهب ثم فضة) */
  function drawStardust() {
    const pool = state.stardust.pool;
    if (!pool) return;
    let live = false;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].on) { live = true; break; }
    }
    if (!live) return;

    const ctx = state.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (let g = 0; g < 2; g++) {
      const warm = g === 0;
      ctx.fillStyle = STARDUST_TINTS[g];
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.on || p.warm !== warm) continue;
        const u = clamp(p.age / p.life, 0, 1);
        const rise = u < 0.1 ? u / 0.1 : 1;            // اشتعال سريع
        const alpha = rise * (1 - u) * (1 - u) * 0.95;  // تلاشٍ بطيء مربّع
        if (alpha < 0.02) continue;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * (1 - u * 0.55)), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** خطوط الأبراج: مسار واحد للروابط ثم توهّج نابض عند كل عقدة */
  function drawConstellation(t) {
    const C = state.constellation;
    if (C.alpha < 0.02 || !C.nodes.length) return;
    const cfg = CONFIG.constellation;
    const ctx = state.ctx;
    const spanX = state.w * 1.04;
    const spanY = state.h * 1.04;
    const offX = -state.w * 0.02;
    const offY = -state.h * 0.02;
    const still = state.reducedMotion;
    const shiftX = state.offsetX * CONFIG.parallax.maxOffset * cfg.depth +
      Math.sin(t * 0.00006 + 2.1) * 5 * cfg.depth;
    const shiftY = state.offsetY * CONFIG.parallax.maxOffset * cfg.depth +
      Math.cos(t * 0.00004 + 1.3) * 3 * cfg.depth;

    // حساب المواضع في مصفوفة معاد استخدامها (بلا تخصيص ذاكرة في الإطارات التالية)
    const pos = C.pos;
    const n = C.nodes.length;
    for (let i = 0; i < n; i++) {
      pos[i * 2] = offX + C.nodes[i].x * spanX + shiftX;
      pos[i * 2 + 1] = offY + C.nodes[i].y * spanY + shiftY;
    }

    // الروابط: مسار واحد ثم ضربة واحدة لكل الشبكة
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = cfg.alpha * C.alpha;
    ctx.strokeStyle = CONSTELLATION_TINT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let e = 0; e < C.edges.length; e++) {
      const a = C.edges[e][0];
      const b = C.edges[e][1];
      ctx.moveTo(pos[a * 2], pos[a * 2 + 1]);
      ctx.lineTo(pos[b * 2], pos[b * 2 + 1]);
    }
    ctx.stroke();

    // توهّج الأطراف: هالة خارجية ناعمة + نواة مضيئة، لكل عقدة نبضها
    ctx.fillStyle = CONSTELLATION_TINT;
    const pulseK = (t / cfg.pulseMs) * TAU;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 2];
      const y = pos[i * 2 + 1];
      const pulse = still ? 0.6 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(pulseK + C.nodes[i].phase));
      ctx.globalAlpha = cfg.glowAlpha * C.alpha * pulse * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, 6 + pulse * 3.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = cfg.glowAlpha * C.alpha * (0.45 + 0.55 * pulse);
      ctx.beginPath();
      ctx.arc(x, y, 1.4 + pulse * 1.1, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** هالة الطالع: تنبض ببطء وتتوهّج بمزج ضوئي فوق السديم والنجوم */
  function drawHalo(t) {
    const sprite = state.halo;
    if (!sprite) return;
    const ctx = state.ctx;
    const phase = Math.sin(((t % CONFIG.halo.pulseMs) / CONFIG.halo.pulseMs) * TAU - Math.PI / 2) * 0.5 + 0.5;
    const boost = state.haloBoost;
    const alpha = clamp(lerp(CONFIG.halo.minAlpha, CONFIG.halo.maxAlpha, phase) * boost, 0, 1);
    // أثناء الرحلة تتضخّم الهالة مع اقترابنا من النجم ثم تهدأ بعد الوصول
    const radius = Math.min(state.w, state.h) * CONFIG.halo.radius *
      (1 + phase * 0.07) * (1 + (boost - 1) * 0.5);
    const cx = warpCenterX() + state.offsetX * 10;
    const cy = state.h * state.haloY + state.offsetY * 8;

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** إطار واحد: السديم (وتفريغ الإطار) ← النجوم ← الشهاب ← الهالة */
  function render(t) {
    const ctx = state.ctx;
    ensureSprites(t);

    if (state.nebula) {
      const driftX = Math.sin(t * 0.00006) * state.w * 0.012;
      const driftY = Math.cos(t * 0.00004) * state.h * 0.012;
      const dx = -state.w * 0.02 + driftX;
      const dy = -state.h * 0.02 + driftY;
      const dw = state.w * 1.04;
      const dh = state.h * 1.04;
      // أثناء الرحلة يتوسّع السديم قليلاً نحو مركز النجم فيبدو الفضاء أعمق
      const nz = 1 + (state.warp.z - 1) * 0.05;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (nz > 1.0005) {
        const cx = warpCenterX();
        const cy = warpCenterY();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(nz, nz);
        ctx.translate(-cx, -cy);
        ctx.drawImage(state.nebula, dx, dy, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(state.nebula, dx, dy, dw, dh);
      }
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgb(DEEP_SPACE);
      ctx.fillRect(0, 0, state.w, state.h);
    }

    drawWeatherBase(t); // الضباب الكوني/الغبار اللؤلؤي/وهج القيظ/عمق الصقيع
    drawLens();       // وهج العدسة قبل النجوم لتبدو النجوم منيرة فوقه
    drawConstellation(t); // خطوط الأبراج خلف النجوم (توصيلة خافتة تنبض بأطرافها)
    drawStars(t);
    drawMeteor();
    drawHalo(t);
    drawStardust();   // سديط النقر فوق المشهد (تغذية راجعة تفاعلية لطيفة)
    drawWeatherFront(); // الرذاذ والبلورات ونبضة الموسم أمام المشهد
    drawFlash();      // الوميض الكاسح فوق كل شيء لحظة إرجاع التقريب

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------------------------------------------
   * 8) الحلقة الزمنية والأحداث
   * ---------------------------------------------------------------- */

  /**
   * حلقة الرسم عبر requestAnimationFrame مع خفض تلقائي لمعدّل الإطارات.
   *
   * الهدف: خمولٌ أطول بلا حركة (60 إطاراً/ث → 30 إطاراً/ث) لخفض استهلاك
   * المعالج والبطارية، مع العودة الفورية للمعدّل الكامل عند أول تفاعل.
   * نستخدم lastDraw كعدّاد منفصل عن lastTime: الأول للخفض، والثاني للحركة —
   * فلا نُجمّد الرسم ولا نُقطّع التدرّجات.
   */
  function loop(now) {
    if (!state.running) return;
    state.rafId = requestAnimationFrame(loop);

    const dt = state.lastTime ? Math.min(now - state.lastTime, 50) : 16;
    state.lastTime = now;
    state.elapsed += dt;
    state.fps = state.fps * 0.92 + (1000 / Math.max(dt, 1)) * 0.08;

    // خفض الإطارات في الخمول: نتخطّى الرسم لا الزمن، فتبقى الحركة سليمة.
    if (state.minFrameMs > 0) {
      if (now - state.lastDraw < state.minFrameMs) return;
    }
    state.lastDraw = now;

    updateParallax(dt);
    updateLens(dt);
    updatePalette(dt);
    updateHaloMotion(dt);
    updateWeather(dt, state.elapsed);
    updateWarp(now);
    updateMeteor(dt, state.elapsed);
    updateStardust(dt);
    updateConstellation(dt);
    render(state.elapsed);
  }

  function start() {
    if (state.running || !state.ready) return;
    state.running = true;
    state.lastTime = 0;
    state.lastDraw = 0;
    state.rafId = requestAnimationFrame(loop);
  }

  function stop() {
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    // إن كان المشهد في رحلة وأُخفي التبويب نُنهيها فوراً كي لا تبقى معلّقة
    if (state.warp.active) endWarp();
  }

  const listeners = [];

  /** ربط حدث مع تسجيله لإمكانية إزالته لاحقاً */
  function bind(target, type, fn, options) {
    if (!target) return;
    if (typeof target.addEventListener === 'function') target.addEventListener(type, fn, options);
    else if (typeof target.addListener === 'function') target.addListener(fn);
    else return;
    listeners.push({ target: target, type: type, fn: fn });
  }

  function unbindAll() {
    for (let i = 0; i < listeners.length; i++) {
      const l = listeners[i];
      if (typeof l.target.removeEventListener === 'function') l.target.removeEventListener(l.type, l.fn);
      else if (typeof l.target.removeListener === 'function') l.target.removeListener(l.fn);
    }
    listeners.length = 0;
  }

  /** تأجيل التنفيذ حتى تتوقّف سلسلة الأحداث (تغيير حجم النافذة مثلاً) */
  function debounce(fn, wait) {
    let timer = 0;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  /** هل بقيت جزيئات سديط حيّة؟ (المخزون موجود دائماً، الحيّ هو المؤشّر) */
  function stardustLive() {
    const pool = state.stardust.pool;
    if (!pool) return false;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].on) return true;
    }
    return false;
  }

  /**
   * إيقاظ المحرّك: يُلغي خفض الإطارات فوراً (minFrameMs = 0) فيعود الرسم
   * إلى المعدّل الكامل أثناء التفاعل، ثم يعود للخفض بعد مدّة الخمول.
   */
  let idleTimer = 0;
  function wakeNow() {
    state.minFrameMs = 0;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      idleTimer = 0;
      // لا نخفض الإطارات إن كان المشهد في رحلة انتقال أو الحركة لم تهدأ.
      // نفحص الجزيئات الحيّة فعلاً (المخزون نفسه يبقى موجوداً دائماً).
      if (state.warp.active || state.meteor.active || stardustLive()) return;
      state.minFrameMs = CONFIG.idleFrameMs;
    }, CONFIG.idleDelayMs);
  }

  /** هل المؤشر فوق عنصر من عناصر الواجهة (نجعل نقرها لا يُطلق سديطاً)؟ */
  function overSkyUI(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return !!target.closest(
      'button, a, input, select, textarea, label, header, nav, aside, ' +
      '.talea-card, .card-stage, .timeline-bar'
    );
  }

  function attachEvents() {
    const onResize = debounce(function () { resize(); }, 150);
    bind(window, 'resize', onResize, { passive: true });
    bind(window, 'orientationchange', onResize, { passive: true });
    // حركة المؤشر تُلغي الخمول فوراً (رفع معدّل الإطارات مؤقتاً)
    bind(window, 'pointermove', function (e) { wakeNow(); setPointer(e.clientX, e.clientY); }, { passive: true });
    bind(window, 'pointerdown', function (e) {
      wakeNow();
      setPointer(e.clientX, e.clientY);
      // سديط النجوم: على مساحة السماء المفتوحة فقط لا فوق عناصر الواجهة
      if (e.button > 0 || e.isPrimary === false) return;
      if (state.warp.active || overSkyUI(e.target)) return;
      spawnStardust(e.clientX, e.clientY);
      // رنين بلوري خفيف يصاحب انطلاق النثار (إن كان الصوت مفعّلاً من زر الزاوية)
      if (window.playChime) window.playChime();
    }, { passive: true });
    // إخفات عدسة الاستكشاف عند خروج المؤشر أو مغادرة النافذة
    bind(document, 'pointerleave', clearPointer);
    bind(window, 'blur', clearPointer);
    bind(document, 'visibilitychange', function () {
      if (document.hidden) { clearPointer(); stop(); } else { start(); }   // توفير المعالج في التبويبات المخفية
    });
  }

  /** احترام تفضيل تقليل الحركة في نظام المستخدم */
  function setupMotionPreference() {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    state.reducedMotion = !!mq.matches;
    bind(mq, 'change', function (e) {
      state.reducedMotion = !!e.matches;
      state.pointerX = 0;
      state.pointerY = 0;
    });
  }

  function countStars() {
    let total = 0;
    for (let L = 0; L < state.layers.length; L++) {
      const buckets = state.layers[L].buckets;
      for (let b = 0; b < buckets.length; b++) total += buckets[b].length;
    }
    return total;
  }

  /* ------------------------------------------------------------------
   * 9) الواجهة العامة
   * ---------------------------------------------------------------- */
  const api = {
    version: '1.3.0',

    /**
     * ربط هالة السماء وطقسها بطالع اليوم: { name, season } القادم من anwaa.js
     * يغيّر لوحة ألوان الهالة تلقائياً ويفعّل طقس الموسم المناظر.
     */
    setTalea: function (talea) {
      if (!talea || !talea.season) return;
      if (!state.ready) {
        state.pending = { name: talea.name, season: talea.season };   // يُطبَّق بعد التهيئة
        return;
      }
      const key = normalizeKey(talea.season);
      const pal = SEASON_PALETTES[key] || fallbackPalette();
      if (!state.palette) state.palette = clonePalette(pal);
      state.targetPalette = clonePalette(pal);
      if (SEASON_PALETTES[key]) {
        // انزياح أفقي بسيط يمنح كل طالع موضعاً مختلفاً قليلاً للهالة
        state.haloShift = ((hashString(normalizeKey(talea.name || '') + key) % 5) - 2) * 0.045;
      }
      // تطبيق طقس الموسم المناظر بنعومة (رذاذ/صقيع/وهج/سماء صافية)
      const weather = SEASON_WEATHER[key] || DEFAULT_WEATHER;
      applyWeather(weather, talea.season);
      // شبكة الأبراج تُبنى من اسم الطالع فتختلف من ليلة إلى ليلة
      buildConstellation(talea.name);
    },

    /**
     * ضبط الموسم الحالي كاملاً (لوحة ألوان + انزياح هالة + طقس محاكي + نبضة انتقال ناعمة)
     * @param {string} seasonName اسم الموسم باللغة العربية
     * @param {boolean} [pulse=true] تفعيل نبضة الضوء الناعمة لحظة التبديل
     */
    setSeason: function (seasonName, pulse) {
      if (!seasonName) return;
      const key = normalizeKey(seasonName);
      const pal = SEASON_PALETTES[key] || fallbackPalette();
      if (!state.palette) state.palette = clonePalette(pal);
      state.targetPalette = clonePalette(pal);
      state.haloShift = ((hashString(key) % 5) - 2) * 0.045;
      const weather = SEASON_WEATHER[key] || DEFAULT_WEATHER;
      applyWeather(weather, seasonName);
      if (pulse !== false && !state.reducedMotion) {
        state.seasonPulse = 1;
      }
    },

    /** نبضة ضوئية قصيرة تُغطّي تغيّر الموسم بنعومة (قوة من 0 إلى 1) */
    pulse: function (strength) {
      if (state.reducedMotion) return;
      state.seasonPulse = clamp(typeof strength === 'number' ? strength : 1, 0, 1);
    },

    /** استعلام عن حالة الطقس الحالية والهدف ونسب الجزيئات النشطة */
    getWeather: function () {
      const now = state.weather.now ? cloneWeather(state.weather.now) : null;
      const goal = state.weather.goal ? cloneWeather(state.weather.goal) : null;
      return {
        key: state.weather.key,
        label: state.weather.label,
        now: now,
        goal: goal,
        particles: {
          rain: state.weather.parts.rain.length,
          frost: state.weather.parts.frost.length
        },
        pulse: Number(state.seasonPulse.toFixed(3))
      };
    },

    /**
     * رحلة الرصد: تقريب سينمائي نحو نجم الطالع مع وميض كاسح ثم هدوء.
     * تُعيد وعداً يُحسم في لحظة كشف البطاقة (أو null إن لم تكن Promise متاحة).
     */
    observe: function () {
      if (state.warp.active) return state.warp.promise;
      state.haloYTarget = CONFIG.halo.focusY;      // تُسند الهالة خلف البطاقة
      return startWarp(1);
    },

    /** الرجوع إلى السماء الواسعة: انسحاب ناعم تعود فيه النجوم من الأطراف */
    release: function () {
      if (state.warp.active) return state.warp.promise;
      state.haloYTarget = CONFIG.halo.y;           // تعود الهالة إلى موضعها الأعلى
      return startWarp(-1);
    },

    /** إسناد الهالة رأسياً (نسبة من ارتفاع الشاشة) لتقع تماماً خلف البطاقة */
    setHaloAnchorY: function (y) {
      const v = Number(y);
      if (!isFinite(v)) return;
      state.haloYTarget = clamp(v, 0.08, 0.92);
    },

    /** هل المشهد في رحلة انتقال الآن؟ */
    isBusy: function () { return !!state.warp.active; },

    /** لون هالة يدوي بصيغة #rrggbb (اختياري) */
    setHaloColor: function (color) {
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color.trim())) return;
      const pal = state.targetPalette || state.palette || fallbackPalette();
      pal.core = c(color.trim());
      state.targetPalette = clonePalette(pal);
    },

    pause: stop,
    resume: start,

    /** إيقاف كل شيء وتحرير الذاكرة */
    destroy: function () {
      stop();
      unbindAll();
      if (state.canvas) {
        if (state.ctx) state.ctx.setTransform(1, 0, 0, 1, 0, 0);
        state.canvas.width = 1;
        state.canvas.height = 1;
      }
      state.nebula = null;
      state.halo = null;
      state.lensSprite = null;
      state.wSprite = null;
      state.weather.parts.rain = [];
      state.weather.parts.frost = [];
      state.stardust.pool = null;
      state.stardust.cursor = 0;
      state.constellation.key = null;
      state.constellation.nodes = [];
      state.constellation.edges = [];
      state.constellation.pos = [];
      state.constellation.alpha = 0;
      state.weather.now = null;
      state.weather.goal = null;
      state.layers = [];
      state.warp.active = false;
      state.warp.def = null;
      state.warp.promise = null;
      state.pendingWarp = null;
      state.ready = false;
    },

    /** معلومات تشخيصية سريعة (معدّل الإطارات وعدد النجوم) */
    stats: function () {
      return { fps: Math.round(state.fps), stars: countStars(), dpr: state.dpr };
    }
  };

  /* ------------------------------------------------------------------
   * 10) التشغيل
   * ---------------------------------------------------------------- */
  function boot() {
    const canvas = document.getElementById('skyCanvas');
    if (!canvas || !canvas.getContext) return;   // منصة السماء عنصر إلزامي في index.html
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    state.canvas = canvas;
    state.ctx = ctx;
    state.rng = createRng(dailySeed());
    state.wRng = createRng(dailySeed() + 433);
    state.clouds = buildCloudSpecs(createRng(dailySeed() + 977));  // مواصفات حزام المجرة
    state.palette = fallbackPalette();
    state.targetPalette = clonePalette(state.palette);
    initWeather();
    initStardust();

    resize();
    state.ready = true;
    attachEvents();
    setupMotionPreference();

    if (state.pending) {
      const pending = state.pending;
      state.pending = null;
      api.setTalea(pending);
    }
    if (state.pendingWarp) {                     // رحلة طُلبت قبل اكتمال التهيئة
      const pw = state.pendingWarp;
      state.pendingWarp = null;
      beginWarp(pw.dir, pw.def);
    }
    if (!state.constellation.nodes.length) buildConstellation('');  // شبكة افتراضية قبل وصول الطالع
    start();
  }

  window.AnwaaSky = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
