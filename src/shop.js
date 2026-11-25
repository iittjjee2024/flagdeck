// "Flagsmith Shop": a PayPal-button A/B test (docs.flagsmith.com/experimentation/example-paypal-button)
// running against self-hosted Flagsmith. Variants are assigned by Flagsmith's multivariate
// bucketing per identity. Exposures/conversions are recorded here and analysed with src/stats.js.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { analyse } from './stats.js';

export const EXPERIMENT = {
  flag: 'paypal_button',
  control: 'control',
  variant: 'show-paypal',
  metric: { name: 'Checkout Completion', event: 'checkout_completed', measure: 'Occurrence', direction: 'Higher is better' },
  hypothesis: 'Offering PayPal at checkout will increase checkout completion by at least 10%.',
};

export class ExperimentStore {
  constructor(file) {
    this.file = file;
    this.reset(false);
    if (file && existsSync(file)) {
      try { Object.assign(this, JSON.parse(readFileSync(file, 'utf8'))); } catch { /* start clean */ }
    }
  }
  reset(save = true) {
    this.exposures = {};   // identity -> first variant seen
    this.quarantined = {}; // identity -> true when served more than one variant
    this.converted = {};   // identity -> true (occurrence metric, counted once)
    this.log = [];         // recent events for the live log
    if (save) this.save();
  }
  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ exposures: this.exposures, quarantined: this.quarantined, converted: this.converted, log: this.log.slice(-60) }));
  }
  push(type, identity, extra = {}) {
    this.log.push({ ts: Date.now(), type, identity, ...extra });
    if (this.log.length > 200) this.log.shift();
  }
  /** Mirrors trackExposureEvent: deduplicated per identity, first variant wins. */
  exposure(identity, variant) {
    const seen = this.exposures[identity];
    if (seen === undefined) { this.exposures[identity] = variant; this.push('exposure', identity, { variant }); return true; }
    if (seen !== variant) this.quarantined[identity] = true;
    return false;
  }
  /** Mirrors trackEvent: only counts after the identity's first exposure. */
  track(identity, event) {
    const variant = this.exposures[identity];
    this.push('event', identity, { name: event, variant: variant ?? null, counted: variant !== undefined && event === EXPERIMENT.metric.event });
    if (variant === undefined || event !== EXPERIMENT.metric.event) return false;
    this.converted[identity] = true;
    return true;
  }
  results() {
    const data = { [EXPERIMENT.control]: { exposures: 0, conversions: 0 }, [EXPERIMENT.variant]: { exposures: 0, conversions: 0 } };
    for (const [id, v] of Object.entries(this.exposures)) {
      if (this.quarantined[id] || !data[v]) continue;
      data[v].exposures++;
      if (this.converted[id]) data[v].conversions++;
    }
    return { experiment: EXPERIMENT, quarantined: Object.keys(this.quarantined).length, ...analyse(data, { control: EXPERIMENT.control }) };
  }
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

/** Returns an async (req, res) => boolean handler; true when the request was for /shop. */
export function shopHandler({ api, envKey, store }) {
  const variantFor = async (identity) => {
    const r = await api.sdkIdentity(envKey, identity);
    const f = r.flags.find((x) => x.feature.name === EXPERIMENT.flag);
    return { variant: f?.enabled ? f.feature_state_value : EXPERIMENT.control, enabled: !!f?.enabled };
  };

  async function simulate({ users = 500, controlRate = 0.08, variantRate = 0.115 }) {
    const rates = { [EXPERIMENT.control]: controlRate, [EXPERIMENT.variant]: variantRate };
    const run = Math.random().toString(36).slice(2, 6);
    for (let i = 0; i < users; i += 25) {
      await Promise.all(Array.from({ length: Math.min(25, users - i) }, async (_, j) => {
        const id = `sim-${run}-${i + j}`;
        const { variant } = await variantFor(id);
        store.exposure(id, variant);
        if (Math.random() < (rates[variant] ?? controlRate)) store.track(id, EXPERIMENT.metric.event);
      }));
    }
    store.save();
    return users;
  }

  return async function handle(req, res) {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith('/shop')) return false;
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    try {
      if (u.pathname === '/shop' || u.pathname === '/shop/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(SHOP_PAGE);
      } else if (u.pathname === '/shop/api/variant') {
        json(200, { identity: u.searchParams.get('id'), flag: EXPERIMENT.flag, ...(await variantFor(u.searchParams.get('id') || randomUUID())) });
      } else if (u.pathname === '/shop/api/exposure' && req.method === 'POST') {
        const { identity, variant } = await readJson(req);
        json(200, { recorded: store.exposure(identity, variant) }); store.save();
      } else if (u.pathname === '/shop/api/event' && req.method === 'POST') {
        const { identity, name } = await readJson(req);
        json(200, { counted: store.track(identity, name) }); store.save();
      } else if (u.pathname === '/shop/api/state') {
        json(200, { results: store.results(), log: store.log.slice(-25) });
      } else if (u.pathname === '/shop/api/simulate' && req.method === 'POST') {
        json(200, { simulated: await simulate(await readJson(req)) });
      } else if (u.pathname === '/shop/api/reset' && req.method === 'POST') {
        store.reset(); json(200, { ok: true });
      } else json(404, { error: 'not found' });
    } catch (e) { json(500, { error: e.message }); }
    return true;
  };
}

const SHOP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Flagsmith Shop · PayPal experiment</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#eef0f8;color:#1b1d2a}
.wrap{display:grid;grid-template-columns:1.2fr 1fr;grid-template-rows:1fr 190px;height:100vh;gap:12px;padding:12px}
.panel{background:#fff;border-radius:12px;overflow:auto;box-shadow:0 1px 4px #0001}
#shop{padding:0 22px 20px}#log{grid-column:1/3;background:#12142a;color:#cfd3f5;font:12px/1.5 ui-monospace,Consolas,monospace;padding:10px 14px}
nav{display:flex;justify-content:space-between;align-items:center;padding:14px 0}nav b{font-size:18px}
nav button{border:0;background:none;font:inherit;padding:8px 14px;border-radius:8px;cursor:pointer}nav button.on{background:#6b4cf6;color:#fff}
.strip{font:12px ui-monospace,Consolas,monospace;color:#555;margin-bottom:10px}.strip b{color:#2a8f4a}
.hero{display:flex;gap:18px;align-items:center;background:#f4f1ff;border-radius:14px;padding:18px}.emoji{font-size:64px}
.btn{border:0;background:#6b4cf6;color:#fff;font:inherit;font-weight:600;padding:10px 18px;border-radius:8px;cursor:pointer}
.btn.pp{background:#ffc439;color:#111;width:100%;margin-top:8px}.btn.card{width:100%}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:12px}.item{background:#f7f7fb;border-radius:10px;padding:10px;text-align:center}.item .emoji{font-size:34px}
.co{max-width:360px;margin:20px auto;background:#f7f7fb;border-radius:12px;padding:18px}.co input{width:100%;padding:9px;margin:5px 0;border:1px solid #ccd;border-radius:6px}
#res{padding:18px}h3{margin:0 0 6px}.bar{height:10px;border-radius:6px;background:#e5e7f3;overflow:hidden}.bar i{display:block;height:100%;background:#6b4cf6}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}td,th{padding:6px 4px;text-align:right;border-bottom:1px solid #eee}th:first-child,td:first-child{text-align:left}
.ok{background:#e6f7ec;color:#17693a;padding:8px 10px;border-radius:8px}.warn{background:#fff3d6;color:#7a5200;padding:8px 10px;border-radius:8px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.row button{border:1px solid #6b4cf6;background:#fff;color:#6b4cf6;border-radius:8px;padding:6px 10px;cursor:pointer;font:inherit}
.t{color:#8b90c9}.e{color:#6ee7a0}.x{color:#ffd166}
</style></head><body><div class="wrap">
<div class="panel" id="shop"></div>
<div class="panel" id="res"></div>
<div class="panel" id="log"><div class="t">LIVE EVENT LOG</div><div id="logbody"></div></div>
</div>
<script>
const EXP={flag:'paypal_button',event:'checkout_completed'};
let id=localStorage.visitor||(localStorage.visitor='visitor-'+Math.random().toString(36).slice(2,9));
let page='home',cart=false,flag={variant:'…',enabled:false};
const items=[['👕','Flagsmith Tee',25],['🧥','Rollout Hoodie',55],['🧢','Logo Cap',20],['☕','Flag Mug',14],['🏷️','Sticker Pack',6],['🧦','Segment Socks',10]];
const $=s=>document.querySelector(s);
const post=(p,b)=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.json());
async function loadFlag(){flag=await (await fetch('/shop/api/variant?id='+id)).json();draw()}
function draw(){
  const nav='<nav><b>🚩 Flagsmith Shop</b><span><button class="'+(page=='home'?'on':'')+'" onclick="go(\\'home\\')">Home</button><button class="'+(page=='checkout'?'on':'')+'" onclick="go(\\'checkout\\')">Checkout'+(cart?' (1)':'')+'</button></span></nav>';
  const strip='<div class="strip">flag <b>'+EXP.flag+'</b> · identity <b>'+id+'</b> · variant <b>'+flag.variant+'</b> · evaluated by self-hosted Flagsmith</div>';
  let body='';
  if(page=='home'){
    body='<div class="hero"><div class="emoji">👕</div><div><h2 style="margin:0">Flagsmith Tee</h2><p>Soft cotton, flag on the chest.</p><b>$25</b><br><br><button class="btn" onclick="add()">Add to cart</button></div></div><h3 style="margin-top:18px">More merch</h3><div class="grid">'+items.slice(1).map(i=>'<div class="item"><div class="emoji">'+i[0]+'</div><b>'+i[1]+'</b><br>$'+i[2]+'</div>').join('')+'</div>';
  } else if(!cart){ body='<p>Your cart is empty. Add the tee first.</p>'; }
  else if(page=='done'){ body='<div class="co"><h3>✅ Order confirmed</h3><p>Thanks! A conversion event (<code>'+EXP.event+'</code>) was recorded.</p><button class="btn card" onclick="newVisitor()">Become a new visitor</button></div>'; }
  else { body='<div class="co"><h3>Checkout · $25</h3><input placeholder="Card number" value="4242 4242 4242 4242"><input placeholder="MM/YY" value="12/30"><button class="btn card" onclick="pay()">Pay by card</button>'+(flag.variant=='show-paypal'?'<button class="btn pp" onclick="pay()">Pay with PayPal</button>':'')+'</div>'; }
  $('#shop').innerHTML=nav+strip+body;
}
async function go(p){page=p;draw();if(p=='checkout'&&cart){await post('/shop/api/exposure',{identity:id,variant:flag.variant})}}
function add(){cart=true;go('checkout')}
async function pay(){await post('/shop/api/event',{identity:id,name:EXP.event});page='done';draw()}
function newVisitor(){localStorage.visitor='';id='visitor-'+Math.random().toString(36).slice(2,9);localStorage.visitor=id;cart=false;page='home';loadFlag()}
async function sim(n){$('#simbtn')&&0;await post('/shop/api/simulate',{users:n})}
async function resetAll(){await post('/shop/api/reset')}
const pc=x=>(x*100).toFixed(1)+'%';
async function refresh(){
  const {results:r,log}=await (await fetch('/shop/api/state')).json();
  const c=r.variants[0],v=r.variants[1];
  const win=v.winProbability??0;
  $('#res').innerHTML='<h3>Experiment: '+r.experiment.flag+'</h3><div class="strip" style="margin:0 0 8px">'+r.experiment.hypothesis+'<br>Metric: '+r.experiment.metric.name+' ('+r.experiment.metric.event+', '+r.experiment.metric.direction.toLowerCase()+')</div>'
   +'<table><tr><th>Variant</th><th>Exposures</th><th>Conversions</th><th>Rate</th><th>Delta</th><th>Win prob.</th></tr>'
   +r.variants.map(x=>'<tr><td>'+x.name+(x.collecting?' <span class="t">(collecting data)</span>':'')+'</td><td>'+x.exposures+'</td><td>'+x.conversions+'</td><td>'+pc(x.rate)+'</td><td>'+(x.delta===undefined?'—':(x.delta>=0?'+':'')+pc(x.delta))+'</td><td>'+(x.winProbability===undefined?'—':pc(x.winProbability))+'</td></tr>').join('')+'</table>'
   +(v.credibleInterval?'<div class="strip">95% credible interval for lift: '+pc(v.credibleInterval[0])+' to '+pc(v.credibleInterval[1])+(v.conclusive?'':' (crosses zero: inconclusive)')+'</div>':'')
   +'<div class="bar"><i style="width:'+(win*100)+'%"></i></div><div class="strip">chance <b>'+v.name+'</b> beats control</div>'
   +(r.srm.mismatch?'<div class="warn">Sample ratio mismatch (p='+r.srm.pValue.toExponential(1)+'). Do not act on these results.</div>':'')
   +'<div class="'+(r.winner?'ok':'warn')+'">'+r.recommendation+(r.winner?'  ·  <code>flagdeck rollout '+r.experiment.flag+' '+r.winner+' --env Production --yes</code>':'')+'</div>'
   +'<div class="strip" style="margin-top:8px">Users enrolled: '+r.totalExposures+(r.quarantined?' · excluded (saw >1 variant): '+r.quarantined:'')+'</div>'
   +'<div class="row"><button onclick="sim(200).then(refresh)">Simulate 200 users</button><button onclick="sim(1000).then(refresh)">Simulate 1000 users</button><button onclick="resetAll().then(refresh)">Reset data</button></div>';
  $('#logbody').innerHTML=log.slice().reverse().map(e=>'<div><span class="t">'+new Date(e.ts).toLocaleTimeString()+'</span> <span class="'+(e.type=='event'?'x':'e')+'">'+e.type.toUpperCase()+'</span> '+e.identity+' '+(e.type=='exposure'?'variant='+e.variant:e.name+(e.counted?' (counted, '+e.variant+')':' (ignored: no prior exposure)'))+'</div>').join('');
}
loadFlag();setInterval(refresh,1200);refresh();
</script></body></html>`;

