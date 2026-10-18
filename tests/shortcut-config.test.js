import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeShortcut, modelKey, persistShortcuts, reasoningOptions, validateShortcuts, visibleShortcuts,
} from '../shortcut-config.js';

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

/** The live form shape: the Host mirrors writability onto the snapshot. */
function snapshotForm({ writable, accepted = true } = {}) {
  const calls = [];
  return {
    calls,
    subscribe: () => () => {},
    getSnapshot: () => ({ status: 'ready', revision: 1, writable }),
    async set(field, value) {
      calls.push([field, value]);
      return accepted;
    },
  };
}

test('reads writability from the snapshot the Host-backed form mirrors', async () => {
  const open = snapshotForm({ writable: true });
  assert.deepEqual(await persistShortcuts(open, [{ provider: 'p', model: 'm' }]), { ok: true });
  assert.equal(open.calls.length, 1);

  const readOnly = snapshotForm({ writable: false });
  const refused = await persistShortcuts(readOnly, [{ provider: 'p', model: 'm' }]);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /read-only/i);
  assert.deepEqual(readOnly.calls, []);
});

test('never guesses writability from a silent or failing snapshot', async () => {
  const silent = { getSnapshot: () => ({ revision: 2 }), set: async () => true };
  const silentResult = await persistShortcuts(silent, [{ provider: 'p', model: 'm' }]);
  assert.equal(silentResult.ok, false);
  assert.match(silentResult.error, /read-only/i);

  let calls = 0;
  const throwing = {
    getSnapshot: () => { throw new Error('mirror is gone'); },
    set: async () => { calls += 1; return true; },
  };
  const thrown = await persistShortcuts(throwing, [{ provider: 'p', model: 'm' }]);
  assert.equal(thrown.ok, false);
  assert.match(thrown.error, /read-only/i);
  assert.equal(calls, 0);
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

test('matches the configured shortcut of the current selection', () => {
  const shortcuts = [
    { provider: 'provider-a', model: 'model-1', alias: 'One' },
    { provider: 'provider-a', model: 'model-2', alias: 'Two' },
  ];
  assert.equal(activeShortcut(shortcuts, { provider: 'provider-a', model: 'model-2' }), shortcuts[1]);
  assert.equal(activeShortcut(shortcuts, { provider: 'provider-a', model: 'model-2', reasoningEffort: 'low' }), shortcuts[1]);
  assert.equal(activeShortcut(shortcuts, { provider: 'provider-b', model: 'model-2' }), undefined);
  assert.equal(activeShortcut(shortcuts, { provider: 'provider-a', model: 'missing' }), undefined);
  assert.equal(activeShortcut(shortcuts, undefined), undefined);
  assert.equal(activeShortcut(shortcuts, {}), undefined);
});

test('lists the reasoning options a model actually supports', () => {
  assert.deepEqual(reasoningOptions(undefined), []);
  assert.deepEqual(reasoningOptions({ id: 'model-2', name: 'Model Two' }), []);
  assert.deepEqual(
    reasoningOptions({ reasoning: { defaultEffort: 'medium', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }),
    [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
  );
  assert.deepEqual(
    reasoningOptions({ reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }),
    [{ id: '', name: '' }, { id: 'low', name: 'Low' }],
  );
});

test('leaves the model metadata it reads untouched', () => {
  const model = { reasoning: { efforts: [{ id: 'low', name: 'Low' }] } };
  const before = structuredClone(model);
  reasoningOptions(model);
  assert.deepEqual(model, before);
});

test('returns nothing when there is nothing to show', () => {
  assert.deepEqual(visibleShortcuts([], groups), []);
  assert.deepEqual(visibleShortcuts([{ provider: 'provider-a', model: 'model-1' }], []), []);
  assert.deepEqual(visibleShortcuts(undefined, undefined), []);
  assert.equal(activeShortcut(undefined, { provider: 'provider-a', model: 'model-1' }), undefined);
});

test('leaves the configuration and the directory it reads untouched', () => {
  const configured = [{ provider: 'provider-a', model: 'model-1', alias: ' Mine ' }];
  const directory = structuredClone(groups);
  const beforeConfigured = structuredClone(configured);
  const beforeDirectory = structuredClone(directory);
  visibleShortcuts(configured, directory);
  activeShortcut(configured, { provider: 'provider-a', model: 'model-1' });
  assert.deepEqual(configured, beforeConfigured);
  assert.deepEqual(directory, beforeDirectory);
});
