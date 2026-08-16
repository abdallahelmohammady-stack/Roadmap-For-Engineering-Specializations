/* ================================================================
   📦 SitesLoader v1 — محمّل المحتوى الموحّد لنسخ الزائر (user)
   ----------------------------------------------------------------
   ليه موجود؟ لأن نسخة الزائر بتقرأ المحتوى من ملف data/sites.json،
   ولو الملف ده مش مترفع على الاستضافة صح كانت الصفحة بتفضل فاضية
   من غير أي سبب واضح. المحمّل ده بيحل 3 حاجات:

   1) شاشة "⏳ جاري تحميل المحتوى" أول ما الصفحة تفتح.
   2) لو الـ fetch فشل (404 / شبكة) ⬅️ بيحاول تلقائيًا يحمّل النسخة
      الاحتياطية المدمجة js/embedded-data.js (بتتولّد من sites.json).
   3) لو الاتنين فشلوا ⬅️ شاشة تشخيص حمرا فيها: المسار اللي جرّبناه،
      نتيجة المحاولة، وخطوات الحل واحدة واحدة + زر إعادة محاولة.

   الاستخدام: بدل ما تعمل fetch بنفسك، نادِ:
       const pack = await window.SitesLoader.load();
       if(!pack) { return; } // فشل نهائي — شاشة التشخيص ظاهرة للزائر
       const data = pack.data;   // نفس محتوى sites.json
       pack.source;              // 'server' أو 'embedded'
   ================================================================ */
(function () {
  if (window.SitesLoader) return;   // حماية من التحميل مرتين

  var FETCH_TIMEOUT = 15000;        // أقصى وقت لانتظار السيرفر
  var SCRIPT_TIMEOUT = 12000;       // أقصى وقت لتحميل النسخة المدمجة
  var Z = 2147483000;               // فوق أي عنصر تاني في الصفحة
  var FONT = '"Cairo","Tajawal",system-ui,-apple-system,"Segoe UI",sans-serif';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- شاشة التحميل / التشخيص (overlay) ---------- */
  var overlay = null, subEl = null, msgEl = null;

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return;
    if (!document.getElementById('sl-style')) {
      var st = document.createElement('style');
      st.id = 'sl-style';
      st.textContent = '@keyframes sl-spin{to{transform:rotate(360deg)}}'
        + '@keyframes sl-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}';
      document.head.appendChild(st);
    }
    overlay = document.createElement('div');
    overlay.setAttribute('dir', 'rtl');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:' + Z + ';display:flex;align-items:center;'
      + 'justify-content:center;background:rgba(8,10,18,.96);backdrop-filter:blur(6px);'
      + 'font-family:' + FONT + ';color:#e5e7eb;padding:16px;overflow:auto;';
    document.documentElement.appendChild(overlay);
  }

  function showLoading() {
    ensureOverlay();
    overlay.innerHTML = '<div style="text-align:center;max-width:340px;animation:sl-in .25s ease">'
      + '<div style="width:46px;height:46px;margin:0 auto 14px;border:4px solid rgba(148,163,184,.25);'
      + 'border-top-color:#818cf8;border-radius:50%;animation:sl-spin .9s linear infinite"></div>'
      + '<div style="font-size:17px;font-weight:700">⏳ جاري تحميل المحتوى…</div>'
      + '<div id="sl-sub" style="font-size:13px;color:#94a3b8;margin-top:8px;line-height:1.9"></div>'
      + '</div>';
    subEl = overlay.querySelector('#sl-sub');
  }

  function setSub(t) { if (subEl) subEl.textContent = t; }

  function hideOverlay() {
    if (overlay && overlay.isConnected) overlay.remove();
    overlay = null; subEl = null;
  }

  /* ---------- شريط تنبيه "شغال بالنسخة الاحتياطية" ---------- */
  function showEmbeddedBanner() {
    if (document.getElementById('sl-embed-banner')) return;
    var b = document.createElement('div');
    b.id = 'sl-embed-banner';
    b.setAttribute('dir', 'rtl');
    b.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:' + (Z - 1) + ';'
      + 'background:#1f2937;border:1px solid rgba(251,191,36,.45);color:#fde68a;font-family:' + FONT + ';'
      + 'font-size:13px;line-height:1.9;padding:10px 14px 10px 8px;border-radius:12px;max-width:92vw;'
      + 'box-shadow:0 10px 30px rgba(0,0,0,.45);display:flex;gap:10px;align-items:flex-start;animation:sl-in .3s ease;';
    b.innerHTML = '<span>⚠️ شغال دلوقتي <b>بنسخة احتياطية مدمجة</b> من المحتوى لأن ملف '
      + '<b style="font-family:monospace">data/sites.json</b> مش متاح على السيرفر — '
      + 'راجع خطوات الرفع عشان الزوّار يشوفوا آخر تحديث.</span>';
    var x = document.createElement('button');
    x.textContent = '✕';
    x.setAttribute('aria-label', 'إغلاق');
    x.style.cssText = 'background:none;border:none;color:#94a3b8;font-size:15px;cursor:pointer;padding:2px 4px;flex-shrink:0;';
    x.onclick = function () { b.remove(); };
    b.appendChild(x);
    document.documentElement.appendChild(b);
  }

  /* ---------- fetch مع وقت أقصى + رسائل عربية واضحة ---------- */
  function fetchJson(url) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        finish(new Error('السيرفر خد وقت أطول من اللازم ومردّش (timeout بعد ' + Math.round(FETCH_TIMEOUT / 1000) + ' ثانية)'));
      }, FETCH_TIMEOUT);

      function finish(err, data) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve(data);
      }

      fetch(url, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) {
          var msg = 'HTTP ' + res.status +
            (res.status === 404 ? ' — الملف مش موجود على السيرفر (غالبًا فولدر data مش مترفع)'
              : res.status === 403 ? ' — السيرفر رافض الوصول للملف (راجع صلاحيات الملفات)' : '');
          var e = new Error(msg);
          e.httpStatus = res.status;
          finish(e);
          return;
        }
        res.json().then(
          function (d) { finish(null, d); },
          function () { finish(new Error('الملف موجود بس محتواه مش JSON صالح — ممكن يكون اتنقل ناقص أو اتعدّل غلط')); }
        );
      }, function (netErr) {
        var m = (netErr && netErr.message) || '';
        finish(new Error(/failed to fetch|network|load failed/i.test(m)
          ? 'فشل الاتصال بالسيرفر نهائيًا (مشكلة شبكة أو السيرفر واقف)'
          : 'خطأ غير متوقع أثناء التحميل: ' + m));
      });
    });
  }

  /* ---------- تحميل النسخة الاحتياطية المدمجة (script tag — بتشتغل حتى على file://) ---------- */
  function loadEmbedded() {
    return new Promise(function (resolve) {
      if (window.__EMBEDDED_SITES_DATA__) { resolve(window.__EMBEDDED_SITES_DATA__); return; }
      var done = false;
      function fin(ok) {
        if (done) return; done = true;
        clearTimeout(timer);
        resolve(ok ? (window.__EMBEDDED_SITES_DATA__ || null) : null);
      }
      var timer = setTimeout(function () { fin(false); }, SCRIPT_TIMEOUT);
      var s = document.createElement('script');
      s.onload = function () { fin(true); };
      s.onerror = function () { fin(false); };
      s.src = 'js/embedded-data.js?ts=' + Date.now();
      document.head.appendChild(s);
    });
  }

  /* ---------- شاشة التشخيص النهائية ---------- */
  function showFatal(url, err, embeddedTried) {
    ensureOverlay();
    var fileProto = location.protocol === 'file:';
    var errMsg = err ? err.message : 'خطأ غير معروف';
    var is404 = err && err.httpStatus === 404;

    overlay.innerHTML = '<div style="max-width:560px;width:100%;background:#151a26;border:1px solid rgba(239,68,68,.35);'
      + 'border-radius:18px;padding:26px 22px;box-shadow:0 20px 60px rgba(0,0,0,.5);animation:sl-in .3s ease;line-height:2">'
      + '<div style="font-size:42px;text-align:center">😵</div>'
      + '<div style="font-size:21px;font-weight:800;text-align:center;margin-bottom:6px">المحتوى مش ظاهر</div>'
      + '<p style="text-align:center;color:#94a3b8;font-size:14px;margin:0 0 16px">الصفحة نفسها شغّالة، بس المتصفح مش قادر يوصل لملف البيانات.</p>'

      + '<div style="background:#0b0f19;border:1px solid rgba(148,163,184,.2);border-radius:12px;padding:12px 14px;font-size:12.5px;margin-bottom:10px">'
      + '<div style="color:#94a3b8;margin-bottom:4px">📁 المسار اللي جرّبناه:</div>'
      + '<div dir="ltr" style="font-family:monospace;color:#93c5fd;word-break:break-all;text-align:left">' + esc(url) + '</div>'
      + '<div style="color:#94a3b8;margin:8px 0 4px">❌ النتيجة:</div>'
      + '<div style="color:#fca5a5">' + esc(errMsg) + '</div>'
      + '</div>'

      + (fileProto
        ? '<div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);border-radius:12px;padding:10px 14px;font-size:13px;color:#fde68a;margin-bottom:10px">'
          + '💡 إنت فاتح الصفحة <b>من ملف على جهازك</b> (file://) — المتصفح بيمنع المواقع من قراءة ملفات JSON المحلية. شغّل سيرفر محلي (زي ما في README) أو ارفع على الاستضافة.</div>'
        : '')

      + '<div style="background:#0b0f19;border:1px solid rgba(148,163,184,.15);border-radius:12px;padding:12px 16px;font-size:13.5px;margin-bottom:14px">'
      + '<div style="font-weight:800;margin-bottom:6px">🛠️ جرّب الحلول دي بالترتيب:</div>'
      + '<ol style="margin:0;padding-right:20px;color:#cbd5e1">'
      + '<li>افتح المسار اللي فوق في تاب لوحده — المفروض تشوف نص طويل فيه بيانات الموقع.'
      + (is404 ? ' <b style="color:#fca5a5">(ظهر 404؟ يبقى فولدر data مش مترفع صح)</b>' : '') + '</li>'
      + '<li>اتأكد إن فولدر <b style="font-family:monospace">data</b> مترفع جوه نفس فولدر الصفحة (جنب <b style="font-family:monospace">js</b> و <b style="font-family:monospace">css</b>) وبنفس الاسم بحروف small.</li>'
      + '<li>اعمل تحديث قوي للصفحة: <b dir="ltr">Cmd+Shift+R</b> على ماك أو <b dir="ltr">Ctrl+Shift+R</b> على ويندوز.</li>'
      + '<li>لو لسه — خد سكرين شوت للشاشة دي وابعتها 🙏</li>'
      + '</ol></div>'

      + (embeddedTried
        ? '<div style="font-size:12px;color:#64748b;margin-bottom:14px">🔎 ملحوظة: النسخة الاحتياطية المدمجة (<span style="font-family:monospace">js/embedded-data.js</span>) برضه مش موجودة — يعني غالبًا فولدر كامل مترفعش على الاستضافة.</div>'
        : '')

      + '<button id="sl-retry" style="width:100%;background:#4f46e5;border:none;color:#fff;font-family:inherit;'
      + 'font-size:15px;font-weight:700;padding:12px;border-radius:12px;cursor:pointer">🔄 إعادة المحاولة</button>'
      + '</div>';

    var btn = overlay.querySelector ? overlay.querySelector('#sl-retry') : null;
    if (btn) btn.onclick = function () { location.reload(); };
  }

  /* ---------- الواجهة الرئيسية ---------- */
  async function loadCore() {
    showLoading();
    var fullUrl = 'data/sites.json';
    try { fullUrl = new URL('data/sites.json', location.href).href; } catch (e) { }

    var fetchErr = null;
    try {
      var data = await fetchJson('data/sites.json');
      hideOverlay();
      return { data: data, source: 'server' };
    } catch (err) {
      fetchErr = err;
      console.warn('[SitesLoader] فشل تحميل data/sites.json:', err);
      setSub('السيرفر مردّش كويس… بنجرّب النسخة الاحتياطية المدمجة 🔄');
    }

    var emb = await loadEmbedded();
    if (emb) {
      hideOverlay();
      showEmbeddedBanner();
      return { data: emb, source: 'embedded' };
    }

    showFatal(fullUrl, fetchErr, true);
    return null;
  }

  window.SitesLoader = { load: loadCore };
})();

/* ============================================================
   مكتبة مواد كلية الهندسة — نسخة الزوّار (viewer.js)
   ------------------------------------------------------------
   عرض فقط: مفيش هنا أي تعديل أو تسجيل دخول.
   المحتوى بيتقرا من data/sites.json (اللي بينزل من زر "تصدير"
   في نسخة الأدمن وبيترفع مكانه).
   يعتمد على: config.js (سجل الأقسام الثابت)
   ============================================================ */

// ---------------- أدوات مساعدة ----------------
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function getLinkIcon(u) {
  if (!u) return 'fa-link';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'fa-brands fa-youtube';
  if (u.includes('drive.google.com')) return 'fa-brands fa-google-drive';
  if (u.includes('sharepoint.com') || u.includes('onedrive')) return 'fa-brands fa-microsoft';
  return 'fa-link';
}
function getLinkColor(u) {
  if (!u) return 'text-gray-500';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'text-red-500';
  if (u.includes('drive.google.com')) return 'text-green-500';
  if (u.includes('sharepoint.com') || u.includes('onedrive')) return 'text-blue-500';
  return 'text-indigo-500';
}
const NOTE_COLORS_LIGHT = [
  { bg: 'linear-gradient(135deg,#fef9c3,#fef08a)', color: '#713f12' },
  { bg: 'linear-gradient(135deg,#dbeafe,#bfdbfe)', color: '#1e3a8a' },
  { bg: 'linear-gradient(135deg,#dcfce7,#bbf7d0)', color: '#166534' },
  { bg: 'linear-gradient(135deg,#fce7f3,#fbcfe8)', color: '#9d174d' },
  { bg: 'linear-gradient(135deg,#f3e8ff,#e9d5ff)', color: '#5b21b6' }
];
const NOTE_COLORS_DARK = [
  { bg: 'linear-gradient(135deg,#78350f,#92400e)', color: '#fef3c7' },
  { bg: 'linear-gradient(135deg,#1e3a8a,#1e40af)', color: '#dbeafe' },
  { bg: 'linear-gradient(135deg,#14532d,#166534)', color: '#d1fae5' },
  { bg: 'linear-gradient(135deg,#831843,#9d174d)', color: '#fce7f3' },
  { bg: 'linear-gradient(135deg,#4c1d95,#6d28d9)', color: '#ede9fe' }
];
const COURSE_ICONS = ['fa-book','fa-flask','fa-calculator','fa-drafting-compass','fa-code','fa-cogs','fa-atom','fa-globe','fa-lightbulb','fa-graduation-cap','fa-brain','fa-chart-bar','fa-images','fa-camera','fa-photo-film','fa-panorama','fa-image','fa-mountain-sun','fa-industry','fa-hard-drive','fa-feather','fa-star','fa-book-open'];
const COURSE_COLORS = ['from-indigo-500 to-purple-600','from-cyan-500 to-blue-600','from-emerald-500 to-teal-600','from-orange-500 to-red-500','from-pink-500 to-rose-600','from-violet-500 to-purple-700','from-sky-500 to-indigo-600','from-amber-500 to-orange-600','from-green-500 to-emerald-600','from-red-500 to-pink-600'];

/* ---------------- الترمين (ترم أول / ترم تاني) ----------------
   كل مادة ليها حقل اختياري sem: '1' = ترم أول (الافتراضي) / '2' = ترم تاني.
   المواد القديمة اللي مفيهاش sem بتتحسب ترم أول تلقائياً — يعني بياناتك
   القديمة شغالة من غير أي تعديل، وتوزّعها على الترمين من لوحة الأدمن.
   أقسام البرامج النوعية (group:'special') بتتعرض باسم Level 100..400. */
const TERM_ORDER = ['1', '2'];
const TERM_NAMES = { '1': 'الترم الأول', '2': 'الترم الثاني' };
const LEVEL_NAMES = { '1': 'Level 100', '2': 'Level 200', '3': 'Level 300', '4': 'Level 400' };
function yearLabel(d, y) { return (d && d.group === 'special') ? LEVEL_NAMES[y] : YEAR_NAMES[y]; }
function courseSem(c, deptId) {
  // sem الصريح ليه الأولوية — القديم من غير sem بيتحسب حسب القسم:
  // اعدادي → ترم تاني (المحتوى الحالي)، الباقي → ترم أول
  if (c && String(c.sem) === '2') return '2';
  if (c && String(c.sem) === '1') return '1';
  return deptId === 'prep' ? '2' : '1';
}

// ---------------- التوست (عرض رسائل بس) ----------------
function showToast(msg, type) {
  type = type || 'info';
  const root = $('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast toast-in ' + type;
  el.innerHTML = '<i class="fa ' + (type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-times-circle' : 'fa-info-circle') + ' text-lg"></i><span>' + esc(msg) + '</span>';
  el.onclick = () => el.remove();
  root.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 3500);
}

// ---------------- الحالة: هيكلة + تحميل من sites.json ----------------
function defaultState() {
  const departments = {};
  DEPARTMENTS.forEach(d => {
    const years = {};
    if (d.noYears) years['1'] = [];
    else YEAR_ORDER.forEach(y => { years[y] = []; });
    departments[d.id] = { years: years };
  });
  return { departments: departments, customDepts: [], deptOverrides: {}, hiddenDepts: [], deptOrder: [] };
}
function normalizeState(s) {
  const base = defaultState();
  if (!s || typeof s !== 'object') return base;
  const deps = s.departments && typeof s.departments === 'object' ? s.departments : {};
  DEPARTMENTS.forEach(d => {
    const cur = deps[d.id];
    if (cur && cur.years && typeof cur.years === 'object') {
      const outYears = {};
      Object.keys(base.departments[d.id].years).forEach(y => {
        outYears[y] = Array.isArray(cur.years[y]) ? cur.years[y] : [];
      });
      base.departments[d.id] = { years: outYears };
    }
  });
  /* أقسام مخصوصة ضافها السوبر أدمن واتصدّرت مع البيانات */
  if (Array.isArray(s.customDepts)) {
    base.customDepts = s.customDepts.filter(cd => cd && cd.id && cd.name && !DEPARTMENTS.some(d => d.id === cd.id));
    base.customDepts.forEach(cd => {
      const cy = deps[cd.id];
      const out = {};
      YEAR_ORDER.forEach(y => { out[y] = (cy && cy.years && Array.isArray(cy.years[y])) ? cy.years[y] : []; });
      base.departments[cd.id] = { years: out };
    });
  }
  /* تفضيلات إدارة الأقسام (تعديل/ترتيب/حذف) — بتتصدّر مع sites.json */
  if (s && s.deptOverrides && typeof s.deptOverrides === 'object') {
    Object.keys(s.deptOverrides).forEach(function(k) {
      if (!DEPARTMENTS.some(function(d) { return d.id === k; })) return;
      const o = s.deptOverrides[k] || {};
      const clean = {};
      ['name', 'desc', 'welcome', 'icon', 'color'].forEach(function(f) {
        if (typeof o[f] === 'string' && o[f].trim()) clean[f] = o[f];
      });
      if (Object.keys(clean).length) base.deptOverrides[k] = clean;
    });
  }
  /* الأقسام المخفية نهائياً — مش سلة محذوفات. بنقرا الاسمين (الجديد + القديم)
     ونمسح أي بقايا داتا للأقسام المخفية عشان ملفات التصدير القديمة تتنضّف لوحدها */
  const hiddenMerge = [];
  [s.hiddenDepts, s.deletedDepts].forEach(function(arr) {
    if (!Array.isArray(arr)) return;
    arr.forEach(function(x) { if (typeof x === 'string' && hiddenMerge.indexOf(x) === -1) hiddenMerge.push(x); });
  });
  hiddenMerge.forEach(function(x) {
    if (base.departments[x]) delete base.departments[x];
    if (base.deptOverrides[x]) delete base.deptOverrides[x];
  });
  base.customDepts = base.customDepts.filter(function(cd) { return hiddenMerge.indexOf(cd.id) === -1; });
  base.hiddenDepts = hiddenMerge.filter(function(x) {
    return DEPARTMENTS.some(function(d) { return d.id === x; });
  });
  if (Array.isArray(s.deptOrder)) {
    base.deptOrder = s.deptOrder.filter(function(x, ix, arr) {
      return typeof x === 'string' && arr.indexOf(x) === ix &&
        (DEPARTMENTS.some(function(d) { return d.id === x; }) || base.customDepts.some(function(cd) { return cd.id === x; }));
    });
  }
  return base;
}
let state = defaultState();
let dataReady = false;
let LAST_EXPORT_AT = null; /* ج26: تاريخ آخر تصدير للمحتوى — بيظهر كتشيب في الرئيسية */
async function loadState() {
  // SitesLoader الموحّد: fetch ← نسخة مدمجة ← شاشة تشخيص
  try {
    const pack = await window.SitesLoader.load();
    if (pack) { state = normalizeState(pack.data); if (pack.data && typeof pack.data.exportedAt === 'number') LAST_EXPORT_AT = pack.data.exportedAt; /* ج26 */ }
  } finally {
    dataReady = true;
  }
}
/* إدارة الأقسام: overrides (تعديل بيانات الأساسية) + إخفاء نهائي + ترتيب مخصص */
function isDeptHidden(id) { return ((state && state.hiddenDepts) || []).indexOf(id) !== -1; }
function withOverride(d) {
  const o = ((state && state.deptOverrides) || {})[d.id];
  if (!o) return d;
  const m = Object.assign({}, d);
  ['name', 'desc', 'welcome', 'icon', 'color'].forEach(function(k) {
    if (typeof o[k] === 'string' && o[k].trim()) m[k] = o[k];
  });
  return m;
}
function allDepts() {
  const list = DEPARTMENTS.concat(((state && state.customDepts) || []))
    .filter(function(d) { return !isDeptHidden(d.id); })
    .map(withOverride);
  const ord = (state && Array.isArray(state.deptOrder)) ? state.deptOrder : [];
  return list.map(function(d, i) { return { d: d, i: i }; })
    .sort(function(a, b) {
      if (a.d.group !== b.d.group) return a.i - b.i; /* الجروب ثابت — الترتيب جواه بس */
      const ka = ord.indexOf(a.d.id), kb = ord.indexOf(b.d.id);
      const va = ka < 0 ? 9999 : ka, vb = kb < 0 ? 9999 : kb;
      return va === vb ? a.i - b.i : va - vb;
    })
    .map(function(x) { return x.d; });
}
function deptOf(id) { return allDepts().find(d => d.id === id); }
function getYearCourses(deptId, year) {
  const d = state.departments[deptId];
  if (!d || !d.years) return [];
  return d.years[year] || [];
}
function findCourse(deptId, year, courseId) {
  return getYearCourses(deptId, year).find(c => c.id === courseId);
}
function deptCounts(deptId) {
  let courses = 0, links = 0;
  const dep = state.departments[deptId];
  if (dep && dep.years) Object.keys(dep.years).forEach(y => {
    (dep.years[y] || []).forEach(c => {
      courses++;
      links += (c.sections || []).reduce((a, s) => a + (s.links || []).length, 0);
    });
  });
  return { courses: courses, links: links };
}

// ---------------- الراوتنج (الهاش) ----------------
function parseRoute() {
  const hash = (window.location.hash || '').replace(/^#/, '');
  const parts = hash.split('/').filter(Boolean);
  const route = { dept: null, year: '1', term: null, course: null, page: null };
  /* صفحات الشريط الرأسي — كلمات محجوزة بتتفسّر قبل أي قسم (جولة 21) */
  if (parts.length && RAIL_PAGES.indexOf(parts[0]) !== -1) { route.page = parts[0]; return route; }
  if (parts.length && deptOf(parts[0])) {
    route.dept = parts[0];
    const d = deptOf(route.dept);
    if (d.noYears) {
      // اعدادي برضه متقسمة ترمين: parts[1] = الترم، parts[2] = المادة
      if (TERM_ORDER.includes(parts[1])) { route.term = parts[1]; route.course = parts[2] || null; }
      else { route.course = parts[1] || null; } // روابط قديمة بتفضل شغالة
    } else {
      if (YEAR_ORDER.includes(parts[1])) {
        route.year = parts[1];
        if (TERM_ORDER.includes(parts[2])) { route.term = parts[2]; route.course = parts[3] || null; }
        else { route.course = parts[2] || null; } // روابط قديمة بدون ترم — بتفضل شغالة
      } else if (parts[1]) { route.course = parts[1]; }
    }
  }
  return route;
}
function goHome() { window.location.hash = ''; }
function openDept(id) { window.location.hash = id; }
function openYear(deptId, year) { window.location.hash = deptId + '/' + year; }
function openTerm(deptId, year, term) {
  const d = deptOf(deptId);
  // اعدادي مفيهاش سنين: اللينك بيبقى قسم/ترم بس، غير كده قسم/سنة/ترم
  window.location.hash = d.noYears ? (deptId + '/' + term) : (deptId + '/' + year + '/' + term);
}
function openCourse(dept, year, term, courseId) {
  const d = deptOf(dept);
  window.location.hash = d.noYears ? (dept + '/' + term + '/' + courseId) : (dept + '/' + year + '/' + term + '/' + courseId);
}
function closeCourseView(dept, year, term, replace) {
  const d = deptOf(dept);
  const h = d.noYears ? (term ? (dept + '/' + term) : dept) : (term ? (dept + '/' + year + '/' + term) : (dept + '/' + year));
  if (replace) {
    // لينك مكسور: استبدال الهاش في الهيستوري بدل الإضافة عشان زرار باك يفضل شغال
    try { history.replaceState(null, '', '#' + h); render(); window.scrollTo(0, 0); }
    catch (e) { window.location.hash = h; }
    return;
  }
  window.location.hash = h;
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// ---------------- الوضع الليلي ----------------
let darkMode = false;
try { darkMode = localStorage.getItem('darkMode_v2') === 'true'; } catch (e) {}
function applyDark() {
  if (darkMode) document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
}
function toggleDark() {
  darkMode = !darkMode;
  try { localStorage.setItem('darkMode_v2', darkMode); } catch (e) {}
  applyDark(); render();
}

// ---------------- تتبع التقدم (Progress Tracking — بيتحفظ في متصفح الزائر) ----------------
const PROGRESS_KEY = 'eng_progress_v1';
let progress = { links: {}, courses: {} };
try {
  const rawP = localStorage.getItem(PROGRESS_KEY);
  if (rawP) { const p = JSON.parse(rawP); progress = { links: p.links || {}, courses: p.courses || {} }; }
} catch (e) {}
function saveProgress() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) {} }
function findCourseById(cid) {
  const deps = (state && state.departments) || {};
  for (const did in deps) {
    for (const y in deps[did].years) {
      const c = (deps[did].years[y] || []).find(x => x.id === cid);
      if (c) return c;
    }
  }
  return null;
}
function linkStats(c) {
  let total = 0, done = 0;
  (c.sections || []).forEach(s => (s.links || []).forEach(l => { total++; if (progress.links[l.id]) done++; }));
  return { total: total, done: done };
}
function coursePct(c) {
  const st = linkStats(c);
  if (st.total > 0) return st.done / st.total;
  return progress.courses[c.id] ? 1 : 0;
}
function courseIsDone(c) { return coursePct(c) >= 1 && true; }
function aggStats(list) {
  const total = list.length;
  let done = 0;
  list.forEach(c => { if (courseIsDone(c)) done++; });
  return { total: total, done: done, pct: total ? done / total : 0 };
}

// ---------------- تصدير «تقدمي» لموقع StudyHub (قسم اتصالات وحاسبات بس) ----------------
/* بتنزّل ملف materials-progress.json فيه أسماء المواد وحالتها: الملف بيتكتب
   بنفس صيغة studyhub-progress اللي StudyHub بيفهمها — اللينكات والملاحظات مش بتتصدّر. */
const STUDYHUB_DEPT = 'commcomp';
function exportMyProgress() {
  try {
    const d = deptOf(STUDYHUB_DEPT);
    const deps = (state && state.departments) || {};
    const dd = deps[STUDYHUB_DEPT] || { years: {} };
    const groups = [];
    let total = 0, done = 0;
    (d && d.noYears ? ['1'] : YEAR_ORDER).forEach(function (y) {
      const list = (dd.years && dd.years[y]) || [];
      if (!list.length) return;
      const items = list.map(function (c) {
        const st = linkStats(c);
        const isDone = courseIsDone(c);
        total++; if (isDone) done++;
        return { id: c.id, name: c.title || 'مادة', done: isDone, links: st.total, linksDone: st.done };
      });
      groups.push({ id: 'year-' + y, name: yearLabel(d, y), items: items });
    });
    const payload = {
      app: 'eng-materials', type: 'studyhub-progress', version: 1, exportedAt: Date.now(),
      label: 'موقع المواد — ' + (d ? d.name : STUDYHUB_DEPT), scope: 'dept:' + STUDYHUB_DEPT,
      stats: { total: total, done: done }, groups: groups
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'materials-progress.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    showToast('اتنزّل ملف تقدمك في «' + (d ? d.name : 'القسم') + '» — ارفعه في StudyHub 📊', 'success');
  } catch (err) {
    console.error(err);
    showToast('حصلت مشكلة أثناء تجهيز ملف التقدم', 'error');
  }
}
function deptAgg(deptId) {
  const dep = ((state || {}).departments || {})[deptId];
  if (!dep) return { total: 0, done: 0, pct: 0 };
  let all = [];
  Object.keys(dep.years || {}).forEach(y => { all = all.concat(dep.years[y] || []); });
  return aggStats(all);
}
function toggleLink(id) {
  if (progress.links[id]) delete progress.links[id]; else progress.links[id] = true;
  saveProgress(); refreshProgressUI();
}
function toggleCourseDone(id) {
  if (progress.courses[id]) delete progress.courses[id]; else progress.courses[id] = true;
  saveProgress(); refreshProgressUI();
}
function resetCourseProgress(cid) {
  const c = findCourseById(cid);
  delete progress.courses[cid];
  if (c) (c.sections || []).forEach(s => (s.links || []).forEach(l => delete progress.links[l.id]));
  saveProgress(); refreshProgressUI();
  showToast('تم مسح تقدمك في المادة دي', 'info');
}
const RING_C = (2 * Math.PI * 13).toFixed(1);
function ringHTML(pct, label) {
  pct = Math.max(0, Math.min(1, pct || 0));
  const off = (RING_C * (1 - pct)).toFixed(1);
  return '<span class="bp-ring' + (pct >= 1 ? ' bp-full' : '') + '">' +
    '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">' +
    '<circle class="bp-rbg" cx="16" cy="16" r="13"/>' +
    '<circle class="bp-rfg" cx="16" cy="16" r="13" stroke-dasharray="' + RING_C + '" stroke-dashoffset="' + off + '"/>' +
    '</svg>' + (label ? '<span class="bp-rlab">' + label + '</span>' : '') + '</span>';
}
/* إعادة رسم عناصر التقدم في الصفحة الحالية — من غير render كامل عشان السكرول ميتحركش */
function refreshProgressUI() {
  const rootEl = document.getElementById('root');
  if (!rootEl) return;
  rootEl.querySelectorAll('[data-pjl]').forEach(row => {
    const on = !!progress.links[row.getAttribute('data-pjl')];
    row.classList.toggle('bp-done', on);
    const box = row.querySelector('.bp-check');
    if (box) box.classList.toggle('bp-on', on);
  });
  rootEl.querySelectorAll('[data-pjc]').forEach(el => {
    const c = findCourseById(el.getAttribute('data-pjc'));
    if (!c) return;
    const st = linkStats(c);
    el.innerHTML = ringHTML(coursePct(c), st.total ? (st.done + '/' + st.total) : '');
    el.classList.toggle('bp-full', coursePct(c) >= 1);
  });
  rootEl.querySelectorAll('[data-pjt]').forEach(el => {
    const parts = el.getAttribute('data-pjt').split('|');
    const list = getYearCourses(parts[0], parts[1]).filter(cc => courseSem(cc, parts[0]) === parts[2]);
    const s = aggStats(list);
    el.innerHTML = ringHTML(s.pct, s.done + '/' + s.total);
    el.classList.toggle('bp-full', s.pct >= 1 && s.total > 0);
  });
  rootEl.querySelectorAll('[data-pjd]').forEach(el => {
    const s = deptAgg(el.getAttribute('data-pjd'));
    if (el.getAttribute('data-pjf') === 'bar') {
      const i = el.querySelector('i');
      if (i) i.style.width = (s.pct * 100).toFixed(0) + '%';
      el.title = s.done + '/' + s.total + ' مكتملة';
      el.classList.toggle('bp-full', s.pct >= 1 && s.total > 0);
    } else {
      el.textContent = s.done + '/' + s.total + ' مكتملة · ' + Math.round(s.pct * 100) + '%';
      el.classList.toggle('bp-full', s.pct >= 1 && s.total > 0);
    }
  });
  rootEl.querySelectorAll('[data-pjm]').forEach(btn => {
    const on = !!progress.courses[btn.getAttribute('data-pjm')];
    btn.classList.toggle('bp-on', on);
    btn.innerHTML = on ? '<i class="fa fa-check"></i> مكتملة' : '<i class="fa fa-check"></i> علّمها كمكتملة';
  });
}

// ---------------- أجزاء مشتركة ----------------
let courseTitleCache = '';
function headerHTML(route) {
  const dept = route.dept ? deptOf(route.dept) : null;
  const title = route.course && dept ? courseTitleCache : (dept ? dept.name : 'مكتبة مواد كلية الهندسة');
  return '' +
  '<header class="sticky top-0 z-50 glass border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80">' +
    '<div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-2 sm:gap-4">' +
      '<div class="flex items-center gap-2 min-w-0">' +
        (dept ? '<button onclick="goHome()" title="كل الأقسام" class="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"><i class="fa fa-arrow-right"></i></button>' : '') +
        '<div class="flex items-center gap-2 min-w-0">' +
          '<div class="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center bp-tile3d" style="background:var(--bp-accent);font-size:1.05rem">' + iconSVG(dept ? dept.icon : 'fa-graduation-cap') + '</div>' +
          '<div class="min-w-0"><p class="bp-micro" style="margin-bottom:-2px">MATERIALS INDEX · SEC/' + (dept ? dept.id.toUpperCase() : 'ALL') + '</p>' +
          '<h1 class="text-sm sm:text-base font-bold text-gray-800 dark:text-white leading-tight truncate">' + esc(title) + '</h1>' +
          '<p class="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">مواد كل الأقسام — عام وبرامج نوعية</p></div>' +
        '</div>' +
      '</div>' +
      '<button onclick="exportMyProgress()" title="حمّل ملف تقدمك في قسم اتصالات وحاسبات (لموقع StudyHub)" class="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"><i class="fa fa-cloud-arrow-down"></i></button>' +
      '<button onclick="toggleDark()" title="الوضع الليلي" class="bp-modetoggle w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 dark:from-amber-400 dark:to-orange-500 text-white dark:text-gray-900 shadow-md"><i class="fa ' + (darkMode ? 'fa-sun' : 'fa-moon') + '"></i></button>' +
    '</div>' +
  '</header>';
}
function footerHTML() {
  return '<footer class="mt-auto text-center py-4 pb-24 lg:pb-6 text-xs text-gray-400 dark:text-gray-600 border-t border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 glass">' +
    '<p class="bp-micro" style="margin-bottom:4px">ENG · MANS · BLUEPRINT EDITION</p>' +
    '<span class="bp-signature" dir="ltr">Created by abdallah elmohammady</span></footer>';
}
function deptCardHTML(d, counts, i) {
  const idx = ('0' + (allDepts().indexOf(d) + 1)).slice(-2);
  const tilt = (i || 0) % 2 === 0 ? ' bp-tilt-l' : ' bp-tilt-r';
  const _a = deptAgg(d.id);
  return '' +
  '<div class="card-hover bp-card' + tilt + ' cursor-pointer group relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm hover:shadow-xl bp-reveal" style="--i:' + (i || 0) + '" onclick="openDept(\'' + d.id + '\')">' +
    '<span class="bp-crop tl"></span><span class="bp-crop tr"></span><span class="bp-crop bl"></span><span class="bp-crop br"></span>' +
    '<div class="h-1.5 bg-gradient-to-r ' + d.color + '"></div>' +
    '<div class="p-5">' +
      '<div class="flex items-start justify-between mb-4">' +
        '<div class="w-12 h-12 bg-gradient-to-br ' + d.color + ' bp-tile3d rounded-xl flex items-center justify-center text-xl shadow-md">' + iconSVG(d.icon) + '</div>' +
        '<div class="flex flex-col items-end gap-1">' +
          '<span class="bp-micro" dir="ltr">SEC/' + idx + '</span>' +
          (d.noYears ? '<span class="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full font-medium">سنة إعدادية</span>' : '') +
        '</div>' +
      '</div>' +
      '<h3 class="font-bold text-gray-800 dark:text-white text-base leading-tight mb-1">' + esc(d.name) + '</h3>' +
      '<p class="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">' + esc(d.desc || '') + '</p>' +
      '<div class="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-3">' +
        '<span class="flex items-center gap-1"><i class="fa fa-book text-indigo-400"></i><span>' + counts.courses + ' مادة</span></span>' +
        '<span class="flex items-center gap-1"><i class="fa fa-link text-cyan-400"></i><span>' + counts.links + ' رابط</span></span>' +
        (counts.courses === 0 ? '<span class="mr-auto text-amber-500 font-semibold">قريباً…</span>' : '') +
      '</div>' +
      '<span class="bp-minibar' + (_a.pct >= 1 && _a.total ? ' bp-full' : '') + '" data-pjd="' + d.id + '" data-pjf="bar" title="' + _a.done + '/' + _a.total + ' مكتملة"><i style="width:' + (_a.pct * 100).toFixed(0) + '%"></i></span>' +
    '</div>' +
  '</div>';
}

// ---------------- الرئيسية: كروت الأقسام ----------------
// رسمة هوية خفيفة: كتاب هندسي + مبنى كلية + دوائر (SVG inline)
function emHomeArt() {
  return '<svg class="em-home-art" viewBox="0 0 560 300" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path class="em-art-fill" d="M122 246c53-25 104-23 158 8V94c-51-29-103-29-158-4v156Zm316 0c-53-25-104-23-158 8V94c51-29 103-29 158-4v156Z"/>' +
    '<path d="M122 246c53-25 104-23 158 8V94c-51-29-103-29-158-4v156Zm316 0c-53-25-104-23-158 8V94c51-29 103-29 158-4v156ZM280 94v160"/>' +
    '<path d="M151 119c34-12 67-11 101 3m-101 25c34-12 67-11 101 3m-101 25c34-12 67-11 101 3m57-56c34-13 66-14 101-3m-101 31c34-13 66-14 101-3m-101 31c34-13 66-14 101-3" opacity=".55"/>' +
    '<path d="M194 61 280 24l86 37-86 38-86-38Zm137 23v34M318 88v22c-23 15-53 15-76 0V88"/>' +
    '<path d="M43 252h78m318 0h78M54 268h56l22-22m296 0 22 22h56" class="em-art-circuit"/>' +
    '<circle cx="80" cy="179" r="30"/><circle cx="80" cy="179" r="12"/><path d="M80 137v14m0 56v14m-42-42h14m56 0h14m-72-30 10 10m40 40 10 10m0-60-10 10m-40 40-10 10"/>' +
    '<path d="M438 96h64v45h-64zM451 141v35m38-35v35m-45 0h52M456 111h28m-14-14v28"/>' +
  '</svg>';
}
function emGroupStats(group) {
  const ds = allDepts().filter(function(d){ return d.group === group; });
  let courses = 0, links = 0;
  ds.forEach(function(d){ const c = deptCounts(d.id); courses += c.courses; links += c.links; });
  return { depts: ds.length, courses: courses, links: links };
}

function renderHome() {
  /* 🏠 الرئيسية (جولة 24): ترحيب نصّي + «في» جوه كتلة العنوان الملوّن مرة واحدة +
     كارتين كبار + لوحة تقدّم بمرجع الأقسام اللي الطالب اشتغل فيها فعلًا — مش الموقع كله. */
  const totals = { courses: 0, links: 0 };
  const depts = allDepts();
  depts.forEach(d => { const c = deptCounts(d.id); totals.courses += c.courses; totals.links += c.links; });
  const generalCount = depts.filter(d => d.group === 'general').length;
  const specialCount = depts.filter(d => d.group === 'special').length;
  /* — تقدّم الطالب: اكتشاف تلقائي للأقسام اللي علّم فيها لينك/مادة — */
  const deptAct = [];
  depts.forEach(d => {
    const blk = state.departments[d.id];
    if (!blk || !blk.years) return;
    let lt = 0, ld = 0, ct = 0, cd = 0;
    (d.noYears ? ['1'] : YEAR_ORDER).forEach(y => (blk.years[y] || []).forEach(c => {
      ct++;
      (c.sections || []).forEach(s2 => (s2.links || []).forEach(l => { lt++; if (progress.links && progress.links[l.id]) ld++; }));
      if (courseIsDone(c)) cd++;
    }));
    if (ld > 0 || cd > 0) deptAct.push({ name: d.name, lt: lt, ld: ld, ct: ct, cd: cd });
  });
  const hasAct = deptAct.length > 0;
  const linksTotal = deptAct.reduce((a, x) => a + x.lt, 0);
  const linksDone = deptAct.reduce((a, x) => a + x.ld, 0);
  const coursesTotal = deptAct.reduce((a, x) => a + x.ct, 0);
  const coursesDone = deptAct.reduce((a, x) => a + x.cd, 0);
  const favsCount = getFavs().length;
  const pct = linksTotal ? (linksDone / linksTotal) : 0;
  const pctTxt = Math.round(pct * 100) + '%';
  const actNames = deptAct.map(x => x.name).join(' + ');
  const RING_BIG_C = (2 * Math.PI * 44).toFixed(1);
  const ringOff = (RING_BIG_C * (1 - pct)).toFixed(1);
  const bigGroupCard = function (g, count) {
    const isG = g === 'general';
    const st = emGroupStats(g);
    return '<article class="em-group-card ' + (isG ? 'em-general' : 'em-special') + '" onclick="railGo(\'' + g + '\')">' +
      '<div class="em-group-top"><span class="em-group-icon"><i class="fa ' + (isG ? 'fa-building-columns' : 'fa-certificate') + '"></i></span><span class="em-group-arrow"><i class="fa fa-arrow-left"></i></span></div>' +
      '<p class="bp-micro">' + (isG ? 'BLOCK / A · GENERAL' : 'BLOCK / B · SPECIAL') + '</p>' +
      '<h3>' + GROUP_NAMES[g] + '</h3>' +
      '<p>' + (isG ? 'الأقسام الأساسية بكلية الهندسة، مرتبة حسب الفرق والترمين.' : 'البرامج المتخصصة، مرتبة حسب المستويات من Level 100 إلى Level 400.') + '</p>' +
      '<div class="em-group-meta"><span><b>' + count + '</b> ' + (isG ? 'أقسام' : 'برامج') + '</span><span><b>' + st.courses + '</b> مادة</span><span><b>' + st.links + '</b> رابط</span></div>' +
    '</article>';
  };
  const dashTile = function (label, value, icon, grad) {
    return '<div class="bp-card rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3 sm:p-4 flex items-center gap-2 sm:gap-3">' +
      '<div class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br ' + grad + ' flex items-center justify-center text-white flex-shrink-0"><i class="fa ' + icon + '"></i></div>' +
      '<div class="min-w-0"><p class="text-lg sm:text-xl font-black text-gray-800 dark:text-white leading-none" dir="ltr">' + value + '</p><p class="text-[11px] sm:text-xs text-gray-400 mt-1 leading-snug">' + label + '</p></div></div>';
  };
  const dashBody = hasAct
    ? '<div class="grid lg:grid-cols-3 gap-4 sm:gap-6 items-center">' +
        '<div class="flex flex-col items-center justify-center gap-3">' +
          '<div class="relative w-24 h-24 sm:w-28 sm:h-28">' +
            '<svg viewBox="0 0 110 110" class="w-24 h-24 sm:w-28 sm:h-28 -rotate-90">' +
              '<circle class="bp-rbg" cx="55" cy="55" r="44" fill="none" stroke-width="10"></circle>' +
              '<circle class="bp-rfg" cx="55" cy="55" r="44" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + RING_BIG_C + '" stroke-dashoffset="' + ringOff + '"></circle>' +
            '</svg>' +
            '<div class="absolute inset-0 flex flex-col items-center justify-center">' +
              '<span class="text-xl sm:text-2xl font-black text-gray-800 dark:text-white" dir="ltr">' + pctTxt + '</span>' +
              '<span class="text-[11px] text-gray-400">من لينكاتك</span>' +
            '</div>' +
          '</div>' +
          '<p class="text-[11px] sm:text-xs text-gray-400 text-center max-w-[11rem] sm:max-w-[13rem]">علّم على أي لينك خلصته من صفحة مادته — والنسبة هنا بتتحدّث على طول</p>' +
        '</div>' +
        '<div class="grid grid-cols-2 gap-2 sm:gap-3">' +
          dashTile('لينكات مكتملة', linksDone + '/' + linksTotal, 'fa-check-double', 'from-indigo-500 to-blue-600') +
          dashTile('مواد مكتملة', coursesDone + '/' + coursesTotal, 'fa-graduation-cap', 'from-emerald-500 to-teal-600') +
          dashTile('لينكات في المفضلة', String(favsCount), 'fa-heart', 'from-rose-500 to-pink-600') +
          dashTile('نسبة الإنجاز الكلية', pctTxt, 'fa-bullseye', 'from-violet-500 to-purple-600') +
        '</div>' +
        '<div class="grid gap-2 sm:gap-3">' +
          '<div class="bp-card rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3 sm:p-4 flex items-center gap-2 sm:gap-3">' +
            '<div class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-cyan-500 to-sky-600 flex items-center justify-center text-white flex-shrink-0"><i class="fa fa-building-columns"></i></div>' +
            '<div><p class="text-lg sm:text-xl font-black text-gray-800 dark:text-white leading-none" dir="ltr">' + depts.length + '</p><p class="text-[11px] sm:text-xs text-gray-400 mt-1 leading-snug">قسم وبرنامج في الموقع</p></div>' +
          '</div>' +
          '<div class="bp-card rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3 sm:p-4 flex items-center gap-2 sm:gap-3">' +
            '<div class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white flex-shrink-0"><i class="fa fa-book"></i></div>' +
            '<div><p class="text-lg sm:text-xl font-black text-gray-800 dark:text-white leading-none" dir="ltr">' + totals.courses + '</p><p class="text-[11px] sm:text-xs text-gray-400 mt-1 leading-snug">مادة متاحة حاليًا</p></div>' +
          '</div>' +
          '<div class="bp-card rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3 sm:p-4 flex items-center gap-2 sm:gap-3">' +
            '<div class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-600 flex items-center justify-center text-white flex-shrink-0"><i class="fa fa-link"></i></div>' +
            '<div><p class="text-lg sm:text-xl font-black text-gray-800 dark:text-white leading-none" dir="ltr">' + totals.links + '</p><p class="text-[11px] sm:text-xs text-gray-400 mt-1 leading-snug">لينك مرفوع من الأدمنز</p></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<p class="text-[11px] sm:text-xs text-gray-400 mt-4 sm:mt-5 leading-relaxed">بتتجمّع من نشاطك في: <span class="font-bold text-indigo-500">' + esc(actNames) + '</span> — اشتغلت في قسم تاني؟ هينضم للحساب لوحده.</p>'
    : '<div class="text-center py-10 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600">' +
        '<div class="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/25 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl text-indigo-300"><i class="fa fa-flag-checkered"></i></div>' +
        '<p class="text-gray-500 dark:text-gray-300 font-bold">لسه مبدأتش تقفل اللينكات</p>' +
        '<p class="text-xs text-gray-400 mt-2 max-w-md mx-auto">علّم على أول لينك خلصته من صفحة أي مادة — واللوحة دي هتحسب تقدّمك على قسمك اللي بتشتغل فيه، مش على الموقع كله.</p></div>';
  $('root').innerHTML =
  '<div class="min-h-screen flex flex-col transition-colors duration-300 ' + (darkMode ? 'dark bg-gray-950' : 'bg-gray-50') + ' dot-pattern">' +
    headerHTML({ dept: null }) +
    '<main class="flex-1 max-w-7xl w-full mx-auto px-4 py-8">' +
      '<section class="em-home-hero bp-panel-frame bp-reveal">' +
        '<div class="em-home-copy">' +
          '<p class="bp-micro">WELCOME · ENGINEERING MATERIALS LIBRARY</p>' +
          '<h1 class="site-title">مكتبة مواد <span class="bp-title-mark">كلية الهندسة</span></h1>' +
          '<p>كل الملخصات واللينكات والمذكرات اللي الأدمنز رافعينها في مكان واحد — اختار نوع القسم، تابع تقدمك، واحفظ أهم المصادر.</p>' +
          '<div class="em-home-actions"><button onclick="railGo(\'general\')" class="em-primary-btn"><i class="fa fa-building-columns"></i> استعرض الأقسام</button><button onclick="railGo(\'favorites\')" class="em-secondary-btn"><i class="fa fa-heart"></i> المفضلة</button></div>' +
        '</div>' +
        '<div class="em-home-visual">' + emHomeArt() + '</div>' +
      '</section>' +
      '<section class="em-home-stats">' +
        '<article><span class="em-stat-icon"><i class="fa fa-layer-group"></i></span><div><small>الأقسام والبرامج</small><strong>' + depts.length + '</strong></div></article>' +
        '<article><span class="em-stat-icon"><i class="fa fa-book"></i></span><div><small>المواد المتاحة</small><strong>' + totals.courses + '</strong></div></article>' +
        '<article><span class="em-stat-icon"><i class="fa fa-link"></i></span><div><small>روابط المحتوى</small><strong>' + totals.links + '</strong></div></article>' +
      '</section>' +
      resumeCardHTML() + /* ج25 */
      '<div class="em-home-heading"><div><p class="bp-micro">LIBRARY DIRECTORY</p><h2>اختار نوع الأقسام</h2></div><span>مسارين رئيسيين</span></div><section class="em-group-grid bp-reveal" style="--i:1">' + bigGroupCard('general', generalCount) + bigGroupCard('special', specialCount) + '</section>' +
      '<div class="bp-reveal bp-panel-frame relative overflow-hidden px-6 py-8 sm:px-9" style="--i:2">' +
        '<span class="bp-crop tl"></span><span class="bp-crop tr"></span><span class="bp-crop bl"></span><span class="bp-crop br"></span>' +
        '<p class="bp-micro">YOUR JOURNEY · PROGRESS</p>' +
        '<h2 class="text-base sm:text-lg font-black text-gray-800 dark:text-white mt-1 mb-4 sm:mb-6"><i class="fa fa-chart-line text-indigo-400 ml-1"></i> لوحة تقدّمك</h2>' +
        dashBody +
      '</div>' +
    '</main>' +
    footerHTML() +
  '</div>';
}

// ---------------- صفحة القسم: شريط الفرق + المواد ----------------
let searchQuery = '';
function onSearchInput(v) {
  searchQuery = v;
  renderDeptGrid();
  const si = $('search-input');
  if (si) { si.focus(); try { si.setSelectionRange(si.value.length, si.value.length); } catch (e) {} }
}
function renderDept(deptId, year) {
  const d = deptOf(deptId);
  if (d.noYears) year = '1';
  const __di = ('0' + (allDepts().indexOf(d) + 1)).slice(-2);
  const __a = deptAgg(deptId);
  const years = d.noYears ? ['1'] : YEAR_ORDER;
  let yearBar = '';
  if (!d.noYears) {
    yearBar =
      '<div class="year-bar mb-6 sticky" style="top:74px;z-index:40">' +
        years.map(y => {
          const n = getYearCourses(deptId, y).length;
          return '<button class="year-tab ' + (y === year ? 'active' : '') + '" onclick="openYear(\'' + deptId + '\',\'' + y + '\')">' +
            '<i class="fa ' + (y === '1' ? 'fa-1' : y === '2' ? 'fa-2' : y === '3' ? 'fa-3' : 'fa-4') + '"></i>' +
            yearLabel(d, y) +
            '<span class="count">' + n + '</span>' +
          '</button>';
        }).join('') +
      '</div>';
  }
  const html =
    '<div class="min-h-screen flex flex-col transition-colors duration-300 ' + (darkMode ? 'dark bg-gray-950' : 'bg-gray-50') + ' dot-pattern">' +
      headerHTML({ dept: deptId }) +
      '<main class="flex-1 max-w-7xl w-full mx-auto px-4 py-6">' +
        '<div class="relative overflow-hidden bp-panel-frame bp-reveal p-6 mb-6 shadow-lg" style="--i:0">' +
          '<span class="bp-crop tl"></span><span class="bp-crop tr"></span><span class="bp-crop bl"></span><span class="bp-crop br"></span>' +
          '<span class="bp-ghost" style="font-size:7rem;top:-16px;inset-inline-end:8px" dir="ltr">' + __di + '</span>' +
          '<p class="bp-micro">SEC/' + __di + ' · ' + (d.group === 'special' ? 'SPECIAL PROGRAM' : 'GENERAL DEPT') + ' · MANSOURA ENG</p>' +
          '<div class="flex items-center gap-4 mt-3 relative">' +
            '<div class="w-14 h-14 bp-tile3d rounded-xl flex items-center justify-center text-3xl flex-shrink-0 shadow-md bg-gradient-to-br ' + d.color + '">' + iconSVG(d.icon) + '</div>' +
            '<div>' +
              '<h1 class="text-xl sm:text-2xl font-black">' + esc(d.name) + '</h1>' +
              '<p class="text-sm mt-1" style="color:var(--bp-ink-soft)">' + esc(d.desc || '') + (d.noYears ? ' • مواد اعدادي مقسّمة على ترمين' : ' • اختار ' + (d.group === 'special' ? 'المستوى' : 'الفرقة') + ' وشوفه متقسّم ترمين') + '</p>' +
              (d.welcome ? '<p class="bp-welcome">' + esc(d.welcome) + '</p>' : '') +
            '</div>' +
            '<div class="mr-auto flex-shrink-0 hidden sm:flex">' +
              '<span class="bp-chip' + (__a.pct >= 1 && __a.total ? ' bp-full' : '') + '" data-pjd="' + d.id + '" data-pjf="chip">' + __a.done + '/' + __a.total + ' مكتملة · ' + Math.round(__a.pct * 100) + '%</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        yearBar +
        '<div id="dept-grid-area"></div>' +
      '</main>' +
      footerHTML() +
    '</div>';
  $('root').innerHTML = html;
  renderDeptGrid();
}
function renderDeptGrid() {
  const area = $('dept-grid-area');
  if (!area) return;
  const route = parseRoute();
  const deptId = route.dept;
  const d = deptOf(deptId);
  const year = d.noYears ? '1' : route.year;
  const term = route.term;
  const all = getYearCourses(deptId, year);
  const q = (searchQuery || '').trim().toLowerCase();

  /* ===== (أ) عرض كروت الترمين — أول ما تختار فرقة ===== */
  if (!term && !q) {
    const termStats = (list) => ({
      courses: list.filter(c => c.type !== 'gallery').length,
      galleries: list.filter(c => c.type === 'gallery').length,
      links: list.reduce((a, c) => a + (c.sections || []).reduce((b, s) => b + (s.links || []).length, 0), 0)
    });
    const termCard = (t, iconClass, grad) => {
      const scoped = all.filter(c => courseSem(c, deptId) === t);
      const st = termStats(scoped);
      const s2 = aggStats(scoped);
      return '' +
      '<div class="card-hover bp-card ' + (t === '1' ? 'bp-tilt-l' : 'bp-tilt-r') + ' cursor-pointer group relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm hover:shadow-xl" onclick="openTerm(\'' + deptId + '\',\'' + year + '\',\'' + t + '\')">' +
        '<span class="bp-crop tl"></span><span class="bp-crop tr"></span><span class="bp-crop bl"></span><span class="bp-crop br"></span>' +
        '<span class="bp-ghost" style="font-size:6.5rem;bottom:-18px;inset-inline-end:6px" dir="ltr">0' + t + '</span>' +
        '<div class="h-1.5 bg-gradient-to-r ' + grad + '"></div>' +
        '<div class="p-6 relative">' +
          '<p class="bp-micro" dir="ltr">PLATE 0' + t + (d.noYears ? ' · PREP' : (' · YR/0' + year)) + '</p>' +
          '<div class="flex items-center gap-4 mt-2 mb-4">' +
            '<div class="min-w-0 flex-1"><h3 class="font-black text-gray-800 dark:text-white text-xl leading-tight">' + TERM_NAMES[t] + '</h3>' +
            '<p class="text-xs text-gray-400 mt-1 truncate">' + (d.noYears ? esc(d.name) : esc(yearLabel(d, year)) + ' • ' + esc(d.name)) + '</p></div>' +
            '<span data-pjt="' + deptId + '|' + year + '|' + t + '" class="' + (s2.pct >= 1 && s2.total ? 'bp-full' : '') + '">' + ringHTML(s2.pct, s2.done + '/' + s2.total) + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-3">' +
            '<span class="flex items-center gap-1"><i class="fa fa-book text-indigo-400"></i><span>' + st.courses + ' مادة</span></span>' +
            '<span class="flex items-center gap-1"><i class="fa fa-images text-pink-400"></i><span>' + st.galleries + ' معرض</span></span>' +
            '<span class="flex items-center gap-1"><i class="fa fa-link text-cyan-400"></i><span>' + st.links + ' رابط</span></span>' +
            '<span class="mr-auto font-semibold text-indigo-500"><i class="fa fa-arrow-left ml-1"></i>عرض</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    };
    area.innerHTML =
      '<div class="fade-in">' +
        '<div class="relative mb-6">' +
          '<i class="fa fa-search absolute top-1/2 -translate-y-1/2 right-4 text-gray-400 text-sm"></i>' +
          '<input id="search-input" value="' + esc(searchQuery) + '" oninput="onSearchInput(this.value)" placeholder="🔍 ابحث في كل مواد ' + esc(yearLabel(d, year)) + '..." class="w-full pr-11 pl-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm bp-search">' +
        '</div>' +
        '<p class="text-sm text-gray-500 dark:text-gray-400 mb-4 flex items-center gap-2"><i class="fa fa-layer-group text-indigo-400"></i>' + esc(d.noYears ? d.name : yearLabel(d, year)) + ' متقسّمة على ترمين — اختار الترم اللي عايزه</p>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
          termCard('1', 'fa-1', 'from-indigo-500 to-purple-600') +
          termCard('2', 'fa-2', 'from-emerald-500 to-teal-600') +
        '</div>' +
      '</div>';
    return;
  }

  /* ===== (ب) عرض مواد ترم معيّن — أو اعدادي، أو نتائج بحث في كل الترمين ===== */
  const scoped = term ? all.filter(c => courseSem(c, deptId) === term) : all;
  const filtered = q ? all.filter(c => (c.title || '').toLowerCase().includes(q) || (c.doc || '').toLowerCase().includes(q)) : scoped;
  const totalLinks = scoped.reduce((a, c) => a + (c.sections || []).reduce((b, s) => b + (s.links || []).length, 0), 0);
  const galleries = scoped.filter(c => c.type === 'gallery').length;
  const scopeLabel = d.noYears ? (d.name + (term ? (' — ' + TERM_NAMES[term]) : '')) : (term ? (yearLabel(d, year) + ' — ' + TERM_NAMES[term]) : yearLabel(d, year));

  area.innerHTML =
    '<div class="fade-in">' +
      '<div class="relative mb-6">' +
        '<i class="fa fa-search absolute top-1/2 -translate-y-1/2 right-4 text-gray-400 text-sm"></i>' +
        '<input id="search-input" value="' + esc(searchQuery) + '" oninput="onSearchInput(this.value)" placeholder="🔍 ابحث عن مادة أو معرض في ' + esc(scopeLabel) + '..." class="w-full pr-11 pl-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm bp-search">' +
      '</div>' +
      (term ?
        '<div class="flex items-center gap-2 mb-5 flex-wrap">' +
          '<button onclick="' + (d.noYears ? ('openDept(\'' + deptId + '\')') : ('openYear(\'' + deptId + '\',\'' + year + '\')')) + '" class="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-indigo-500"><i class="fa fa-arrow-right"></i> كل الترمين</button>' +
          '<span class="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-xl"><i class="fa fa-' + term + ' ml-1"></i>' + (d.noYears ? '' : esc(yearLabel(d, year)) + ' • ') + TERM_NAMES[term] + '</span>' +
        '</div>'
      : '') +
      '<div class="grid grid-cols-3 gap-3 mb-8">' +
        [{ label: 'المواد', value: scoped.length - galleries, icon: 'fa-book', color: 'from-indigo-500 to-purple-600' },
         { label: 'المعارض', value: galleries, icon: 'fa-images', color: 'from-pink-500 to-rose-600' },
         { label: 'الروابط', value: totalLinks, icon: 'fa-link', color: 'from-emerald-500 to-teal-600' }]
        .map(s => '<div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700"><div class="w-9 h-9 bg-gradient-to-br ' + s.color + ' rounded-xl flex items-center justify-center text-white mb-2"><i class="fa ' + s.icon + ' text-sm"></i></div><div class="text-2xl font-bold text-gray-800 dark:text-white">' + s.value + '</div><div class="text-xs text-gray-500 dark:text-gray-400 font-medium">' + s.label + '</div></div>').join('') +
      '</div>' +
      (filtered.length === 0 ?
        '<div class="text-center py-20"><div class="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl text-gray-300"><i class="fa ' + (q ? 'fa-search' : 'fa-graduation-cap') + '"></i></div>' +
        '<p class="text-gray-400 font-semibold text-lg">' + (q ? '❌ لا توجد نتائج' : 'لسه مفيش محتوى في ' + esc(scopeLabel)) + '</p>' +
        (!q ? '<p class="text-gray-400 text-sm mt-2">أدمن القسم لسه مارفعش حاجة هنا — ارجع له تاني قريب</p>' : '') +
        '</div>'
      :
        '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">' +
          filtered.map((c, i) => courseCardHTML(deptId, year, term || courseSem(c, deptId), c, i)).join('') +
        '</div>'
      ) +
    '</div>';
}

function courseCardHTML(deptId, year, term, c, index) {
  const isGallery = c.type === 'gallery';
  const links = (c.sections || []).reduce((a, s) => a + (s.links || []).length, 0);
  const color = c.color || COURSE_COLORS[index % COURSE_COLORS.length];
  const st = linkStats(c);
  const manual = links === 0; /* معرض أو مادة من غير روابط — إنجاز يدوي */
  return '' +
  '<div class="card-hover bp-card cursor-pointer group relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm hover:shadow-xl bp-reveal" style="--i:' + index + '" onclick="openCourse(\'' + deptId + '\',\'' + year + '\',\'' + (term || courseSem(c, deptId)) + '\',\'' + c.id + '\')">' +
    '<span class="bp-crop tl"></span><span class="bp-crop br"></span>' +
    '<div class="h-2 bg-gradient-to-r ' + color + '"></div>' +
    '<div class="p-6">' +
      '<div class="flex items-start justify-between mb-4">' +
        '<div class="w-14 h-14 bg-gradient-to-br ' + color + ' rounded-2xl flex items-center justify-center text-white text-2xl shadow-md overflow-hidden">' +
          (c.image ? '<img src="' + esc(c.image) + '" alt="" class="w-full h-full object-cover" loading="lazy" decoding="async">' : iconSVG(c.icon || COURSE_ICONS[index % COURSE_ICONS.length])) +
        '</div>' +
        '<span class="bp-micro" dir="ltr">C/' + ('0' + (index + 1)).slice(-2) + '</span>' +
      '</div>' +
      '<div class="flex items-center gap-2 mb-1">' + (isGallery ? '<span class="text-xs bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 px-2 py-0.5 rounded-full font-medium">معرض صور</span>' : '') +
      '<h3 class="font-bold text-gray-800 dark:text-white text-lg leading-tight">' + esc(c.title) + '</h3></div>' +
      '<p class="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">' + esc(c.doc || '') + '</p>' +
      '<div class="flex items-center gap-4 text-sm text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-4">' +
        (isGallery ?
          '<span class="flex items-center gap-1"><i class="fa fa-images text-pink-400"></i><span>' + ((c.images || []).length) + ' صورة</span></span>'
        :
          '<span class="flex items-center gap-1"><i class="fa fa-layer-group text-indigo-400"></i><span>' + ((c.sections || []).length) + ' قسم</span></span>' +
          '<span class="flex items-center gap-1"><i class="fa fa-link text-cyan-400"></i><span>' + links + ' رابط</span></span>' +
          ((c.notes || []).length ? '<span class="flex items-center gap-1 mr-auto"><i class="fa fa-sticky-note text-amber-400"></i><span>' + c.notes.length + '</span></span>' : '')
        ) +
      '</div>' +
      '<div class="flex items-center justify-between mt-4 gap-2">' +
        '<span data-pjc="' + esc(c.id) + '" class="' + (coursePct(c) >= 1 ? 'bp-full' : '') + '">' + ringHTML(coursePct(c), st.total ? (st.done + '/' + st.total) : 'يدوي') + '</span>' +
        (manual ? '<button type="button" data-pjm="' + esc(c.id) + '" class="bp-donebtn' + (progress.courses[c.id] ? ' bp-on' : '') + '" onclick="event.stopPropagation();toggleCourseDone(\'' + c.id + '\')">' + (progress.courses[c.id] ? '<i class="fa fa-check"></i> مكتملة' : '<i class="fa fa-check"></i> علّمها كمكتملة') + '</button>' : '') +
      '</div>' +
    '</div>' +
  '</div>';
}

// ---------------- صفحة المادة: محتوى/ملاحظات ----------------
let activeCourseTab = 'content';
const collapsedSections = {};
function setCourseTab(t) { activeCourseTab = t; render(); }
function toggleSectionCollapse(sid) { collapsedSections[sid] = !collapsedSections[sid]; render(); }
function renderCourse(deptId, year, courseId) {
  const c = findCourse(deptId, year, courseId);
  if (!c) { closeCourseView(deptId, year); return; }
  if (c.type === 'gallery') { renderGallery(deptId, year, c); return; }
  courseTitleCache = c.title;
  const isContent = activeCourseTab !== 'notes';
  const totalLinks = (c.sections || []).reduce((a, s) => a + (s.links || []).length, 0);
  const color = c.color || COURSE_COLORS[0];

  const sectionsHTML = (c.sections || []).map((s, si) => {
    const collapsed = !!collapsedSections[s.id];
    return '' +
    '<div class="bg-white dark:bg-gray-800 bp-card bp-reveal rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-4" style="--i:' + (si + 1) + '">' +
      '<div class="flex items-center gap-2 px-4 py-3 lg:px-5 lg:py-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 select-none" onclick="toggleSectionCollapse(\'' + s.id + '\')">' +
        '<i class="fa fa-chevron-' + (collapsed ? 'down' : 'up') + ' text-gray-400 text-xs"></i>' +
        '<span class="bp-micro" dir="ltr">S' + ('0' + (si + 1)).slice(-2) + '</span>' +
        '<span class="font-bold text-gray-800 dark:text-white text-sm lg:text-base flex-1 truncate">' + esc(s.name) + '</span>' +
        (s.badge ? '<span class="text-xs lg:text-sm bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-semibold">' + esc(s.badge) + '</span>' : '') +
        '<span class="text-xs lg:text-sm text-gray-400">' + ((s.links || []).length) + ' رابط</span>' +
      '</div>' +
      (collapsed ? '' :
        '<div class="px-3 pb-3">' +
          (s.links || []).map(l =>
            '<div data-pjl="' + esc(l.id) + '" class="' + (progress.links[l.id] ? 'bp-done ' : '') + 'flex items-center gap-2 py-1.5 px-3 lg:py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50">' +
              '<button type="button" title="علّم إنك خلصته" class="bp-check' + (progress.links[l.id] ? ' bp-on' : '') + '" onclick="event.stopPropagation();toggleLink(\'' + l.id + '\')"></button>' +
              '<i class="' + getLinkIcon(l.url) + ' ' + getLinkColor(l.url) + ' text-sm lg:text-base w-4 lg:w-5 flex-shrink-0"></i>' +
              '<a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer" class="flex-1 text-sm lg:text-base text-gray-700 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 truncate">' + esc(l.name) + '</a>' +
              (l.star ? '<span class="inline-flex items-center gap-1 text-[10px] font-black text-amber-500 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full flex-shrink-0" title="لينك مهم"><i class="fa fa-star"></i> مهم</span>' : '') + /* ج26 */
              '<a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer" title="فتح اللينك في صفحة جديدة ↗" class="w-6 h-6 lg:w-7 lg:h-7 flex items-center justify-center rounded-md text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 flex-shrink-0" onclick="event.stopPropagation()"><i class="fa fa-arrow-up-right-from-square text-xs lg:text-sm"></i></a>' +
              '<button type="button" title="نسخ اللينك" class="w-6 h-6 lg:w-7 lg:h-7 flex items-center justify-center rounded-md text-gray-300 dark:text-gray-600 hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 flex-shrink-0" onclick="event.stopPropagation();copyTextSmart(\'' + esc(l.url) + '\')"><i class="fa fa-copy text-xs lg:text-sm"></i></button>' +
              '<button type="button" title="' + (isFav(l.id) ? 'شيل من المفضلة' : 'حفظ في المفضلة') + '" class="w-6 h-6 lg:w-7 lg:h-7 flex items-center justify-center rounded-md flex-shrink-0 ' + (isFav(l.id) ? 'text-rose-500' : 'text-gray-300 dark:text-gray-600 hover:text-rose-400') + '" onclick="event.stopPropagation();toggleFavById(\'' + l.id + '\',\'' + deptId + '\',\'' + year + '\',\'\',\'' + c.id + '\')"><i class="' + (isFav(l.id) ? 'fa-solid' : 'fa-regular') + ' fa-heart text-xs lg:text-sm"></i></button>' +
            '</div>'
          ).join('') +
          ((s.links || []).length === 0 ? '<p class="text-xs lg:text-sm text-gray-400 text-center py-2">لسه مفيش لينكات هنا</p>' : '') +
        '</div>'
      ) +
    '</div>';
  }).join('');

  const notesHTML =
    ((c.notes || []).length === 0 ?
      '<div class="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600"><div class="w-20 h-20 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl text-amber-300"><i class="fa fa-sticky-note"></i></div><p class="text-gray-400 font-medium">لا توجد ملاحظات</p></div>'
    :
      '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">' +
        c.notes.map((n, i) => {
          const ns = (darkMode ? NOTE_COLORS_DARK : NOTE_COLORS_LIGHT)[i % NOTE_COLORS_LIGHT.length];
          const dt = new Date(n.updatedAt || n.createdAt || Date.now());
          return '<div class="rounded-2xl p-4 shadow-md" style="background:' + ns.bg + ';color:' + ns.color + '">' +
            '<p class="whitespace-pre-wrap text-sm lg:text-base font-medium leading-relaxed mb-3">' + esc(n.content) + '</p>' +
            '<span class="text-xs lg:text-sm opacity-70">' + dt.toLocaleDateString('ar-EG') + '</span>' +
          '</div>';
        }).join('') +
      '</div>'
    );

  setResume(deptId, year, c); /* ج25: سجّل «كمّل من حيث وقفت» */
  const html =
    '<div class="min-h-screen flex flex-col transition-colors duration-300 ' + (darkMode ? 'dark bg-gray-950' : 'bg-gray-50') + ' dot-pattern">' +
      headerHTML({ dept: deptId, course: courseId }) +
      '<main class="flex-1 max-w-5xl w-full mx-auto px-4 py-6">' +
        '<button onclick="closeCourseView(\'' + deptId + '\',\'' + year + '\',\'' + courseSem(c, deptId) + '\')" class="flex items-center gap-2 text-sm lg:text-base font-bold text-gray-500 dark:text-gray-400 hover:text-indigo-500 mb-4"><i class="fa fa-arrow-right"></i> رجوع لـ ' + esc((deptOf(deptId) || {}).name || '') + '</button>' +
        '<div class="rounded-3xl p-6 mb-6 bg-gradient-to-r ' + color + ' text-white shadow-lg fade-in bp-oncolor">' +
          '<div class="flex items-center gap-4 min-w-0">' +
            '<div class="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center text-2xl overflow-hidden flex-shrink-0">' + (c.image ? '<img src="' + esc(c.image) + '" class="w-full h-full object-cover" alt="" loading="lazy" decoding="async">' : iconSVG(c.icon || 'fa-book')) + '</div>' +
            '<div class="min-w-0"><h1 class="text-xl sm:text-2xl lg:text-3xl font-bold truncate">' + esc(c.title) + '</h1>' +
              '<p class="text-white/80 text-sm lg:text-base mt-1 truncate">' + esc(c.doc || '') + '</p>' +
              '<div class="flex gap-4 lg:gap-5 mt-2 text-sm lg:text-base text-white/70"><span><i class="fa fa-layer-group ml-1"></i>' + ((c.sections || []).length) + ' قسم</span><span><i class="fa fa-link ml-1"></i>' + totalLinks + ' رابط</span><span><i class="fa fa-sticky-note ml-1"></i>' + ((c.notes || []).length) + ' ملاحظة</span></div>' +
              '<div class="flex items-center gap-3 mt-3 flex-wrap">' +
                '<span data-pjc="' + esc(c.id) + '" class="' + (coursePct(c) >= 1 ? 'bp-full' : '') + '">' + ringHTML(coursePct(c), linkStats(c).total ? (linkStats(c).done + '/' + linkStats(c).total) : '') + '</span>' +
                '<span class="bp-micro" style="color:rgba(255,255,255,.8)">PROGRESS · تقدمك</span>' +
                '<button type="button" onclick="resetCourseProgress(\'' + c.id + '\')" class="text-xs lg:text-sm font-bold px-3 py-1 lg:px-4 rounded-lg" style="background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.25)">مسح التقدم</button>' +
                (linkStats(c).total === 0 ? '<button type="button" data-pjm="' + esc(c.id) + '" class="text-xs lg:text-sm font-bold px-3 py-1 lg:px-4 rounded-lg" style="background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.25)" onclick="toggleCourseDone(\'' + c.id + '\')">' + (progress.courses[c.id] ? 'مكتملة ✓' : 'علّمها كمكتملة') + '</button>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="flex gap-2 mb-6">' +
          '<button onclick="setCourseTab(\'content\')" class="flex items-center gap-2 px-5 py-2.5 lg:px-6 lg:py-3 rounded-xl font-semibold text-sm lg:text-base ' + (isContent ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700') + '"><i class="fa fa-link"></i> المحتوى (' + totalLinks + ')</button>' +
          '<button onclick="setCourseTab(\'notes\')" class="flex items-center gap-2 px-5 py-2.5 lg:px-6 lg:py-3 rounded-xl font-semibold text-sm lg:text-base ' + (!isContent ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700') + '"><i class="fa fa-sticky-note"></i> الملاحظات (' + ((c.notes || []).length) + ')</button>' +
        '</div>' +
        (isContent ?
          '<div class="fade-in">' +
            ((c.sections || []).length === 0 ? '<div class="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600"><div class="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl text-indigo-300"><i class="fa fa-folder-open"></i></div><p class="text-gray-400 font-medium">لسه مفيش محتوى في المادة دي</p></div>' : sectionsHTML) +
          '</div>'
        : '<div class="fade-in">' + notesHTML + '</div>') +
      '</main>' +
      footerHTML() +
    '</div>';
  $('root').innerHTML = html;
}

/* ======================= ج25 — «كمّل من حيث وقفت»: آخر مادة فتحتها على جهازك ======================= */
const RESUME_KEY = 'eng_resume_v1';
function getResume() { try { const r = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); return (r && r.deptId && r.courseId) ? r : null; } catch (e) { return null; } }
function setResume(deptId, year, c) {
  if (!deptId || !c || !c.id) return;
  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ deptId: deptId, year: year || '1', term: courseSem(c, deptId), courseId: c.id, at: Date.now() })); } catch (e) {}
}
function clearResume() { try { localStorage.removeItem(RESUME_KEY); } catch (e) {} render(); }
function timeAgoAr(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'دلوقتي حالاً';
  if (m < 60) return 'من ' + m + (m === 1 ? ' دقيقة' : ' دقايق');
  const h = Math.floor(m / 60);
  if (h < 24) return 'من ' + h + (h === 1 ? ' ساعة' : ' ساعات');
  const d = Math.floor(h / 24);
  return 'من ' + d + (d === 1 ? ' يوم' : ' أيام');
}
function resumeCardHTML() {
  const r = getResume();
  if (!r) return '';
  const d = deptOf(r.deptId);
  if (!d) return '';
  const c = findCourse(r.deptId, r.year, r.courseId);
  if (!c) return ''; // المادة ممكن تكون اتعدلت/اتشالت — الكارت بيختفي لوحده
  const color = c.color || 'from-indigo-500 to-violet-600';
  return '' +
  '<div class="mb-8 bp-reveal bp-panel-frame relative overflow-hidden px-5 py-4 sm:px-7 flex items-center gap-4 flex-wrap" style="--i:0" data-testid="resume-card">' +
    '<div class="w-12 h-12 rounded-2xl bg-gradient-to-br ' + color + ' text-white flex items-center justify-center text-lg shadow-md flex-shrink-0"><i class="fa fa-circle-play"></i></div>' +
    '<div class="min-w-0 flex-1">' +
      '<p class="bp-micro">RESUME · كمّل من حيث وقفت</p>' +
      '<p class="font-black text-gray-800 dark:text-white text-base sm:text-lg truncate">' + esc(c.title) + '</p>' +
      '<p class="text-xs text-gray-400 truncate">' + esc(d.name) + ' · ' + timeAgoAr(r.at || Date.now()) + '</p>' +
    '</div>' +
    '<button type="button" class="h-10 px-5 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 text-white font-bold text-sm shadow-md flex items-center gap-2 flex-shrink-0" onclick="railGo(\'' + courseHash(r.deptId, r.year, courseSem(c, r.deptId), c.id) + '\')"><i class="fa fa-circle-play"></i> كمّل دلوقتي</button>' +
    '<button type="button" title="إخفاء الكارت" class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 dark:text-gray-600 hover:text-gray-500 flex-shrink-0" onclick="clearResume()"><i class="fa fa-xmark"></i></button>' +
  '</div>';
}
/* 📋 ج25 — نسخ اللينك للحافظة: Clipboard API الحديث + فول-باك آمن للمتصفحات القديمة/الصفحات المحلية */
function copyFallback(t) {
  var ok = null;
  try {
    var ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    ok = document.execCommand ? document.execCommand('copy') : null;
    ta.remove();
  } catch (e) { ok = false; }
  showToast(ok === false ? 'مقدرتش أنسخ — انسخه يدوي' : 'اللينك اتنسخ ✓', ok === false ? 'error' : 'success');
}
function copyTextSmart(t) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { showToast('اللينك اتنسخ ✓', 'success'); }, function () { copyFallback(t); });
      return;
    }
  } catch (e) {}
  copyFallback(t);
}

// ---------------- المعرض ----------------
function renderGallery(deptId, year, c) {
  courseTitleCache = c.title;
  setResume(deptId, year, c); /* ج25 */
  const color = c.color || 'from-pink-500 to-rose-600';
  const imgs = c.images || [];
  const html =
    '<div class="min-h-screen flex flex-col transition-colors duration-300 ' + (darkMode ? 'dark bg-gray-950' : 'bg-gray-50') + ' dot-pattern">' +
      headerHTML({ dept: deptId, course: c.id }) +
      '<main class="flex-1 max-w-5xl w-full mx-auto px-4 py-6">' +
        '<button onclick="closeCourseView(\'' + deptId + '\',\'' + year + '\',\'' + courseSem(c, deptId) + '\')" class="flex items-center gap-2 text-sm lg:text-base font-bold text-gray-500 dark:text-gray-400 hover:text-indigo-500 mb-4"><i class="fa fa-arrow-right"></i> رجوع</button>' +
        '<div class="rounded-3xl p-6 mb-6 bg-gradient-to-r ' + color + ' text-white shadow-lg fade-in bp-oncolor">' +
          '<div class="flex items-center gap-4">' +
            '<div class="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center text-2xl overflow-hidden flex-shrink-0">' + (c.image ? '<img src="' + esc(c.image) + '" class="w-full h-full object-cover" alt="" loading="lazy" decoding="async">' : iconSVG('images')) + '</div>' +
            '<div><h1 class="text-xl sm:text-2xl font-bold">' + esc(c.title) + '</h1><p class="text-white/80 text-sm mt-1">' + esc(c.doc || '') + '</p>' +
            '<div class="flex items-center gap-3 mt-3 flex-wrap">' +
              '<span data-pjc="' + esc(c.id) + '" class="' + (coursePct(c) >= 1 ? 'bp-full' : '') + '">' + ringHTML(coursePct(c), '') + '</span>' +
              '<button type="button" data-pjm="' + esc(c.id) + '" class="text-xs lg:text-sm font-bold px-3 py-1 lg:px-4 rounded-lg" style="background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.25)" onclick="toggleCourseDone(\'' + c.id + '\')">' + (progress.courses[c.id] ? 'مكتملة ✓' : 'علّمها كمكتملة') + '</button>' +
              '<button type="button" onclick="resetCourseProgress(\'' + c.id + '\')" class="text-xs lg:text-sm font-bold px-3 py-1 lg:px-4 rounded-lg" style="background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.25)">مسح التقدم</button>' +
            '</div>' +
            '<div class="flex gap-4 lg:gap-5 mt-2 text-sm lg:text-base text-white/70"><span><i class="fa fa-image ml-1"></i>' + imgs.length + ' صورة</span></div></div>' +
          '</div>' +
        '</div>' +
        (imgs.length === 0 ?
          '<div class="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600"><div class="w-20 h-20 bg-pink-50 dark:bg-pink-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl text-pink-300"><i class="fa fa-images"></i></div><p class="text-gray-400 font-medium">لا توجد صور في المعرض</p></div>'
        :
          '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 gallery-grid">' +
            imgs.map((im, i) =>
              '<div class="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">' +
                '<img src="' + esc(im.url) + '" alt="' + esc(im.title || '') + '" class="w-full h-40 object-cover" loading="lazy" decoding="async" onclick="openLightbox(' + i + ',\'' + c.id + '\')">' +
                '<div class="p-3"><p class="text-sm font-semibold text-gray-800 dark:text-white truncate">' + esc(im.title || 'صورة') + '</p>' +
                (im.description ? '<p class="text-xs text-gray-400 truncate">' + esc(im.description) + '</p>' : '') + '</div>' +
              '</div>'
            ).join('') +
          '</div>'
        ) +
      '</main>' +
      footerHTML() +
    '</div>';
  $('root').innerHTML = html;
}
function openLightbox(idx, courseId) {
  const route = parseRoute();
  const d = deptOf(route.dept);
  const year = d.noYears ? '1' : route.year;
  const c = findCourse(route.dept, year, courseId);
  const im = ((c || {}).images || [])[idx];
  if (!im) return;
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = '<img src="' + esc(im.url) + '" alt="">';
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}

// ---------------- العرض الرئيسي ----------------
function render() {
  if (document.body) document.body.classList.toggle('em-has-sidebar', !!dataReady);
  if (!dataReady) {
    $('root').innerHTML =
      '<div class="min-h-screen flex items-center justify-center ' + (darkMode ? 'dark bg-gray-950' : 'bg-gray-50') + ' dot-pattern">' +
        '<div class="text-center"><div class="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div><p class="text-gray-400">جاري تحميل المحتوى...</p></div>' +
      '</div>';
    return;
  }
  const route = parseRoute();
  if (route.page) { renderPage(route); appendRail(); return; }
  if (!route.dept) { renderHome(); appendRail(); return; }
  const d = deptOf(route.dept);
  const year = d.noYears ? '1' : route.year;
  if (route.course) {
    const c = findCourse(route.dept, year, route.course);
    if (!c) { closeCourseView(route.dept, year, route.term, true); return; }
    renderCourse(route.dept, year, route.course);
  } else {
    renderDept(route.dept, year);
  }
  appendRail();
}


// ---------------- 🧭 جولة 21-24: الشريط الرأسي (بلسان إخفاء) + الصفحات + المفضلة + الفيد + البحث — والمعاينة اتلغت نهائيًا في ج24 ----------------
const RAIL_PAGES = ['general', 'special', 'favorites', 'recent', 'search'];
let railOpen = false;
function toggleRailDrawer() { railOpen = !railOpen; appendRail(); }
function closeRailDrawer() { if (!railOpen) return; railOpen = false; appendRail(); }
function railGo(h) { railOpen = false; window.location.hash = (h === 'home') ? '' : h; }
function railLinkHTML(it, activeKey) {
  const on = (activeKey === it.key);
  return '<button class="em-nav-link ' + (on ? 'active' : '') + '" onclick="railGo(\'' + it.hash + '\')">' +
    '<span class="em-nav-ic"><i class="fa ' + it.icon + '"></i></span><span>' + it.label + '</span></button>';
}
/* ثابت على اللابتوب، ودروّر على الموبايل — نفس هوية نسخة الأدمن */
function appendRail() {
  const old = document.getElementById('bp-rail-wrap');
  if (old) old.remove();
  let route;
  try { route = parseRoute(); } catch (e) { route = { page: null, dept: null }; }
  const d = route.dept ? deptOf(route.dept) : null;
  const activeKey = route.page || (d ? d.group : 'home');
  const items = [
    { key: 'home', hash: 'home', icon: 'fa-house', label: 'الرئيسية' },
    { key: 'general', hash: 'general', icon: 'fa-building-columns', label: 'الأقسام العامة' },
    { key: 'special', hash: 'special', icon: 'fa-certificate', label: 'البرامج النوعية' },
    { key: 'search', hash: 'search', icon: 'fa-magnifying-glass', label: 'بحث عام' },
    { key: 'favorites', hash: 'favorites', icon: 'fa-heart', label: 'المفضلة' },
    { key: 'recent', hash: 'recent', icon: 'fa-clock-rotate-left', label: 'آخر الإضافات' }
  ];
  const links = items.map(function(it){ return railLinkHTML(it, activeKey); }).join('');
  const doneLinks = Object.keys((progress && progress.links) || {}).length;
  const wrap = document.createElement('div');
  wrap.id = 'bp-rail-wrap';
  wrap.innerHTML =
    '<button type="button" aria-label="قائمة الصفحات" class="em-nav-fab" onclick="toggleRailDrawer()"><i class="fa ' + (railOpen ? 'fa-xmark' : 'fa-bars') + '"></i></button>' +
    '<div class="em-nav-backdrop ' + (railOpen ? 'show' : '') + '" onclick="closeRailDrawer()"></div>' +
    '<aside class="em-sidebar ' + (railOpen ? 'open' : '') + '" aria-label="شريط الصفحات">' +
      '<div class="em-side-brand"><img src="favicon.png" alt=""><div><b>مكتبة الهندسة</b><small>مواد كل الأقسام</small></div><button onclick="closeRailDrawer()"><i class="fa fa-xmark"></i></button></div>' +
      '<nav>' + links + '</nav>' +
      '<div class="em-side-art" aria-hidden="true"><i class="fa fa-book-open"></i><i class="fa fa-gear"></i><i class="fa fa-ruler-combined"></i></div>' +
      '<div class="em-side-user"><span><i class="fa fa-user-graduate"></i></span><div><b>طالب زائر</b><small>' + doneLinks + ' لينك مكتمل · ' + getFavs().length + ' مفضلة</small></div><button onclick="exportMyProgress()" title="تحميل ملف التقدم"><i class="fa fa-cloud-arrow-down"></i></button></div>' +
    '</aside>';
  (document.getElementById('root') || document.body).appendChild(wrap);
}

/* 🏗️ شلّ الصفحات الجديدة — نفس جلد الموقع */
function pageShellHTML(bodyHTML, micro, title, sub) {
  return '' +
  '<div class="min-h-screen flex flex-col transition-colors duration-300 ' + (darkMode ? 'dark bg-gray-950' : 'bg-gray-50') + ' dot-pattern">' +
    headerHTML({ dept: null }) +
    '<main class="flex-1 max-w-7xl w-full mx-auto px-4 py-8">' +
      '<div class="mb-8 bp-reveal bp-panel-frame relative overflow-hidden px-6 py-7 sm:px-9" style="--i:0">' +
        '<span class="bp-crop tl"></span><span class="bp-crop tr"></span><span class="bp-crop bl"></span><span class="bp-crop br"></span>' +
        '<p class="bp-micro">' + micro + '</p>' +
        '<h1 class="text-2xl md:text-3xl font-black text-gray-800 dark:text-white mt-1.5 mb-2">' + title + '</h1>' +
        (sub ? '<p class="text-sm text-gray-500 dark:text-gray-400 max-w-xl">' + sub + '</p>' : '') +
      '</div>' +
      bodyHTML +
    '</main>' +
    footerHTML() +
  '</div>';
}
function renderPage(route) {
  if (route.page === 'general' || route.page === 'special') renderGroupPage(route.page);
  else if (route.page === 'favorites') renderFavoritesPage();
  else if (route.page === 'recent') renderRecentPage();
  else if (route.page === 'search') renderSearchPage();
}
function renderGroupPage(g) {
  const depts = allDepts().filter(d => d.group === g);
  const grid = '<div class="bp-deptgrid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">' +
    depts.map((d, di) => deptCardHTML(d, deptCounts(d.id), di)).join('') + '</div>';
  const sub = (g === 'general') ? 'أقسام الكلية الأساسية — من الاعدادي لحد التخرج' : 'برامج الساعات المعتمدة والبرامج النوعية';
  $('root').innerHTML = pageShellHTML(grid, 'BLOCK / ' + (g === 'general' ? 'A' : 'B') + ' · ' + depts.length + ' DEPTS', GROUP_NAMES[g], sub);
}


/* ======================= المفضلة (على جهاز الطالب — أيقونة قلب مش إيموجي) ======================= */
const FAVS_KEY = 'eng_favs_v1';
function getFavs() { try { const f = JSON.parse(localStorage.getItem(FAVS_KEY) || '[]'); return Array.isArray(f) ? f : []; } catch (e) { return []; } }
function setFavs(f) { try { localStorage.setItem(FAVS_KEY, JSON.stringify(f)); } catch (e) {} }
function isFav(lid) { return getFavs().some(x => x && x.lid === lid); }
function courseHash(deptId, year, term, courseId) {
  const d = deptOf(deptId);
  if (!d) return deptId;
  return (d.noYears
    ? (deptId + (term ? ('/' + term) : ''))
    : (deptId + '/' + year + (term ? ('/' + term) : ''))) + '/' + courseId;
}
function toggleFavById(lid, deptId, year, term, courseId) {
  const f = getFavs();
  const ix = f.findIndex(x => x && x.lid === lid);
  if (ix > -1) {
    const nm = f[ix] && f[ix].name;
    f.splice(ix, 1); setFavs(f);
    showToast('اتشال «' + (nm || 'اللينك') + '» من المفضلة', 'success');
  } else {
    const c = findCourse(deptId, year, courseId);
    let link = null;
    (c && c.sections ? c.sections : []).forEach(s => (s.links || []).forEach(l => { if (l.id === lid) link = l; }));
    if (!link) return;
    const d = deptOf(deptId);
    f.push({ lid: lid, name: link.name, url: link.url, deptId: deptId, deptName: d ? d.name : deptId, year: year, courseId: courseId, courseTitle: c ? (c.title || '') : '', at: Date.now() });
    setFavs(f);
    showToast('اتحفظ في المفضلة — هتلاقيه في صفحة المفضلة من الشريط', 'success');
  }
  render();
}
/* ج26: النجمة بتتقرا حيّة من الداتا — لو اللينك اتعلّم «مهم» من الأدمن */
function starOfFav(x) {
  try {
    const c = findCourse(x.deptId, x.year, x.courseId);
    if (!c) return false;
    let st = false;
    (c.sections || []).forEach(function (sc) { (sc.links || []).forEach(function (lk) { if (lk.id === x.lid && lk.star) st = true; }); });
    return st;
  } catch (e) { return false; }
}
function favRowHTML(x) {
  const filled = isFav(x.lid);
  return '' +
  '<div class="bp-card card-hover relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm flex items-center gap-3 p-4 mb-2">' +
    '<i class="' + getLinkIcon(x.url) + ' ' + getLinkColor(x.url) + ' text-base w-5 flex-shrink-0"></i>' +
    '<div class="min-w-0 flex-1 cursor-pointer" onclick="window.location.hash=\'' + courseHash(x.deptId, x.year, '', x.courseId) + '\'">' +
      '<p class="text-sm font-bold text-gray-800 dark:text-white truncate">' + esc(x.name) + '</p>' +
      '<p class="text-xs text-gray-400 truncate">' + esc(x.deptName) + (x.courseTitle ? ' · ' + esc(x.courseTitle) : '') + (starOfFav(x) ? ' <span class="font-black text-amber-500"><i class="fa fa-star"></i> مهم</span>' : '') + '</p>' +
    '</div>' +
    '<button type="button" title="نسخ اللينك" class="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 dark:text-gray-600 hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 flex-shrink-0" onclick="copyTextSmart(\'' + esc(x.url) + '\')"><i class="fa fa-copy text-xs"></i></button>' +
    '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer" title="فتح اللينك في صفحة جديدة" class="h-7 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 flex-shrink-0"><i class="fa fa-arrow-up-right-from-square text-[10px]"></i> فتح ↗</a>' +
    '<button type="button" title="' + (filled ? 'شيل من المفضلة' : 'حفظ في المفضلة') + '" class="w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 ' + (filled ? 'text-rose-500' : 'text-gray-300 dark:text-gray-600 hover:text-rose-400') + '" onclick="toggleFavById(\'' + x.lid + '\',\'' + x.deptId + '\',\'' + x.year + '\',\'\',\'' + x.courseId + '\')"><i class="' + (filled ? 'fa-solid' : 'fa-regular') + ' fa-heart text-xs"></i></button>' +
  '</div>';
}
/* ج26: فلتر الأقسام في المفضلة — تشيبس تطلع بس لما يكون في أكتر من قسم */
let favFilter = 'all';
function setFavFilter(id) { favFilter = id || 'all'; renderFavoritesPage(); }
function favChipHTML(id, label, n) {
  const on = (favFilter === id);
  return '<button type="button" data-testid="fav-chip" data-chip="' + esc(id) + '" onclick="setFavFilter(\'' + esc(id) + '\')" class="h-8 px-3.5 rounded-full text-xs font-black inline-flex items-center gap-1.5 transition-colors ' +
    (on ? 'bg-gradient-to-l from-rose-500 to-pink-600 text-white shadow-md' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-rose-300') + '">' +
    '<i class="fa ' + (id === 'all' ? 'fa-layer-group' : 'fa-bookmark') + ' text-[10px]"></i>' + esc(label) + '<span dir="ltr" class="opacity-75">' + n + '</span></button>';
}
function renderFavoritesPage() {
  const fAll = getFavs().slice().reverse();
  const seen = [];
  fAll.forEach(function (x) { if (x && x.deptId && seen.indexOf(x.deptId) < 0) seen.push(x.deptId); });
  const f = (favFilter === 'all') ? fAll : fAll.filter(function (x) { return x && x.deptId === favFilter; });
  let chips = '';
  if (seen.length > 1) {
    chips = '<div class="flex flex-wrap gap-2 mb-4">' + favChipHTML('all', 'الكل', fAll.length) +
      seen.map(function (id) { const d = deptOf(id); const nm = d ? d.name : (fAll.find(function (x) { return x.deptId === id; }) || {}).deptName || id;
        return favChipHTML(id, nm, fAll.filter(function (x) { return x.deptId === id; }).length); }).join('') + '</div>';
  }
  const body = chips + (f.length
    ? f.map(x => favRowHTML(x)).join('')
    : '<div class="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600">' +
      '<div class="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl text-rose-300"><i class="fa fa-heart"></i></div>' +
      '<p class="text-gray-400 font-medium">' + (fAll.length ? 'مفيش لينكات في القسم ده' : 'مفيش لينكات محفوظة لسه') + '</p>' +
      (fAll.length ? '' : '<p class="text-xs text-gray-400 mt-2">علّم على أي لينك بأيقونة القلب <i class="fa-regular fa-heart text-rose-400"></i> من صفحة مادته — وهتلاقيه جاهز هنا على طول.</p>') + '</div>');
  $('root').innerHTML = pageShellHTML(body, 'FAVORITES · ' + f.length + ' LINKS', 'المفضلة <i class="fa-solid fa-heart text-rose-500"></i>', 'أهم اللينكات اللي حفظتها بنفسك — بتتخزّن على جهازك بس.');
}

/* ======================= أحدث الإضافات 🕐 ======================= */
/* بترتيب الإضافة في الملف نفسه: بنمشي على كل الأقسام والمواد بالترتيب
   وناخد آخر N — من غير أي تغيير في شكل البيانات الأصلي */
function collectRecent(limit) {
  const out = [];
  allDepts().forEach(d => {
    const blk = state.departments[d.id];
    if (!blk || !blk.years) return;
    const years = d.noYears ? ['1'] : YEAR_ORDER;
    years.forEach(y => {
      (blk.years[y] || []).forEach(c => {
        (c.sections || []).forEach(s2 => {
          (s2.links || []).forEach(l => {
            out.push({ lid: l.id, name: l.name, url: l.url, deptId: d.id, deptName: d.name, year: y, courseId: c.id, courseTitle: c.title || '' });
          });
        });
      });
    });
  });
  return out.slice(Math.max(0, out.length - (limit || 30))).reverse();
}
function renderRecentPage() {
  /* جولة 23: آخر ٥ إضافات بس — مفيش تكديس */
  const list = collectRecent(5);
  const body = list.length
    ? list.map(x => favRowHTML(x)).join('')
    : '<div class="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600"><p class="text-gray-400 font-medium">لسه مفيش إضافات</p></div>';
  $('root').innerHTML = pageShellHTML(body, 'FRESH DROPS · ' + list.length, 'آخر الإضافات 🕐', 'آخر ٥ لينكات اتضافت على الموقع — الأجدد أولاً.');
}

/* ======================= البحث العام 🔍 ======================= */
let globalQuery = '';
function onGlobalSearch(v) {
  globalQuery = v;
  const r = document.getElementById('g-results');
  if (r) r.innerHTML = globalSearchHTML(v);
}
function globalSearchHTML(v) {
  const q = (v || '').trim().toLowerCase();
  if (q.length < 2) return '<p class="text-center text-sm text-gray-400 py-10">اكتب حرفين على الأقل عشان يبدأ البحث 🔍</p>';
  const courses = [], links = [];
  allDepts().forEach(d => {
    const blk = state.departments[d.id];
    if (!blk || !blk.years) return;
    const years = d.noYears ? ['1'] : YEAR_ORDER;
    years.forEach(y => (blk.years[y] || []).forEach(c => {
      if (courses.length < 24 && (c.title || '').toLowerCase().indexOf(q) !== -1) {
        courses.push({ deptId: d.id, deptName: d.name, year: y, courseId: c.id, title: c.title, color: c.color });
      }
      (c.sections || []).forEach(s2 => (s2.links || []).forEach(l => {
        if (links.length >= 60) return;
        if ((l.name || '').toLowerCase().indexOf(q) !== -1 || (l.url || '').toLowerCase().indexOf(q) !== -1) {
          links.push({ lid: l.id, name: l.name, url: l.url, deptId: d.id, deptName: d.name, year: y, courseId: c.id, courseTitle: c.title || '' });
        }
      }));
    }));
  });
  if (!courses.length && !links.length) {
    return '<div class="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600">' +
      '<div class="w-20 h-20 bg-gray-100 dark:bg-gray-700/40 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl text-gray-300"><i class="fa fa-magnifying-glass"></i></div>' +
      '<p class="text-gray-400 font-medium">مفيش نتائج لـ «' + esc(v) + '»</p></div>';
  }
  let h = '';
  if (courses.length) {
    h += '<p class="bp-micro mb-3">COURSES · ' + courses.length + '</p><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">' +
      courses.map(x =>
        '<div class="bp-card card-hover cursor-pointer relative rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-4" onclick="window.location.hash=\'' + courseHash(x.deptId, x.year, '', x.courseId) + '\'">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-10 h-10 bg-gradient-to-br ' + (x.color || COURSE_COLORS[0]) + ' rounded-xl flex items-center justify-center text-white bp-tile3d flex-shrink-0"><i class="fa fa-book"></i></div>' +
            '<div class="min-w-0"><p class="font-bold text-sm text-gray-800 dark:text-white truncate">' + esc(x.title) + '</p><p class="text-xs text-gray-400 truncate">' + esc(x.deptName) + '</p></div>' +
          '</div></div>').join('') + '</div>';
  }
  if (links.length) h += '<p class="bp-micro mb-3">LINKS · ' + links.length + '</p>' + links.map(x => favRowHTML(x)).join('');
  return h;
}
function renderSearchPage() {
  $('root').innerHTML = pageShellHTML(
    '<div class="mb-4 relative">' +
      '<i class="fa fa-magnifying-glass absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"></i>' +
      '<input id="g-search" value="' + esc(globalQuery) + '" oninput="onGlobalSearch(this.value)" placeholder="دوّر على مادة أو لينك في الموقع كله..." class="w-full pr-11 pl-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm bp-search">' +
    '</div>' +
    '<div id="g-results">' + globalSearchHTML(globalQuery) + '</div>',
    'GLOBAL SEARCH · ALL DEPTS', 'بحث عام 🔍', 'بيدوّر في كل الأقسام والبرامج النوعية مرة واحدة — مواد ولينكات.');
  const inp = document.getElementById('g-search');
  if (inp && globalQuery) { try { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {} }
}

// ---------------- إقلاع ----------------
applyDark();
// خلفية Campus Archive / Carbon Mechanical معمولة بـ CSS خفيف بدل SVG/SMIL.
render(); // شاشة تحميل الأول
loadState().then(() => { render(); });
