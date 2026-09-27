<div align="center">

# ✦ أَنْوَاء | ANWAA ✦
### مرصد مواسم الأرض ومطالع النجوم في سماء الجزيرة العربية
*An interactive celestial guide to traditional Arabian astronomy, seasonal cycles, and agricultural calendars.*

<br/>

[![Status](https://img.shields.io/badge/Status-Active-22c55e?style=flat-square)](#)
[![Stack](https://img.shields.io/badge/Stack-Vanilla_JS_•_HTML5_•_CSS3-6366f1?style=flat-square)](#)
[![License](https://img.shields.io/badge/License-MIT-e2b342?style=flat-square)](#)

</div>

---

## 🌌 نبذة عن المشروع

**«أَنْوَاء»** منصة فلكية تفاعلية تجمع بين الإرث الفلكي التراثي للجزيرة العربية وأحدث معايير تصميم الويب الحديث. يُحاكي التطبيق قبة السماء الليلية وحركة مطالع النجوم مع ربط الطالع الفلكي بالطقس الميداني المباشر ومواسم الزراعة والري المعتمدة تاريخياً في المنطقة.

---

## ✨ المميزات الرئيسية

- 🪐 **مرصد تفاعلي عميق (Deep Space Sky):** قبة سماء مرسومة بمحرك `HTML5 Canvas` بحركة انسيابية للنجوم وغبار سديم درب التبانة.
- 📜 **حساب الأنواء والدرور:** تحديد دقيق لمنازل القمر، طالع اليوم، بدايات الفصول الزراعية، وأيام الطوالع.
- 🌤️ **طقس الطالع اللحظي:** تكامل مباشر مع `Open-Meteo API` لجلب درجات الحرارة وسرعة الرياح لمدن المملكة وربطها بخصائص النجم الحالية.
- 💎 **واجهة زجاجية فضائية (Cosmic Glassmorphism):** أسلوب بصري متقن بتأثيرات البلور الداكن، تباين عالي للقراءة، ودعم كامل للشاشات الذكية والهواتف.
- ⚡ **بنية خفيفة (Zero Dependencies):** مبني بالكامل دون حزم أو أطر عمل ثقيلة لضمان أعلى سرعة تحميل وأرشفة سريعة في محركات البحث.

---

## 📂 بنية الملفات

| الملف | الدور والمهمة |
| :--- | :--- |
| `index.html` | الهيكل الدلالي، بطاقات المرصد، وبيانات الميتا لمحركات البحث |
| `style.css` | التصميم الزجاجي، لوحة الألوان الفضائية، وقواعد التجاوب |
| `app.js` | إدارة حالة التطبيق، التبديل بين الطوالع، ومزامنة الواجهة |
| `sky.js` | محرك رسم قبة السماء، وميض النجوم، وحزام المجرة على الـ Canvas |
| `anwaa.js` | خوارزميات الحسابات الفلكية وجداول المواسم ومطالع النجوم |
| `weather.js` | استدعاء بيانات الطقس الحية لمناطق المملكة ومعالجة الاستجابة |
| `audio.js` | المؤثرات الصوتية الفلكية المحيطية والتحكم في كتم الصوت |
| `robots.txt` | تصاريح الفهرسة الموجهة لمحركات البحث |
| `sitemap.xml` | خارطة أرشفة روابط الموقع لـ Google Search Console |

---

## 🚀 التشغيل الميداني والمحلي

المشروع مصمم ليعمل مباشرة دون الحاجة لأي عمليات تثبيت (No `npm install` needed).

### تشغيل خادم محلي:

```bash
# باستخدام بايثون
python -m http.server 8000
```

ثم افتح الرابط في المتصفح: <http://localhost:8000>

> **ملاحظة:** أذونات الموقع وجلب الطقس الحيّ يتطلّبان سياقاً آمناً (`https` أو `localhost`)، أما فتحُ `index.html` مباشرةً فيعمل لبقية الوظائف كاملةً.

---

### 📚 المصادر والمراجع التراثية | References

تم تدقيق البيانات الفلكية، مطالع الطوالع، والأسجاع التراثية بالاعتماد على أمهات كتب الفلك العربي الموثقة:

* **كتاب الأنواء في مواسم العرب** — أبو محمد عبد الله بن مسلم ابن قتيبة الدينوري (ت 276 هـ).
* **تقويم مواسم ومطالع النجوم التراثي لسماء الجزيرة العربية**.

<img width="1132" height="1600" alt="دليل الطوالع" src="https://github.com/user-attachments/assets/e1e7aa6e-35c3-430e-855b-0115a821ae2d" />

---

## 🌐 English Overview

**Anwaa** is an interactive celestial observatory celebrating traditional Arabian
ethno-astronomy. It bridges ancient desert seasonal reckoning — the *matali'*
(star risings), the *anwaa* (seasonal mansions) and the agricultural calendars —<img width="1875" height="896" alt="Screenshot 2026-09-27 081736" src="https://github.com/user-attachments/assets/4932ad2d-53e7-42f3-824b-5cda3a34d99d" />

with modern front-end craftsmanship.

### Highlights

- **Dynamic Sky Engine** — Procedural night sky rendering with layered stellar
  magnitude, a galactic dust band, meteors and pointer parallax, via HTML5 Canvas.
- **Accurate Astronomical Computations** — Real-time determination of the active
  mansion, its rise date, and the boundaries of the six astronomical seasons.
- **Contextual Meteorology** — Live weather integration across Saudi Arabian
  territories, tied to the prevailing seasonal mansion and its weather profile.
- **Modern Minimalist UI** — Ultra-clean dark cosmic glassmorphism layout, fully
  responsive, and SEO-optimized.
- **Zero Dependencies** — No framework, no build step, no bundler.

### Stack

`HTML5` · `CSS3` · `Vanilla JavaScript` · `Canvas API` · `Open-Meteo API`

---

<div align="center">

### 🖼️ Screenshot

<br>
![Uploading Screenshot 2026-09-27 081736.png…]()

<br><br>

<sub>مطالع النجوم ومواسم الأرض · Anwaa — © 2026</sub>

</div>
