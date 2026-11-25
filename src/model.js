// Flag x environment matrix: load, diff, toggle, promote.

/** @returns {Promise<{envs: {id:number,name:string,key:string}[], flags: Flag[]}>} */
export async function loadMatrix(api, projectId) {
  const [envList, features] = await Promise.all([api.environments(projectId), api.features(projectId)]);
  const envs = envList.map((e) => ({ id: e.id, name: e.name, key: e.api_key }));
  const statesPerEnv = await Promise.all(envs.map((e) => api.featureStates(e.key)));
  const flags = features
    .filter((f) => !f.is_archived)
    .map((f) => {
      const cells = {};
      envs.forEach((env, i) => {
        const st = statesPerEnv[i].find((s) => s.feature === f.id && !s.identity && !s.feature_segment);
        if (st) cells[env.name] = { stateId: st.id, enabled: st.enabled, value: st.feature_state_value };
      });
      return { id: f.id, name: f.name, description: f.description ?? '', cells };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { envs, flags };
}

const same = (a, b) => a.enabled === b.enabled && (a.value ?? null) === (b.value ?? null);

/** A flag drifts when its enabled state or value differs between environments. */
export function isDrifted(flag) {
  const cells = Object.values(flag.cells);
  return cells.some((c) => !same(c, cells[0]));
}

/** Flags whose state differs between two environments. */
export function diffEnvs(matrix, from, to) {
  return matrix.flags
    .filter((f) => f.cells[from] && f.cells[to] && !same(f.cells[from], f.cells[to]))
    .map((f) => ({ name: f.name, from: { ...f.cells[from] }, to: { ...f.cells[to] } }));
}

export async function setEnabled(api, matrix, flag, envName, enabled) {
  const env = matrix.envs.find((e) => e.name === envName);
  const cell = flag.cells[envName];
  if (!env || !cell) throw new Error(`No state for ${flag.name} in ${envName}`);
  await api.updateFeatureState(env.key, cell.stateId, { enabled });
  cell.enabled = enabled;
}

export const toggle = (api, matrix, flag, envName) => setEnabled(api, matrix, flag, envName, !flag.cells[envName].enabled);

/** Copy enabled+value from one environment to another for the given flags (all drifted if omitted). */
export async function promote(api, matrix, from, to, names, { dryRun = false } = {}) {
  const changes = diffEnvs(matrix, from, to).filter((d) => !names || names.includes(d.name));
  const toEnv = matrix.envs.find((e) => e.name === to);
  if (!toEnv) throw new Error(`Unknown environment ${to}`);
  if (!dryRun) {
    for (const c of changes) {
      const flag = matrix.flags.find((f) => f.name === c.name);
      const patch = { enabled: c.from.enabled };
      if (c.from.value !== undefined) patch.feature_state_value = c.from.value;
      await api.updateFeatureState(toEnv.key, flag.cells[to].stateId, patch);
      flag.cells[to].enabled = c.from.enabled;
      flag.cells[to].value = c.from.value;
    }
  }
  return changes;
}

export function resolveEnv(matrix, input) {
  const hit = matrix.envs.find((e) => e.name.toLowerCase() === String(input).toLowerCase())
    ?? matrix.envs.find((e) => e.name.toLowerCase().startsWith(String(input).toLowerCase()));
  if (!hit) throw new Error(`Unknown environment "${input}". Available: ${matrix.envs.map((e) => e.name).join(', ')}`);
  return hit.name;
}

/**
 * Serve one variation of a multivariate flag to everyone in an environment (the "ship the winner" step).
 * The control variation is the flag's own value, so rolling out control sets every option to 0%.
 */
export async function rollout(api, matrix, projectId, flagName, variant, envName, { dryRun = false } = {}) {
  const env = matrix.envs.find((e) => e.name === envName);
  const feature = (await api.features(projectId)).find((f) => f.name === flagName);
  if (!feature) throw new Error(`Flag "${flagName}" not found`);
  const options = feature.multivariate_options ?? [];
  if (!options.length) throw new Error(`"${flagName}" is not a multivariate flag`);
  const chosen = options.find((o) => o.string_value === variant);
  const state = (await api.featureStates(env.key)).find((s) => s.feature === feature.id && !s.identity && !s.feature_segment);
  const mv = options.map((o) => {
    const existing = state.multivariate_feature_state_values.find((v) => v.multivariate_feature_option === o.id);
    return { ...(existing ? { id: existing.id } : {}), multivariate_feature_option: o.id, percentage_allocation: chosen && o.id === chosen.id ? 100 : 0 };
  });
  if (!chosen && variant !== state.feature_state_value) throw new Error(`Unknown variation "${variant}". Options: ${options.map((o) => o.string_value).join(', ')}, ${state.feature_state_value} (control)`);
  if (!dryRun) await api.putFeatureState(env.key, state.id, { ...state, enabled: true, multivariate_feature_state_values: mv });
  return { flag: flagName, env: envName, variant, allocations: mv.map((m) => `${options.find((o) => o.id === m.multivariate_feature_option).string_value}=${m.percentage_allocation}%`) };
}
