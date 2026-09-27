/* =============================================================================
 * audio.js — التجربة الصوتية الأثيرية لمرصد «أَنْوَاء» (Web Audio API خالص)
 * ----------------------------------------------------------------------------
 * مصدر واحد للحقيقة (Single Source of Truth) — فلا يسبق الصوت الأيقونة:
 *   • الحالة الابتدائية مكتومة تماماً (مطبقة لمعايير المتصفحات وتجربة المستخدم):
 *     لا خلفية، ولا مؤثرات، والأيقونة تعرض سماعة مغلقة (is-off).
 *   • متغير `enabled` وحده يحكم كل شيء: هو الذي تتبعه الأيقونة، وهو الذي
 *     يسمح بالمؤثرات اللحظية، فلا يمكن أن يختلف الاثنان أبداً.
 *   • نقرة واحدة على زر الصوت تُفعّل وتفتح السماعة، ونقرة أخرى تكتم وتغلقها —
 *     دون الحاجة إلى نقرتين لكتم صوت مسموع (الخلل السابق).
 *   • التزام سياسة التشغيل التلقائي (Autoplay Policy): السياق يُنشأ ويُستأنف
 *     داخل إيماءة المستخدم نفسها (await ctx.resume()) فيُسمع المؤثر بوضوح.
 *   • الخلفية (Drone: 55Hz و110Hz عبر Low-pass بمستوى gain ≈ 0.15) لا تبدأ
 *     إلا من زر الصوت نفسه.
 *   • حالة الزر واضحة بصرياً: شارب كتم عند الإطفاء، وذبذبات متحركة
 *     وتوهّج ذهبي حيّ عند التشغيل (أنماط .aa-sound في style.css).
 *
 * الواجهة العامة:
 *   window.playChime()           // رنين بلوري (صامت قبل تفعيل الزر)
 *   window.playWarpSound()       // اندفاع كوني لحظي (السياسة نفسها)
 *   window.AnwaaAudio.toggle()   // تشغيل/كتم الصوت
 *   window.AnwaaAudio.isActive() // هل الصوت مفعّل الآن؟
 *   window.AnwaaAudio.isMuted()  // هل الصوت مكتوم الآن؟
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const supported = typeof AudioCtx === 'function';

  /* كل الأرقام في مكان واحد لتسهيل الضبط */
  const AUDIO = {
    droneGain: 0.15,        // مستوى الخلفية الواضح والمريح (حوالي 0.15)
    partials: [             // [التردد (هيرتز), الشدّة النسبية]
      [55, 0.65],           // النواة الأرضية النقية
      [110, 0.35]           // أوكتافها المريح
    ],
    lowpassHz: 420,         // تمرير منخفض ينظّف الطبقات العليا
    lowpassQ: 0.7,
    fadeInMs: 1200,         // تلاشي دخول الخلفية بعد التفعيل
    fadeOutMs: 400,         // تلاشي الكتم
    visFadeMs: 550,         // تلاشي مع إخفاء/إظهار التبويب
    chime: {
      notes: [1174.66, 1318.51, 1479.98, 1567.98, 1760, 1975.53], // مقام صافٍ عالٍ
      partials: [           // [مضاعف التردد, الشدّة, تأخير (ثانية)]
        [1, 0.22, 0],
        [2.01, 0.08, 0.012],      // نحو نصف طبقة: صرير الكريستال
        [3.4, 0.03, 0.024]        // توافقي بعيد خافت
      ],
      attack: 0.006,        // اشتعال سريع
      decay: 1.15,          // خمول أقصر (ثانية) فلا يتحوّل الرنين إلى ضجيج
      minGapMs: 180,        // أدنى فاصل بين رنينين: يمنع التكديس أثناء التصفح السريع
      gain: 0.7             // خفّة إضافية للرنين كمؤثر «نقرة» لا موسيقى
    },
    warp: {                 // صوت الاندفاع الفضائي (Cosmic Whoosh)
      dur: 1.6,             // المدة الكلية (ثانية) ≈ ثانية ونصف ثم خفوت
      lpStart: 130,         // بداية التردد المنخفض للمرشّح (هيرتز)
      lpPeak: 2600,         // ذروة الصعود مع الاندفاع
      lpEnd: 230,           // عودة التردد عند الخفوت
      noisePeak: 0.13,      // شدّة الضجيج الأبيض (خفيفة لا تزعج)
      oscPeak: 0.07,        // شدّة موجة السين المنخفضة
      oscFrom: 55,          // بداية الموجة (هيرتز)
      oscTo: 98             // صعود خفيف للوكتاف مع السفر
    }
  };

  /* الحالة الداخلية
   *
   * مصدر واحد للحقيقة (Single Source of Truth):
   *   enabled      — نيّة المستخدم من زر الصوت (يبدأ false = مكتوم)
   *   mutedByUser  — مرآة enabled تُسكت المؤثرات اللحظية أيضاً (يبدأ true)
   *   active       — خلفية Drone تعمل الآن (تابعة، تبدأ false)
   *   iconState    — ما تعرضه الأيقونة؛ يُشتق من enabled بعد اكتمال التبديل
   *                  فلا يسبق أحدهما الآخر أبداً.
   */
  let ctx = null;
  let master = null;
  let droneBuilt = false;      // هل بُنيت خلفية Drone؟ (السياق الكسول للمؤثرات بلا خلفية)
  let droneOscillators = null; // مذبذبات الخلفية (تُنشأ مع البناء، وتبدأ عند التفعيل)
  let droneStarted = false;    // هل بدأت مذبذبات الخلفية؟ (مرة واحدة فقط)
  let enabled = false;         // نيّة المستخدم: الصوت مكتوم افتراضياً عند الدخول
  let active = false;          // هل الخلفية تعمل الآن؟
  let starting = false;        // منع التزامن أثناء await الاستئناف
  let lastChimeAt = -1e9;
  let suspendTimer = 0;
  let mutedByUser = true;      // مكتوم ابتداءً: يطابق enabled ويمنع أي مؤثر قبل التفعيل
  let noiseBuffer = null;      // مخزن الضجيج الأبيض (يُبنى مرة واحدة للاستفادة)
  let btn = null;

  /** هل الصوت مسموع الآن؟ (المؤثرات تُسمع فقط بعد تفعيل المستخدم) */
  function isAudible() {
    return enabled && !mutedByUser;
  }

  /** هل يفضّل المستخدم تقليل الحركة؟ (يمنع المؤثرات النغمية المزعجة) */
  function prefersLessMotion() {
    try {
      return typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) { return false; }
  }

  /** تلاشي خطي ناعم للمجمّع العام انطلاقاً من قيمته الحالية */
  function fadeMaster(value, ms) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(value, t + ms / 1000);
  }

  /** بناء سلسلة الخلفية الأثيرية: مذبذبان نقيان ← تمرير منخفض ← مجمّع */
  function buildDrone() {
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = AUDIO.lowpassHz;
    lowpass.Q.value = AUDIO.lowpassQ;

    const droneGain = ctx.createGain();
    droneGain.gain.value = AUDIO.droneGain;   // ≈0.15 — مستوى واضح ومريح

    lowpass.connect(droneGain);
    droneGain.connect(master);

    droneOscillators = [];
    for (let i = 0; i < AUDIO.partials.length; i++) {
      const p = AUDIO.partials[i];
      const osc = ctx.createOscillator();
      osc.type = 'sine';                      // موجة نقية بلا تشويه
      osc.frequency.value = p[0];
      const g = ctx.createGain();
      g.gain.value = p[1];
      osc.connect(g);
      g.connect(lowpass);
      droneOscillators.push(osc);             // لا تبدأ هنا؛ تبدأ عند التفعيل
    }
  }

  /** بدء مذبذبات الخلفية مرة واحدة (يُستدعى من enable فقط) */
  function startDrone() {
    if (droneStarted || !droneOscillators) return;
    for (let i = 0; i < droneOscillators.length; i++) {
      try { droneOscillators[i].start(); } catch (err) { /* تجاهل */ }
    }
    droneStarted = true;
  }

  /**
   * إنشاء السياق والمجمّع الرئيسي — من نقرة زر الصوت، أو لحظياً من أول
   * إيماءة مؤثر صوتي؛ والخلفية لا تُبنى إلا عند تفعيل زر الصوت فعلاً.
   */
  function createCtx(withDrone) {
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    droneBuilt = false;
    if (withDrone !== false) {
      buildDrone();
      droneBuilt = true;
    }
  }

  /** تفعيل الصوت: بناء الخلفية عند الحاجة + await الاستئناف + تلاشي الدخول */
  async function enable() {
    if (!supported || starting) return false;
    if (enabled) return true;          // مُفعَّل أصلاً — لا تكرار
    starting = true;
    try {
      if (!ctx) createCtx(true);
      else if (!droneBuilt) { buildDrone(); droneBuilt = true; }
      if (ctx.state === 'suspended') await ctx.resume();   // سياسة المتصفح الصارمة
      if (!droneStarted) startDrone();                    // بدء مذبذبات الخلفية مرة واحدة
      // نُعلن الحالات الثلاث معاً بعد نجاح الاستئناف فعلاً:
      // enabled (نيّة المستخدم) ← mutedByUser (السمعية) ← active (الخلفية)
      enabled = true;
      mutedByUser = false;
      active = true;
      fadeMaster(1, AUDIO.fadeInMs);
      updateButton();
      return true;
    } catch (err) {
      // فشل التفعيل: نُبقي كل شيء على حالة الكتم الصريحة
      enabled = false;
      mutedByUser = true;
      active = false;
      updateButton();
      return false;
    } finally {
      starting = false;
    }
  }

  /** كتم الصوت: تلاشي ناعم ثم إيقاف السياق مؤقتاً لتوفير المعالج */
  function disable() {
    enabled = false;
    active = false;
    mutedByUser = true;        // الكتم الصريح يسكّت حتى المؤثرات اللحظية
    updateButton();
    if (!ctx) return;
    fadeMaster(0, AUDIO.fadeOutMs);
    if (suspendTimer) clearTimeout(suspendTimer);
    suspendTimer = setTimeout(function () {
      suspendTimer = 0;
      if (!enabled && ctx && ctx.state === 'running') {
        const p = ctx.suspend();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    }, AUDIO.fadeOutMs + 140);
  }

  /**
   * تهيئة السياق للتشغيل الفوري من داخل إيماءة المستخدم.
   * يُنشأ عند الحاجة (دون تشغيل الخلفية) ويُستأنف فوراً قبل جدولة أي نغمة.
   * يُعاد false ما لم يكن الصوت مُفعَّلاً من زر الزاوية — وعندها فقط يُسمع
   * المؤثر، فلا يسبق الصوت الأيقونة أبداً.
   */
  function ensureAudioReady(gesture) {
    if (!supported) return false;
    if (!isAudible()) return false;   // مكتوم: لا سياق ولا نغمة قبل تفعيل الزر
    if (!gesture) return false;       // لا سياق بلا إيماءة: التزام التشغيل التلقائي
    if (!ctx) {
      try { createCtx(false); } catch (err) { return false; }
    }
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try {
        const r = ctx.resume();
        if (r && typeof r.catch === 'function') r.catch(function () {});  // فكّ تعليق المتصفح فوراً
      } catch (err) { /* تجاهل */ }
    }
    if (master && !active) {
      // السياق الكسول للمؤثرات يُبنى صامتاً؛ نرفع المجمّع فوراً حتى تُسمع النغمة
      try { fadeMaster(1, 120); } catch (err) { /* تجاهل */ }
    }
    return !!ctx;
  }

  /**
   * تعليق السياق ذاتياً بعد انتهاء مؤثر لحظي إن لم تكن الخلفية مفعّلة
   * (توفير للمعالج) — أيُّ تفاعل لاحق يبني مؤقتاً جديداً ويلغي القديم.
   */
  function scheduleLazySuspend(delayMs) {
    if (typeof clearTimeout === 'function') clearTimeout(suspendTimer);
    suspendTimer = setTimeout(function () {
      suspendTimer = 0;
      if (!active && ctx && ctx.state === 'running' && !document.hidden) {
        const p = ctx.suspend();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    }, delayMs);
  }

  /**
   * رنين بلوري خافت وناعم — يُستدعى من نقر النجوم وأزرار المواسم والأزرار.
   * صامت تماماً حتى يفعّل المستخدم الصوت من زر الزاوية، وعندها يطابق
   * ما تظهره الأيقونة بالضبط.
   */
  function playChime() {
    if (!ensureAudioReady(true)) return;   // لا صوت قبل تفعيل المستخدم للزر
    if (prefersLessMotion()) return;       // تقليل الحركة: نُسكّت المؤثر النغمي
    playChimeEnvelope();
    if (!active) scheduleLazySuspend(AUDIO.chime.decay * 1000 + 600);
  }

  /** جدولة توافقيات الرنين على السياق الجاهز */
  function playChimeEnvelope() {
    const C = AUDIO.chime;
    const t = ctx.currentTime;
    const stamp = t * 1000;
    if (stamp - lastChimeAt < C.minGapMs) return;   // لا تراكم فوق بعضه
    lastChimeAt = stamp;
    const level = C.gain || 1;                     // خفّة الرنين كمؤثر نقر

    const base = C.notes[(Math.random() * C.notes.length) | 0];
    const panner = (typeof ctx.createStereoPanner === 'function') ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = Math.random() * 1.4 - 0.7;
      panner.connect(master);
    }

    for (let i = 0; i < C.partials.length; i++) {
      const p = C.partials[i];
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * p[0];
      osc.detune.value = Math.random() * 12 - 6;
      const g = ctx.createGain();
      const t0 = t + p[2];
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(p[1] * level, t0 + C.attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + C.decay);
      osc.connect(g);
      g.connect(panner || master);
      try {
        osc.start(t0);
        osc.stop(t0 + C.decay + 0.12);
      } catch (err) { /* تجاهل */ }
      osc.onended = function () {
        try { osc.disconnect(); g.disconnect(); } catch (err) { /* تجاهل */ }
      };
    }
  }

  /**
   * صوت الاندفاع الفضائي (Cosmic Warp / Whoosh): ضجيج أبيض مُولّد برمجياً
   * يمرّ على مرشّح تمرير منخفض يرتفع تردده تدريجياً مع اندفاع ثم يخفت ناعماً،
   * مدموجاً مع موجة Sine منخفضة التردد — همس نحن عبر الفضاء بلا إزعاج.
   * يُستدعى مع زر الرصد لتزامن مع تأثير تسارع النجوم (Zoom In).
   */
  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const seconds = AUDIO.warp.dur + 0.3;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;   // ضجيج أبيض نقي
    noiseBuffer = buf;
    return buf;
  }

  function playWarpSound() {
    if (!ensureAudioReady(true)) return;   // صامت حتى يفعّل المستخدم الزر
    const W = AUDIO.warp;
    const t = ctx.currentTime;
    const D = W.dur;

    // 1) طبقة الضجيج: أبيض ← lowpass يصعد ثم يهبط، بحجم يتلاشى بنعومة
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    noise.loop = false;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(W.lpStart, t);
    lp.frequency.exponentialRampToValueAtTime(W.lpPeak, t + D * 0.65);  // اندفاع يتصاعد
    lp.frequency.exponentialRampToValueAtTime(W.lpEnd, t + D);          // ثم خفوت
    lp.Q.value = 0.8;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(W.noisePeak, t + D * 0.3);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + D);

    noise.connect(lp);
    lp.connect(noiseGain);
    noiseGain.connect(master);

    // 2) الطبقة النغمية: سين عميق يصعد من 55 إلى 98 هيرتز
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(W.oscFrom, t);
    osc.frequency.exponentialRampToValueAtTime(W.oscTo, t + D);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.0001, t);
    oscGain.gain.exponentialRampToValueAtTime(W.oscPeak, t + D * 0.4);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + D + 0.2);
    osc.connect(oscGain);
    oscGain.connect(master);

    try {
      noise.start(t);
      noise.stop(t + D + 0.1);
      osc.start(t);
      osc.stop(t + D + 0.3);
    } catch (err) { /* تجاهل */ }
    if (!active) scheduleLazySuspend(D * 1000 + 600);
  }

  /* ---- الزر: عنصر index.html بالمعرف audioToggle ---- */

/**
   * مزامنة شكل الزر مع الحالة الحقيقية — يُشتق من enabled وحده،
   * فلا يمكن للأيقونة أن تسبق الصوت أو تتأخر عنه.
   *   مكتوم  : is-off + سماعة مغلقة (aa-slash) + aria-pressed=false
   *   يعمل  : is-on  + ذبذبات متحركة        + aria-pressed=true
   */
  function updateButton() {
    if (!btn) return;
    const on = enabled && !mutedByUser;
    btn.classList.toggle('is-on', on);
    btn.classList.toggle('is-off', !on);
    const label = on ? 'كتم الصوت' : 'تشغيل الصوت';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.disabled = !supported;          // بلا دعم Web Audio: الزر غير قابل للاستخدام
  }

  /**
   * نقرة واحدة للتبديل — لا OCR ولا حالتين متتاليتين:
   * مكتوم ← تفعيل (وتُعلَن الأيقونة بعد نجاح الاستئناف فقط)
   * يعمل  ← كتم فوري (والأيقونة تتغير في اللحظة نفسها)
   */
  async function onButtonClick() {
    if (!supported || starting) return;
    if (enabled) disable();
    else await enable();
  }

  /** النقرة الوحيدة التي يُنشأ فيها السياق أو يُستأنف — قلب السياسة الصارمة */
  function bindButton() {
    btn = document.getElementById('audioToggle');
    if (!btn) return;   // زر الصوت عنصر إلزامي في index.html
    // الحالة الابتدائية موحّدة قبل أي تفاعل: مكتوم + سماعة مغلقة
    enabled = false;
    mutedByUser = true;
    active = false;
    updateButton();
    if (!supported) return;   // لا فعّل المستمع بلا دعم
    btn.addEventListener('click', function () { onButtonClick(); });
  }

  /* عند إخفاء التبويب يختفي الصوت ناعماً ويعود عند إظهاره (إن كان مفعّلاً) */
  document.addEventListener('visibilitychange', function () {
    if (!ctx || !enabled) return;
    fadeMaster(document.hidden ? 0 : 1, AUDIO.visFadeMs);
  });

  /* ------------------------------------------------------------------
   * الواجهة العامة + الإقلاع
   * ---------------------------------------------------------------- */
  window.playChime = playChime;
  window.playWarpSound = playWarpSound;
  window.AnwaaAudio = {
    version: '3.0.0',
    supported: supported,
    toggle: function () { if (enabled) { disable(); return false; } return enable(); },
    /** هل الصوت مفعّل؟ (مصدر الحقيقة الذي تتبعه الأيقونة) */
    isActive: function () { return enabled; },
    isMuted: function () { return !enabled; },
    enable: enable,
    disable: disable
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButton, { once: true });
  } else {
    bindButton();
  }
})();
