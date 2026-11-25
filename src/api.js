// Minimal Flagsmith Management API client. Zero dependencies (Node >= 18, global fetch).

export class ApiError extends Error {
  constructor(status, body, method, path) {
    super(`${method} ${path} -> ${status} ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export class Flagsmith {
  /**
   * @param {{url: string, token?: string, tokenType?: 'Token'|'Api-Key'}} opts
   */
  constructor({ url, token, tokenType = 'Token' }) {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.tokenType = tokenType;
  }

  async request(method, path, body, headers = {}) {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json', ...headers };
    if (this.token && !h.Authorization) h.Authorization = `${this.tokenType} ${this.token}`;
    const res = await fetch(this.url + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok) throw new ApiError(res.status, data, method, path);
    return data;
  }

  /** Follow DRF-style pagination and return every result. */
  async list(path) {
    let next = path;
    const out = [];
    while (next) {
      const page = await this.request('GET', next);
      if (Array.isArray(page)) return page;
      out.push(...page.results);
      next = page.next ? page.next.replace(this.url, '').replace(/^https?:\/\/[^/]+/, '') : null;
    }
    return out;
  }

  // ---- auth ----
  async login(email, password) {
    const r = await this.request('POST', '/api/v1/auth/login/', { email, password });
    this.token = r.key;
    this.tokenType = 'Token';
    return r.key;
  }

  async register({ email, password, first_name = 'Flagdeck', last_name = 'Admin' }) {
    const r = await this.request('POST', '/api/v1/auth/users/', {
      email, password, re_password: password, first_name, last_name,
    });
    this.token = r.key;
    this.tokenType = 'Token';
    return r.key;
  }

  // ---- structure ----
  organisations() { return this.list('/api/v1/organisations/'); }
  createOrganisation(name) { return this.request('POST', '/api/v1/organisations/', { name }); }
  projects() { return this.list('/api/v1/projects/'); }
  createProject(name, organisation) { return this.request('POST', '/api/v1/projects/', { name, organisation }); }
  environments(projectId) { return this.list(`/api/v1/environments/?project=${projectId}`); }
  createEnvironment(name, project) { return this.request('POST', '/api/v1/environments/', { name, project }); }
  features(projectId) { return this.list(`/api/v1/projects/${projectId}/features/?page_size=100`); }
  createFeature(projectId, body) { return this.request('POST', `/api/v1/projects/${projectId}/features/`, body); }

  // ---- per-environment state ----
  featureStates(envKey) { return this.list(`/api/v1/environments/${envKey}/featurestates/?page_size=100`); }
  updateFeatureState(envKey, id, patch) {
    return this.request('PATCH', `/api/v1/environments/${envKey}/featurestates/${id}/`, patch);
  }

  // ---- public Flags API (SDK-facing) ----
  sdkFlags(envKey) { return this.request('GET', '/api/v1/flags/', undefined, { 'X-Environment-Key': envKey, Authorization: '' }); }
  sdkIdentity(envKey, identifier, traits = []) {
    return this.request('POST', '/api/v1/identities/', { identifier, traits }, { 'X-Environment-Key': envKey, Authorization: '' });
  }
}

/** Poll until the API answers (used by docker `seed --wait`). */
export async function waitForApi(url, { timeoutMs = 180000, intervalMs = 2000 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url.replace(/\/+$/, '') + '/health');
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`Flagsmith at ${url} did not become healthy in ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
