/**
 * APP_TEMPLATES (part A) — ready-made, fully working business apps for the
 * Template Marketplace. Each is a real, runnable single-file app (inline
 * CSS+JS, localStorage persistence) that publishes as-is to a live URL.
 */
import type { TemplateDef } from './templates'

const BASE_CSS = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
.wrap{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:1.6rem;margin-bottom:4px}p.sub{color:#94a3b8;font-size:.9rem;margin-bottom:20px}
button{cursor:pointer;border:none;border-radius:8px;font-weight:600}input,select,textarea{background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:8px;padding:10px 12px;font-size:.95rem;width:100%}
.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px}.btn{background:#6366f1;color:#fff;padding:10px 16px;font-size:.9rem}.btn:hover{background:#4f46e5}
.btn2{background:#334155;color:#e2e8f0;padding:8px 12px;font-size:.85rem}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.empty{color:#64748b;text-align:center;padding:32px 0;font-size:.95rem}`

export const APP_TEMPLATES_A: TemplateDef[] = [
  {
    id: 'app-ecommerce',
    name: 'E-commerce Storefront',
    framework: 'static',
    runtime: "",
    description: 'Product grid, shopping cart with totals, checkout flow — a real online store starter.',
    icon: '🛒',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ShopLite — Store</title><style>${BASE_CSS}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}
.cartbtn{background:#22c55e;color:#052e16;padding:10px 14px}
.pimg{height:110px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:2.6rem;background:#0f172a}
.pname{font-weight:600;margin:10px 0 2px}.price{color:#4ade80;font-weight:700}.add{width:100%;margin-top:10px;padding:8px}
#cartPanel{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:9}
#cartPanel.open{display:flex}.cbox{background:#1e293b;border:1px solid #334155;border-radius:14px;width:min(420px,92vw);padding:20px;max-height:80vh;overflow:auto}
.citem{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #334155;font-size:.92rem}
.total{font-size:1.15rem;font-weight:800;color:#4ade80;margin:14px 0}
</style></head><body><div class="wrap">
<header><div><h1>ShopLite</h1><p class="sub">Quality gear, fair prices</p></div>
<button class="cartbtn" onclick="toggleCart(true)">🛒 Cart (<span id="cartN">0</span>)</button></header>
<div class="grid" id="products"></div></div>
<div id="cartPanel"><div class="cbox">
<div class="row" style="justify-content:space-between"><h2>Your Cart</h2><button class="btn2" onclick="toggleCart(false)">✕</button></div>
<div id="citems"></div><div class="total" id="ctotal">Total: $0.00</div>
<button class="btn" style="width:100%;padding:12px" onclick="checkout()">Checkout</button>
</div></div>
<script>
const PRODUCTS=[{id:1,n:"Wireless Headphones",p:59.99,e:"🎧"},{id:2,n:"Smart Watch",p:89.99,e:"⌚"},{id:3,n:"Camera Drone",p:149.0,e:"🚁"},{id:4,n:"Bluetooth Speaker",p:29.99,e:"🔊"},{id:5,n:"Power Bank",p:19.99,e:"🔋"},{id:6,n:"USB-C Hub",p:24.5,e:"🔌"}];
let cart=JSON.parse(localStorage.getItem('shop_cart')||'{}');
const save=()=>localStorage.setItem('shop_cart',JSON.stringify(cart));
function render(){document.getElementById('products').innerHTML=PRODUCTS.map(p=>\`
<div class="card"><div class="pimg">\${p.e}</div><div class="pname">\${p.n}</div>
<div class="price">$\${p.p.toFixed(2)}</div><button class="btn add" onclick="add(\${p.id})">Add to cart</button></div>\`).join('');
const items=Object.entries(cart);const n=items.reduce((s,[,q])=>s+q,0);
document.getElementById('cartN').textContent=n;
document.getElementById('citems').innerHTML=items.length?items.map(([id,q])=>{const p=PRODUCTS.find(x=>x.id==id);return \`<div class="citem"><span>\${p.e} \${p.n} × \${q}</span><span>$\${(p.p*q).toFixed(2)} <button class="btn2" onclick="rm(\${id})">✕</button></span></div>\`}).join(''):'<div class="empty">Cart is empty</div>';
const total=items.reduce((s,[id,q])=>s+PRODUCTS.find(x=>x.id==id).p*q,0);
document.getElementById('ctotal').textContent='Total: $'+total.toFixed(2);}
function add(id){cart[id]=(cart[id]||0)+1;save();render()}
function rm(id){delete cart[id];save();render()}
function toggleCart(o){document.getElementById('cartPanel').classList.toggle('open',o)}
function checkout(){if(!Object.keys(cart).length)return alert('Cart is empty');alert('Order placed! Total: $'+Object.entries(cart).reduce((s,[id,q])=>s+PRODUCTS.find(x=>x.id==id).p*q,0).toFixed(2));cart={};save();render();toggleCart(false)}
render();</script></body></html>`,
      },
    ],
  },
  {
    id: 'app-expense-tracker',
    name: 'Expense Tracker',
    framework: 'static',
    runtime: "",
    description: 'Income & expense log with running balance, category breakdown and persistence.',
    icon: '💰',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pennywise — Expenses</title><style>${BASE_CSS}
.bal{font-size:2.2rem;font-weight:800;margin:6px 0 18px}.pos{color:#4ade80}.neg{color:#f87171}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px}
.titem{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #334155;font-size:.95rem}
.tag{font-size:.72rem;background:#334155;border-radius:99px;padding:2px 8px;margin-left:8px;color:#94a3b8}
.del{background:none;color:#64748b;font-size:1rem;padding:4px}
form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px}
form .full{grid-column:1/-1}
</style></head><body><div class="wrap">
<h1>Pennywise</h1><p class="sub">Know where every dollar goes</p>
<div class="card">Balance<div class="bal" id="bal">$0.00</div>
<div class="stats"><div class="card" style="padding:10px">Income<div class="bal pos" style="font-size:1.3rem" id="inc">$0</div></div>
<div class="card" style="padding:10px">Expenses<div class="bal neg" style="font-size:1.3rem" id="exp">$0</div></div></div></div>
<form id="f"><input class="full" id="desc" placeholder="Description (e.g. Groceries)" required>
<select id="type"><option value="exp">Expense</option><option value="inc">Income</option></select>
<input id="amt" type="number" step="0.01" min="0.01" placeholder="Amount" required>
<button class="btn full" type="submit">Add transaction</button></form>
<div class="card"><h3 style="margin-bottom:8px">History</h3><div id="list"></div></div></div>
<script>
let tx=JSON.parse(localStorage.getItem('tx')||'[]');
document.getElementById('f').onsubmit=e=>{e.preventDefault();
tx.unshift({d:desc.value,t:type.value,a:+amt.value,at:Date.now()});localStorage.setItem('tx',JSON.stringify(tx));f.reset();render()};
function del(i){tx.splice(i,1);localStorage.setItem('tx',JSON.stringify(tx));render()}
function render(){const inc=tx.filter(t=>t.t=='inc').reduce((s,t)=>s+t.a,0),exp=tx.filter(t=>t.t=='exp').reduce((s,t)=>s+t.a,0);
bal.textContent='$'+(inc-exp).toFixed(2);bal.className='bal '+(inc-exp>=0?'pos':'neg');
inc_.textContent='$'+inc.toFixed(2);exp_.textContent='$'+exp.toFixed(2);
list.innerHTML=tx.length?tx.map((t,i)=>\`<div class="titem"><span>\${t.d}<span class="tag">\${t.t=='inc'?'income':'expense'}</span></span>
<span class="row"><b class="\${t.t=='inc'?'pos':'neg'}">\${t.t=='inc'?'+':'−'}$\${t.a.toFixed(2)}</b><button class="del" onclick="del(\${i})">🗑</button></span></div>\`).join(''):'<div class="empty">No transactions yet</div>';}
render();</script></body></html>`,
      },
    ],
  },
  {
    id: 'app-restaurant',
    name: 'Restaurant Menu & Orders',
    framework: 'static',
    runtime: "",
    description: 'Categorized digital menu with an order cart and table booking note.',
    icon: '🍽️',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spice Garden — Menu</title><style>${BASE_CSS}
header{text-align:center;margin-bottom:18px}.tabs{display:flex;gap:8px;justify-content:center;margin-bottom:18px;flex-wrap:wrap}
.tab{background:#1e293b;border:1px solid #334155;padding:8px 14px;border-radius:99px;font-size:.85rem}
.tab.on{background:#f59e0b;color:#1c1917;border-color:#f59e0b}
.mitem{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px dashed #334155}
.mitem b{display:block}.mitem small{color:#94a3b8}.price{color:#fbbf24;font-weight:700;margin-right:10px}
#obar{position:fixed;bottom:0;left:0;right:0;background:#1e293b;border-top:1px solid #334155;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
</style></head><body><div class="wrap">
<header><h1>🌶️ Spice Garden</h1><p class="sub">Fresh · Fast · Flavorful — order below, pay at table</p></header>
<div class="tabs" id="tabs"></div><div id="menu"></div></div>
<div id="obar"><span id="osum">No items yet</span><button class="btn" onclick="place()">Place order</button></div>
<script>
const MENU={Starters:[["Veg Samosa (2)",4.5,"🥟"],["Chicken Wings",8.9,"🍗"],["Soup of the Day",5.0,"🍲"]],
Mains:[["Butter Chicken",13.9,"🍛"],["Beef Biryani",12.5,"🍚"],["Grilled Salmon",16.9,"🐟"],["Paneer Tikka",11.0,"🧀"]],
Drinks:[["Mango Lassi",3.9,"🥭"],["Masala Chai",2.5,"☕"],["Fresh Lime Soda",3.0,"🍋"]],
Desserts:[["Gulab Jamun (3)",4.9,"🍮"],["Ice Cream Sundae",5.5,"🍨"]]};
let cat='Starters',order=JSON.parse(localStorage.getItem('rg_order')||'[]');
function tabs(){tabs_.innerHTML=Object.keys(MENU).map(c=>\`<button class="tab \${c==cat?'on':''}" onclick="cat='\${c}';draw()">\${c}</button>\`).join('')}
function draw(){tabs();menu.innerHTML=MENU[cat].map(([n,p,e],i)=>\`<div class="mitem"><span><b>\${e} \${n}</b><small>Chef's pick · serves 1</small></span>
<span class="row"><span class="price">$\${p.toFixed(2)}</span><button class="btn2" onclick="add('\${n}',\${p})">+ Add</button></span></div>\`).join('')}
function add(n,p){order.push({n,p});localStorage.setItem('rg_order',JSON.stringify(order));sum()}
function sum(){const t=order.reduce((s,i)=>s+i.p,0);osum.textContent=order.length?\`\${order.length} items · $\${t.toFixed(2)}\`:'No items yet'}
function place(){if(!order.length)return alert('Add something tasty first!');alert('Order sent to kitchen! 🧑‍🍳\\nTotal: $'+order.reduce((s,i)=>s+i.p,0).toFixed(2));order=[];localStorage.setItem('rg_order','[]');sum()}
tabs();draw();sum();</script></body></html>`,
      },
    ],
  },
  {
    id: 'app-quiz',
    name: 'Quiz App',
    framework: 'static',
    runtime: "",
    description: 'Timed multiple-choice quiz with score tracking and result screen.',
    icon: '🧠',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BrainWave — Quiz</title><style>${BASE_CSS}
.qcard{max-width:560px;margin:0 auto}.opt{display:block;width:100%;text-align:left;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:10px;padding:12px 14px;margin:8px 0;font-size:.95rem}
.opt:hover{border-color:#6366f1}.opt.ok{border-color:#22c55e;background:#052e16}.opt.bad{border-color:#ef4444;background:#2a0a0a}
.bar{height:8px;background:#334155;border-radius:99px;overflow:hidden;margin:10px 0}.bar>div{height:100%;background:#6366f1;transition:width .3s}
.timer{font-size:.85rem;color:#fbbf24}.center{text-align:center;padding:40px 0}
</style></head><body><div class="wrap"><div class="qcard">
<h1>🧠 BrainWave</h1><p class="sub">General knowledge · 10s per question</p><div id="game"></div></div></div>
<script>
const QS=[["What is the capital of Japan?",["Seoul","Tokyo","Beijing","Bangkok"],1],
["Which planet is the Red Planet?",["Venus","Mars","Jupiter","Mercury"],1],
["How many continents are there?",["5","6","7","8"],2],
["Who wrote 'Romeo and Juliet'?",["Dickens","Shakespeare","Hemingway","Tolstoy"],1],
["What is 15% of 200?",["25","30","35","40"],1],
["Largest ocean on Earth?",["Atlantic","Indian","Arctic","Pacific"],3],
["H2O is better known as…",["Oxygen","Salt","Water","Hydrogen"],2],
["Which language has the most native speakers?",["English","Spanish","Mandarin","Hindi"],2]];
let i=0,score=0,timer,ti;
function start(){i=0;score=0;show()}
function show(){clearInterval(timer);if(i>=QS.length)return end();
const [q,opts,ans]=QS[i];let left=10;
game.innerHTML=\`<div class="row" style="justify-content:space-between"><span>Q\${i+1}/\${QS.length}</span><span class="timer">⏱ <b id="t">10</b>s</span></div>
<div class="bar"><div style="width:\${i/QS.length*100}%"></div></div>
<div class="card" style="margin-top:10px"><h3 style="margin-bottom:10px">\${q}</h3>\${opts.map((o,k)=>\`<button class="opt" onclick="pick(this,\${k},\${ans})">\${String.fromCharCode(65+k)}. \${o}</button>\`).join('')}</div>\`;
timer=setInterval(()=>{left--;const el=document.getElementById('t');if(el)el.textContent=left;if(left<=0){clearInterval(timer);pick(null,-1,ans)}},1000)}
function pick(btn,k,ans){clearInterval(timer);document.querySelectorAll('.opt').forEach((b,j)=>{b.disabled=true;if(j==ans)b.classList.add('ok')});
if(k==ans)score++;else if(btn)btn.classList.add('bad');
setTimeout(()=>{i++;show()},900)}
function end(){const best=+(localStorage.getItem('quiz_best')||0);if(score>best)localStorage.setItem('quiz_best',score);
game.innerHTML=\`<div class="card center"><div style="font-size:3rem">\${score==QS.length?'🏆':score>=QS.length/2?'🎉':'💪'}</div>
<h2>Score: \${score}/\${QS.length}</h2><p class="sub" style="margin-top:6px">Best: \${Math.max(score,best)}</p>
<button class="btn" style="margin-top:16px;padding:12px 24px" onclick="start()">Play again</button></div>\`}
start();</script></body></html>`,
      },
    ],
  },
  {
    id: 'app-pomodoro',
    name: 'Pomodoro Focus Timer',
    framework: 'static',
    runtime: "",
    description: '25/5 focus cycles, session counter and daily goal — beat procrastination.',
    icon: '⏱️',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FocusPod — Pomodoro</title><style>${BASE_CSS}
.clock{font-size:4.5rem;font-weight:800;text-align:center;letter-spacing:2px;margin:26px 0;font-variant-numeric:tabular-nums}
.modes{display:flex;gap:8px;justify-content:center;margin-bottom:8px}
.mode{background:#1e293b;border:1px solid #334155;padding:8px 16px;border-radius:99px;font-size:.85rem}
.mode.on{background:#6366f1;border-color:#6366f1;color:#fff}
.center{text-align:center}.big{width:140px;height:140px;border-radius:50%;font-size:1.05rem;margin:0 auto;display:block}
#go{background:#22c55e;color:#052e16;border:none}#go.run{background:#ef4444;color:#fff}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:360px;margin:26px auto 0}
</style></head><body><div class="wrap">
<h1 style="text-align:center">⏱️ FocusPod</h1><p class="sub" style="text-align:center">Work 25 · break 5 · repeat</p>
<div class="modes"><button class="mode on" id="mWork" onclick="setMode('work')">Focus 25</button>
<button class="mode" id="mBreak" onclick="setMode('break')">Break 5</button></div>
<div class="clock" id="clk">25:00</div>
<div class="center"><button class="big" id="go" onclick="toggle()">START</button></div>
<div class="stats"><div class="card center" style="padding:12px">Today<div class="bal" style="font-size:1.4rem" id="done">0</div>sessions</div>
<div class="card center" style="padding:12px">Daily goal<div class="bal" style="font-size:1.4rem">8</div>sessions</div></div>
<script>
const DUR={work:25*60,break:5*60};let mode='work',left=DUR[work],run=false,iv;
let done=JSON.parse(localStorage.getItem('fp_done')||'{}');
const today=new Date().toISOString().slice(0,10);const dn=done[today]||0;document.getElementById('done').textContent=dn;
function fmt(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
function draw(){clk.textContent=fmt(left);go.textContent=run?'PAUSE':'START';go.className='big'+(run?' run':'')}
function setMode(m){mode=m;left=DUR[m];run=false;clearInterval(iv);
mWork.className='mode'+(m=='work'?' on':'');mBreak.className='mode'+(m=='break'?' on':'');draw()}
function toggle(){run=!run;if(run){iv=setInterval(tick,1000)}else clearInterval(iv);draw()}
function tick(){left--;if(left<=0){clearInterval(iv);run=false;
if(mode=='work'){done[today]=(done[today]||0)+1;localStorage.setItem('fp_done',JSON.stringify(done));document.getElementById('done').textContent=done[today];setMode('break');alert('Session done! Take a break ☕')}
else{setMode('work');alert('Break over — back to focus 💪')}return}draw()}
draw();</script></body></html>`,
      },
    ],
  },
]
