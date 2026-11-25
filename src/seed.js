import { Flagsmith, ApiError, waitForApi } from './api.js';
import { writeFileSync } from 'node:fs';

export const DEFAULTS = {
  email: 'admin@example.com',
  password: 'flagdeck-demo-1',
  org: 'Flagdeck Demo',
  project: 'Storefront',
  envs: ['Development', 'Staging', 'Production'],
};

// enabled-per-env is deliberately uneven so the matrix shows realistic drift.
export const DEMO_FLAGS = [
  { name: 'new_checkout', description: 'Single-page checkout', value: null, on: { Development: true, Staging: true, Production: false } },
  { name: 'dark_mode', description: 'Dark theme toggle in header', value: null, on: { Development: true, Staging: true, Production: true } },
  { name: 'ai_assistant', description: 'AI shopping assistant widget', value: null, on: { Development: true, Staging: false, Production: false } },
  { name: 'hero_headline', description: 'Remote config: landing hero text', value: 'Ship faster with feature flags', on: { Development: true, Staging: true, Production: true } },
  { name: 'maintenance_banner', description: 'Site-wide maintenance notice', value: 'Scheduled maintenance tonight 22:00 UTC', on: { Development: false, Staging: false, Production: false } },
];

const log = (m) => console.log(`[seed] ${m}`);

async function signIn(api, { email, password }) {
  try {
    await api.register({ email, password });
    log(`created admin ${email}`);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status >= 500) throw e;
    await api.login(email, password);
    log(`logged in as ${email}`);
  }
}

/** Create admin, org, project, environments and demo flags. Safe to run repeatedly. */
export async function seed({ url, email = DEFAULTS.email, password = DEFAULTS.password, wait = false, writeEnv } = {}) {
  if (wait) await waitForApi(url);
  const api = new Flagsmith({ url });
  await signIn(api, { email, password });

  const orgs = await api.organisations();
  const org = orgs.find((o) => o.name === DEFAULTS.org) ?? (log('creating organisation'), await api.createOrganisation(DEFAULTS.org));

  const projects = await api.projects();
  const project = projects.find((p) => p.name === DEFAULTS.project && p.organisation === org.id)
    ?? (log('creating project'), await api.createProject(DEFAULTS.project, org.id));

  let envs = await api.environments(project.id);
  for (const name of DEFAULTS.envs) {
    if (!envs.some((e) => e.name === name)) { log(`creating environment ${name}`); await api.createEnvironment(name, project.id); }
  }
  envs = await api.environments(project.id);

  const existing = await api.features(project.id);
  for (const f of DEMO_FLAGS) {
    if (existing.some((x) => x.name === f.name)) continue;
    log(`creating flag ${f.name}`);
    await api.createFeature(project.id, {
      name: f.name, description: f.description, default_enabled: false,
      initial_value: f.value ?? undefined, type: 'STANDARD',
    });
  }
  // Multivariate flag for the PayPal-button experiment: 50% show-paypal, remainder control.
  if (!existing.some((x) => x.name === 'paypal_button')) {
    log('creating experiment flag paypal_button');
    await api.createFeature(project.id, {
      name: 'paypal_button', description: 'Experiment: offer PayPal at checkout', default_enabled: true,
      initial_value: 'control', type: 'MULTIVARIATE',
      multivariate_options: [{ type: 'unicode', string_value: 'show-paypal', default_percentage_allocation: 50 }],
    });
  }
  const features = await api.features(project.id);

  for (const env of envs) {
    const states = await api.featureStates(env.api_key);
    for (const f of DEMO_FLAGS) {
      const want = f.on[env.name];
      if (want === undefined) continue;
      const feat = features.find((x) => x.name === f.name);
      const st = states.find((s) => s.feature === feat?.id);
      if (st && st.enabled !== want && !existing.some((x) => x.name === f.name)) {
        await api.updateFeatureState(env.api_key, st.id, { enabled: want });
      }
    }
  }

  const result = {
    url, email, password, token: api.token, project: project.id,
    envs: Object.fromEntries(envs.map((e) => [e.name, e.api_key])),
  };
  if (writeEnv) {
    const lines = [`FLAGSMITH_URL=${url}`, `FLAGDECK_TOKEN=${api.token}`, `FLAGDECK_PROJECT=${project.id}`,
      ...envs.map((e) => `FLAGDECK_ENV_${e.name.toUpperCase()}=${e.api_key}`)];
    writeFileSync(writeEnv, lines.join('\n') + '\n');
  }
  log(`ready: project ${project.id}, environments ${Object.keys(result.envs).join(', ')}`);
  return result;
}

