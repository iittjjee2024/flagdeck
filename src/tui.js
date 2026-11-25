import readline from 'node:readline';
import { loadMatrix, isDrifted, toggle, setEnabled } from './model.js';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', inv: '\x1b[7m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - strip(s).length));
const isProd = (name) => /prod/i.test(name);

/** Column geometry shared by the renderer and mouse hit-testing. */
export function layout(state) {
  const flags = visibleFlags(state);
  const nameW = Math.max(12, ...flags.map((f) => f.name.length)) + 2;
  const colW = Math.max(...state.matrix.envs.map((e) => e.name.length), 8) + 3;
  return { nameW, colW, firstRow: 5 };
}

/** Map a 1-based terminal click to a matrix cell, or null. */
export function hitTest(state, x, y) {
  const { nameW, colW, firstRow } = layout(state);
  const row = y - firstRow;
  const col = Math.floor((x - 1 - nameW) / colW);
  if (row < 0 || row >= visibleFlags(state).length || col < 0 || col >= state.matrix.envs.length) return null;
  return { row, col };
}

/** Pure renderer so it can be unit tested without a TTY. */
export function render(state, { color = true } = {}) {
  const { matrix, row, col, driftOnly, message, confirm, url } = state;
  const k = color ? c : Object.fromEntries(Object.keys(c).map((x) => [x, '']));
  const flags = visibleFlags(state);
  const nameW = Math.max(12, ...flags.map((f) => f.name.length)) + 2;
  const colW = Math.max(...matrix.envs.map((e) => e.name.length), 8) + 3;
  const out = [];
  out.push(`${k.bold}${k.cyan}flagdeck${k.reset} ${k.gray}${url}${k.reset}  ${driftOnly ? `${k.yellow}[drift only]${k.reset}` : ''}`);
  out.push('');
  out.push(pad(`${k.bold}FLAG${k.reset}`, nameW) + matrix.envs.map((e) => pad(`${k.bold}${e.name}${k.reset}`, colW)).join('') + `${k.bold}DRIFT${k.reset}`);
  out.push(k.gray + '─'.repeat(nameW + colW * matrix.envs.length + 5) + k.reset);
  flags.forEach((f, r) => {
    const drift = isDrifted(f);
    let line = pad(`${r === row ? k.bold : ''}${f.name}${k.reset}`, nameW);
    matrix.envs.forEach((e, ci) => {
      const cell = f.cells[e.name];
      let txt = !cell ? `${k.gray}n/a${k.reset}` : cell.enabled ? `${k.green}● ON${k.reset}` : `${k.red}○ OFF${k.reset}`;
      if (cell && cell.value != null && cell.value !== '') txt += `${k.gray}*${k.reset}`;
      if (r === row && ci === col) txt = `${k.inv}${strip(txt).padEnd(colW - 2)}${k.reset}`;
      line += pad(txt, colW);
    });
    line += drift ? `${k.yellow}≠${k.reset}` : `${k.gray}=${k.reset}`;
    out.push(line);
  });
  if (!flags.length) out.push(`${k.gray}(no flags${driftOnly ? ' with drift' : ''})${k.reset}`);
  out.push('');
  const sel = flags[row];
  if (sel) {
    out.push(`${k.dim}${sel.description}${k.reset}`);
    const cell = sel.cells[matrix.envs[col]?.name];
    if (cell?.value != null && cell.value !== '') out.push(`${k.dim}value (${matrix.envs[col].name}): ${JSON.stringify(cell.value)}${k.reset}`);
  }
  out.push('');
  out.push(confirm ? `${k.yellow}${confirm.text} [y/N]${k.reset}` : message ? `${k.cyan}${message}${k.reset}` : '');
  out.push(`${k.gray}←↑↓→ move   space or click toggle   < > copy cell to prev/next env   d drift filter   r refresh   q quit${k.reset}`);
  return out.join('\n');
}

export function visibleFlags(state) {
  return state.driftOnly ? state.matrix.flags.filter(isDrifted) : state.matrix.flags;
}

/** Apply a keypress to state. Returns a promise when it needs I/O. */
export async function handleKey(state, api, key) {
  if (state.confirm) {
    const yes = key === 'y' || key === 'Y';
    const action = state.confirm.action;
    state.confirm = null;
    if (yes) await action(); else state.message = 'cancelled';
    return;
  }
  const flags = visibleFlags(state);
  const flag = flags[state.row];
  const env = state.matrix.envs[state.col];
  const guard = async (envName, text, run) => {
    if (isProd(envName)) { state.confirm = { text, action: run }; return; }
    await run();
  };
  switch (key) {
    case 'up': state.row = Math.max(0, state.row - 1); break;
    case 'down': state.row = Math.min(Math.max(0, flags.length - 1), state.row + 1); break;
    case 'left': state.col = Math.max(0, state.col - 1); break;
    case 'right': state.col = Math.min(state.matrix.envs.length - 1, state.col + 1); break;
    case 'space': case 'return':
      if (!flag || !flag.cells[env.name]) break;
      await guard(env.name, `Toggle ${flag.name} in ${env.name}?`, async () => {
        await toggle(api, state.matrix, flag, env.name);
        state.message = `${flag.name} in ${env.name} → ${flag.cells[env.name].enabled ? 'ON' : 'OFF'}`;
      });
      break;
    case '<': case '>': {
      const target = state.matrix.envs[state.col + (key === '>' ? 1 : -1)];
      if (!flag || !target || !flag.cells[env.name] || !flag.cells[target.name]) break;
      await guard(target.name, `Copy ${flag.name} (${flag.cells[env.name].enabled ? 'ON' : 'OFF'}) from ${env.name} to ${target.name}?`, async () => {
        await setEnabled(api, state.matrix, flag, target.name, flag.cells[env.name].enabled);
        state.message = `${flag.name}: ${env.name} → ${target.name}`;
      });
      break;
    }
    case 'd': state.driftOnly = !state.driftOnly; state.row = 0; break;
    case 'r': await refresh(state, api); state.message = 'refreshed'; break;
    default: break;
  }
}

export async function refresh(state, api) {
  state.matrix = await loadMatrix(api, state.projectId);
  state.row = Math.min(state.row, Math.max(0, visibleFlags(state).length - 1));
}

export async function runTui(api, { projectId, url }) {
  if (!process.stdin.isTTY) throw new Error('The dashboard needs an interactive terminal. Use `flagdeck ls` for scripts.');
  const state = { matrix: await loadMatrix(api, projectId), projectId, url, row: 0, col: 0, driftOnly: false, message: '', confirm: null };
  const draw = () => process.stdout.write('\x1b[H\x1b[2J' + render(state) + '\n');
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?25l\x1b[?1049h\x1b[?1000h\x1b[?1006h');
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || state.confirm) return;
    busy = true;
    try { await refresh(state, api); } catch (e) { state.message = `refresh failed: ${e.message}`; }
    busy = false; draw();
  }, 4000);
  const cleanup = () => { clearInterval(timer); process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?1049l\x1b[?25h'); process.stdin.setRawMode(false); };
  process.stdin.on('data', async (buf) => {
    const m = /\x1b\[<0;(\d+);(\d+)M/.exec(buf.toString());
    if (!m || busy) return;
    const hit = hitTest(state, Number(m[1]), Number(m[2]));
    if (!hit) return;
    busy = true;
    try {
      if (state.confirm) { state.confirm = null; state.message = 'cancelled'; }
      else { state.row = hit.row; state.col = hit.col; await handleKey(state, api, 'space'); }
    } catch (e) { state.message = `error: ${e.message}`; }
    busy = false; draw();
  });
  draw();
  await new Promise((resolve) => {
    process.stdin.on('keypress', async (str, k) => {
      if (k?.ctrl && k.name === 'c' || (str === 'q' && !state.confirm)) { cleanup(); resolve(); return; }
      if (busy) return;
      busy = true;
      try { await handleKey(state, api, k?.name === 'space' ? 'space' : (k?.name && k.name.length > 1 ? k.name : str)); }
      catch (e) { state.message = `error: ${e.message}`; }
      busy = false; draw();
    });
  });
  process.stdin.pause();
}

