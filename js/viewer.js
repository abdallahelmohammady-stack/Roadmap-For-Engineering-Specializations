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
      + (is404 ? ' <b style="color:#fca5a5">(ظهر 404؟ يبقى فولدر data مش مترفع صح 👇)</b>' : '') + '</li>'
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

/* ============================ DATA ============================ */
const ICONS = ['building-2','landmark','ruler','cpu','cog','zap','radio','flask-conical','wrench','hammer','layers','network','circuit-board','hard-hat','pyramid','mountain','droplets','atom','satellite','boxes','pencil-ruler','factory','gauge','plug'];
const COLORS = {
  sky:'#38bdf8', amber:'#fbbf24', rose:'#fb7185', violet:'#a78bfa',
  emerald:'#34d399', orange:'#fb923c', lime:'#a3e635', fuchsia:'#e879f9', cyan:'#22d3ee'
};
const defaultImage = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='100%' height='100%' fill='#0d2137'/><g stroke='#1b3650' stroke-width='1'><path d='M0 60H640M0 120H640M0 180H640M0 240H640M0 300H640M80 0V360M160 0V360M240 0V360M320 0V360M400 0V360M480 0V360M560 0V360'/></g><text x='50%' y='50%' font-family='monospace' font-size='22' fill='#38618a' text-anchor='middle' dy='.3em'>PARTITION</text></svg>");

// ---- EXPORT TARGET (DO NOT DELETE THIS LINE) ----
// نسخة الزوّار: مفيش بيانات مبدئية مدمجة في الكود ولا localStorage خاص بالأدمن —
// المحتوى بييجي من data/sites.json فقط (عن طريق SitesLoader أسفل الملف).
const STORAGE_KEY = 'engBlueprintData_Roadmaps_v1';
const safeOriginal = [];
const defaultDepartments = safeOriginal;

let depts = [];
let current = 'home';      // 'home' or dept id
let currentPartition = null; // selected partition id
let currentCategory = null; // selected category id
const isAdmin = false; // نسخة الزوار: عرض فقط
let collapsed = {};        // category/partition collapse state
let tempImg = null;

/* ============================ HELPERS ============================ */
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const $ = id => document.getElementById(id);
/* تقدم كل زائر بيتسجّل عنده هو بس (بروجرس المشاهدة) — المحتوى نفسه للقراءة فقط */
const USER_PROGRESS_KEY = 'engRoadmapUserProgress_v1';
function saveUserProgress(){
  const map = {};
  (depts||[]).forEach(d=>(d.partitions||[]).forEach(p=>{
    const walkCats = cats => (cats||[]).forEach(c=>{
      (c.courses||[]).forEach(co=>{ if(co.completed) map[co.id]=true; });
      if(c.subCategories) walkCats(c.subCategories);
    });
    walkCats(p.categories||[]);
  }));
  try{ localStorage.setItem(USER_PROGRESS_KEY, JSON.stringify(map)); }catch(e){}
}
/* ---------------- تصدير «تقدمي» لموقع StudyHub (قسم الاتصالات والحاسبات بس) ----------------
   ينزّل roadmap-progress.json بصيغة studyhub-progress: أسماء البارتيشنات والكورسات وحالتها. */
const STUDYHUB_DEPT = 'comm';
function exportMyProgress(){
  try{
    const d = depts.find(x=>x.id===STUDYHUB_DEPT);
    if(!d) throw new Error('dept missing');
    let map = {};
    try{ map = JSON.parse(localStorage.getItem(USER_PROGRESS_KEY) || '{}') || {}; }catch(e){}
    const groups = []; let t=0, dn=0;
    (d.partitions||[]).forEach(p=>{
      const items = [];
      const walk = cats => (cats||[]).forEach(c=>{
        (c.courses||[]).forEach(co=>{
          const isDone = !!map[co.id]; t++; if(isDone) dn++;
          items.push({ id: co.id, name: co.title || 'كورس', done: isDone });
        });
        if(c.subCategories) walk(c.subCategories);
      });
      walk(p.categories||[]);
      if(items.length) groups.push({ id: p.id, name: p.name || p.title || p.id, items: items });
    });
    const payload = {
      app:'eng-roadmap', type:'studyhub-progress', version:1, exportedAt: Date.now(),
      label:'الكورسات الهندسية — ' + (d.title || ''), scope:'dept:' + STUDYHUB_DEPT,
      stats:{ total:t, done:dn }, groups: groups
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'roadmap-progress.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    showToast('اتنزّل ملف تقدمك في «' + (d.title||'القسم') + '» — ارفعه في StudyHub 📊');
  }catch(err){
    console.error(err);
    showToast('حصلت مشكلة أثناء تجهيز ملف التقدم', true);
  }
}

function applyUserProgress(){
  let map = {};
  try{ map = JSON.parse(localStorage.getItem(USER_PROGRESS_KEY) || '{}'); }catch(e){}
  (depts||[]).forEach(d=>(d.partitions||[]).forEach(p=>{
    const walkCats = cats => (cats||[]).forEach(c=>{
      (c.courses||[]).forEach(co=>{ co.completed = !!map[co.id]; });
      if(c.subCategories) walkCats(c.subCategories);
    });
    walkCats(p.categories||[]);
  }));
}
const save = () => { saveUserProgress(); render(); };
const acc = c => COLORS[c] || COLORS.sky;

function stats(node){
  let t=0,d=0;
  const walkCats = cats => cats.forEach(cat=>{
    (cat.courses||[]).forEach(co=>{ t++; if(co.completed) d++; });
    if(cat.subCategories) walkCats(cat.subCategories);
  });
  if(node.partitions) node.partitions.forEach(p=>walkCats(p.categories||[]));
  else if(node.categories) walkCats(node.categories);
  else if(node.courses||node.subCategories) walkCats([node]);
  return { t, d, pct: t? Math.round(d/t*100):0 };
}

// locate any node by id -> {node, arr, index, kind}
function locate(id){
  for(let i=0;i<depts.length;i++){ if(depts[i].id===id) return {node:depts[i], arr:depts, index:i, kind:'dept'}; }
  for(const dep of depts) for(let i=0;i<(dep.partitions||[]).length;i++){
    if(dep.partitions[i].id===id) return {node:dep.partitions[i], arr:dep.partitions, index:i, kind:'partition', dept:dep};
  }
  for(const dep of depts) for(const part of (dep.partitions||[])) for(let i=0;i<(part.categories||[]).length;i++){
    if(part.categories[i].id===id) return {node:part.categories[i], arr:part.categories, index:i, kind:'category', part, dept:dep};
  }
  for(const dep of depts) for(const part of (dep.partitions||[])) for(const cat of (part.categories||[])) for(let i=0;i<(cat.subCategories||[]).length;i++){
    if(cat.subCategories[i].id===id) return {node:cat.subCategories[i], arr:cat.subCategories, index:i, kind:'subcategory', cat, part, dept:dep};
  }
  for(const dep of depts) for(const part of (dep.partitions||[])) for(const cat of (part.categories||[])){
    const arrs=[cat.courses, ...(cat.subCategories||[]).map(s=>s.courses)];
    for(const a of arrs){ if(!a) continue; const idx=a.findIndex(c=>c.id===id); if(idx>-1) return {node:a[idx], arr:a, index:idx, kind:'course'}; }
  }
  return null;
}
function findNode(id){ const r=locate(id); return r?r.node:null; }
const uid = p => p + '_' + Date.now() + Math.floor(Math.random()*999);

/* ============================================================
   نسخة الزوار: المحتوى بيتقرا من data/sites.json (عرض فقط)
   ============================================================ */
function showToast(msg, isError){
  const t=$('mini-toast'); if(!t) return;
  t.textContent=(isError?'⚠️ ':'✅ ')+msg;
  t.classList.add('show');
  if(isError) t.classList.add('err'); else t.classList.remove('err');
  clearTimeout(window.__toastT);
  window.__toastT=setTimeout(()=>t.classList.remove('show'),3000);
}
async function loadDeptsFromJson(){
  // SitesLoader الموحّد: fetch ← نسخة مدمجة ← شاشة تشخيص
  const pack = await window.SitesLoader.load();
  if(!pack){ depts=[]; return; }
  const data = pack.data;
  const arr = Array.isArray(data) ? data : (data && data.depts);
  if(!Array.isArray(arr)){ depts=[]; return; }
  depts = arr;
  applyUserProgress();
}

/* ============================ ROUTING ============================ */
function go(target){ currentPartition=null; currentCategory=null; current=target; history.pushState(null,'', target==='home'? location.pathname : location.pathname+'#'+target); closeRailDrawer(); render(); window.scrollTo({top:0}); }
function openPartition(id){ const r=locate(id); if(!r || r.kind!=='partition') return; current=r.dept.id; currentPartition=id; currentCategory=null; history.pushState(null,'',location.pathname+'#'+current+'/'+id); closeRailDrawer(); render(); window.scrollTo({top:0}); }
/* 🗒️ جولة النوتس — باليت كروت «الستيكي» بنفس ألوان موقع المواد حرفيًا */
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
/* 🌗 جولة النايت مود — بنختار باليت النوتس وقت الرسم حسب الثيم الحالي (دارك افتراضي / لايت) */
let currentCatTab = 'content';
let lastCatId = null;
function setCatTab(t){ currentCatTab = t; renderCategoryDetail(); }

/* 🗂️ جولة السايد بار — دروّير جانبي بسلوك مواد بالظبط (FAB عائم + باكدروب + انزلاق translateX) */
let railOpen = false;
function paintRail(){
  const r=$('rail'), b=$('rail-backdrop'), f=$('rail-fab');
  if(!r||!b||!f) return;
  r.classList.toggle('open', railOpen);
  b.classList.toggle('show', railOpen);
  f.innerHTML = railOpen ? '<i data-lucide="x"></i>' : '<i data-lucide="menu"></i>';
  if(typeof lucide!=='undefined') lucide.createIcons();
}
function toggleRailDrawer(){ railOpen = !railOpen; paintRail(); }
function closeRailDrawer(){ if(!railOpen) return; railOpen = false; paintRail(); }

/* 🌗 جولة النايت مود — الافتراضي داكن (هوية الموقع)، النهاري بيتخزن في er_theme */
const THEME_KEY = 'er_theme';
function isLightTheme(){ return document.documentElement.classList.contains('light'); }
function applyTheme(t){
  const light = t==='light';
  document.documentElement.classList.toggle('dark', !light);
  document.documentElement.classList.toggle('light', light);
  try{ localStorage.setItem(THEME_KEY, light?'light':'dark'); }catch(e){}
  paintThemeBtn();
}
function toggleTheme(){ applyTheme(isLightTheme()?'dark':'light'); }
function paintThemeBtn(){
  const b=$('theme-toggle'); if(!b) return;
  b.innerHTML='<i data-lucide="'+(isLightTheme()?'moon':'sun')+'" class="w-4 h-4"></i>';
  if(typeof lucide!=='undefined') lucide.createIcons();
}

function openCategory(id){ const r=locate(id); if(!r || r.kind!=='category') return; current=r.dept.id; currentPartition=r.part.id; currentCategory=id; history.pushState(null,'',location.pathname+'#'+current+'/'+currentPartition+'/'+id); closeRailDrawer(); render(); window.scrollTo({top:0}); }
window.addEventListener('popstate', ()=>{ const [deptId, partId, catId]=location.hash.replace('#','').split('/'); current=(deptId && depts.find(d=>d.id===deptId))?deptId:'home'; currentPartition=(partId && locate(partId)?.kind==='partition')?partId:null; currentCategory=(catId && locate(catId)?.kind==='category')?catId:null; render(); });

/* ============================ ADMIN / RESET ============================ */
/* ============================ MOVE / DELETE / COMPLETE ============================ */
function toggleCourse(id){
  const r=locate(id); if(!r||r.kind!=='course') return;
  r.node.completed=!r.node.completed; save();
}
function toggleCollapse(id){
  const isCat = String(id).indexOf('C_')===0;
  const cur = isCat ? (collapsed[id] !== false) : !!collapsed[id];
  collapsed[id] = !cur;
  render();
}

/* ============================ EXPORT ============================ */
/* ============================ CRUD MODAL ============================ */
const colorOptions = () => Object.keys(COLORS).map(k=>({val:k,txt:k}));
const iconOptions = () => ICONS.map(i=>({val:i,txt:i}));
/* ============================ ADD SHORTCUTS ============================ */
/* ============================ RENDER ============================ */
function renderTabs(){
  const t=$('tabs'); t.innerHTML='';
  // home tab
  t.insertAdjacentHTML('beforeend',
    `<button class="tab ${current==='home'?'active':''}" style="--acc:#38bdf8" onclick="go('home')"><i data-lucide="layout-grid" class="ic"></i> الرئيسية</button>`);
  depts.forEach((d,i)=>{
    const st=stats(d);
    const active = current===d.id;
    let ctrl='';
    if(isAdmin){
      ctrl = `<span class="tab-ctrl" onclick="event.stopPropagation()">
        <button title="تقديم" onclick="move('${d.id}',-1)" ${i===0?'disabled style="opacity:.3"':''}><i data-lucide="chevron-right" class="w-3 h-3"></i></button>
        <button title="تأخير" onclick="move('${d.id}',1)" ${i===depts.length-1?'disabled style="opacity:.3"':''}><i data-lucide="chevron-left" class="w-3 h-3"></i></button>
        <button title="تعديل" onclick="openModal('dept','${d.id}')"><i data-lucide="edit-3" class="w-3 h-3"></i></button>
        <button class="del" title="حذف" onclick="del('${d.id}')"><i data-lucide="trash-2" class="w-3 h-3"></i></button>
      </span>`;
    }
    t.insertAdjacentHTML('beforeend',
      `<button class="tab ${active?'active':''}" style="--acc:${acc(d.color)}" onclick="go('${d.id}')">
        <i data-lucide="${d.icon}" class="ic"></i>
        <span>${esc(d.title)}</span>
        <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[rgba(255,255,255,.08)] text-[#9fb6cb]">${st.t}</span>
        ${ctrl}
      </button>`);
  });
  if(isAdmin){
    t.insertAdjacentHTML('beforeend',
      `<button class="tab tab-add" onclick="openModal('dept')"><i data-lucide="plus" class="ic"></i> قسم جديد</button>`);
  }
  paintThemeBtn();
}

function renderHome(){
  const g=$('dept-grid'); g.innerHTML='';
  if(!depts.length){ g.innerHTML=`<div class="col-span-full text-center py-16 text-[#7f9bb3]">لا توجد أقسام بعد. ${isAdmin?'اضغط "قسم جديد" في الشريط العلوي للإضافة.':''}</div>`; return; }
  depts.forEach(d=>{
    const st=stats(d); const c=acc(d.color);
    g.insertAdjacentHTML('beforeend',
      `<div onclick="go('${d.id}')" class="sheet cursor-pointer hover:-translate-y-1 transition-transform" style="--acc:${c}">
        <div class="sheet-head p-6">
          <div class="flex items-start justify-between mb-4">
            <div class="w-12 h-12 rounded-xl grid place-items-center border" style="background:${c}1f;border-color:${c}55;color:${c}"><i data-lucide="${d.icon}" class="w-6 h-6"></i></div>
            <div class="ring" style="--acc:${c};--p:${st.pct}"><span>${st.pct}%</span></div>
          </div>
          <h3 class="text-xl font-black text-white mb-1">${esc(d.title)}</h3>
          <p class="text-[11px] font-mono uppercase tracking-widest mb-3" style="color:${c}">${esc(d.subtitle)}</p>
          <p class="text-sm text-[#9fb6cb] line-clamp-2 mb-4">${esc(d.description)}</p>
          <div class="flex items-center justify-between text-[11px] font-mono text-[#7f9bb3]">
            <span>${(d.partitions||[]).length} بارتيشن · ${st.d}/${st.t} مكتمل</span>
            <span class="flex items-center gap-1" style="color:${c}">دخول <i data-lucide="arrow-left" class="w-4 h-4"></i></span>
          </div>
        </div>
      </div>`);
  });
}

function renderDept(){
  const d=depts.find(x=>x.id===current); if(!d){ go('home'); return; }
  const c=acc(d.color); const st=stats(d);
  let headAdmin = isAdmin ? `<div class="flex gap-2">
      <button class="icobtn" title="تعديل القسم" onclick="openModal('dept','${d.id}')"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
      <button class="icobtn del" title="حذف القسم" onclick="del('${d.id}')"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
    </div>` : '';
  $('dept-head').innerHTML =
    `<div class="titleblock sheet" style="--acc:${c}">
      <div class="diag"></div>
      <div class="relative p-6 sm:p-8 flex flex-col md:flex-row md:items-center gap-6">
        <div class="w-16 h-16 rounded-2xl grid place-items-center border shrink-0" style="background:${c}1f;border-color:${c}55;color:${c}"><i data-lucide="${d.icon}" class="w-8 h-8"></i></div>
        <div class="flex-1">
          <div class="flex items-center gap-3 mb-1"><span class="stamp" style="--acc:${c}">DEPT · ${esc(d.subtitle||'')}</span>${headAdmin}</div>
          <h2 class="text-2xl sm:text-4xl font-black text-white">${esc(d.title)}</h2>
          <p class="text-[#9fb6cb] mt-2 max-w-2xl text-sm">${esc(d.description)}</p>
        </div>
        <div class="ring shrink-0" style="--acc:${c};--p:${st.pct}"><span>${st.pct}%</span></div>
      </div>
    </div>`;

  // partitions
  const wrap=$('partitions'); wrap.innerHTML='';
  if(!(d.partitions||[]).length){
    wrap.innerHTML=`<div class="sheet p-12 text-center col-span-full" style="--acc:${c}">
      <i data-lucide="layout-panel-top" class="w-10 h-10 mx-auto mb-3" style="color:${c}"></i>
      <p class="text-[#9fb6cb]">لا توجد بارتيشنات بعد.</p>
      ${isAdmin?`<button onclick="addPartition()" class="pillbtn pill-primary mt-4"><i data-lucide="plus" class="w-4 h-4"></i> إضافة أول بارتيشن</button>`:''}
    </div>`;
    lucide.createIcons(); return;
  }
  d.partitions.forEach((p,i)=>{
    const pc=acc(p.color); const pst=stats(p); const col=collapsed['P_'+p.id];
    const first=i===0, last=i===d.partitions.length-1;
    let pAdmin = isAdmin ? `<div class="flex items-center gap-1.5" onclick="event.stopPropagation()">
        <button class="move" title="تحريك لأعلى" onclick="move('${p.id}',-1)" ${first?'disabled':''}><i data-lucide="arrow-up" class="w-3.5 h-3.5"></i></button>
        <button class="move" title="تحريك لأسفل" onclick="move('${p.id}',1)" ${last?'disabled':''}><i data-lucide="arrow-down" class="w-3.5 h-3.5"></i></button>
        <button class="icobtn" title="تعديل" onclick="openModal('partition','${p.id}')"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
        <button class="icobtn del" title="حذف" onclick="del('${p.id}')"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </div>` : '';
    

    const el=document.createElement('div');
    el.className='sheet partition-card cursor-pointer'; el.style.setProperty('--acc',pc); el.onclick=()=>openPartition(p.id);
    el.innerHTML = `
      <div class="partition-cover">
        <img src="${p.image||defaultImage}" alt="${esc(p.title)}" loading="lazy" decoding="async" onerror="this.src=defaultImage">
        <div class="cover-icon" style="background:${pc}2b;border-color:${pc}80;color:${pc}"><i data-lucide="${p.icon}" class="w-5 h-5"></i></div>
      </div>
      <div class="sheet-head p-6">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 mb-1 flex-wrap"><span class="stamp" style="--acc:${pc}">PARTITION ${String(i+1).padStart(2,'0')}</span><span class="text-[10px] font-mono uppercase tracking-widest" style="color:${pc}">${esc(p.subtitle||'')}</span></div>
            <h3 class="text-xl font-black text-white">${esc(p.title)}</h3>
          </div>
          <div class="ring w-12! h-12!" style="--acc:${pc};--p:${pst.pct}"><span class="w-[38px]! h-[38px]! text-[11px]!">${pst.pct}%</span></div>
        </div>
        <p class="text-[14px] text-[#9fb6cb] mt-2 min-h-[44px]">${esc(p.description||'')}</p>
        <div class="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-[rgba(120,180,230,.12)]">
          <span class="flex items-center gap-1 text-[12px] font-bold" style="color:${pc}">دخول <i data-lucide="arrow-left" class="w-4 h-4"></i></span>
          <div onclick="event.stopPropagation()">${pAdmin}</div>
        </div>
      </div>`;

    // محتوى البارتيشن يظهر في صفحة مستقلة عند الضغط على البطاقة.
    wrap.appendChild(el);
  });
  lucide.createIcons();
}

function renderPartition(){
  const r=locate(currentPartition); if(!r || r.kind!=='partition'){ currentPartition=null; render(); return; }
  const p=r.node, d=r.dept, pc=acc(p.color), pst=stats(p);
  let pAdmin=isAdmin ? `<div class="flex items-center gap-1.5" onclick="event.stopPropagation()">
    <button class="icobtn" title="تعديل" onclick="openModal('partition','${p.id}')"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
    <button class="icobtn del" title="حذف" onclick="del('${p.id}')"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
  </div>` : '';
  const addCat=isAdmin ? `<button onclick="openModal('category',null,'${p.id}')" class="pillbtn pill-primary"><i data-lucide="folder-plus" class="w-4 h-4"></i> إضافة تصنيف</button>` : '';
  const wrap=$('partition-detail');
  wrap.innerHTML=`
    <div class="flex items-center justify-between flex-wrap gap-3 mb-6">
      <button onclick="go('${d.id}')" class="flex items-center gap-2 text-[12px] font-bold text-[#9fb6cb] hover:text-sky-400 transition uppercase tracking-wide"><i data-lucide="arrow-right" class="w-4 h-4"></i> رجوع إلى ${esc(d.title)}</button>
      ${addCat}
    </div>
    <div class="sheet" style="--acc:${pc}">
      <div class="partition-cover h-56! sm:h-72!"><img src="${p.image||defaultImage}" alt="${esc(p.title)}" loading="lazy" decoding="async" onerror="this.src=defaultImage"><div class="cover-icon" style="background:${pc}2b;border-color:${pc}80;color:${pc}"><i data-lucide="${p.icon}" class="w-6 h-6"></i></div></div>
      <div class="sheet-head p-6 sm:p-8">
        <div class="flex items-start justify-between gap-4"><div><div class="flex items-center gap-2 mb-2 flex-wrap"><span class="stamp" style="--acc:${pc}">PARTITION</span><span class="text-[11px] font-mono uppercase tracking-widest" style="color:${pc}">${esc(p.subtitle||'')}</span></div><h2 class="text-2xl sm:text-3xl font-black text-white">${esc(p.title)}</h2><p class="text-[#9fb6cb] mt-2 text-sm">${esc(p.description||'')}</p></div><div class="flex items-center gap-3"><div class="ring" style="--acc:${pc};--p:${pst.pct}"><span>${pst.pct}%</span></div>${pAdmin}</div></div>
      </div>
    </div>
    <div class="flex items-center justify-between flex-wrap gap-2 mt-9 mb-5">
      <h3 class="text-xl font-black text-white flex items-center gap-2"><i data-lucide="layers" class="w-5 h-5" style="color:${pc}"></i> التصنيفات</h3>
      <span class="text-[11px] font-mono text-[#7f9bb3]">${(p.categories||[]).length} تصنيف</span>
    </div>
    <div class="categories-grid" id="partition-categories"></div>`;
  const body=$('partition-categories');
  if(!(p.categories||[]).length) body.innerHTML=`<div class="sheet p-12 text-center col-span-full" style="--acc:${pc}"><i data-lucide="folder-open" class="w-10 h-10 mx-auto mb-3" style="color:${pc}"></i><p class="text-[#9fb6cb]">لا توجد تصنيفات بعد.</p>${isAdmin?`<button onclick="openModal('category',null,'${p.id}')" class="pillbtn pill-primary mt-4"><i data-lucide="plus" class="w-4 h-4"></i> إضافة أول تصنيف</button>`:''}</div>`;
  else p.categories.forEach((cat,ci)=>body.appendChild(renderCategory(cat,p,ci,p.categories.length,pc)));
  lucide.createIcons();
}

function renderCategory(cat, part, ci, total, pc){
  const first=ci===0, last=ci===total-1;
  const box=document.createElement('div');
  box.className='cat-card cursor-pointer';
  box.style.setProperty('--acc',pc);
  let admin = isAdmin ? `<div class="flex items-center gap-1.5" onclick="event.stopPropagation()">
      <button class="move" title="أعلى" onclick="move('${cat.id}',-1)" ${first?'disabled':''}><i data-lucide="arrow-up" class="w-3.5 h-3.5"></i></button>
      <button class="move" title="أسفل" onclick="move('${cat.id}',1)" ${last?'disabled':''}><i data-lucide="arrow-down" class="w-3.5 h-3.5"></i></button>
      <button class="icobtn" title="تعديل" onclick="openModal('category','${cat.id}')"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
      <button class="icobtn del" title="حذف" onclick="del('${cat.id}')"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
    </div>` : '';
  const cnt=(cat.courses||[]).length + (cat.subCategories||[]).reduce((a,s)=>a+(s.courses||[]).length,0);
  box.innerHTML = `<div class="cat-card-head" onclick="openCategory('${cat.id}')">
    <div class="flex items-center gap-3 min-w-0">
      <i data-lucide="arrow-left" class="w-5 h-5 text-[#7f9bb3] shrink-0"></i>
      <div class="w-11 h-11 rounded-xl grid place-items-center shrink-0" style="background:${pc}1f;color:${pc}"><i data-lucide="${cat.icon}" class="w-6 h-6"></i></div>
      <h4 class="text-[16px] font-bold text-white truncate">${esc(cat.title)}</h4>
      <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-[rgba(255,255,255,.06)] text-[#9fb6cb] shrink-0">${cnt}</span>
    </div>
    <div class="shrink-0">${admin}</div>
  </div>`;
  return box;
}

function renderCategoryDetail(){
  const r=locate(currentCategory);
  if(!r || r.kind!=='category'){ currentCategory=null; render(); return; }
  const cat=r.node, part=r.part, d=r.dept, pc=acc(part.color), cst=stats(cat);
  if(cat.id!==lastCatId){ currentCatTab='content'; lastCatId=cat.id; }
  const ccnt=(cat.courses||[]).length + (cat.subCategories||[]).reduce((a,s)=>a+(s.courses||[]).length,0);
  let cAdmin=isAdmin ? `<div class="flex items-center gap-1.5" onclick="event.stopPropagation()">
    <button class="icobtn" title="تعديل" onclick="openModal('category','${cat.id}')"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
    <button class="icobtn del" title="حذف" onclick="del('${cat.id}')"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
  </div>` : '';
  const addBtn=isAdmin ? `<button onclick="openModal('course',null,'${cat.id}')" class="pillbtn pill-primary"><i data-lucide="plus" class="w-4 h-4"></i> إضافة كورس</button>
    <button onclick="openModal('subcategory',null,'${cat.id}')" class="pillbtn pill-ghost"><i data-lucide="git-branch" class="w-4 h-4"></i> تصنيف فرعي</button>` : '';
  const wrap=$('category-detail');
  wrap.innerHTML=`
    <div class="flex items-center justify-between flex-wrap gap-3 mb-6">
      <button onclick="openPartition('${part.id}')" class="flex items-center gap-2 text-[12px] font-bold text-[#9fb6cb] hover:text-sky-400 transition uppercase tracking-wide"><i data-lucide="arrow-right" class="w-4 h-4"></i> رجوع إلى ${esc(part.title)}</button>
      <div class="flex gap-2 flex-wrap">${addBtn}</div>
    </div>
    <div class="sheet" style="--acc:${pc}">
      <div class="sheet-head p-6 sm:p-8">
        <div class="flex items-start justify-between gap-4"><div><div class="flex items-center gap-2 mb-2 flex-wrap"><span class="stamp" style="--acc:${pc}">CATEGORY</span><span class="text-[11px] font-mono uppercase tracking-widest" style="color:${pc}">${esc(part.title)}</span></div><h2 class="text-2xl sm:text-3xl font-black text-white">${esc(cat.title)}</h2></div><div class="flex items-center gap-3"><div class="ring" style="--acc:${pc};--p:${cst.pct}"><span>${cst.pct}%</span></div>${cAdmin}</div></div>
      </div>
      <div class="nt-tabs">
        <button type="button" onclick="setCatTab('content')" class="nt-tab ${currentCatTab==='content'?'on-content':''}"><i data-lucide="layers" class="w-4 h-4"></i> المحتوى (${ccnt})</button>
        <button type="button" onclick="setCatTab('notes')" class="nt-tab ${currentCatTab==='notes'?'on-notes':''}"><i data-lucide="sticky-note" class="w-4 h-4"></i> الملاحظات (${(cat.notes||[]).length})</button>
      </div>
      <div class="cat-card-body divide-y divide-[rgba(120,180,230,.06)] bg-[rgba(0,0,0,.15)]" id="category-content" style="${currentCatTab==='notes'?'display:none':''}"></div>
      <div id="category-notes" class="${currentCatTab==='notes'?'':'nt-hide'}"></div>
    </div>`;
  const body=$('category-content');
  (cat.courses||[]).forEach((co,i)=> body.appendChild(renderCourse(co, cat.id, i, cat.courses.length, pc)));
  (cat.subCategories||[]).forEach(sub=>{
    const subHead=document.createElement('div');
    subHead.className='px-5 py-3 bg-[rgba(0,0,0,.25)] flex items-center justify-between gap-2 flex-wrap';
    let subAdmin = isAdmin ? `<div class="flex items-center gap-1.5">
        <button class="pillbtn pill-ghost py-0.5! px-2! text-[10px]!" onclick="openModal('course',null,'${sub.id}')"><i data-lucide="plus" class="w-3 h-3"></i> كورس</button>
        <button class="icobtn w-7! h-7!" title="تعديل" onclick="openModal('subcategory','${sub.id}')"><i data-lucide="edit-3" class="w-3.5 h-3.5"></i></button>
        <button class="icobtn del w-7! h-7!" title="حذف" onclick="del('${sub.id}')"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
      </div>` : '';
    subHead.innerHTML=`<div class="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider" style="color:${pc}"><i data-lucide="${sub.icon}" class="w-4 h-4"></i> ${esc(sub.title)}</div>${subAdmin}`;
    body.appendChild(subHead);
    (sub.courses||[]).forEach((co,i)=> body.appendChild(renderCourse(co, sub.id, i, sub.courses.length, pc)));
  });
    if(!(cat.courses||[]).length && !(cat.subCategories||[]).length){
      body.insertAdjacentHTML('beforeend', `<div class="p-6 text-center text-[#7f9bb3] text-sm italic">لا توجد كورسات بعد.</div>`);
    }

    // 🗒️ جولة النوتس: الملاحظات جوّه نفس الشيت تحت التاب بالظبط (مش شيت لحالها تحت الصفحة)
    const notesPane=$('category-notes');
    if(notesPane) notesPane.appendChild(renderNotes(cat, pc));

    lucide.createIcons();
  }

function renderCourse(co, parentId, i, total, pc){
  const first=i===0, last=i===total-1;
  const row=document.createElement('div');
  row.className='row group p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3';
  let mv = isAdmin ? `<div class="flex gap-1" onclick="event.stopPropagation()">
      <button class="move" title="أعلى" onclick="move('${co.id}',-1)" ${first?'disabled':''}><i data-lucide="arrow-up" class="w-3 h-3"></i></button>
      <button class="move" title="أسفل" onclick="move('${co.id}',1)" ${last?'disabled':''}><i data-lucide="arrow-down" class="w-3 h-3"></i></button>
    </div>` : '';
  let adm = isAdmin ? `<div class="flex gap-1.5 sm:opacity-0 group-hover:opacity-100 transition" onclick="event.stopPropagation()">
      <button class="icobtn w-8! h-8!" title="تعديل" onclick="openModal('course','${co.id}','${parentId}')"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
      <button class="icobtn del w-8! h-8!" title="حذف" onclick="del('${co.id}')"><i data-lucide="trash" class="w-3.5 h-3.5"></i></button>
    </div>` : '';
  row.innerHTML = `
    <div class="flex items-center gap-3 min-w-0 flex-1">
      ${mv}
      <button onclick="toggleCourse('${co.id}')" class="chk ${co.completed?'done':''}" style="--acc:${pc}"><i data-lucide="check" class="w-4 h-4"></i></button>
      <span class="text-[14.5px] truncate ${co.completed?'text-[#7f9bb3] line-through':'text-[#e8f1f8]'}">${esc(co.title)}</span>
    </div>
    <div class="flex items-center gap-3 justify-end">
      <a href="${esc(co.link)}" target="_blank" class="pillbtn pill-ghost py-1.5! text-[12px]!" style="color:${pc};border-color:${pc}55">فتح المصدر <i data-lucide="external-link" class="w-3.5 h-3.5"></i></a>
      ${adm}
    </div>`;
  return row;
}

function fmtDate(s){
  try{ const d=new Date(s);
    return d.toLocaleDateString('ar-EG',{year:'numeric',month:'short',day:'numeric'}) + ' · ' + d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
  }catch(e){ return ''; }
}
function renderNotes(cat, pc){
  // 🗒️ جولة النوتس — كروت «ستيكي» ملوّنة بنفس شكل وتوزيعة موقع المواد حرفيًا
  const wrapDiv=document.createElement('div');
  wrapDiv.className='nt-notes-wrap';
  const notes=cat.notes||[];
  let html='';
  if(isAdmin){
    html+=`<div class="nt-notes-admin"><button onclick="addNote('${cat.id}')" class="pillbtn pill-ghost py-1.5! text-[12px]!" style="color:${pc};border-color:${pc}55"><i data-lucide="plus" class="w-4 h-4"></i> إضافة ملاحظة</button></div>`;
  }
  if(!notes.length){
    html+=`<div class="nt-empty"><div class="nt-empty-ic"><i data-lucide="sticky-note" class="w-8 h-8"></i></div><p class="nt-empty-txt">لا توجد ملاحظات</p></div>`;
  } else {
    html+='<div class="nt-grid">';
    notes.forEach((n,i)=>{
      const npal=isLightTheme()?NOTE_COLORS_LIGHT:NOTE_COLORS_DARK;
      const ns=npal[i%npal.length];
      html+=`<div class="nt-card" style="background:${ns.bg};color:${ns.color}">
        <p class="nt-text">${esc(n.text)}</p>
        <div class="nt-foot">
          ${n.date?`<span class="nt-date">${new Date(n.date).toLocaleDateString('ar-EG')}</span>`:'<span class="nt-date"></span>'}
          ${isAdmin?`<span class="nt-actions">
            <button class="nt-act" onclick="editNote('${cat.id}','${n.id}')"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i> تعديل</button>
            <button class="nt-act" onclick="delNote('${cat.id}','${n.id}')"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i> حذف</button>
          </span>`:''}
        </div>
      </div>`;
    });
    html+='</div>';
  }
  wrapDiv.innerHTML=html;
  return wrapDiv;
}

function render(){
  renderTabs();
  const home=$('view-home'), dept=$('view-dept'), partition=$('view-partition'), category=$('view-category');
  home.classList.add('hidden'); dept.classList.add('hidden'); partition.classList.add('hidden'); category.classList.add('hidden');
  if(current==='home'){ home.classList.remove('hidden'); renderHome(); }
  else if(currentCategory){ category.classList.remove('hidden'); renderCategoryDetail(); }
  else if(currentPartition){ partition.classList.remove('hidden'); renderPartition(); }
  else { dept.classList.remove('hidden'); renderDept(); }
  lucide.createIcons();
}

/* ============================ INIT ============================ */
function initFromHash(){
  const [deptId, partId, catId]=location.hash.replace('#','').split('/');
  current=(deptId && depts.find(d=>d.id===deptId))?deptId:'home';
  currentPartition=(partId && locate(partId)?.kind==='partition')?partId:null;
  currentCategory=(catId && locate(catId)?.kind==='category')?catId:null;
}
loadDeptsFromJson().then(()=>{ initFromHash(); render(); });

// Safety net: re-initialize icons after a short delay in case of CDN timing issues
setTimeout(function() {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}, 500);
