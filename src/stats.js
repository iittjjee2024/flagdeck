// Bayesian A/B analysis for occurrence metrics (Beta-Binomial), mirroring what
// Flagsmith's results page reports: exposures, rate, delta, credible interval, win probability.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng) {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Marsaglia-Tsang gamma sampler (shape >= 1 is all we need here).
function gamma(shape, rng) {
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = normal(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function betaSample(a, b, rng) {
  const x = gamma(a, rng), y = gamma(b, rng);
  return x / (x + y);
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

// Abramowitz-Stegun 7.1.26 erfc approximation (abs error < 1.5e-7).
function erfc(x) {
  const t = 1 / (1 + 0.3275911 * x);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return y * Math.exp(-x * x);
}

/** Chi-square test for sample ratio mismatch. Returns p-value (df = k-1, k in {2,3,4}). */
export function srmPValue(counts, expected) {
  const total = counts.reduce((s, x) => s + x, 0);
  if (!total) return 1;
  const chi = counts.reduce((s, o, i) => s + ((o - total * expected[i]) ** 2) / (total * expected[i]), 0);
  const df = counts.length - 1;
  if (df === 1) return erfc(Math.sqrt(chi / 2));
  if (df === 2) return Math.exp(-chi / 2);
  return Math.exp(-chi / 2) * (1 + chi / 2);
}

/**
 * @param {Record<string,{exposures:number, conversions:number}>} data keyed by variant name
 * @param {{control:string, expectedSplit?:Record<string,number>, draws?:number, seed?:number}} opts
 */
export function analyse(data, { control, expectedSplit, draws = 20000, seed = 42 } = {}) {
  const names = Object.keys(data);
  const rng = mulberry32(seed);
  const total = names.reduce((s, n) => s + data[n].exposures, 0);
  const post = (n) => ({ a: 1 + data[n].conversions, b: 1 + data[n].exposures - data[n].conversions });
  const samples = Object.fromEntries(names.map((n) => [n, Array.from({ length: draws }, () => betaSample(post(n).a, post(n).b, rng))]));
  const variants = names.map((n) => {
    const d = data[n];
    const rate = d.exposures ? d.conversions / d.exposures : 0;
    const row = { name: n, exposures: d.exposures, conversions: d.conversions, rate, collecting: d.exposures < 50 || d.conversions < 5 };
    if (n !== control) {
      const cs = samples[control];
      const rel = samples[n].map((v, i) => v / cs[i] - 1).sort((x, y) => x - y);
      row.winProbability = samples[n].reduce((s, v, i) => s + (v > cs[i] ? 1 : 0), 0) / draws;
      row.delta = rel.reduce((s, x) => s + x, 0) / draws;
      row.credibleInterval = [pct(rel, 0.025), pct(rel, 0.975)];
      row.conclusive = !(row.credibleInterval[0] < 0 && row.credibleInterval[1] > 0);
    }
    return row;
  });
  const split = expectedSplit ?? Object.fromEntries(names.map((n) => [n, 1 / names.length]));
  const srmP = srmPValue(names.map((n) => data[n].exposures), names.map((n) => split[n]));
  const challengers = variants.filter((v) => v.name !== control && v.winProbability !== undefined);
  const best = challengers.sort((a, b) => b.winProbability - a.winProbability)[0];
  return {
    totalExposures: total,
    variants: [...variants.filter((v) => v.name === control), ...variants.filter((v) => v.name !== control)],
    srm: { pValue: srmP, mismatch: total >= 100 && srmP < 0.001 },
    winner: best && best.winProbability >= 0.95 && !best.collecting ? best.name : null,
    recommendation: best && best.winProbability >= 0.95 && !best.collecting ? `Roll out "${best.name}"` : 'Keep the experiment running',
  };
}

