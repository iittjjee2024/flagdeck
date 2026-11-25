import { parseArgs } from 'node:util';
import { Flagsmith, waitForApi } from './api.js';
import { seed, DEFAULTS } from './seed.js';
import { demo } from './demo.js';
import { loadMatrix, isDrifted, diffEnvs, promote, setEnabled, resolveEnv } from './model.js';
import { runTui } from './tui.js';

const HELP = `flagdeck: terminal dashboard and tooling for self-hosted Flagsmith

Usage: flagdeck [command] [options]

Commands:
  tui (default)                Interactive flag x environment matrix
  ls [--drift] [--json]        Print the matrix (--drift: only flags that differ between envs)
  toggle <flag> <env> [on|off] Flip a flag in one environment
  diff <from> <to>             Show flags that differ between two environments
  promote <from> <to> [flag…]  Copy state from one env to another (--dry-run, --yes for prod)
  seed                         Create admin, org, project, envs and demo flags (idempotent)
  demo                         Run the demo storefront driven by the seeded flags

Options:
  --url <url>        Flagsmith URL (env FLAGSMITH_URL, default http://localhost:8000)
  --token <token>    User token (env FLAGDECK_TOKEN) or organisation key (env FLAGSMITH_ORG_TOKEN)
  --project <id>     Project id (env FLAGDECK_PROJECT, default: first project)
  --email/--password Login credentials (default: demo admin from "flagdeck seed")
`;

const isProd = (n) => /prod/i.test(n);

async function connect(o) {
  const url = o.url ?? process.env.FLAGSMITH_URL ?? 'http://localhost:8000';
  const api = new Flagsmith({ url });
  const orgKey = process.env.FLAGSMITH_ORG_TOKEN;
  const token = o.token ?? process.env.FLAGDECK_TOKEN;
  if (orgKey) { api.token = orgKey; api.tokenType = 'Api-Key'; }
  else if (token) api.token = token;
  else await api.login(o.email ?? process.env.FLAGDECK_EMAIL ?? DEFAULTS.email, o.password ?? process.env.FLAGDECK_PASSWORD ?? DEFAULTS.password);
  let projectId = o.project ?? process.env.FLAGDECK_PROJECT;
  if (!projectId) {
    const projects = await api.projects();
    if (!projects.length) throw new Error('No projects found. Run `flagdeck seed` first.');
    projectId = (projects.find((p) => p.name === DEFAULTS.project) ?? projects[0]).id;
  }
  return { api, url, projectId };
}

function table(matrix, flags) {
  const nameW = Math.max(4, ...flags.map((f) => f.name.length)) + 2;
  const colW = Math.max(...matrix.envs.map((e) => e.name.length), 5) + 2;
  const head = 'FLAG'.padEnd(nameW) + matrix.envs.map((e) => e.name.padEnd(colW)).join('') + 'DRIFT';
  const rows = flags.map((f) => f.name.padEnd(nameW)
    + matrix.envs.map((e) => (f.cells[e.name] ? (f.cells[e.name].enabled ? 'ON' : 'off') : 'n/a').padEnd(colW)).join('')
    + (isDrifted(f) ? '≠' : ''));
  return [head, ...rows].join('\n');
}

export async function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      url: { type: 'string' }, token: { type: 'string' }, project: { type: 'string' },
      email: { type: 'string' }, password: { type: 'string' }, port: { type: 'string' },
      wait: { type: 'boolean' }, drift: { type: 'boolean' }, json: { type: 'boolean' },
      'dry-run': { type: 'boolean' }, yes: { type: 'boolean' }, 'write-env': { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd = 'tui', ...args] = positionals;
  if (o.help || cmd === 'help') { console.log(HELP); return 0; }
  const url = o.url ?? process.env.FLAGSMITH_URL ?? 'http://localhost:8000';

  if (cmd === 'seed') { await seed({ url, wait: o.wait, email: o.email, password: o.password, writeEnv: o['write-env'] }); return 0; }
  if (cmd === 'demo') { await demo({ url, port: Number(o.port ?? 3000), wait: o.wait, email: o.email, password: o.password }); return new Promise(() => {}); }

  if (o.wait) await waitForApi(url);
  const { api, projectId } = await connect(o);

  if (cmd === 'tui') { await runTui(api, { projectId, url }); return 0; }

  const matrix = await loadMatrix(api, projectId);

  if (cmd === 'ls') {
    const flags = o.drift ? matrix.flags.filter(isDrifted) : matrix.flags;
    if (o.json) console.log(JSON.stringify({ environments: matrix.envs.map((e) => e.name), flags: flags.map((f) => ({ name: f.name, drift: isDrifted(f), states: Object.fromEntries(Object.entries(f.cells).map(([k, v]) => [k, { enabled: v.enabled, value: v.value }])) })) }, null, 2));
    else console.log(table(matrix, flags));
    return 0;
  }

  if (cmd === 'toggle') {
    const [name, envIn, state] = args;
    if (!name || !envIn) throw new Error('Usage: flagdeck toggle <flag> <env> [on|off]');
    const env = resolveEnv(matrix, envIn);
    const flag = matrix.flags.find((f) => f.name === name);
    if (!flag?.cells[env]) throw new Error(`Flag "${name}" not found in ${env}`);
    const next = state ? state === 'on' : !flag.cells[env].enabled;
    if (isProd(env) && !o.yes) throw new Error(`Refusing to change ${env} without --yes`);
    await setEnabled(api, matrix, flag, env, next);
    console.log(`${name} in ${env}: ${next ? 'ON' : 'OFF'}`);
    return 0;
  }

  if (cmd === 'diff' || cmd === 'promote') {
    if (args.length < 2) throw new Error(`Usage: flagdeck ${cmd} <from> <to>${cmd === 'promote' ? ' [flag…]' : ''}`);
    const from = resolveEnv(matrix, args[0]);
    const to = resolveEnv(matrix, args[1]);
    if (cmd === 'diff') {
      const d = diffEnvs(matrix, from, to);
      if (!d.length) console.log(`${from} and ${to} are identical`);
      for (const x of d) console.log(`${x.name}: ${from}=${x.from.enabled ? 'ON' : 'off'}  ${to}=${x.to.enabled ? 'ON' : 'off'}`);
      return d.length ? 1 : 0;
    }
    const names = args.slice(2);
    const dry = o['dry-run'] || (isProd(to) && !o.yes);
    const changes = await promote(api, matrix, from, to, names.length ? names : undefined, { dryRun: dry });
    for (const x of changes) console.log(`${dry ? 'would set' : 'set'} ${x.name} in ${to}: ${x.to.enabled ? 'ON' : 'off'} -> ${x.from.enabled ? 'ON' : 'off'}`);
    if (!changes.length) console.log('nothing to promote');
    else if (dry && !o['dry-run']) console.log(`\n${to} is protected: re-run with --yes to apply.`);
    return 0;
  }

  console.error(`Unknown command "${cmd}"\n\n${HELP}`);
  return 2;
}
