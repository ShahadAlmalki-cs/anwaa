/* التحقق من وسوم SEO والملفات المهيكلة: نقرأها كما تفعل محركات البحث. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
};

console.log('\n— 1) العنوان والوصف والكلمات —');
const title = (html.match(/<title>([^<]*)<\/title>/g) || []);
check('عنوان واحد فقط (لا تكرار)', title.length === 1, title.length + ' عناوين');
const t = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
check('العنوان بالنص المطلوب', t === 'أنواء | مَطَالِعُ النُّجُومِ وَمَوَاسِمُ الأَرْضِ', t);
const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
check('الوصف بالنص المطلوب',
  desc === 'مرصد وتطبيق أنواء التفاعلي لرصد طوالع النجوم، حساب المواسم التراثية، دلالات الطقس والتقويم الزراعي في سماء الجزيرة العربية.', desc.slice(0, 50));
const kw = (html.match(/<meta name="keywords" content="([^"]*)"/) || [])[1] || '';
check('الكلمات المفتاحية التسع كاملة',
  ['أنواء', 'مطالع النجوم', 'سهيل', 'المربعانية', 'الشبط', 'طالع الليلة', 'تقويم الأنواء', 'الفلك التراثي', 'مواسم السعودية']
    .every((k) => kw.indexOf(k) !== -1), kw);

console.log('\n— 2) canonical و robots —');
check('وسم canonical موجود', /<link rel="canonical" href="index\.html">/.test(html));
const robots = (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1] || '';
check('robots يسمح بالفهرسة والتتبّع', robots.indexOf('index') !== -1 && robots.indexOf('follow') !== -1, robots);

console.log('\n— 3) البيانات المهيكلة JSON-LD —');
const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
check('سكربت JSON-LD موجود', !!m);
if (m) {
  let data = null;
  try { data = JSON.parse(m[1]); } catch (e) { /* الخطأ يُبلّغ عنه أدناه */ }
  check('JSON-LD صالح (JSON.parse ينجح)', !!data);
  if (data) {
    check('@type = WebApplication', data['@type'] === 'WebApplication', data['@type']);
    check('@context = schema.org', data['@context'] === 'https://schema.org', data['@context']);
    check('الاسم موجود', !!(data.name && data.name.length > 5), data.name);
    check('الوصف موجود', !!(data.description && data.description.length > 30));
    check('اللغة عربية (inLanguage)', /^ar/.test(data.inLanguage || ''), data.inLanguage);
    check('تصنيف فلكي', data.applicationCategory === 'AstronomyApplication', data.applicationCategory);
    check('وlng عربي لا يحوي محارف تالفة',
      !JSON.stringify(data).match(/[\u0080-\u04FF]{1,}[A-Za-z]/),
      (JSON.stringify(data).match(/[\u0080-\u04FF]{1,}[A-Za-z]+/) || [])[0]);
    check('featureList غير فارغ', Array.isArray(data.featureList) && data.featureList.length >= 3,
      (data.featureList || []).length);
  }
}

console.log('\n— 4) robots.txt —');
const rb = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
check('robots.txt موجود وغير فارغ', rb.trim().length > 0);
check('يحتوي User-agent: *', /User-agent:\s*\*/.test(rb));
check('يسمح بالزحف (Allow: /)', /Allow:\s*\/\s*$/m.test(rb), rb.match(/Allow:.*/g));

console.log('\n— 5) sitemap.xml —');
const sm = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
check('sitemap.xml موجود', sm.trim().length > 0);
check('يبدأ بتعريف XML', /^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(sm.trim()));
check('يشمل نطاق urlset القياسي', /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(sm));
check('يحتوي رابط الصفحة الرئيسية', /<loc>index\.html<\/loc>/.test(sm));
check('معدل التحديث weekly', /<changefreq>weekly<\/changefreq>/.test(sm));
check('الأولوية 1.0', /<priority>1\.0<\/priority>/.test(sm));
check('تاريخ آخر تعديل بصيغة صحيحة', /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sm));

console.log('\n========================================');
console.log('النتيجة: ' + pass + ' ناجح، ' + fail + ' فاشل');
console.log('========================================');
if (fail > 0) process.exitCode = 1;
