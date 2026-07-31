/* ============================ DATA ============================ */
const ICONS = ['building-2','landmark','ruler','cpu','cog','zap','radio','flask-conical','wrench','hammer','layers','network','circuit-board','hard-hat','pyramid','mountain','droplets','atom','satellite','boxes','pencil-ruler','factory','gauge','plug'];
const COLORS = {
  sky:'#38bdf8', amber:'#fbbf24', rose:'#fb7185', violet:'#a78bfa',
  emerald:'#34d399', orange:'#fb923c', lime:'#a3e635', fuchsia:'#e879f9', cyan:'#22d3ee'
};
const defaultImage = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='100%' height='100%' fill='#0d2137'/><g stroke='#1b3650' stroke-width='1'><path d='M0 60H640M0 120H640M0 180H640M0 240H640M0 300H640M80 0V360M160 0V360M240 0V360M320 0V360M400 0V360M480 0V360M560 0V360'/></g><text x='50%' y='50%' font-family='monospace' font-size='22' fill='#38618a' text-anchor='middle' dy='.3em'>PARTITION</text></svg>");

// ---- EXPORT TARGET (DO NOT DELETE THIS LINE) ----
const defaultDepartments = DEFAULT_DEPTS;

const STORAGE_KEY = 'engBlueprintData_Roadmaps_v1';
const safeOriginal = defaultDepartments;

let depts = JSON.parse(localStorage.getItem(STORAGE_KEY)) || JSON.parse(JSON.stringify(safeOriginal));
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
  try{
    const res = await fetch('data/sites.json', { cache:'no-store' });
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data && data.depts);
    if(!Array.isArray(arr)) throw new Error('bad json');
    depts = arr;
    applyUserProgress();
  }catch(e){
    console.warn('تعذّر تحميل data/sites.json:', e);
    depts = [];
    showToast('تعذّر تحميل ملف المحتوى — شغّل من سيرفر مش من الملف مباشرة', true);
  }
}

/* ============================ ROUTING ============================ */
function go(target){ currentPartition=null; currentCategory=null; current=target; history.pushState(null,'', target==='home'? location.pathname : location.pathname+'#'+target); render(); window.scrollTo({top:0}); }
function openPartition(id){ const r=locate(id); if(!r || r.kind!=='partition') return; current=r.dept.id; currentPartition=id; currentCategory=null; history.pushState(null,'',location.pathname+'#'+current+'/'+id); render(); window.scrollTo({top:0}); }
function openCategory(id){ const r=locate(id); if(!r || r.kind!=='category') return; current=r.dept.id; currentPartition=r.part.id; currentCategory=id; history.pushState(null,'',location.pathname+'#'+current+'/'+currentPartition+'/'+id); render(); window.scrollTo({top:0}); }
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
        <img src="${p.image||defaultImage}" alt="${esc(p.title)}" onerror="this.src=defaultImage">
        <div class="cover-icon" style="background:${pc}2b;border-color:${pc}80;color:${pc}"><i data-lucide="${p.icon}" class="w-5 h-5"></i></div>
      </div>
      <div class="sheet-head p-6">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 mb-1 flex-wrap"><span class="stamp" style="--acc:${pc}">PARTITION ${String(i+1).padStart(2,'0')}</span><span class="text-[10px] font-mono uppercase tracking-widest" style="color:${pc}">${esc(p.subtitle||'')}</span></div>
            <h3 class="text-xl font-black text-white">${esc(p.title)}</h3>
          </div>
          <div class="ring !w-12 !h-12" style="--acc:${pc};--p:${pst.pct}"><span class="!w-[38px] !h-[38px] !text-[11px]">${pst.pct}%</span></div>
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
      <div class="partition-cover !h-56 sm:!h-72"><img src="${p.image||defaultImage}" alt="${esc(p.title)}" onerror="this.src=defaultImage"><div class="cover-icon" style="background:${pc}2b;border-color:${pc}80;color:${pc}"><i data-lucide="${p.icon}" class="w-6 h-6"></i></div></div>
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
      <div class="cat-card-body divide-y divide-[rgba(120,180,230,.06)] bg-[rgba(0,0,0,.15)]" id="category-content"></div>
    </div>`;
  const body=$('category-content');
  (cat.courses||[]).forEach((co,i)=> body.appendChild(renderCourse(co, cat.id, i, cat.courses.length, pc)));
  (cat.subCategories||[]).forEach(sub=>{
    const subHead=document.createElement('div');
    subHead.className='px-5 py-3 bg-[rgba(0,0,0,.25)] flex items-center justify-between gap-2 flex-wrap';
    let subAdmin = isAdmin ? `<div class="flex items-center gap-1.5">
        <button class="pillbtn pill-ghost !py-0.5 !px-2 !text-[10px]" onclick="openModal('course',null,'${sub.id}')"><i data-lucide="plus" class="w-3 h-3"></i> كورس</button>
        <button class="icobtn !w-7 !h-7" title="تعديل" onclick="openModal('subcategory','${sub.id}')"><i data-lucide="edit-3" class="w-3.5 h-3.5"></i></button>
        <button class="icobtn del !w-7 !h-7" title="حذف" onclick="del('${sub.id}')"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
      </div>` : '';
    subHead.innerHTML=`<div class="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider" style="color:${pc}"><i data-lucide="${sub.icon}" class="w-4 h-4"></i> ${esc(sub.title)}</div>${subAdmin}`;
    body.appendChild(subHead);
    (sub.courses||[]).forEach((co,i)=> body.appendChild(renderCourse(co, sub.id, i, sub.courses.length, pc)));
  });
    if(!(cat.courses||[]).length && !(cat.subCategories||[]).length){
      body.insertAdjacentHTML('beforeend', `<div class="p-6 text-center text-[#7f9bb3] text-sm italic">لا توجد كورسات بعد.</div>`);
    }

    // قسم ملاحظات مخصص ومنفصل عن المحتوى
    const notesPanel=document.createElement('div');
    notesPanel.className='sheet mt-8';
    notesPanel.style.setProperty('--acc', pc);
    notesPanel.appendChild(renderNotes(cat, pc));
    wrap.appendChild(notesPanel);

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
      <button class="icobtn !w-8 !h-8" title="تعديل" onclick="openModal('course','${co.id}','${parentId}')"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
      <button class="icobtn del !w-8 !h-8" title="حذف" onclick="del('${co.id}')"><i data-lucide="trash" class="w-3.5 h-3.5"></i></button>
    </div>` : '';
  row.innerHTML = `
    <div class="flex items-center gap-3 min-w-0 flex-1">
      ${mv}
      <button onclick="toggleCourse('${co.id}')" class="chk ${co.completed?'done':''}" style="--acc:${pc}"><i data-lucide="check" class="w-4 h-4"></i></button>
      <span class="text-[14.5px] truncate ${co.completed?'text-[#7f9bb3] line-through':'text-[#e8f1f8]'}">${esc(co.title)}</span>
    </div>
    <div class="flex items-center gap-3 justify-end">
      <a href="${esc(co.link)}" target="_blank" class="pillbtn pill-ghost !py-1.5 !text-[12px]" style="color:${pc};border-color:${pc}55">فتح المصدر <i data-lucide="external-link" class="w-3.5 h-3.5"></i></a>
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
  const sec=document.createElement('div');
  sec.className='notes-section';
  const notes=cat.notes||[];
  let html=`<div class="flex items-center justify-between gap-2 mb-3">
      <div class="flex items-center gap-2 text-[13px] font-bold" style="color:${pc}"><i data-lucide="sticky-note" class="w-4 h-4"></i> الملاحظات <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-[rgba(255,255,255,.06)] text-[#9fb6cb]">${notes.length}</span></div>
      ${isAdmin?`<button onclick="addNote('${cat.id}')" class="pillbtn pill-ghost !py-1.5 !text-[12px]" style="color:${pc};border-color:${pc}55"><i data-lucide="plus" class="w-4 h-4"></i> إضافة ملاحظة</button>`:''}
    </div>`;
  if(!notes.length){
    html+=`<div class="text-center text-[#7f9bb3] text-[13px] italic py-1">لا توجد ملاحظات بعد.</div>`;
  } else {
    html+='<div class="space-y-2.5">';
    notes.forEach(n=>{
      html+=`<div class="note-card">
        <p class="note-text text-[13.5px] text-[#e8f1f8] leading-relaxed">${esc(n.text)}</p>
        ${n.date?`<div class="text-[10px] font-mono text-[#7f9bb3] mt-2">${fmtDate(n.date)}</div>`:''}
        ${isAdmin?`<div class="flex items-center gap-3 mt-2 pt-2 border-t border-[rgba(120,180,230,.1)]">
          <button class="text-[12px] font-bold flex items-center gap-1.5 text-[#9fb6cb] hover:text-sky-400 transition" onclick="editNote('${cat.id}','${n.id}')"><i data-lucide="edit-2" class="w-4 h-4"></i> تعديل</button>
          <button class="text-[12px] font-bold flex items-center gap-1.5 text-rose-400 hover:text-rose-300 transition" onclick="delNote('${cat.id}','${n.id}')"><i data-lucide="trash-2" class="w-4 h-4"></i> حذف</button>
        </div>`:''}
      </div>`;
    });
    html+='</div>';
  }
  sec.innerHTML=html;
  return sec;
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
