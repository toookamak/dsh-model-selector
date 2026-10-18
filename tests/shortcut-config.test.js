import assert from 'node:assert/strict';
import test from 'node:test';
import { modelKey, persistShortcuts, validateShortcuts, visibleShortcuts } from '../shortcut-config.js';

const groups = [{
  id: 'provider-a',
  name: 'Provider A',
  models: [
    { id: 'model-1', name: 'Model One', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } },
    { id: 'model-2', name: 'Model Two' },
  ],
}];

test('validates no more than three distinct provider/model pairs', () => {
  assert.equal(validateShortcuts([]), undefined);
  assert.equal(validateShortcuts([
    { provider: 'p', model: '1', alias: '' },
    { provider: 'p', model: '2', alias: '' },
    { provider: 'q', model: '1', alias: '' },
  ]), undefined);
  assert.match(validateShortcuts(Array.from({ length: 4 }, (_, i) => ({ provider: 'p', model: String(i) }))), /three/i);
  assert.match(validateShortcuts([
    { provider: 'p', model: 'm' }, { provider: 'p', model: 'm' },
  ]), /duplicate/i);
  assert.match(validateShortcuts([{ provider: '', model: 'm' }]), /provider/i);
  assert.match(validateShortcuts([{ provider: 'p', model: '' }]), /model/i);
});

test('keys use both provider and model without delimiter collisions', () => {
  assert.notEqual(modelKey('a/b', 'c'), modelKey('a', 'b/c'));
});

test('keeps configured order, resolves aliases, and hides unavailable models', () => {
  const visible = visibleShortcuts([
    { provider: 'provider-a', model: 'model-2', alias: 'Pinned' },
    { provider: 'provider-a', model: 'model-1', alias: '' },
    { provider: 'missing', model: 'gone', alias: 'Retained' },
  ], groups);
  assert.deepEqual(visible.map(({ label }) => label), ['Pinned', 'Model One']);
  assert.deepEqual(visible.map(({ key }) => key), [
    modelKey('provider-a', 'model-2'), modelKey('provider-a', 'model-1'),
  ]);
});

/** Minimal stand-in for the Host-backed configuration form the page saves through. */
function fakeForm({ writable = true, accepted = true } = {}) {
  const calls = [];
  return {
    writable,
    calls,
    async set(field, value) {
      calls.push([field, value]);
      return accepted;
    },
  };
}

test('refuses an invalid draft without touching the configuration form', async () => {
  const tooMany = fakeForm();
  const limited = await persistShortcuts(tooMany, Array.from({ length: 4 }, (_, i) => ({ provider: 'p', model: String(i) })));
  assert.equal(limited.ok, false);
  assert.match(limited.error, /three/i);
  assert.deepEqual(tooMany.calls, []);

  const duplicated = fakeForm();
  const repeated = await persistShortcuts(duplicated, [
    { provider: 'p', model: 'm' }, { provider: 'p', model: 'm' },
  ]);
  assert.equal(repeated.ok, false);
  assert.match(repeated.error, /duplicate/i);
  assert.deepEqual(duplicated.calls, []);
});

test('writes a valid draft through the form exactly once', async () => {
  const form = fakeForm();
  const draft = [{ provider: 'p', model: 'm', alias: 'Mine' }];
  assert.deepEqual(await persistShortcuts(form, draft), { ok: true });
  assert.equal(form.calls.length, 1);
  assert.equal(form.calls[0][0], 'shortcuts');
  assert.deepEqual(form.calls[0][1], draft);
});

test('reports a read-only configuration without writing', async () => {
  const form = fakeForm({ writable: false });
  const result = await persistShortcuts(form, [{ provider: 'p', model: 'm' }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /read-only/i);
  assert.deepEqual(form.calls, []);
});

test('reports a host rejection and leaves the draft untouched for editing', async () => {
  const form = fakeForm({ accepted: false });
  const draft = [{ provider: 'p', model: 'm', alias: 'Mine' }];
  const result = await persistShortcuts(form, draft);
  assert.equal(result.ok, false);
  assert.match(result.error, /rejected/i);
  assert.deepEqual(draft, [{ provider: 'p', model: 'm', alias: 'Mine' }]);
  assert.equal(form.calls.length, 1);
});
