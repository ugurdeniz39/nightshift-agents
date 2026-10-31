import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { cli } from './helpers.mjs';

// The other tests use temporary data. This one checks the repository's real factory/*.json, so a bad merge
// (for example leftover conflict markers) can never pass CI again. Found on 2026-10-31.
test('the real factory data passes doctor', async () => {
  const home = fileURLToPath(new URL('..', import.meta.url));
  const r = await cli(home, ['doctor']);
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  assert.doesNotMatch(r.out, /^FAIL/m);
});
