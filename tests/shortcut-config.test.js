import assert from 'node:assert/strict';
import test from 'node:test';
import { modelKey, validateShortcuts, visibleShortcuts } from '../shortcut-config.js';

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
