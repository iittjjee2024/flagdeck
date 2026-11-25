// Live smoke test of the web dashboard API against a running `docker compose up` stack.
// Usage: node test/smoke.mjs [baseUrl]
const base = (process.argv[2] ?? 'http://localhost:3000') + '/dashboard/api';
const post = (p, x) => fetch(`${base}/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(x) }).then((r) => r.json());
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) process.exitCode = 1; };

const m = await (await fetch(`${base}/matrix`)).json();
check('matrix lists flags', m.flags.length >= 5, `(${m.flags.length})`);
const before = m.flags.find((f) => f.name === 'ai_assistant').cells.Staging.enabled;
let r = await post('toggle', { flag: 'ai_assistant', env: 'Staging', enabled: !before });
check('toggle', r.ok, r.message);
const after = (await (await fetch(`${base}/matrix`)).json()).flags.find((f) => f.name === 'ai_assistant').cells.Staging.enabled;
check('toggle persisted in Flagsmith', after === !before);
r = await post('toggle', { flag: 'ai_assistant', env: 'Staging', enabled: before });
check('toggle restored', r.ok);
r = await post('copy', { flag: 'dark_mode', from: 'Development', to: 'Staging' });
check('copy to next environment', r.ok, r.message);
r = await post('diff', { from: 'Staging', to: 'Production' });
check('diff', r.ok, JSON.stringify(r.changes));
r = await post('promote', { from: 'Staging', to: 'Production', dryRun: true });
check('promote dry run', r.ok, r.message);
r = await post('rollout', { flag: 'paypal_button', variant: 'show-paypal', env: 'Development' });
check('rollout variation', r.ok, r.message);
r = await post('rollout', { flag: 'paypal_button', variant: 'control', env: 'Development' });
check('rollout control', r.ok, r.message);
r = await post('toggle', { flag: 'missing', env: 'Staging', enabled: true });
check('unknown flag is rejected', r.ok === false, r.error);
