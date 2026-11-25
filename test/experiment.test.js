import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, srmPValue } from '../src/stats.js';
import { ExperimentStore, EXPERIMENT } from '../src/shop.js';

test('analyse declares a winner when the variant clearly beats control', () => {
  const r = analyse({ control: { exposures: 1000, conversions: 80 }, 'show-paypal': { exposures: 1000, conversions: 120 } }, { control: 'control' });
  assert.equal(r.winner, 'show-paypal');
  assert.ok(r.variants[1].winProbability > 0.95);
  assert.ok(r.variants[1].credibleInterval[0] > 0);
});

test('analyse stays inconclusive for identical rates', () => {
  const r = analyse({ control: { exposures: 1000, conversions: 80 }, 'show-paypal': { exposures: 1000, conversions: 80 } }, { control: 'control' });
  assert.equal(r.winner, null);
  assert.equal(r.variants[1].conclusive, false);
});

test('analyse reports collecting data under 50 exposures or 5 conversions', () => {
  const r = analyse({ control: { exposures: 30, conversions: 2 }, 'show-paypal': { exposures: 30, conversions: 9 } }, { control: 'control' });
  assert.equal(r.variants[1].collecting, true);
  assert.equal(r.winner, null);
});

test('sample ratio mismatch is flagged for a lopsided split', () => {
  assert.ok(srmPValue([500, 500], [0.5, 0.5]) > 0.9);
  assert.ok(srmPValue([700, 300], [0.5, 0.5]) < 0.001);
});

test('store dedupes exposures, quarantines identities served two variants, ignores events before exposure', () => {
  const s = new ExperimentStore(null);
  assert.equal(s.track('u1', EXPERIMENT.metric.event), false); // no prior exposure
  assert.equal(s.exposure('u1', 'control'), true);
  assert.equal(s.exposure('u1', 'control'), false);
  assert.equal(s.track('u1', EXPERIMENT.metric.event), true);
  s.exposure('u2', 'control'); s.exposure('u2', 'show-paypal');
  const r = s.results();
  assert.equal(r.quarantined, 1);
  assert.equal(r.variants[0].exposures, 1);
  assert.equal(r.variants[0].conversions, 1);
});
