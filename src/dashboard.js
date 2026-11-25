// Web version of the flagdeck matrix: every control calls the same model functions as the terminal UI.
import { loadMatrix, isDrifted, setEnabled, promote, rollout, diffEnvs } from './model.js';

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

const isProd = (n) => /prod/i.test(n);

export function dashboardHandler({ api, projectId }) {
  return async function handle(req, res) {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith('/dashboard')) return false;
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    try {
      if (u.pathname === '/dashboard' || u.pathname === '/dashboard/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return true;
      }
      if (u.pathname === '/dashboard/api/matrix') {
        const m = await loadMatrix(api, projectId);
        const features = await api.features(projectId);
        const multi = Object.fromEntries(features.filter((f) => f.multivariate_options?.length)
          .map((f) => [f.name, f.multivariate_options.map((o) => o.string_value)]));
        json(200, {
          envs: m.envs.map((e) => e.name),
          flags: m.flags.map((f) => ({
            name: f.name, description: f.description, drift: isDrifted(f), variants: multi[f.name] ?? null,
            cells: Object.fromEntries(Object.entries(f.cells).map(([k, v]) => [k, { enabled: v.enabled, value: v.value }])),
          })),
        });
        return true;
      }
      if (req.method !== 'POST') { json(405, { error: 'POST required' }); return true; }
      const body = await readJson(req);
      const m = await loadMatrix(api, projectId);
      const flag = body.flag && m.flags.find((f) => f.name === body.flag);
      if (u.pathname === '/dashboard/api/toggle') {
        if (!flag?.cells[body.env]) throw new Error(`No state for ${body.flag} in ${body.env}`);
        await setEnabled(api, m, flag, body.env, !!body.enabled);
        json(200, { ok: true, message: `${flag.name} in ${body.env}: ${body.enabled ? 'ON' : 'OFF'}` });
      } else if (u.pathname === '/dashboard/api/copy') {
        if (!flag?.cells[body.from] || !flag.cells[body.to]) throw new Error('Unknown flag or environment');
        await setEnabled(api, m, flag, body.to, flag.cells[body.from].enabled);
        json(200, { ok: true, message: `${flag.name}: copied ${body.from} to ${body.to}` });
      } else if (u.pathname === '/dashboard/api/promote') {
        const changes = await promote(api, m, body.from, body.to, undefined, { dryRun: !!body.dryRun });
        json(200, { ok: true, count: changes.length, message: changes.length ? `${body.dryRun ? 'Would promote' : 'Promoted'} ${changes.map((c) => c.name).join(', ')} from ${body.from} to ${body.to}` : `${body.from} and ${body.to} are already identical` });
      } else if (u.pathname === '/dashboard/api/diff') {
        json(200, { ok: true, changes: diffEnvs(m, body.from, body.to).map((c) => c.name) });
      } else if (u.pathname === '/dashboard/api/rollout') {
        const r = await rollout(api, m, projectId, body.flag, body.variant, body.env);
        json(200, { ok: true, message: `${r.flag} in ${r.env}: ${r.allocations.join(', ')}` });
      } else json(404, { error: 'not found' });
    } catch (e) { json(400, { ok: false, error: e.message }); }
    return true;
  };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>flagdeck dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#eef0f8;color:#1b1d2a}
header{display:flex;justify-content:space-between;align-items:center;padding:14px 28px;background:#fff;box-shadow:0 1px 4px #0001}
header b{font-size:18px}header a{color:#6b4cf6;text-decoration:none;margin-left:16px;font-weight:600}
main{max-width:1000px;margin:24px auto;padding:0 20px}.card{background:#fff;border-radius:12px;padding:18px;box-shadow:0 1px 4px #0001;margin-bottom:16px}
table{width:100%;border-collapse:collapse}th,td{padding:10px 8px;text-align:left;border-bottom:1px solid #eee}th{font-size:12px;color:#667;text-transform:uppercase}
.sw{width:46px;height:26px;border-radius:13px;border:0;background:#c9cde0;position:relative;cursor:pointer;transition:.2s}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s}
.sw.on{background:#2fb872}.sw.on::after{left:23px}.sw:disabled{opacity:.5;cursor:wait}
.copy{border:0;background:none;color:#6b4cf6;cursor:pointer;font-size:16px;padding:2px 5px;border-radius:5px}.copy:hover{background:#efeaff}
.cell{display:flex;align-items:center;gap:4px}.drift{color:#d98200;font-weight:700}.same{color:#9aa}
.btn{border:1px solid #6b4cf6;background:#fff;color:#6b4cf6;border-radius:8px;padding:7px 12px;cursor:pointer;font:inherit}.btn.p{background:#6b4cf6;color:#fff}.btn.on{background:#6b4cf6;color:#fff}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}select{font:inherit;padding:6px;border-radius:6px}
small{color:#778}.desc{display:block;color:#889;font-size:12px}#msg{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#12142a;color:#fff;padding:10px 18px;border-radius:10px;display:none}
#msg.err{background:#b3261e}
</style></head><body>
<header><b>🚩 flagdeck dashboard</b><span><a href="/shop">Experiment shop</a><a href="/">Storefront</a></span></header>
<main>
<div class="card bar">
  <button class="btn" id="drift">Show drift only</button>
  <button class="btn" id="refresh">Refresh</button>
  <span style="flex:1"></span>
  <label>Promote <select id="from"></select> → <select id="to"></select></label>
  <button class="btn" id="diffbtn">Diff</button>
  <button class="btn p" id="promote">Promote differences</button>
</div>
<div class="card"><table id="t"></table></div>
<div class="card" id="mv" style="display:none"><b>Roll out a variation</b> <small>(serves it to 100% of an environment)</small>
  <div class="bar" style="margin-top:10px"><select id="mvflag"></select><select id="mvvar"></select> in <select id="mvenv"></select><button class="btn p" id="rollout">Roll out</button></div></div>
<small>Auto-refreshes every 4 seconds. Changes made in the Flagsmith UI or the terminal dashboard appear here.</small>
</main><div id="msg"></div>
<script>
let M=null,driftOnly=false,busy=false;const $=s=>document.querySelector(s);
const prod=n=>/prod/i.test(n);
function toast(t,err){const m=$('#msg');m.textContent=t;m.className=err?'err':'';m.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>m.style.display='none',3500)}
async function call(path,body){const r=await fetch('/dashboard/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!d.ok)throw new Error(d.error||'failed');return d}
async function act(fn){if(busy)return;busy=true;try{const d=await fn();if(d?.message)toast(d.message)}catch(e){toast(e.message,true)}busy=false;await load()}
function confirmEnv(env,text){return !prod(env)||confirm(text+'\\n\\n'+env+' is a protected environment. Continue?')}
function draw(){
  const flags=M.flags.filter(f=>!driftOnly||f.drift);
  $('#t').innerHTML='<tr><th>Flag</th>'+M.envs.map(e=>'<th>'+e+'</th>').join('')+'<th>Drift</th></tr>'
   +flags.map(f=>'<tr><td><b>'+f.name+'</b><span class="desc">'+f.description+'</span></td>'
     +M.envs.map((e,i)=>{const c=f.cells[e];if(!c)return '<td>n/a</td>';
       const next=M.envs[i+1];
       return '<td><div class="cell"><button class="sw '+(c.enabled?'on':'')+'" title="Toggle '+f.name+' in '+e+'" data-t="'+f.name+'|'+e+'"></button>'
        +(next&&f.cells[next]?'<button class="copy" title="Copy to '+next+'" data-c="'+f.name+'|'+e+'|'+next+'">→</button>':'')+'</div></td>'}).join('')
     +'<td>'+(f.drift?'<span class="drift">≠ differs</span>':'<span class="same">in sync</span>')+'</td></tr>').join('');
  $('#drift').className='btn'+(driftOnly?' on':'');$('#drift').textContent=driftOnly?'Showing drift only':'Show drift only';
  const mv=M.flags.filter(f=>f.variants);$('#mv').style.display=mv.length?'block':'none';
  if(mv.length&&!$('#mvflag').options.length){$('#mvflag').innerHTML=mv.map(f=>'<option>'+f.name+'</option>').join('');$('#mvenv').innerHTML=M.envs.map(e=>'<option>'+e+'</option>').join('');setVars()}
  if(!$('#from').options.length){$('#from').innerHTML=$('#to').innerHTML=M.envs.map(e=>'<option>'+e+'</option>').join('');$('#from').selectedIndex=Math.max(0,M.envs.length-2);$('#to').selectedIndex=M.envs.length-1}
}
function setVars(){const f=M.flags.find(x=>x.name===$('#mvflag').value);const ctl=f.cells[M.envs[0]].value;$('#mvvar').innerHTML=[...f.variants,ctl].map(v=>'<option>'+v+'</option>').join('')}
async function load(){try{M=await (await fetch('/dashboard/api/matrix')).json();draw()}catch(e){toast('load failed: '+e.message,true)}}
$('#t').addEventListener('click',e=>{
  const t=e.target.closest('[data-t]'),c=e.target.closest('[data-c]');
  if(t){const[flag,env]=t.dataset.t.split('|');const cur=M.flags.find(f=>f.name==flag).cells[env].enabled;
    if(!confirmEnv(env,'Turn '+flag+' '+(cur?'OFF':'ON')+' in '+env+'?'))return;t.disabled=true;act(()=>call('toggle',{flag,env,enabled:!cur}))}
  if(c){const[flag,from,to]=c.dataset.c.split('|');if(!confirmEnv(to,'Copy '+flag+' from '+from+' to '+to+'?'))return;act(()=>call('copy',{flag,from,to}))}});
$('#drift').onclick=()=>{driftOnly=!driftOnly;draw()};
$('#refresh').onclick=()=>act(async()=>({message:'Refreshed'}));
$('#diffbtn').onclick=()=>act(async()=>{const d=await call('diff',{from:$('#from').value,to:$('#to').value});return{message:d.changes.length?'Differs: '+d.changes.join(', '):'Environments are identical'}});
$('#promote').onclick=()=>{const from=$('#from').value,to=$('#to').value;if(from===to)return toast('Pick two different environments',true);
  if(!confirmEnv(to,'Promote all differences from '+from+' to '+to+'?'))return;act(()=>call('promote',{from,to}))};
$('#mvflag').onchange=setVars;
$('#rollout').onclick=()=>{const flag=$('#mvflag').value,variant=$('#mvvar').value,env=$('#mvenv').value;
  if(!confirm('Serve "'+variant+'" for '+flag+' to 100% of '+env+'?'))return;act(()=>call('rollout',{flag,variant,env}))};
load();setInterval(()=>{if(!busy)load()},4000);
</script></body></html>`;
