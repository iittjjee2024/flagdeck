import http from 'node:http';
import { Flagsmith, waitForApi } from './api.js';
import { seed, DEFAULTS } from './seed.js';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Storefront (flagdeck demo)</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fff;--fg:#14171f;--card:#f3f5f9;--accent:#5b4bdb}
body.dark{--bg:#12141a;--fg:#e8eaf0;--card:#1d2029}
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);transition:.3s}
header{display:flex;justify-content:space-between;align-items:center;padding:16px 32px;border-bottom:1px solid #8883}
select{font:inherit;padding:4px 8px}
#banner{background:#f5a623;color:#222;padding:10px 32px;display:none;font-weight:600}
main{max-width:760px;margin:40px auto;padding:0 24px}
h1{font-size:2.2rem}.card{background:var(--card);padding:20px;border-radius:12px;margin:16px 0}
button{font:inherit;border:0;border-radius:8px;padding:12px 20px;background:var(--accent);color:#fff;cursor:pointer}
button.single{width:100%;font-size:1.1rem;padding:16px}
#ai{position:fixed;right:24px;bottom:24px;background:var(--accent);color:#fff;padding:14px 18px;border-radius:24px;display:none;box-shadow:0 4px 16px #0004}
small{opacity:.6}
</style></head><body>
<div id="banner"></div>
<header><strong>Storefront</strong><label>Environment <select id="env"></select></label></header>
<main>
<h1 id="hero">…</h1>
<div class="card"><p>Cart: 2 items · €48.00</p><div id="checkout"></div></div>
<small>Flags are read live from self-hosted Flagsmith. Toggle them in the <code>flagdeck</code> terminal dashboard and this page updates.</small>
<pre id="raw" class="card" style="font-size:12px"></pre>
</main><div id="ai">💬 Ask the AI assistant</div>
<script>
const sel=document.getElementById('env');let envs=null;
async function tick(){
  const r=await fetch('/api/flags?env='+encodeURIComponent(sel.value||'')); const d=await r.json();
  if(!envs){envs=d.envs;sel.innerHTML=envs.map(e=>'<option>'+e+'</option>').join('');sel.value=d.env;}
  const f=d.flags;
  document.body.classList.toggle('dark',!!f.dark_mode?.enabled);
  document.getElementById('hero').textContent=f.hero_headline?.enabled?(f.hero_headline.value||'Welcome'):'Welcome';
  const b=document.getElementById('banner');b.style.display=f.maintenance_banner?.enabled?'block':'none';b.textContent=f.maintenance_banner?.value||'';
  document.getElementById('ai').style.display=f.ai_assistant?.enabled?'block':'none';
  document.getElementById('checkout').innerHTML=f.new_checkout?.enabled?'<button class="single">⚡ Buy now (one-page checkout)</button>':'<button>Proceed to checkout (step 1 of 4)</button>';
  document.getElementById('raw').textContent=JSON.stringify(Object.fromEntries(Object.entries(f).map(([k,v])=>[k,v.enabled+(v.value?' · '+v.value:'')])),null,1);
}
sel.onchange=tick;setInterval(tick,1500);tick();
</script></body></html>`;

export async function demo({ url, port = 3000, wait = false, email = DEFAULTS.email, password = DEFAULTS.password, host = '0.0.0.0' }) {
  if (wait) await waitForApi(url);
  const { envs } = await seed({ url, email, password });
  const api = new Flagsmith({ url });
  const names = Object.keys(envs);

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/flags') {
      try {
        const env = envs[u.searchParams.get('env')] ? u.searchParams.get('env') : names[0];
        const list = await api.sdkFlags(envs[env]);
        const flags = Object.fromEntries(list.map((f) => [f.feature.name, { enabled: f.enabled, value: f.feature_state_value }]));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ env, envs: names, flags }));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(port, host, r));
  console.log(`[demo] http://localhost:${port} (reading flags from ${url})`);
  return server;
}
