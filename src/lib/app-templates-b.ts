/**
 * APP_TEMPLATES (part B) — ready-made, fully working business apps (continued).
 */
import type { TemplateDef } from './templates'
import { APP_TEMPLATES_A } from './app-templates-a'

const BASE_CSS = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
.wrap{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:1.6rem;margin-bottom:4px}p.sub{color:#94a3b8;font-size:.9rem;margin-bottom:20px}
button{cursor:pointer;border:none;border-radius:8px;font-weight:600}input,select,textarea{background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:8px;padding:10px 12px;font-size:.95rem;width:100%}
.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px}.btn{background:#6366f1;color:#fff;padding:10px 16px;font-size:.9rem}.btn:hover{background:#4f46e5}
.btn2{background:#334155;color:#e2e8f0;padding:8px 12px;font-size:.85rem}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.empty{color:#64748b;text-align:center;padding:32px 0;font-size:.95rem}`

export const APP_TEMPLATES_B: TemplateDef[] = [
  {
    id: 'app-booking',
    name: 'Appointment Booking',
    framework: 'static',
    runtime: "",
    description: 'Date + time-slot booking with conflict prevention and an admin view of bookings.',
    icon: '📅',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BookEase — Appointments</title><style>${BASE_CSS}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-top:12px}
.slot{background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:10px;border-radius:8px;font-size:.9rem}
.slot:hover{border-color:#6366f1}.slot.taken{opacity:.35;pointer-events:none;text-decoration:line-through}
.blist{font-size:.9rem}.bitem{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #334155}
</style></head><body><div class="wrap">
<h1>📅 BookEase</h1><p class="sub">Pick a day, grab a slot — confirmed instantly</p>
<div class="card"><label style="font-size:.85rem;color:#94a3b8">Choose date</label>
<input type="date" id="day" style="margin-top:6px" onchange="draw()">
<div class="slots" id="slots"></div></div>
<form id="bf" style="display:none;margin-top:14px" class="card row">
<input id="nm" placeholder="Your name" required style="flex:1;min-width:150px">
<input id="ph" placeholder="Phone" required style="flex:1;min-width:130px">
<button class="btn">Confirm booking</button></form>
<div class="card" style="margin-top:14px"><h3 style="margin-bottom:8px">Today's bookings (admin)</h3><div class="blist" id="bl"></div></div>
<script>
const HOURS=[9,10,11,12,14,15,16,17];
let books=JSON.parse(localStorage.getItem('bk')||'{}');let picked=null;
day.value=new Date().toISOString().slice(0,10);
function key(){return day.value+' '+picked}
function draw(){picked=null;bf.style.display='none';
slots.innerHTML=HOURS.map(h=>{const k=day.value+' '+h+':00';const taken=!!books[k];
return \`<button class="slot \${taken?'taken':''}" onclick="pick(this,'\${h}:00')">\${h}:00</button>\`}).join('');adm()}
function pick(btn,t){picked=t;bf.style.display='flex'}
bf.onsubmit=e=>{e.preventDefault();if(!picked)return;books[key()]={n:nm.value,p:ph.value};
localStorage.setItem('bk',JSON.stringify(books));alert('Booked! '+day.value+' at '+picked);bf.reset();bf.style.display='none';draw()};
function adm(){bl.innerHTML=Object.entries(books).filter(([k])=>k.startsWith(day.value)).map(([k,v])=>\`<div class="bitem"><span>\${k.split(' ')[1]} — <b>\${v.n}</b> (\${v.p})</span><button class="btn2" onclick="cancel('\${k}')">Cancel</button></div>\`).join('')||'<div class="empty">No bookings this day</div>'}
function cancel(k){delete books[k];localStorage.setItem('bk',JSON.stringify(books));draw()}
draw();</script></body></html>`,
      },
    ],
  },
  {
    id: 'app-invoice',
    name: 'Invoice Generator',
    framework: 'static',
    runtime: "",
    description: 'Line items, tax, printable professional invoice — for freelancers and shops.',
    icon: '🧾',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>InvoiceCraft</title><style>${BASE_CSS}
.inv{background:#fff;color:#0f172a;border-radius:12px;padding:28px;margin-top:10px}
.inv h2{color:#0f172a}.inv input{background:#f1f5f9;border:1px solid #cbd5e1;color:#0f172a}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:.92rem}
th{background:#0f172a;color:#fff;text-align:left;padding:8px}td{border-bottom:1px solid #e2e8f0;padding:8px}
.right{text-align:right}.tot{font-weight:800;font-size:1.1rem}
@media print{body *{visibility:hidden}.inv,.inv *{visibility:visible}.inv{position:absolute;inset:0}}
</style></head><body><div class="wrap">
<div class="row" style="justify-content:space-between"><div><h1>🧾 InvoiceCraft</h1><p class="sub">Fill it, print it, get paid</p></div>
<button class="btn" onclick="window.print()">🖨 Print / PDF</button></div>
<div class="inv"><div class="row" style="justify-content:space-between">
<div><h2 contenteditable>INVOICE #001</h2><small style="color:#64748b">Your Company LLC</small></div>
<div style="text-align:right"><input id="date" type="date" style="width:auto"><br><small style="color:#64748b">Due on receipt</small></div></div>
<div class="row" style="margin:14px 0"><input id="client" placeholder="Bill to — client name & address" style="max-width:380px"></div>
<table><thead><tr><th>Item</th><th style="width:90px">Qty</th><th style="width:110px">Price</th><th class="right" style="width:110px">Amount</th><th style="width:40px"></th></tr></thead>
<tbody id="rows"></tbody></table>
<div class="right"><div>Subtotal: <span id="sub">$0.00</span></div>
<div>Tax %: <input id="tax" type="number" value="0" style="width:70px" onchange="calc()"> → <span id="taxv">$0.00</span></div>
<div class="tot">TOTAL: <span id="tot">$0.00</span></div></div>
<button class="btn2" style="margin-top:10px" onclick="addRow()">+ Add line</button></div>
<script>
let n=0;date.value=new Date().toISOString().slice(0,10);
function addRow(d='',q=1,p=0){n++;const tr=document.createElement('tr');tr.id='r'+n;
tr.innerHTML=\`<td><input placeholder="Service or product" value="\${d}" oninput="calc()"></td>
<td><input type="number" value="\${q}" min="0" oninput="calc()"></td>
<td><input type="number" value="\${p}" min="0" step="0.01" oninput="calc()"></td>
<td class="right amt">$0.00</td><td><button class="btn2" onclick="document.getElementById('r\${n}').remove();calc()">✕</button></td>\`;
rows.appendChild(tr);calc()}
function calc(){let s=0;document.querySelectorAll('#rows tr').forEach(tr=>{const [d,q,p]=tr.querySelectorAll('input');
const a=(+q.value||0)*(+p.value||0);tr.querySelector('.amt').textContent='$'+a.toFixed(2);s+=a});
sub.textContent='$'+s.toFixed(2);const t=s*(+tax.value||0)/100;
taxv.textContent='$'+t.toFixed(2);tot.textContent='$'+(s+t).toFixed(2)}
addRow('Web design',1,350);addRow('Hosting (1 yr)',1,120);
</script></body></html>`,
      },
    ],
  },
  {
    id: 'app-portfolio',
    name: 'Portfolio Site',
    framework: 'static',
    runtime: "",
    description: 'Personal portfolio: hero, skills, projects grid and contact — perfect for freelancers.',
    icon: '💼',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alex Rahman — Portfolio</title><style>${BASE_CSS}
body{background:#0f172a}a{color:#818cf8;text-decoration:none}
.hero{text-align:center;padding:64px 0 44px}.ava{width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#22d3ee);display:flex;align-items:center;justify-content:center;font-size:2.4rem;margin:0 auto 16px}
h1{font-size:2.2rem}.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:14px}
.chip{background:#1e293b;border:1px solid #334155;border-radius:99px;padding:6px 14px;font-size:.82rem;color:#a5b4fc}
h2{margin:34px 0 14px;font-size:1.25rem;border-left:3px solid #6366f1;padding-left:10px}
.pcard{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px}
.pcard b{display:block;margin-bottom:4px}.pcard small{color:#94a3b8;line-height:1.5;display:block}
footer{text-align:center;color:#64748b;font-size:.85rem;padding:40px 0 24px}
</style></head><body><div class="wrap">
<div class="hero"><div class="ava">👨‍💻</div>
<h1>Alex Rahman</h1><p class="sub" style="margin-bottom:0">Full-stack developer · I build apps that ship</p>
<div class="chips"><span class="chip">React</span><span class="chip">Flutter</span><span class="chip">Node.js</span><span class="chip">Python</span><span class="chip">UI/UX</span></div></div>
<h2>Projects</h2><div class="grid">
<div class="pcard"><b>🛒 ShopLite</b><small>E-commerce storefront with cart & checkout. React + Stripe.</small><a href="#">View →</a></div>
<div class="pcard"><b>📱 FitTrack</b><small>Fitness tracking app, 10k downloads. Flutter.</small><a href="#">View →</a></div>
<div class="pcard"><b>🧾 InvoiceCraft</b><small>Invoice generator for freelancers. PWA.</small><a href="#">View →</a></div>
<div class="pcard"><b>💬 ChatWave</b><small>Realtime chat with rooms. Socket.io.</small><a href="#">View →</a></div></div>
<h2>Contact</h2><div class="card row" style="justify-content:space-between">
<span>📧 alex@example.com<br>📱 +880 1XXX-XXXXXX</span>
<a class="btn" href="mailto:alex@example.com">Hire me</a></div>
<footer>Built with ❤️ · © 2025 Alex Rahman</footer></div></body></html>`,
      },
    ],
  },
  {
    id: 'app-notes',
    name: 'Notes App',
    framework: 'static',
    runtime: "",
    description: 'Fast searchable notes with colors, edit/delete and offline persistence.',
    icon: '📝',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NoteNest</title><style>${BASE_CSS}
.search{max-width:420px;margin-bottom:16px}
.note{border-radius:12px;padding:14px;min-height:130px;display:flex;flex-direction:column;gap:6px;border:1px solid #334155}
.note h3{font-size:1rem;word-break:break-word}.note p{font-size:.85rem;color:#cbd5e1;flex:1;white-space:pre-wrap;word-break:break-word}
.note .row{justify-content:space-between}.dot{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer}
.dot.on{border-color:#fff}
#fab{position:fixed;bottom:22px;right:22px;width:56px;height:56px;border-radius:50%;background:#6366f1;color:#fff;font-size:1.6rem;box-shadow:0 8px 24px rgba(0,0,0,.4)}
dialog{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:14px;padding:18px;width:min(420px,92vw)}
dialog::backdrop{background:rgba(0,0,0,.6)}
</style></head><body><div class="wrap">
<h1>📝 NoteNest</h1><p class="sub">Your thoughts, saved offline</p>
<input class="search" id="q" placeholder="🔍 Search notes…" oninput="render()">
<div class="grid" id="grid"></div>
<button id="fab" onclick="edit(-1)">+</button>
<dialog id="dlg"><h3 id="dt" style="margin-bottom:10px">New note</h3>
<input id="ti" placeholder="Title" style="margin-bottom:8px">
<textarea id="bo" rows="5" placeholder="Write something…" style="margin-bottom:10px"></textarea>
<div class="row" style="justify-content:space-between">
<div class="row" id="palette"></div>
<div class="row"><button class="btn2" onclick="dlg.close()">Cancel</button><button class="btn" onclick="save()">Save</button></div></div></dialog>
<script>
const COLORS=['#f59e0b','#22c55e','#3b82f6','#ef4444','#a855f7'];
let notes=JSON.parse(localStorage.getItem('nn')||'[]');let cur=-1,col=COLORS[0];
function palette(){palette_.innerHTML=COLORS.map(c=>\`<button class="dot \${c==col?'on':''}" style="background:\${c}" onclick="col='\${c}';palette()"></button>\`).join('')}
function render(){const s=q.value.toLowerCase();
grid.innerHTML=notes.map((n,i)=>(n.t+n.b).toLowerCase().includes(s)?\`
<div class="note" style="background:\${n.c}22;border-color:\${n.c}66">
<h3>\${n.t||'(untitled)'}</h3><p>\${n.b}</p>
<div class="row"><small style="color:#64748b">\${new Date(n.at).toLocaleDateString()}</small>
<span class="row"><button class="btn2" onclick="edit(\${i})">✏️</button><button class="btn2" onclick="del(\${i})">🗑</button></span></div></div>\`:'').join('')
||'<div class="empty">No notes found</div>'}
function edit(i){cur=i;dt.textContent=i<0?'New note':'Edit note';
ti.value=i<0?'':notes[i].t;bo.value=i<0?'':notes[i].b;col=i<0?COLORS[0]:notes[i].c;palette();dlg.showModal()}
function save(){const t=ti.value.trim(),b=bo.value.trim();if(!t&&!b)return dlg.close();
if(cur<0)notes.unshift({t,b,c:col,at:Date.now()});else Object.assign(notes[cur],{t,b,c:col});
localStorage.setItem('nn',JSON.stringify(notes));dlg.close();render()}
function del(i){notes.splice(i,1);localStorage.setItem('nn',JSON.stringify(notes));render()}
render();</script></body></html>`,
      },
    ],
  },
  {
    id: 'app-fitness',
    name: 'Fitness Tracker',
    framework: 'static',
    runtime: "",
    description: 'Workout logger with weekly minutes goal, streaks and history.',
    icon: '💪',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FitTrack — Workouts</title><style>${BASE_CSS}
.ring{width:150px;height:150px;border-radius:50%;background:conic-gradient(#22c55e var(--p,0%),#334155 0);display:flex;align-items:center;justify-content:center;margin:0 auto 8px}
.ring>div{width:118px;height:118px;border-radius:50%;background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center}
.witem{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #334155;font-size:.93rem}
form{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-top:12px}
</style></head><body><div class="wrap">
<h1>💪 FitTrack</h1><p class="sub">Goal: 300 minutes every week</p>
<div class="card center" style="text-align:center"><div class="ring" id="ring"><div>
<b style="font-size:1.5rem" id="mins">0</b><small style="color:#94a3b8">min this week</small></div></div>
<b id="pct">0%</b> of weekly goal</div>
<form id="f"><input id="act" placeholder="Activity (e.g. Running)" required>
<input id="min" type="number" min="1" placeholder="Minutes" required>
<button class="btn">Log it</button></form>
<div class="card" style="margin-top:14px"><h3 style="margin-bottom:6px">This week</h3><div id="hist"></div></div>
<script>
let w=JSON.parse(localStorage.getItem('ft')||'[]');
const MON=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function weekStart(){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay());return d}
function render(){const ws=weekStart().getTime();
const wk=w.filter(x=>x.at>=ws);const total=wk.reduce((s,x)=>s+x.m,0);
const p=Math.min(100,Math.round(total/300*100));
ring.style.setProperty('--p',p+'%');mins.textContent=total;pct.textContent=p+'%';
hist.innerHTML=wk.length?wk.map((x,i)=>\`<div class="witem"><span>\${x.a}<small style="color:#64748b"> · \${MON[new Date(x.at).getDay()]}</small></span>
<span class="row"><b style="color:#4ade80">\${x.m} min</b><button class="btn2" onclick="w.splice(\${w.indexOf(x)},1);save();render()">✕</button></span></div>\`).join(''):'<div class="empty">No workouts logged yet — let's go!</div>'}
f.onsubmit=e=>{e.preventDefault();w.push({a:act.value,m:+min.value,at:Date.now()});save();f.reset();render()};
function save(){localStorage.setItem('ft',JSON.stringify(w))}
render();</script></body></html>`,
      },
    ],
  },
  {
    id: 'app-blog',
    name: 'Mini Blog',
    framework: 'static',
    runtime: "",
    description: 'Post list with reading view, draft writer and localStorage CMS.',
    icon: '✍️',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>InkWell — Blog</title><style>${BASE_CSS}
.post{padding:16px 0;border-bottom:1px solid #334155;cursor:pointer}
.post:hover h3{color:#a5b4fc}.post h3{margin-bottom:4px;transition:.2s}.post small{color:#64748b}
.reader{display:none}.reader.on{display:block}.reader p{line-height:1.8;color:#cbd5e1;white-space:pre-wrap;margin-top:12px}
.tag{font-size:.7rem;background:#6366f133;color:#a5b4fc;border-radius:99px;padding:2px 10px;margin-left:8px}
#new{position:fixed;bottom:22px;right:22px;background:#6366f1;color:#fff;width:54px;height:54px;border-radius:50%;font-size:1.5rem;box-shadow:0 8px 24px rgba(0,0,0,.4)}
dialog{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:14px;padding:18px;width:min(480px,92vw)}
dialog::backdrop{background:rgba(0,0,0,.6)}
</style></head><body><div class="wrap">
<div id="listView"><h1>✍️ InkWell</h1><p class="sub">Ideas, notes & stories</p><div id="posts"></div></div>
<div class="reader" id="reader"><button class="btn2" onclick="reader.classList.remove('on');listView.style.display='block'">← All posts</button>
<h1 id="rt" style="margin-top:12px"></h1><p id="rb"></p></div>
<button id="new" onclick="dlg.showModal();ti.value='';bo.value='';">+</button>
<dialog id="dlg"><h3 style="margin-bottom:10px">New post</h3>
<input id="ti" placeholder="Title" style="margin-bottom:8px">
<textarea id="bo" rows="7" placeholder="Tell the story…" style="margin-bottom:10px"></textarea>
<div class="row" style="justify-content:flex-end"><button class="btn2" onclick="dlg.close()">Cancel</button><button class="btn" onclick="pub()">Publish</button></div></dialog>
<script>
const SEED=[{t:'Why I build small apps',b:'Big ideas ship faster when they start small.\\n\\nEvery product I love began as a weekend hack: one screen, one job, done well. Scope grows AFTER the first user smiles.\\n\\nBuild tiny. Ship daily.',at:Date.now()-86400e3*2},{t:'My 5-tool dev stack in 2025',b:'1. An AI swarm that writes boilerplate\\n2. One editor, dark mode always\\n3. SQLite until it hurts\\n4. Preview on real phones\\n5. Publish in one click\\n\\nBoring tools, exciting products.',at:Date.now()-86400e3}];
let posts=JSON.parse(localStorage.getItem('ib')||'null')||SEED;
function list(){listView.style.display='block';reader.classList.remove('on');
posts.innerHTML?posts_.innerHTML=posts.map((p,i)=>\`<div class="post" onclick="open_(\${i})"><h3>\${p.t}<span class="tag">\${new Date(p.at).toLocaleDateString()}</span></h3><small>\${p.b.slice(0,110)}…</small></div>\`).join(''):'<div class="empty">No posts yet</div>'}
function open_(i){const p=posts[i];rt.textContent=p.t;rb.textContent=p.b;listView.style.display='none';reader.classList.add('on')}
function pub(){const t=ti.value.trim(),b=bo.value.trim();if(!t)return;posts.unshift({t,b,at:Date.now()});
localStorage.setItem('ib',JSON.stringify(posts));dlg.close();list()}
list();</script></body></html>`,
      },
    ],
  },
]

export const APP_TEMPLATES: TemplateDef[] = [...APP_TEMPLATES_A, ...APP_TEMPLATES_B]
