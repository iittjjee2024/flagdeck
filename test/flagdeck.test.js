import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDrifted, diffEnvs, promote, resolveEnv } from '../src/model.js';
import { render, handleKey } from '../src/tui.js';

const cell = (id, enabled, value = null) => ({ stateId: id, enabled, value });
const makeMatrix = () => ({
  envs: [{ name: 'Development', key: 'd' }, { name: 'Staging', key: 's' }, { name: 'Production', key: 'p' }],
  flags: [
    { id: 1, name: 'a', description: 'flag a', cells: { Development: cell(1, true), Staging: cell(2, true), Production: cell(3, false) } },
    { id: 2, name: 'b', description: 'flag b', cells: { Development: cell(4, true), Staging: cell(5, true), Production: cell(6, true) } },
  ],
});
const fakeApi = () => { const calls = []; return { calls, updateFeatureState: async (...a) => { calls.push(a); } }; };

test('isDrifted detects differing environments', () => {
  const m = makeMatrix();
  assert.equal(isDrifted(m.flags[0]), true);
  assert.equal(isDrifted(m.flags[1]), false);
});

test('diffEnvs returns snapshots that survive later mutation', () => {
  const m = makeMatrix();
  const d = diffEnvs(m, 'Staging', 'Production');
  assert.deepEqual(d.map((x) => x.name), ['a']);
  m.flags[0].cells.Production.enabled = true;
  assert.equal(d[0].to.enabled, false);
});

test('promote dry run does not call the API', async () => {
  const m = makeMatrix(); const api = fakeApi();
  const ch = await promote(api, m, 'Staging', 'Production', undefined, { dryRun: true });
  assert.equal(ch.length, 1);
  assert.equal(api.calls.length, 0);
});

test('promote applies state and updates the local matrix', async () => {
  const m = makeMatrix(); const api = fakeApi();
  await promote(api, m, 'Staging', 'Production');
  assert.deepEqual(api.calls[0], ['p', 3, { enabled: true, feature_state_value: null }]);
  assert.equal(m.flags[0].cells.Production.enabled, true);
});

test('resolveEnv accepts prefixes and rejects unknown names', () => {
  const m = makeMatrix();
  assert.equal(resolveEnv(m, 'prod'), 'Production');
  assert.throws(() => resolveEnv(m, 'qa'), /Unknown environment/);
});

test('toggle in a non-production env applies immediately', async () => {
  const state = { matrix: makeMatrix(), row: 0, col: 0, driftOnly: false, message: '', confirm: null };
  const api = fakeApi();
  await handleKey(state, api, 'space');
  assert.equal(api.calls.length, 1);
  assert.equal(state.matrix.flags[0].cells.Development.enabled, false);
});

test('toggle in production asks for confirmation first', async () => {
  const state = { matrix: makeMatrix(), row: 0, col: 2, driftOnly: false, message: '', confirm: null };
  const api = fakeApi();
  await handleKey(state, api, 'space');
  assert.equal(api.calls.length, 0);
  assert.match(state.confirm.text, /Production/);
  await handleKey(state, api, 'n');
  assert.equal(api.calls.length, 0);
  await handleKey(state, api, 'space');
  await handleKey(state, api, 'y');
  assert.equal(api.calls.length, 1);
  assert.equal(state.matrix.flags[0].cells.Production.enabled, true);
});

test('render shows drift marker and drift-only filter', () => {
  const state = { matrix: makeMatrix(), row: 0, col: 0, driftOnly: false, message: '', confirm: null, url: 'http://x' };
  const full = render(state, { color: false });
  assert.match(full, /a\s+● ON\s+● ON\s+○ OFF\s+≠/);
  state.driftOnly = true;
  const drift = render(state, { color: false });
  assert.doesNotMatch(drift, /\bb\b\s+●/);
});
