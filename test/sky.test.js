'use strict';
/* ============================================================================
 * test/sky.test.js — اختبار محرّك sky.js عبر محاكاة DOM/Canvas بـ node:vm
 * ----------------------------------------------------------------------------
 * التشغيل:  node test/sky.test.js
 *
 * البساطة المتعمّدة هنا: يُحمَّل sky.js داخل سياق VM معزول تُزامَن فيه
 * نافذة/وثيقة/منصّات رسم مزيّفة تُسجّل مكالمات الرسم (fill/stroke/تدرّجات)
 * بحيث نتأكد أن: الشهاب يُرسم بعد 5 ثوانٍ، خطوط الأبراج تظهر وتختفي مع
 * الرحلة، سديط النقر ينفجر على السماء فقط، وتقليل الحركة يُخفّض الأثر.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SKY_PATH = path.join(__dirname, '..', 'sky.js');
const source = fs.readFileSync(SKY_PATH, 'utf8');

/* ---------- أدوات تحقّق بسيطة ---------- */
let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.log('  FAIL  ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  }
}

/* ---------- سجّال عمليات الرسم ---------- */
function makeGradient() {
  return {
    stops: [],
    addColorStop: function (offset, color) { this.stops.push([offset, String(color)]); }
  };
}

function makeTracker() {
  return { fills: [], strokes: [], fillRects: [], linearGradients: [], radialGradients: [] };
}

function makeCtx(canvas, tracker) {
  const noop = function () {};
  const ctx = {
    canvas: canvas,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    font: '10px sans-serif',
    save: noop, restore: noop, scale: noop, translate: noop, rotate: noop,
    setTransform: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, rect: noop, arc: noop, drawImage: noop,
    fill: function () {
      tracker.fills.push({ style: String(ctx.fillStyle), alpha: ctx.globalAlpha, comp: ctx.globalCompositeOperation });
    },
    stroke: function () {
      tracker.strokes.push({ style: String(ctx.strokeStyle), alpha: ctx.globalAlpha, width: ctx.lineWidth, comp: ctx.globalCompositeOperation });
    },
    fillRect: function () {
      tracker.fillRects.push({ style: String(ctx.fillStyle), alpha: ctx.globalAlpha });
    },
    createLinearGradient: function () { const g = makeGradient(); tracker.linearGradients.push(g); return g; },
    createRadialGradient: function () { const g = makeGradient(); tracker.radialGradients.push(g); return g; },
    getImageData: function (x, y, w, h) {
      return { data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h };
    },
    putImageData: noop,
    measureText: function () { return { width: 10 }; },
    setLineDash: noop
  };
  return ctx;
}

function makeCanvas(tracker) {
  const canvas = {
    id: '',
    clientWidth: 0,
    clientHeight: 0,
    width: 0,
    height: 0,
    style: {},
    setAttribute: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    getContext: function () {
      if (!canvas._ctx) canvas._ctx = makeCtx(canvas, tracker);
      return canvas._ctx;
    }
  };
  return canvas;
}

/* ---------- بُعد حدثي بسيط (window / document / matchMedia) ---------- */
function makeEventTarget() {
  const map = new Map();
  return {
    addEventListener: function (type, fn) {
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(fn);
    },
    removeEventListener: function (type, fn) {
      const arr = map.get(type) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    fire: function (type, ev) {
      const arr = (map.get(type) || []).slice();
      for (let i = 0; i < arr.length; i++) arr[i](ev || {});
    },
    listenerCount: function (type) { return (map.get(type) || []).length; }
  };
}

/* ---------- إنشاء بيئة معزولة وتحميل sky.js فيها ---------- */
function bootSandbox(opts) {
  opts = opts || {};
  const tracker = makeTracker();
  const counters = { rafRequests: 0, cancels: 0 };
  let rafCb = null;
  let now = 0;

  // الأحداث تُسجَّل على السياق نفسه: window === السياق تماماً كالمتصفح
  const events = makeEventTarget();

  const mainCanvas = makeCanvas(tracker);
  mainCanvas.id = 'skyCanvas';
  mainCanvas.clientWidth = 1280;
  mainCanvas.clientHeight = 720;

  const doc = makeEventTarget();
  doc.readyState = 'complete';
  doc.hidden = false;
  doc.getElementById = function (id) { return id === 'skyCanvas' ? mainCanvas : null; };
  doc.createElement = function () { return makeCanvas(makeTracker()); }; // منصّات مخبّأة: سجلّ مستقل
  doc.documentElement = {};
  doc.body = { insertBefore: function () {}, firstChild: null };
  doc.getComputedStyle = function () { return { getPropertyValue: function () { return ''; } }; };

  const sandbox = {
    document: doc,
    navigator: { hardwareConcurrency: 8 },
    getComputedStyle: doc.getComputedStyle,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    console: console,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener: events.addEventListener,
    removeEventListener: events.removeEventListener,
    fire: events.fire,
    listenerCount: events.listenerCount,
    matchMedia: function (query) {
      const mq = makeEventTarget();
      mq.matches = !!opts.reducedMotion;
      mq.media = query;
      return mq;
    },
    requestAnimationFrame: function (cb) { counters.rafRequests++; rafCb = cb; return counters.rafRequests; },
    cancelAnimationFrame: function () { counters.cancels++; rafCb = null; }
  };
  sandbox.window = sandbox;   // window === السياق نفسه تماماً كالمتصفح
  vm.createContext(sandbox);

  try {
    vm.runInContext(source, sandbox, { filename: 'sky.js' });
  } catch (err) {
    console.error('خطأ أثناء تحميل sky.js: ', err);
    process.exit(1);
  }

  const api = sandbox.AnwaaSky;

  return {
    api: api,
    win: sandbox,
    doc: doc,
    tracker: tracker,
    counters: counters,
    /** تحريك n إطاراً بخطوة 16.7 مللي ثانية؛ يتوقف تلقائياً بعد destroy() */
    pump: function (n) {
      let done = 0;
      for (let i = 0; i < n; i++) {
        const cb = rafCb;
        if (!cb) break;
        now += 16.7;
        rafCb = null;
        cb(now);
        done++;
      }
      return done;
    },
    pumpMs: function (ms) { return this.pump(Math.round(ms / 16.7)); }
  };
}

/* ---------- مرشّحات مشتركة ---------- */
const STARDUST_STYLES = ['rgb(247,214,143)', 'rgb(231,239,255)'];
function burstFills(tracker) {
  return tracker.fills.filter(function (f) { return STARDUST_STYLES.indexOf(f.style) !== -1; });
}
function constellationStrokes(tracker) {
  return tracker.strokes.filter(function (s) { return s.style === 'rgb(196,214,246)'; });
}
function meteorGradients(tracker) {
  return tracker.linearGradients.filter(function (g) {
    return g.stops.some(function (s) { return s[1].indexOf('255,250,235') !== -1; });
  });
}
const skyTarget = { closest: function () { return null; } };     // عنصر لا ينتمي للواجهة
const uiTarget = { closest: function () { return uiTarget; } };  // يطابق أي محدِّد

/* ---------- محاكاة Web Audio لاختبار audio.js ---------- */
function makeAudioParam(v) {
  return {
    value: v || 0,
    events: [],
    setValueAtTime: function (val, t) { this.value = val; this.events.push(['set', val, t]); },
    linearRampToValueAtTime: function (val, t) { this.value = val; this.events.push(['lin', val, t]); },
    exponentialRampToValueAtTime: function (val, t) { this.value = val; this.events.push(['exp', val, t]); },
    setTargetAtTime: function (val, t) { this.value = val; this.events.push(['tgt', val, t]); },
    cancelScheduledValues: function (t) { this.events.push(['cancel', t]); }
  };
}

function makeAudioNodeBag() {
  return {
    connections: [],
    connect: function (n) { this.connections.push(n); return n; },
    disconnect: function () {}
  };
}

function FakeAudioContext() {
  FakeAudioContext.instances.push(this);
  this.currentTime = 0;
  this.state = 'suspended';
  this.resumeCalls = 0;
  this.sampleRate = 48000;
  this.bufferSources = [];
  this.destination = makeAudioNodeBag();
  this.oscillators = [];
  this.gainNodes = [];
  this.filters = [];
  this.panners = [];
}
FakeAudioContext.instances = [];
FakeAudioContext.prototype.resume = function () { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); };
FakeAudioContext.prototype.suspend = function () { this.state = 'suspended'; return Promise.resolve(); };
FakeAudioContext.prototype.createOscillator = function () {
  const o = makeAudioNodeBag();
  o.type = 'sine';
  o.frequency = makeAudioParam(440);
  o.detune = makeAudioParam(0);
  o.onended = null;
  o.started = false;
  o.stopped = false;
  o.start = function () { this.started = true; };
  o.stop = function () { this.stopped = true; };
  this.oscillators.push(o);
  return o;
};
FakeAudioContext.prototype.createGain = function () {
  const g = makeAudioNodeBag();
  g.gain = makeAudioParam(1);
  this.gainNodes.push(g);
  return g;
};
FakeAudioContext.prototype.createBiquadFilter = function () {
  const f = makeAudioNodeBag();
  f.type = '';
  f.frequency = makeAudioParam(350);
  f.Q = makeAudioParam(1);
  this.filters.push(f);
  return f;
};
FakeAudioContext.prototype.createStereoPanner = function () {
  const p = makeAudioNodeBag();
  p.pan = makeAudioParam(0);
  this.panners.push(p);
  return p;
};
FakeAudioContext.prototype.createBuffer = function (channels, length, sampleRate) {
  return {
    channels: channels,
    length: length,
    sampleRate: sampleRate,
    data: new Float32Array(length),
    getChannelData: function () { return this.data; }
  };
};
FakeAudioContext.prototype.createBufferSource = function () {
  const src = makeAudioNodeBag();
  src.buffer = null;
  src.loop = false;
  src.started = false;
  src.stopped = false;
  src.start = function () { this.started = true; };
  src.stop = function () { this.stopped = true; };
  this.bufferSources.push(src);
  return src;
};

/* ---------- عنصر واجهة مصغّر للزر والأنماط ---------- */
function makeTinyEl(tag) {
  const listeners = new Map();
  const classes = new Set();
  return {
    tagName: String(tag).toUpperCase(),
    type: '',
    innerHTML: '',
    textContent: '',
    style: {},
    attrs: {},
    classList: {
      add: function (c) { classes.add(c); },
      remove: function (c) { classes.delete(c); },
      toggle: function (c, force) {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
      contains: function (c) { return classes.has(c); }
    },
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return this.attrs[k]; },
    addEventListener: function (t, fn) {
      if (!listeners.has(t)) listeners.set(t, []);
      listeners.get(t).push(fn);
    },
    removeEventListener: function (t, fn) {
      const a = listeners.get(t) || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    fire: function (t, ev) {
      (listeners.get(t) || []).slice().forEach(function (fn) { fn(ev || {}); });
    },
    listenerCount: function (t) { return (listeners.get(t) || []).length; }
  };
}

/* ---------- إنشاء بيئة معزولة وتحميل audio.js فيها ---------- */
function bootAudioSandbox() {
  const created = { buttons: [], styles: [], button: makeTinyEl('button') };
  created.button.classList.add('aa-sound');   // كأنه وصل من HTML بـ class="aa-sound is-off"
  created.button.classList.add('is-off');
  created.buttons.push(created.button);   // زر index.html الجاهز بالمعرف audioToggle
  const doc = makeEventTarget();
  doc.readyState = 'complete';
  doc.hidden = false;
  doc.getElementById = function (id) { return id === 'audioToggle' ? created.button : null; };
  doc.head = { children: [], appendChild: function (n) { this.children.push(n); created.styles.push(n); return n; } };
  doc.body = { children: [], appendChild: function (n) { this.children.push(n); return n; } };
  doc.createElement = function (tag) {
    if (tag === 'style') return makeTinyEl('style');
    if (tag === 'button') {
      const el = makeTinyEl('button');
      created.buttons.push(el);
      return el;
    }
    return makeTinyEl(tag);
  };

  const events = makeEventTarget();
  const sandbox = {
    document: doc,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    AudioContext: FakeAudioContext,
    addEventListener: events.addEventListener,
    removeEventListener: events.removeEventListener,
    fire: events.fire,
    listenerCount: events.listenerCount
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'audio.js'), 'utf8'), sandbox, { filename: 'audio.js' });
  } catch (err) {
    console.error('خطأ أثناء تحميل audio.js: ', err);
    process.exit(1);
  }
  return { sandbox: sandbox, doc: doc, created: created, api: sandbox.AnwaaAudio };
}



/* ======================================================================= */
console.log('\n— 1) الإقلاع والحلقة والواجهة العامة —');
const A = bootSandbox();
check('AnwaaSky مكشوف على window', !!A.api && typeof A.api.setTalea === 'function');
check('الإصدار 1.3.0', A.api && A.api.version === '1.3.0', A.api && A.api.version);
A.pump(10);
check('الحلقة تعمل بـ requestAnimationFrame', A.counters.rafRequests > 5, A.counters.rafRequests);
const statsA = A.api.stats();
check('النجوم مبنية (≥250)', statsA.stars >= 250, JSON.stringify(statsA));
check('fps محسوب', statsA.fps > 0 && statsA.fps <= 120, statsA.fps);
const gw = A.api.getWeather();
check('getWeather يعيد شكله المعتاد', !!(gw && gw.key && gw.now && gw.pulse !== undefined));

console.log('\n— 2) الشهاب: يظهر بعد 5 ثوانٍ بذيل متدرّج —');
const B = bootSandbox();
B.pumpMs(5300);
check('شهاب مرسوم بتدرّج خاص به', meteorGradients(B.tracker).length >= 1, meteorGradients(B.tracker).length);

console.log('\n— 3) خطوط الأبراج: تظهر بعد setTalea ثم تخفي مع الرحلة وتعود —');
const C = bootSandbox();
C.pump(30);
C.api.setTalea({ name: 'الثريا', season: 'الوسم' });
C.tracker.strokes.length = 0;
C.tracker.fills.length = 0;
C.pump(90);
const cs1 = constellationStrokes(C.tracker);
check('خطوط الأبراج تُرسم', cs1.length > 0, cs1.length);
check('تُرسم بمزج ضوئي lighter', cs1.every(function (s) { return s.comp === 'lighter'; }));
check('شدّتها خافتة حتى القيمة القصوى', cs1.every(function (s) { return s.alpha > 0 && s.alpha < 0.16; }),
  cs1.length ? Math.max.apply(null, cs1.map(function (s) { return s.alpha; })) : 'لا شيء');
check('تستقر قرب شدّتها العليا', cs1.some(function (s) { return s.alpha > 0.12; }));
const cg1 = C.tracker.fills.filter(function (f) { return f.style === 'rgb(196,214,246)'; });
check('توهّج العقد يُرسم', cg1.length > 0, cg1.length);
check('توهّج العقد مضبوط ≤ 0.55', cg1.every(function (f) { return f.alpha <= 0.55; }));

// الرصد: التوهج يتلاشى وسط الرحلة
C.tracker.strokes.length = 0;
C.api.observe();
C.pump(100);  // ≈1670 من أصل 2000 مللي ثانية — الرحلة ما زالت جارية
const cs2 = constellationStrokes(C.tracker);
const half2 = cs2.slice(Math.floor(cs2.length / 2));
check('الأبراج تخفت أثناء الرحلة', half2.length > 0 && half2.every(function (s) { return s.alpha < 0.05; }),
  half2.length ? half2[half2.length - 1].alpha : 'لا شيء');

// بعد الرحلة: تعود تدريجياً
C.tracker.strokes.length = 0;
C.pump(70);   // الرحلة تنتهي عند ~120 إطاراً ثم يبدأ الظهور من جديد
const cs3 = constellationStrokes(C.tracker);
check('الأبراج تعود بعد الرحلة', cs3.length > 0 && cs3[cs3.length - 1].alpha > 0.08,
  cs3.length ? cs3[cs3.length - 1].alpha : 'لا شيء');
C.api.release();
C.pump(90);

console.log('\n— 4) سديط النقر: انفجار على السماء فقط —');
const D = bootSandbox();
D.pump(30);
D.tracker.fills.length = 0;
D.win.fire('pointerdown', { clientX: 640, clientY: 360, button: 0, isPrimary: true, target: skyTarget });
D.pump(1);
const burst1 = burstFills(D.tracker);
check('انفجار كامل = 22 جزيئاً + ومضة', burst1.length === 23, burst1.length);
check('المزج ضوئي lighter', burst1.every(function (f) { return f.comp === 'lighter'; }));
check('الشفافية ضمن (0..1]', burst1.every(function (f) { return f.alpha > 0 && f.alpha <= 1; }));

// نقر فوق عنصر واجهة: بلا انفجار (بعد انتهاء جزيئات اللقطة السابقة)
D.pumpMs(2200);
D.tracker.fills.length = 0;
D.win.fire('pointerdown', { clientX: 100, clientY: 100, button: 0, isPrimary: true, target: uiTarget });
D.pump(1);
check('لا انفجار فوق عناصر الواجهة', burstFills(D.tracker).length === 0, burstFills(D.tracker).length);

// زر الفأرة الأيمن: بلا انفجار
D.tracker.fills.length = 0;
D.win.fire('pointerdown', { clientX: 100, clientY: 100, button: 2, isPrimary: true, target: skyTarget });
D.pump(1);
check('لا انفجار بزر الفأرة الأيمن', burstFills(D.tracker).length === 0, burstFills(D.tracker).length);

// الذرات تتلاشى كلياً بعد انتهاء أعمارها
D.tracker.fills.length = 0;
D.pump(4);
check('لا جزيئات باقية بعد انقضاء أعمارها', burstFills(D.tracker).length === 0, burstFills(D.tracker).length);

console.log('\n— 5) أثناء الرحلة: لا سديط —');
const E = bootSandbox();
E.pump(5);
E.api.observe();
E.tracker.fills.length = 0;
E.win.fire('pointerdown', { clientX: 400, clientY: 300, button: 0, isPrimary: true, target: skyTarget });
E.pump(1);
check('لا انفجار أثناء رحلة التقريب', burstFills(E.tracker).length === 0, burstFills(E.tracker).length);

console.log('\n— 6) prefers-reduced-motion: بلا شهاب وبسديط مخفّض —');
const F = bootSandbox({ reducedMotion: true });
F.pumpMs(13000);
check('لا شهاب مع تقليل الحركة', meteorGradients(F.tracker).length === 0, meteorGradients(F.tracker).length);
F.tracker.fills.length = 0;
F.win.fire('pointerdown', { clientX: 500, clientY: 400, button: 0, isPrimary: true, target: skyTarget });
F.pump(1);
const burstF = burstFills(F.tracker);
check('انفجار مخفّض = 8 + ومضة', burstF.length === 9, burstF.length);

console.log('\n— 7) destroy() يوقف الحلقة ويزيل الأحداث —');
const beforeReq = A.counters.rafRequests;
A.api.destroy();
A.pump(5);
check('الحلقة تتوقف بعد destroy', A.counters.rafRequests === beforeReq, A.counters.rafRequests);
check('كل المستمعين أُزيلوا', A.win.listenerCount('pointerdown') === 0 &&
  A.win.listenerCount('resize') === 0, A.win.listenerCount('pointerdown'));
A.tracker.fills.length = 0;
A.win.fire('pointerdown', { clientX: 10, clientY: 10, button: 0, isPrimary: true, target: skyTarget });
A.pump(1);
check('لا استجابة لنقرة بعد destroy', burstFills(A.tracker).length === 0, burstFills(A.tracker).length);

/* ---------- سيناريو audio.js: غير متزامن لانتظار await استئناف السياق ---------- */
runAudioScenario().then(printSummary).catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});

function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

async function runAudioScenario() {
  console.log('\n— 8) audio.js: تفعيل صارم عبر زر الزاوية + رنين البلور —');

  // فحوص ثابتة على ربط index.html وsky.js وaudio.js وapp.js
  const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const skySrc2 = fs.readFileSync(path.join(__dirname, '..', 'sky.js'), 'utf8');
  const audioSrc = fs.readFileSync(path.join(__dirname, '..', 'audio.js'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  check('audio.js بلا ملفات صوتية خارجية', !/new Audio\(|\.mp3|\.wav|\.ogg|fetch\(/.test(audioSrc));
  check('index.html يحمل معرف زر الصوت audioToggle', htmlSrc.indexOf('id="audioToggle"') !== -1);
  check('style.css يضمّ أنماط حالات الزر', cssSrc.indexOf('.aa-sound') !== -1);
  check('index.html يربط style.css عبر link', htmlSrc.indexOf('href="style.css"') !== -1);
  check('تنظيف: لا style مضمّن في index.html', htmlSrc.indexOf('<style>') === -1 &&
    htmlSrc.indexOf('</style>') === -1);
  check('تنظيف: لا سكربت منطق مضمّن في index.html', htmlSrc.indexOf('<script>') === -1);
  check('index.html يربط audio.js', htmlSrc.indexOf('src="audio.js"') !== -1);
  check('index.html يربط app.js (منطق الواجهة)', htmlSrc.indexOf('src="app.js"') !== -1);
  check('app.js يستدعي playChime عند اختيار الطالع', appSrc.indexOf('window.playChime()') !== -1);
  check('sky.js يستدعي playChime مع النثار', skySrc2.indexOf('window.playChime()') !== -1);
  check('index.html يضمّ زر مشاركة الطالع', htmlSrc.indexOf('id="shareBtn"') !== -1);
  check('index.html يضمّ نافذة النبذة الزجاجية', htmlSrc.indexOf('id="infoModal"') !== -1 &&
    htmlSrc.indexOf('info-sheet') !== -1);
  check('index.html يضمّ إشعار النسخ بنجاح', htmlSrc.indexOf('id="toast"') !== -1 &&
    appSrc.indexOf('تم النسخ بنجاح') !== -1);
  check('index.html يربط زر النبذة بمنطقه', htmlSrc.indexOf('id="infoBtn"') !== -1 &&
    appSrc.indexOf('openInfoModal') !== -1);
  check('تنظيف: لا أثر لمكتبة html2canvas غير المستخدمة', htmlSrc.indexOf('html2canvas') === -1 &&
    appSrc.indexOf('html2canvas') === -1);
  check('index.html يضمّ زر حفظ البطاقة كصورة', htmlSrc.indexOf('id="saveImgBtn"') !== -1);
  check('ستوري 1080×1920 + canShare + تنزيل PNG', appSrc.indexOf('STORY_W = 1080') !== -1 &&
    appSrc.indexOf('STORY_H = 1920') !== -1 && appSrc.indexOf('navigator.canShare') !== -1 &&
    appSrc.indexOf('.png') !== -1);
  check('app.js يستدعي playWarpSound مع زر الرصد', appSrc.indexOf('playWarpSound()') !== -1);

  console.log('\n— 9) anwaa.js: البحث الفلكي + التحويل الهجري —');

  // البحث والتحويل يُحمَّلان في سياق معزول (توابعهما عامة بلا DOM)
  const anwaaSrc = fs.readFileSync(path.join(__dirname, '..', 'anwaa.js'), 'utf8');
  const anwaaBox = {};
  vm.createContext(anwaaBox);
  vm.runInContext(anwaaSrc + '\nthis.anwaaList = anwaaList; this.anwaaSeasons = anwaaSeasons;',
    anwaaBox, { filename: 'anwaa.js' });

  check('findTalea يجد الطالع باسمه', (anwaaBox.findTalea('الطرفة') || {}).season === 'سهيل');
  check('findTalea يتجاوز التشكيل (الثُّرَيَّا)',
    (anwaaBox.findTalea('الثُّرَيَّا') || {}).name === 'الثريا');
  check('findTalea بلا مطابقة يعيد null', anwaaBox.findTalea('zzzـ') === null);
  check('تنظيف: حُذفت الدوال المهجورة (بحث/تقدم الموسم)',
    anwaaBox.searchTales === undefined && anwaaBox.getSeasonProgress === undefined &&
    anwaaBox.anwaaDayKey === undefined);

  // خوارزمية الكويت: 1 رمضان 1447هـ ≈ 18 فبراير 2026م (± يوم مقبول)
  const hDate = anwaaBox.hijriToGregorian(1447, 9, 1);
  // ملاحظة: instanceof يعبر سياقات vm يفشل، لذا نتحقق عبر toString
  const hOk = Object.prototype.toString.call(hDate) === '[object Date]' && !isNaN(hDate.getTime()) &&
    hDate.getFullYear() === 2026 && hDate.getMonth() === 1 &&
    hDate.getDate() >= 17 && hDate.getDate() <= 19;
  check('hijriToGregorian: رمضان 1447 ≈ فبراير 2026', hOk, hDate);
  check('hijriToGregorian يرفض شهراً 13', anwaaBox.hijriToGregorian(1447, 13, 1) === null);
  check('hijriToGregorian يرفض يوماً 31', anwaaBox.hijriToGregorian(1447, 9, 31) === null);
  // الطالع لذلك التاريخ: المربعانية/الشبط (شتاء) لا سهيل
  const hTalea = hDate ? anwaaBox.getCurrentTalea(hDate) : null;
  check('طالع رمضان 1447 شتوي (لا سهيل)', !!hTalea && hTalea.season !== 'سهيل', hTalea && hTalea.name + '/' + hTalea.season);

  console.log('\n— 10) weather.js: Open-Meteo + المقارنة البلاغية —');
  const weatherSrc = fs.readFileSync(path.join(__dirname, '..', 'weather.js'), 'utf8');
  const wBox = {
    window: {},
    navigator: {},
    fetch: function () { return Promise.reject(new Error('offline')); }
  };
  wBox.window = wBox;
  vm.createContext(wBox);
  vm.runInContext(weatherSrc, wBox, { filename: 'weather.js' });
  check('AnwaaWeather مكشوف (fetchLive/describe/versus/cities)',
    !!(wBox.AnwaaWeather && wBox.AnwaaWeather.fetchLive && wBox.AnwaaWeather.describe &&
      wBox.AnwaaWeather.versus && wBox.AnwaaWeather.cities && wBox.AnwaaWeather.setCity &&
      wBox.AnwaaWeather.locate));
  check('describe(0) سماء صافية', wBox.AnwaaWeather.describe(0) === 'سماء صافية', wBox.AnwaaWeather.describe(0));
  check('describe(95) رعد', wBox.AnwaaWeather.describe(95) === 'رعد', wBox.AnwaaWeather.describe(95));
  const coldTalea = { name: 'النعائم', proverb: 'ابيضت البهائم من الصقيع الدائم' };
  const hotLive = { tempC: 34, label: 'سماء صافية', code: 0 };
  const line = wBox.AnwaaWeather.versus(coldTalea, hotLive);
  check('versus تربط الصقيع بحرّ اليوم', /الصقيع/.test(line) && /34/.test(line), line.slice(0, 60));
  check('versus بلا طقس يعيد فراغاً', wBox.AnwaaWeather.versus(coldTalea, null) === '');
  const offline = await wBox.AnwaaWeather.fetchLive({ cache: false });
  check('fetchLive دون شبكة يعيد null (لا يرمي)', offline === null);

  console.log('\n— 10.b) الطقس: لا طلب إذن موقع تلقائي + قائمة مدن —');
  check('تنظيف: الصفحة لا تملك أي طلب موقع تلقائي في مسار الإقلاع',
    weatherSrc.indexOf('geolocation') !== -1 &&
    weatherSrc.indexOf('function locate()') !== -1);
  // لا يُستدعى getCurrentPosition فعلياً إلا داخل locate() — أي بالاختيار اليدوي وحده
  const geoCallSites = (weatherSrc.match(/navigator\.geolocation\.getCurrentPosition\(/g) || []).length;
  check('نداء getCurrentPosition الفعلي واحد (داخل locate اليدوية)', geoCallSites === 1, geoCallSites);
  check('دالة locate غير مُستدعاة في مسار الجلب التلقائي',
    /function fetchLive[\s\S]*?\n  }/.test(weatherSrc) &&
    !/function fetchLive[\s\S]{0,600}locate\(\)/.test(weatherSrc));
  check('app.js لا يستدعي locate عند الإقلاع',
    !/refreshLiveWeather\(\);[\s\S]{0,80}locate\(/.test(appSrc) &&
    appSrc.indexOf('el.geoBtn.addEventListener') !== -1);
  check('app.js يطلب الموقع من زر داخلي فقط',
    /function useMyLocation/.test(appSrc) && appSrc.indexOf('AnwaaWeather.locate()') !== -1);

  const cities = wBox.AnwaaWeather.cities();
  check('قائمة المدن متاحة وغير فارغة', Array.isArray(cities) && cities.length >= 10, cities.length);
  const def = wBox.AnwaaWeather.getCity();
  check('المدينة الافتراضية هي الرياض بلا إذن',
    def && def.name === 'الرياض' && def.lat > 24 && def.lat < 25, def && def.name);
  const switched = wBox.AnwaaWeather.setCity('makkah');
  check('setCity تبدّل المدينة بالإحداثيات الصحيحة',
    switched && switched.name === 'مكة المكرمة' && Math.round(switched.lat) === 21, switched && switched.name);
  check('setCity بمعرّف غير موجود تعيد null', wBox.AnwaaWeather.setCity('nowhere') === null);
  check('windDirection يرجم الاتجاهات العربية',
    wBox.AnwaaWeather.windDirection(0) === 'شمالية' &&
    wBox.AnwaaWeather.windDirection(180) === 'جنوبية' &&
    wBox.AnwaaWeather.windDirection(90) === 'شرقية', wBox.AnwaaWeather.windDirection(90));
  check('windDirection تتعامل مع قيم غائبة', wBox.AnwaaWeather.windDirection(null) === null);

  console.log('\n— 10.c) دليل الطالع العملي وزاوية الرصد —');
  let guideBad = [];
  let sightBad = [];
  anwaaBox.anwaaList.forEach(function (t) {
    if (!t.farm || t.farm.length < 15) guideBad.push(t.name + '/farm');
    if (!t.life || t.life.length < 15) guideBad.push(t.name + '/life');
    if (!t.sight || t.sight.length < 15) sightBad.push(t.name);
  });
  check('كل طالع يحمل دليل زراعة وغرس', guideBad.length === 0, guideBad.join(', '));
  check('كل طالع يحمل نمط حياة ومناخ', guideBad.length === 0);
  check('كل طالع يحمل زاوية رصد', sightBad.length === 0, sightBad.join(', '));
  const coldT = anwaaBox.findTalea('النعائم');
  check('دليل النعائم يذكر احتراز الصقيع', /صقيع|الصقيع|برودة/.test(coldT.life + coldT.farm), coldT.life.slice(0, 50));

  console.log('\n— 10.c) نافذة النبذة وويدجت الطقس ودليل الطالع —');
  check('زر المدينة في الزاوية العلوية', htmlSrc.indexOf('id="cityBtn"') !== -1 &&
    htmlSrc.indexOf('id="cityBtnName"') !== -1 && htmlSrc.indexOf('class="city-picker"') !== -1);
  check('قائمة المدن + خيار تحديد الموقع الداخلي الاختياري',
    htmlSrc.indexOf('id="cityMenu"') !== -1 && htmlSrc.indexOf('id="cityList"') !== -1 &&
    htmlSrc.indexOf('id="geoBtn"') !== -1 && htmlSrc.indexOf('حدّد موقعي تلقائياً') !== -1 &&
    htmlSrc.indexOf('يُطلب إذن الموقع فقط') !== -1);
  check('ويدجت الطقس: المدينة والشرائح والرابط وزاوية الرصد',
    htmlSrc.indexOf('id="weatherWidget"') !== -1 && htmlSrc.indexOf('id="wwCity"') !== -1 &&
    htmlSrc.indexOf('id="wwChips"') !== -1 && htmlSrc.indexOf('id="liveWeather"') !== -1 &&
    htmlSrc.indexOf('id="wwSight"') !== -1 && htmlSrc.indexOf('زاوية الرصد') !== -1);
  check('قسم «دليل الطالع العملي» بنقطتيه',
    htmlSrc.indexOf('دليل الطالع العملي') !== -1 && htmlSrc.indexOf('id="agroFarm"') !== -1 &&
    htmlSrc.indexOf('id="agroLife"') !== -1 && htmlSrc.indexOf('الزراعة والغرس') !== -1 &&
    htmlSrc.indexOf('نمط الحياة والمناخ') !== -1);
  check('نافذة النبذة تحمل الدليل العملي وزاوية الرصد',
    htmlSrc.indexOf('id="infoFarm"') !== -1 && htmlSrc.indexOf('id="infoLife"') !== -1 &&
    htmlSrc.indexOf('id="infoSight"') !== -1 && appSrc.indexOf('infoSight') !== -1);
  check('app.js يعرض شرائح الحرارة والرياح',
    appSrc.indexOf('renderWeatherChips') !== -1 && appSrc.indexOf('كم/س') !== -1 &&
    appSrc.indexOf('مئوية') !== -1);

  /* ---- حصر الطقس اللحظي على طالع اليوم فقط ---- */
  check('حالة صريحة تحكم إظهار الطقس اللحظي',
    /var isTodayTalea = true;/.test(appSrc) &&
    appSrc.indexOf('function setWeatherVisibility') !== -1);
  check('الإظهار/الإخفاء يضبطان hidden و aria-hidden معاً',
    /el\.weatherWidget\.hidden = !show/.test(appSrc) &&
    /setAttribute\('aria-hidden', show \? 'false' : 'true'\)/.test(appSrc));
  check('الطقس يُعرض بشرط isTodayTalea داخل renderTalea',
    /setWeatherVisibility\(isTodayTalea\)/.test(appSrc) &&
    /if \(isTodayTalea\) \{[\s\S]{0,90}renderLiveWeather\(\)/.test(appSrc));
  check('شرائح الحرارة والرياح لا تُبنى لغير طالع اليوم',
    /if \(isTodayTalea\) \{[\s\S]{0,140}renderWeatherChips\(\)/.test(appSrc));
  check('زاوية الرصد تُكتب دائماً خارج شرط الطقس',
    /el\.wwSight\.textContent = talea\.sight[\s\S]{0,220}setWeatherVisibility\(isTodayTalea\)/.test(appSrc));
  check('دليل الطالع يُكتب دائماً (زراعة + مناخ)',
    /el\.agroFarm\.textContent = talea\.farm/.test(appSrc) &&
    /el\.agroLife\.textContent = talea\.life/.test(appSrc));
  check('زر «ارصُد طالع الليلة» يعيد العرض إلى طالع اليوم ثم يرصد',
    /function observeToday/.test(appSrc) &&
    /el\.observeBtn\.addEventListener\('click', observeToday\)/.test(appSrc) &&
    /function observeToday\(\) \{[\s\S]{0,260}paintTalea\(currentToday, true\)/.test(appSrc));
  check('لا ظلّ لمتغير محلي يُخفي حالة الطقس',
    !/var isTodayTalea = isCurrentSeason/.test(appSrc));
  check('زاوية الرصد خارج ويدجت الطقس في البنية (تبقى عند إخفائه)',
    /<\/div>\s*<!-- زاوية رصد النجم/.test(htmlSrc) &&
    htmlSrc.indexOf('ww-sight-standalone') !== -1);
  check('style.css يضمن إخفاء الويدجت بـ hidden',
    cssSrc.indexOf('.weather-widget[hidden]') !== -1 &&
    cssSrc.indexOf('.ww-sight-standalone') !== -1);

  /* ---- تحسين 1: انتقال موحّد بين الطوالع ---- */
  check('انتقال المحتوى: تلاشٍ قبل الكتابة وpaintTalea منفصلة',
    /function paintTalea/.test(appSrc) && /function renderTalea/.test(appSrc) &&
    /body\.classList\.add\('is-swapping'\)/.test(appSrc) &&
    /SWAP_MS = 180/.test(appSrc));
  check('الطالع نفسه يُكتب مباشرة بلا تلاشٍ',
    /activeTalea && activeTalea\.name === talea\.name[\s\S]{0,120}paintTalea/.test(appSrc));
  check('الرصد يلغي أي انتقال معلّق (لا طبقتي حركة)',
    /function observeToday[\s\S]{0,200}clearTimeout\(swapTimer\)/.test(appSrc));
  check('CSS ينسّق انتقال الطوالع ويحترم تقليل الحركة',
    cssSrc.indexOf('body.is-swapping') !== -1 &&
    /prefers-reduced-motion[\s\S]{0,900}is-swapping/.test(cssSrc));

  /* ---- تحسين 2: استجابة الجوال ---- */
  check('أزرار البطاقة: touch-action ومنع تحديد النص',
    cssSrc.indexOf('touch-action: manipulation') !== -1 &&
    cssSrc.indexOf('-webkit-user-select: none') !== -1);
  check('شريط المواسم: منع تمرير الصفحة عند التجاوز',
    cssSrc.indexOf('overscroll-behavior-x: contain') !== -1 &&
    cssSrc.indexOf('touch-action: pan-x') !== -1);

  /* ---- تحسين 3: خفض الإطارات في الخمول ---- */
  check('sky.js يخفض الإطارات في الخمول (idleFrameMs)',
    /idleFrameMs: 33/.test(skySrc2) && /idleDelayMs: 1400/.test(skySrc2));
  check('عدّاد الرسم منفصل عن زمن الحركة (لا تجميد للحركة)',
    /lastDraw: 0/.test(skySrc2) &&
    /if \(now - state\.lastDraw < state\.minFrameMs\) return;/.test(skySrc2));
  check('إيقاظ المحرّك عند التفاعل (مؤشر/نقر/رحلة)',
    /function wakeNow/.test(skySrc2) &&
    /bind\(window, 'pointermove', function \(e\) \{ wakeNow\(\)/.test(skySrc2) &&
    /function startWarp\(dir\) \{[\s\S]{0,80}wakeNow\(\)/.test(skySrc2));
  check('لا خفض أثناء الرحلة أو الشهاب أو النثار',
    /if \(state\.warp\.active \|\| state\.meteor\.active \|\| stardustLive\(\)\) return;/.test(skySrc2));
  check('انحدار: مخزون السديط موجود دائماً فلا يُستخدم كشرط خفض',
    !/state\.stardust\.pool\) return;/.test(skySrc2) &&
    /function stardustLive\(\)/.test(skySrc2) &&
    /if \(pool\[i\]\.on\) return true;/.test(skySrc2));

  /* ---- تحسين 4: دقة المؤثرات الصوتية ---- */
  check('الرنين أخفّ وأقصر مع فاصل أطول',
    /decay: 1\.15/.test(audioSrc) && /minGapMs: 180/.test(audioSrc) &&
    /gain: 0\.7/.test(audioSrc));
  check('مستوى الرنين يطبّق الكسب الخفيف',
    /const level = C\.gain \|\| 1/.test(audioSrc) &&
    /linearRampToValueAtTime\(p\[1\] \* level/.test(audioSrc));
  check('تقليل الحركة يُسكّت الرنين النغمي',
    /function prefersLessMotion/.test(audioSrc) &&
    /if \(prefersLessMotion\(\)\) return;/.test(audioSrc));
  check('الصوت يبقى مكتوماً افتراضياً بعد التعديلات',
    /let enabled = false;/.test(audioSrc) && /let mutedByUser = true;/.test(audioSrc));
  check('بطاقة الستوري تحمل الدليل العملي (بلا إيموجي)',
    appSrc.indexOf('دليل الطالع العملي') !== -1 &&
    /bezierCurveTo\(sx, sy - 4/.test(appSrc) &&
    !/['"]\s*\\uD83C|🌱/.test(appSrc));

  /* ---- نظام الأيقونات الخطية: لا إيموجي ملوّنة في المشروع ----
     نقتصر على الإيموجي الملوّنة (نطاقات U+1F300 وما فوقها وU+2600..U+27BF)،
     ولا نحسب الرموز الطباعية أحادية اللون (✦ ✧ ☾ ✓)، فهي جزء من هوية أنواء. */
  const EMOJI_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|\uD83C[\uDC00-\uDFFF]|\u2600-\u27BF[\uFE0F]?/g;
  const ALLOWED_GLYPHS = ['✦', '✧', '☾', '✓', '‹', '›', '×', '→', '←', '•', '—', '–', '·'];
  const emojiHits = [];
  for (const pair of [['index.html', htmlSrc], ['app.js', appSrc],
    ['style.css', cssSrc], ['anwaa.js', anwaaSrc], ['audio.js', audioSrc],
    ['sky.js', skySrc2], ['weather.js', weatherSrc]]) {
    const found = (pair[1].match(EMOJI_RE) || [])
      .filter((ch) => ALLOWED_GLYPHS.indexOf(ch) === -1);
    if (found.length) emojiHits.push(pair[0] + ':' + found.join(''));
  }
  check('لا إيموجي ملوّنة في أي ملف من المشروع', emojiHits.length === 0, emojiHits.join(' | '));
  check('الرموز الطباعية التراثية (✦ ✧ ☾) باقية بهويتها',
    appSrc.indexOf("'✦ ✦ ✦'") !== -1 && htmlSrc.indexOf('✧') !== -1);
  check('مجموعة أيقونات SVG خطية معرّفة (sprout/coat/scope)',
    /var SVG = \{/.test(appSrc) && /sprout:/.test(appSrc) &&
    /coat:/.test(appSrc) && /scope:/.test(appSrc));
  check('أيقونات SVG خطية بلا تعبئة وبـ currentColor',
    /fill="none" stroke="currentColor"/.test(appSrc) && /stroke-width="1\.6"/.test(appSrc));
  check('أيقونات المواسم أصبحت مفاتيح SVG لا إيموجي',
    /'سهيل': 'star'/.test(appSrc) &&
    !/'سهيل': '✦'/.test(appSrc) && !/🌧|❄|❅|💧/.test(appSrc));
  check('دالة svgIcon تولّد أيقونة قابلة للإدراج',
    /function svgIcon\(name, cls\)/.test(appSrc) &&
    /viewBox="0 0 24 24"/.test(appSrc) && /focusable="false"/.test(appSrc));
  check('index.html يستخدم أيقونات SVG في الدليل والوصف',
    htmlSrc.indexOf('class="agro-icon" viewBox="0 0 24 24"') !== -1 &&
    htmlSrc.indexOf('class="info-li-icon" viewBox="0 0 24 24"') !== -1 &&
    !/class="agro-icon"[^>]*>🌱/.test(htmlSrc));
  check('CSS يعطي الأيقونات قياساً دقيقاً ومحاذاة رأسية',
    /\.agro-icon \{[\s\S]{0,200}width: 17px[\s\S]{0,140}height: 17px/.test(cssSrc) &&
    cssSrc.indexOf('vertical-align: middle') !== -1);
  check('لون الأيقونات عاجيّ ترابي يتتبّع الهوية',
    (cssSrc.match(/stroke: #c4b595/g) || []).length >= 3);

  /* ---- وسوم المشاركة الاجتماعية (OpenGraph) وأيقونة الموقع ---- */
  check('og:title بالنص المطلوب',
    /<meta property="og:title" content="أنواء \| مَطَالِعُ النُّجُومِ وَقَوَاسِمُ الأَرْضِ">/.test(htmlSrc));
  check('og:description بالنص المطلوب',
    /<meta property="og:description" content="دليل تفاعلي يرصد طوالع النجوم ومواقيتها التراثية في سماء الجزيرة العربية، مع دليل الزراعة والمناخ اللحظي\.">/.test(htmlSrc));
  check('og:type = website',
    /<meta property="og:type" content="website">/.test(htmlSrc));
  check('twitter:card = summary_large_image',
    /<meta name="twitter:card" content="summary_large_image">/.test(htmlSrc));
  check('وسوم Twitter المساعدة (title/description)',
    /<meta name="twitter:title" content="أنواء/.test(htmlSrc) &&
    /<meta name="twitter:description" content="دليل تفاعلي/.test(htmlSrc));
  check('بيانات إضافية: og:locale و og:site_name',
    /<meta property="og:locale" content="ar_AR">/.test(htmlSrc) &&
    /<meta property="og:site_name" content="أَنْوَاء">/.test(htmlSrc));
  check('أيقونة الموقع SVG مدمجة (data-URI بلا طلب شبكة)',
    /<link rel="icon" href="data:image\/svg\+xml,[^"]*%3Csvg/.test(htmlSrc));
  check('أيقونة apple-touch-iicon للخدمات على الجوال',
    /<link rel="apple-touch-icon" href="data:image\/svg\+xml/.test(htmlSrc));
  check('أيقونة الموقع نجمة فلكية خطية بلون ذهبي وخلفية فضائية',
    htmlSrc.indexOf("stroke='%23e5b967'") !== -1 &&   // #e5b967
    htmlSrc.indexOf("fill='%23040714'") !== -1 &&      // #040714
    htmlSrc.indexOf("stroke-width='1.8'") !== -1 &&
    htmlSrc.indexOf("fill='none'") !== -1);
  check('لون الواجهة يوافق لون الخلفية الفعلي (#040714)',
    /<meta name="theme-color" content="#040714">/.test(htmlSrc) &&
    /--bg-space: #040714;/.test(cssSrc));
  check('style.css ينسّق المدينة والويدجت والدليل',
    cssSrc.indexOf('.city-btn') !== -1 && cssSrc.indexOf('.city-menu') !== -1 &&
    cssSrc.indexOf('.city-item') !== -1 && cssSrc.indexOf('.city-geo') !== -1 &&
    cssSrc.indexOf('.weather-widget') !== -1 && cssSrc.indexOf('.ww-chip') !== -1 &&
    cssSrc.indexOf('.agro-guide') !== -1 && cssSrc.indexOf('.agro-icon') !== -1);
  check('تنظيف: لا بقايا لمتغير الطقس القديم', appSrc.indexOf('liveWeatherEl') === -1);

  console.log('\n— 11) index.html + app.js: نافذة التاريخ + الطقس المباشر —');
  check('زر طالع تاريخ معيّن بجانب زر الرصد', htmlSrc.indexOf('id="dateBtn"') !== -1 &&
    htmlSrc.indexOf('طالع تاريخ معيّن') !== -1);
  check('نافذة التقويم مخصصة (بلا حقل تاريخ أصلي)', htmlSrc.indexOf('id="dateModal"') !== -1 &&
    htmlSrc.indexOf('id="calGrid"') !== -1 && htmlSrc.indexOf('type="date"') === -1 &&
    htmlSrc.indexOf('id="searchHijriD"') === -1 && htmlSrc.indexOf('id="searchInput"') === -1);
  check('تبديل التقويم: ميلادي/هجري بأزرار تبويب', htmlSrc.indexOf('id="calTabGreg"') !== -1 &&
    htmlSrc.indexOf('id="calTabHijri"') !== -1 && appSrc.indexOf('calSetMode(') !== -1);
  check('بناء الشبكة برمجيا مع تنقّل الشهور وتحويل أم القرى',
    appSrc.indexOf('renderCalendar(') !== -1 && htmlSrc.indexOf('id="calPrev"') !== -1 &&
    htmlSrc.indexOf('id="calNext"') !== -1 && appSrc.indexOf('hijriMonthStart(') !== -1);
  check('رأس التقويم: قائمتان منسدلتان للشهر والسنة + سهمان',
    htmlSrc.indexOf('id="calMonthSelect"') !== -1 && htmlSrc.indexOf('id="calYearSelect"') !== -1 &&
    htmlSrc.indexOf('cal-select-chevron') !== -1 && appSrc.indexOf('syncCalendarPickers') !== -1 &&
    appSrc.indexOf('CAL_YEAR_MIN') !== -1 && appSrc.indexOf('calSelectYear') !== -1);
  check('style.css ينسّق القائمتين الزجاجيتين', cssSrc.indexOf('.cal-select') !== -1 &&
    cssSrc.indexOf('.cal-pickers') !== -1 && cssSrc.indexOf('.cal-select-chevron') !== -1 &&
    cssSrc.indexOf('appearance: none') !== -1);
  check('الاختيار يغلق النافذة ويحدّث السماء والبطاقة', appSrc.indexOf('jumpToDateTalea(') !== -1 &&
    appSrc.indexOf('sky.setTalea') !== -1 && appSrc.indexOf('closeDateModal()') !== -1);
  check('سطر الطقس liveWeather موجود', htmlSrc.indexOf('id="liveWeather"') !== -1);
  check('نافذة التقويم تُفتح من الزر', htmlSrc.indexOf('id="dateBtn"') !== -1 &&
    appSrc.indexOf('openDateModal(') !== -1);
  check('سطر الطقس يستخدم versus()', appSrc.indexOf('AnwaaWeather.versus(') !== -1);
  check('الطقس يُجلب عند الإقلاع مع fallback', appSrc.indexOf('AnwaaWeather.fetchLive(') !== -1 &&
    appSrc.indexOf('المثل الشعبي يكفي الليلة') !== -1);
  check('طلب الموقع يدوي ومحصور في locate() بweather.js',
    weatherSrc.indexOf('function locate()') !== -1 &&
    weatherSrc.indexOf('navigator.geolocation') !== -1);
  check('style.css ينسّق النافذة والتقويم والطقس', cssSrc.indexOf('.date-modal') !== -1 &&
    cssSrc.indexOf('.date-btn') !== -1 && cssSrc.indexOf('.cal-grid') !== -1 &&
    cssSrc.indexOf('.cal-day') !== -1 && cssSrc.indexOf('.cal-tab') !== -1 &&
    cssSrc.indexOf('.live-weather') !== -1 && cssSrc.indexOf('.hero-actions') !== -1);
  check('زر التاريخ يشارك زر الرصد الصنف والتوهّج',
    htmlSrc.indexOf('class="observe-btn date-btn"') !== -1 &&
    cssSrc.indexOf('hero-glow') !== -1);
  check('تنظيف: لا بقايا لشريط البحث القديم', cssSrc.indexOf('.search-bar') === -1 &&
    cssSrc.indexOf('.search-suggest') === -1 && htmlSrc.indexOf('search-wrap') === -1 &&
    appSrc.indexOf('searchTales(') === -1);

  /* ---------- تشغيل فعلي لتقويم النافذة المخصص (استخراج الكود من app.js) ---------- */
  function hasCalClass(el, c) { return String(el.className).split(/\s+/).indexOf(c) !== -1; }
  function makeCalEl(tag) {
    const el = {
      tag: tag, children: [], textContent: '', className: '', attrs: {}, _html: '',
      classList: {
        add: function (c) { if (!hasCalClass(el, c)) el.className = (el.className + ' ' + c).trim(); },
        remove: function (c) { el.className = el.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(' '); },
        toggle: function (c, on) { if (on) this.add(c); else this.remove(c); },
        contains: function (c) { return hasCalClass(el, c); }
      },
      setAttribute: function (k, v) { el.attrs[k] = String(v); },
      getAttribute: function (k) { return k in el.attrs ? el.attrs[k] : null; },
      appendChild: function (node) { el.children.push(node); return node; },
      addEventListener: function () {},
      focus: function () {}
    };
    Object.defineProperty(el, 'innerHTML', {
      get: function () { return el._html; },
      set: function (v) { el._html = v; if (v === '') el.children.length = 0; }
    });
    return el;
  }
  const calFrom = appSrc.indexOf('  /** أرقام عربية مشرقية للعرض */');
  const calTo = appSrc.indexOf('  /** الانتقال إلى طالع تاريخ معيّن');
  const calCode = appSrc.slice(calFrom, calTo);
  check('الكود المخصص للتقويم موجود وقابل للاستخراج', calFrom !== -1 && calTo !== -1 &&
    calCode.length > 2000, calCode.length);

  const calPicked = [];
  const calBox = {
    document: { createElement: function (t) { return makeCalEl(t); } },
    makeCalEl: makeCalEl,
    hijriToGregorian: anwaaBox.hijriToGregorian,   // تقدير الكويت لعتبة hijriMonthStart
    todayDate: new Date(2026, 8, 27),             // أحد 27 سبتمبر 2026
    picked: calPicked,
    window: {}
  };
  calBox.window = calBox;
  vm.createContext(calBox);
  vm.runInContext(
    // ثوابت app.js التي يعتمد عليها قسم التقويم (تُمرّر قبل الشريحة)
    'const GREG_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];' +
    'const HIJRI_MONTHS = ["محرم","صفر","ربيع الأول","ربيع الآخر","جمادى الأولى","جمادى الآخرة","رجب","شعبان","رمضان","شوال","ذو القعدة","ذو الحجة"];' +
    'const WEEKDAYS = ["أحد","اثنين","ثلا","أربع","خميس","جمعة","سبت"];' +
    'const MS_PER_DAY = 86400000;' +
    'var calMode = "greg";' +
    'var calView = { y: 2026, m: 9, hy: 1447, hm: 1 };' +
    'var lastDateFocus = null;' +
    // عناصر النافذة التي تلمسها closeDateModal (بلا DOM حقيقي في السياق)
    'var dateModalEl = makeCalEl("div"), dateBtnEl = makeCalEl("button"), dateHintEl = makeCalEl("p");' +
    // حالة الطالع المباشر التي تلمسها jumpToDateTalea في app.js
    'var currentToday = null, currentTodaySeason = null;' +
    'var calGridEl = { tag:"grid", children:[], textContent:"", className:"", attrs:{}, _html:"", ' +
    '  classList:{add(){},remove(){},toggle(){},contains(){return false;}}, setAttribute(){}, ' +
    '  appendChild(n){this.children.push(n);return n;}, addEventListener(){}, focus(){} };' +
    'Object.defineProperty(calGridEl, "innerHTML", { get(){return this._html;}, set(v){this._html=v; if(v==="") this.children.length=0;} });' +
    'const calWeekEl = makeCalEl("week"), calTitleEl = makeCalEl("title");' +
    'const calTabGregEl = makeCalEl("button"), calTabHijriEl = makeCalEl("button");' +
    // قائمتا الشهر والسنة المنسدلتان + مداهما (كما في app.js)
    'const CAL_YEAR_MIN = { greg: 1950, hijri: 1370 };' +
    'const CAL_YEAR_MAX = { greg: 2030, hijri: 1452 };' +
    'var calMonthSelectEl = makeCalEl("select"), calYearSelectEl = makeCalEl("select");' +
    // محاكاة options: مرآة لكائنات .children التي يضيفها الكود عبر appendChild
    'function bindOptions(sel) { sel.options = sel.children; sel.options.length = 0; } ' +
    'bindOptions(calMonthSelectEl); bindOptions(calYearSelectEl);' +
    'calMonthSelectEl.value = ""; calYearSelectEl.value = "";' +
    // يتيح clearSelect في app.js تمرير removeChild/firstChild كما في DOM الحقيقي
    'function bindRemoveChild(sel) { sel.firstChild = null; ' +
    '  sel.removeChild = function (n) { var i = sel.children.indexOf(n); if (i >= 0) sel.children.splice(i, 1); }; } ' +
    'bindRemoveChild(calMonthSelectEl); bindRemoveChild(calYearSelectEl);' +
    'const hijriToGregorian = this.hijriToGregorian;' +
    'function focusQuietly(node) { if (node && typeof node.focus === "function") node.focus(); }' +
    // يتحسّس الاختيار في مكان استدعاء الانتقال داخل الشريحة
    'function jumpToDateTalea(date, extraNote) { picked.push({ date: date, note: extraNote || "" }); }' +
    'function setDateHint(m) { this.hint = m || ""; }' +
    calCode +
    'this.calApi = { calSyncToToday: calSyncToToday, renderCalendar: renderCalendar, calStep: calStep, ' +
    '  calSetMode: function (m) { calMode = m; }, mode: function () { return calMode; }, ' +
    '  setView: function (v) { Object.assign(calView, v); }, view: function () { return calView; }, ' +
    '  pickCalendarDay: pickCalendarDay, hijriMonthStart: hijriMonthStart, ' +
    '  hijriMonthLength: hijriMonthLength, hijriPartsOf: hijriPartsOf, grid: calGridEl, ' +
    '  monthSelect: calMonthSelectEl, yearSelect: calYearSelectEl, ' +
    '  calSelectMonth: calSelectMonth, calSelectYear: calSelectYear, syncPickers: syncCalendarPickers };',
    calBox, { filename: 'calendar-from-app.js' }
  );
  const CA = calBox.calApi;
  const dayCells = function () {
    return CA.grid.children.filter(function (c) { return hasCalClass(c, 'cal-day'); });
  };
  const padCells = function () {
    return CA.grid.children.filter(function (c) { return hasCalClass(c, 'cal-pad'); });
  };

  CA.calSyncToToday();
  CA.renderCalendar();
  check('الشبكة الميلادية: 30 خلية ليوم سبتمبر + محاذاة أول الشهر',
    dayCells().length === 30 && padCells().length === new Date(2026, 8, 1).getDay(),
    dayCells().length + '/' + padCells().length);
  check('اليوم الحالي مميز بخلية واحدة (ميلادي)',
    dayCells().filter(function (c) { return hasCalClass(c, 'is-today'); }).length === 1);

  /* ---------- القائمتان المنسدلتان للشهر والسنة ---------- */
  check('قائمة الأشهر تُبنى بـ 12 خياراً ميلادياً',
    CA.monthSelect.options.length === 12 && CA.monthSelect.options[8].textContent === 'سبتمبر',
    CA.monthSelect.options.length + ' | ' + (CA.monthSelect.options[8] || {}).textContent);
  check('قائمة السنوات تغطّي 1950..2030 ميلادياً بـ 81 خياراً',
    CA.yearSelect.options.length === 81 && CA.yearSelect.options[0].value === '1950' &&
    CA.yearSelect.options[80].value === '2030', CA.yearSelect.options.length);
  check('القائمتان تعكسان الشهر المعروض (سبتمبر ٢٠٢٦)',
    CA.monthSelect.value === '9' && CA.yearSelect.value === '2026',
    CA.monthSelect.value + '/' + CA.yearSelect.value);

  // القفز المباشر لسنة وشهر بضغطة واحدة
  CA.calSelectYear('1990');
  CA.calSelectMonth('3');
  check('اختيار السنة والشهر يقفز مباشرة إليهما',
    CA.view().y === 1990 && CA.view().m === 3 && dayCells().length === 31,
    CA.view().y + '/' + CA.view().m + ' | ' + dayCells().length);

  // رفض ما هو خارج المدى دون كسر العرض
  CA.calSelectYear('1900');
  check('السنة خارج المدى (1900) تُرفض ويبقى العرض كما هو', CA.view().y === 1990, CA.view().y);
  CA.calSelectYear('2050');
  check('السنة خارج المدى (2050) تُرفض ويبقى العرض كما هو', CA.view().y === 1990, CA.view().y);
  CA.calSelectMonth('13');
  check('الشهر خارج المدى (13) يُرفض ويبقى العرض كما هو', CA.view().m === 3, CA.view().m);

  // الأسهم ما زالت تعمل وتتوقف عند حدّي القائمة
  CA.setView({ y: 2030, m: 12 });
  CA.calStep(1);
  check('الأسهم تتوقف عند حدّ السنة الأعلى في القائمة',
    CA.view().y === 2030 && CA.view().m === 12, CA.view().y + '/' + CA.view().m);
  CA.setView({ y: 1950, m: 1 });
  CA.calStep(-1);
  check('الأسهم تتوقف عند حدّ السنة الأدنى في القائمة',
    CA.view().y === 1950 && CA.view().m === 1, CA.view().y + '/' + CA.view().m);

  // التقويم الهجري: قائمة سنوات هجرية ومدى معادل
  CA.calSetMode('hijri');
  CA.syncPickers();
  check('التقويم الهجري: 12 شهراً و83 سنة (1370..1452هـ)',
    CA.monthSelect.options.length === 12 && CA.yearSelect.options.length === 83 &&
    CA.yearSelect.options[0].value === '1370' && CA.yearSelect.options[82].value === '1452',
    CA.yearSelect.options.length);
  CA.calSelectYear('1447');
  CA.calSelectMonth('9');
  check('اختيار رمضان ١٤٤٧هـ يعرض شهراً هجرياً صحيح الطول',
    CA.view().hy === 1447 && CA.view().hm === 9 &&
    (dayCells().length === 29 || dayCells().length === 30),
    CA.view().hy + '/' + CA.view().hm + ' | ' + dayCells().length);
  CA.calSetMode('greg');

  let hijriBad = 0;
  for (let m = 1; m <= 12; m++) {
    const s = CA.hijriMonthStart(1447, m);
    const p = CA.hijriPartsOf(s);
    const len = CA.hijriMonthLength(1447, m);
    if (!p || p.y !== 1447 || p.m !== m || p.d !== 1 || (len !== 29 && len !== 30)) hijriBad++;
  }
  check('بدايات شهور 1447هـ موافقة لأم القرى وأطوالها 29/30', hijriBad === 0, hijriBad);
  const ramStart = CA.hijriMonthStart(1447, 9);
  check('1 رمضان 1447هـ = 18 فبراير 2026 (أم القرى)',
    ramStart.getFullYear() === 2026 && ramStart.getMonth() === 1 && ramStart.getDate() === 18,
    ramStart.toDateString());

  CA.calSetMode('hijri');
  CA.setView({ hy: 1448, hm: 4 });
  CA.renderCalendar();
  const hijriCells = dayCells();
  check('شهر هجري 1448: 29 أو 30 خلية مع تمييز اليوم الحالي',
    (hijriCells.length === 29 || hijriCells.length === 30) &&
    hijriCells.filter(function (c) { return hasCalClass(c, 'is-today'); }).length === 1,
    hijriCells.length);

  calPicked.length = 0;
  CA.pickCalendarDay(1);
  const hPick = calPicked[0];
  check('اختيار يوم هجري يحوّله لميلادي مع تسمية التقويم الحسابي',
    !!hPick && Object.prototype.toString.call(hPick.date) === '[object Date]' &&
    /هجري/.test(hPick.note), hPick && hPick.date && hPick.date.toDateString());

  CA.calSetMode('greg');
  CA.setView({ y: 2026, m: 12 });
  CA.calStep(1);
  check('الالتفاف حول السنة (دجنبر → يناير)', CA.view().y === 2027 && CA.view().m === 1,
    CA.view().y + '/' + CA.view().m);
  calPicked.length = 0;
  CA.pickCalendarDay(25);
  const gPick = calPicked[0];
  check('اختيار يوم ميلادي يمرر التاريخ نفسه (25 يناير 2027)',
    !!gPick && gPick.date.getFullYear() === 2027 && gPick.date.getMonth() === 0 &&
    gPick.date.getDate() === 25 && gPick.note === '', gPick && gPick.date.toDateString());

  const AU = bootAudioSandbox();
  check('AnwaaAudio و playChime مكشوفان', !!(AU.api && AU.api.supported) &&
    typeof AU.sandbox.playChime === 'function');
  const audioBtn = AU.created.buttons[0];
  check('زر الصوت يُلتقط بالمعرف audioToggle', AU.doc.getElementById('audioToggle') === audioBtn &&
    audioBtn.classList.contains('aa-sound'));
  check('الزر يبدأ في وضع الكتم (بلا سياق بعد)', audioBtn.classList.contains('is-off') &&
    audioBtn.getAttribute('aria-pressed') === 'false');
  check('وصف الزر جاهز للتشغيل', audioBtn.getAttribute('aria-label') === 'تشغيل الصوت');
  check('واجهة الحالة تكشف الكتم الابتدائي', AU.api.isActive() === false && AU.api.isMuted() === true);

  /* ---- السياسة الجديدة: مؤثرات سلبية لا تُصدر صوتاً قبل تفعيل الزر ---- */
  AU.sandbox.fire('pointerdown', {});
  AU.sandbox.fire('keydown', {});
  check('لا سياق صوتي قبل أي إيماءة', FakeAudioContext.instances.length === 0);

  // الأهم (الخلل المُصلَح): لا صوت بينما الأيقونة تُظهر الكتم
  AU.sandbox.playChime();
  check('مكتوم: playChime بلا سياق ولا مذبذب (لا يسبق الأيقونة)',
    FakeAudioContext.instances.length === 0,
    FakeAudioContext.instances.length + ' سياق');
  AU.sandbox.playWarpSound();
  check('مكتوم: playWarpSound بلا سياق كذلك', FakeAudioContext.instances.length === 0,
    FakeAudioContext.instances.length + ' سياق');
  check('الأيقونة ما زالت مغلقة بعد المؤثرات المكتومة',
    audioBtn.classList.contains('is-off') && AU.api.isMuted() === true);

  /* ---- النقرة الأولى: تفعيل في اللحظة نفسها (تفعيل واحد يكفي) ---- */
  audioBtn.fire('click');
  await tick();
  check('النقرة الأولى تُنشئ السياق وتُفعّل الصوت',
    FakeAudioContext.instances.length === 1 && AU.api.isActive() === true,
    FakeAudioContext.instances.length + ' سياق');
  const actx = FakeAudioContext.instances[0];
  check('تم await resume والسياق يعمل', actx.resumeCalls >= 1 && actx.state === 'running',
    actx.state + '/' + actx.resumeCalls);
  check('مجدول تلاشي دخول إلى 1', actx.gainNodes[0].gain.events.some(function (e) {
    return e[0] === 'lin' && e[1] === 1;
  }));
  const droneOsc = actx.oscillators.filter(function (o) {
    return (o.frequency.value === 55 || o.frequency.value === 110) &&
      o.type === 'sine' && o.started;
  });
  check('مذبذبا الخلفية 55 و110 هيرتز نقيان', droneOsc.length === 2,
    actx.oscillators.map(function (o) { return o.frequency.value; }).join(','));
  const droneFilter = actx.filters.filter(function (f) { return f.type === 'lowpass'; });
  check('مرشّح تمرير منخفض للخلفية', droneFilter.length >= 1, actx.filters.length);
  const droneGainNode = actx.gainNodes.filter(function (g) {
    return Math.abs(g.gain.value - 0.15) < 1e-9;
  })[0];
  check('مستوى الخلفية ≈0.15', !!droneGainNode,
    actx.gainNodes.map(function (g) { return g.gain.value; }).join(','));
  check('مجمّع متصل بالمخرج', actx.gainNodes[0].connections.indexOf(actx.destination) !== -1);
  check('الزر يظهر مفعّلاً (توهج + ذبذبات)', audioBtn.classList.contains('is-on') &&
    audioBtn.getAttribute('aria-pressed') === 'true' &&
    audioBtn.getAttribute('aria-label') === 'كتم الصوت');
  check('توحيد الحالة: الأيقونة مفتوحة وisActive() صادقة في الوقت نفسه',
    audioBtn.classList.contains('is-on') && AU.api.isActive() === true && AU.api.isMuted() === false);


  // الرنين البلوري بعد التفعيل (مع احترام فاصل 90ms بين رنينين)
  actx.currentTime += 0.2;
  const oscBefore = actx.oscillators.length;
  const gainsBefore = actx.gainNodes.length;
  AU.sandbox.playChime();
  check('playChime يبني 3 توافقيات', actx.oscillators.length - oscBefore === 3,
    actx.oscillators.length - oscBefore);
  const chimeGains = actx.gainNodes.slice(gainsBefore);
  check('جدول خمول أسي للرنين', chimeGains.length === 3 && chimeGains.every(function (g) {
    return g.gain.events.some(function (e) { return e[0] === 'exp'; });
  }), chimeGains.length);
  check('مسار استريو عشوائي للرنين', actx.panners.length >= 1 &&
    actx.panners[actx.panners.length - 1].connections.length > 0, actx.panners.length);

  // صوت الاندفاع الفضائي (Cosmic Whoosh)
  const oscBeforeWarp = actx.oscillators.length;
  const filtersBeforeWarp = actx.filters.length;
  const buffersBeforeWarp = actx.bufferSources.length;
  AU.sandbox.playWarpSound();
  check('الاندفاع: مصدر ضجيج بمخزن أبيض مولّد',
    actx.bufferSources.length === buffersBeforeWarp + 1 &&
    !!actx.bufferSources[actx.bufferSources.length - 1].buffer &&
    actx.bufferSources[actx.bufferSources.length - 1].started === true,
    actx.bufferSources.length);
  const warpFilter = actx.filters[actx.filters.length - 1];
  check('الاندفاع: lowpass بصعود ترددين متدرّج', actx.filters.length === filtersBeforeWarp + 1 &&
    warpFilter.type === 'lowpass' &&
    warpFilter.frequency.events.filter(function (e) { return e[0] === 'exp'; }).length >= 2);
  check('الاندفاع: موجة سين منخفضة مدموجة', actx.oscillators.length === oscBeforeWarp + 1 &&
    actx.oscillators[actx.oscillators.length - 1].type === 'sine');
  check('الاندفاع: صعود وتراجع شدة الضجيج (exponential)', actx.gainNodes[actx.gainNodes.length - 2]
    .gain.events.filter(function (e) { return e[0] === 'exp'; }).length >= 2);

  // النقرة الثانية: الكتم بالتلاشي
  audioBtn.fire('click');
  check('النقرة الثانية تكتم الصوت', AU.api.isActive() === false &&
    audioBtn.classList.contains('is-off') &&
    actx.gainNodes[0].gain.value === 0, actx.gainNodes[0].gain.value);
  const oscAfterWarp = actx.oscillators.length;   // بعد الرنين والاندفاع
  const buffersAfterWarp = actx.bufferSources.length;
  AU.sandbox.playChime();
  AU.sandbox.playWarpSound();
  check('لا رنين ولا اندفاع بعد الكتم',
    actx.oscillators.length === oscAfterWarp &&
    actx.bufferSources.length === buffersAfterWarp,
    (actx.oscillators.length - oscAfterWarp) + ' مذبذب / ' +
    (actx.bufferSources.length - buffersAfterWarp) + ' ضجيج');

  // النقرة الثالثة: العودة مع await resume إن لزم
  audioBtn.fire('click');
  await tick();
  check('النقرة الثالثة تعيد التشغيل', AU.api.isActive() === true && actx.state === 'running' &&
    Math.abs(actx.gainNodes[0].gain.value - 1) < 1e-9, actx.gainNodes[0].gain.value);

  /* ---- دورة كاملة: كل نقرة تُقلب الحالة مرة واحدة (لا نقرتان) ---- */
  const seen = [audioBtn.classList.contains('is-on') ? 'on' : 'off'];
  const seenActive = [AU.api.isActive()];
  for (let i = 0; i < 4; i++) {
    audioBtn.fire('click');
    await tick();
    seen.push(audioBtn.classList.contains('is-on') ? 'on' : 'off');
    seenActive.push(AU.api.isActive());
  }
  check('كل نقرة تقلب الحالة مرة واحدة بالضبط',
    seen.join(',') === 'on,off,on,off,on', seen.join(','));
  check('الأيقونة والحالة الحقيقية متطابقتان في كل خطوة',
    seenActive.map(function (a) { return a ? 'on' : 'off'; }).join(',') === seen.join(','),
    seenActive.join(','));
  check('طول السماعة يطابق الحالة في كل خطوة', seen.every(function (s, i) {
    return (s === 'on') === (seenActive[i] === true);
  }));

  // بعد الدورة صرنا على 'on' — نكتم حتى تبقى اختبارات التبويب متوقعة
  audioBtn.fire('click');
  await tick();
  audioBtn.fire('click');
  await tick();

  // إخفاء/إظهار التبويب بتلاشي
  AU.doc.hidden = true;
  AU.doc.fire('visibilitychange');
  check('إخفاء التبويب يُخمّد الصوت', actx.gainNodes[0].gain.value === 0,
    actx.gainNodes[0].gain.value);
  AU.doc.hidden = false;
  AU.doc.fire('visibilitychange');
  check('إظهار التبويب يعيد الصوت', Math.abs(actx.gainNodes[0].gain.value - 1) < 1e-9,
    actx.gainNodes[0].gain.value);

}

function printSummary() {

/* ---------- الملخّص ---------- */
console.log('\n========================================');
console.log('النتيجة: ' + passed + ' ناجح، ' + failed + ' فاشل');
console.log('========================================');
if (failed > 0) process.exitCode = 1;
}



