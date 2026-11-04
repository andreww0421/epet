import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createStagingConfig, assertStagingConfig } from '../scripts/staging-policy.mjs';

test('checked-in analytics is disabled without bindings and staging policy rejects accidental collection', async () => {
  const production = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const template = JSON.parse(await readFile('wrangler.staging.jsonc', 'utf8'));
  for (const [config, environment] of [[production, 'production'], [template, 'staging']] as const) {
    assert.equal(config.vars.PRODUCT_ANALYTICS_ENABLED, 'false');
    assert.equal(config.vars.PRODUCT_ANALYTICS_ENVIRONMENT, environment);
    assert.equal(config.vars.PRODUCT_ANALYTICS_COHORT_START, undefined);
    assert.ok(config.d1_databases.every((binding: { binding: string }) => binding.binding !== 'ANALYTICS_DB'));
  }
  const generated = createStagingConfig({ production, template, dryRun: true });
  assert.doesNotThrow(() => assertStagingConfig({ production, config: generated }));
  const enabled = structuredClone(generated); enabled.vars.PRODUCT_ANALYTICS_ENABLED = 'true';
  assert.throws(() => assertStagingConfig({ production, config: enabled }));
  const alias = structuredClone(generated);
  alias.d1_databases.push({ ...alias.d1_databases[0], binding: 'ANALYTICS_DB' });
  assert.throws(() => assertStagingConfig({ production, config: alias }));
});
