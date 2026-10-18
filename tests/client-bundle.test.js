import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  activeShortcut, modelKey, persistShortcuts, reasoningOptions, validateShortcuts, visibleShortcuts,
} from '../shortcut-config.js';

/**
 * Load the browser bundle the way the module loader does, without a browser.
 *
 * The factory only needs `react` at render time, so a recording stub is enough
 * to reach the exports the page actually uses.
 *
 * @returns the bundle's exports.
 */
function loadBundle() {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  let loaded;
  const window = { __ModuleLoader__: { load: (spec) => { loaded = spec; } } };
  new Function('window', source)(window);
  assert.equal(loaded.id, '@local/dsh-model-selector');
  const react = {
    createElement: () => null,
    useCallback: (callback) => callback,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useSyncExternalStore: () => undefined,
  };
  return loaded.factory((name) => {
    if (name === 'react') return react;
    throw new Error(`the bundle may not require ${name}`);
  });
}

/** Flatten a nested dictionary file into the dotted keys the page looks up. */
function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, item]) => (
    item !== null && typeof item === 'object' ? flatten(item, `${prefix}${key}.`) : [`${prefix}${key}`]
  ));
}

const groups = [{
  id: 'provider-a',
  name: 'Provider A',
  models: [
    { id: 'model-1', name: 'Model One' },
    { id: 'model-2', name: 'Model Two', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } },
  ],
}];

const shortcuts = [
  { provider: 'provider-a', model: 'model-1', alias: '' },
  { provider: 'provider-a', model: 'model-2', alias: 'Pinned' },
  { provider: 'provider-a', model: 'model-2', alias: 'Pinned' },
];

test('declares the services the page and the composer row need', () => {
  const bundle = loadBundle();
  assert.equal(typeof bundle.apply, 'function');
  assert.deepEqual(bundle.inject, ['slots', 'locale', 'configForms', 'modelDirectories']);
});

test('mirrors the host-side shortcut rules exactly', () => {
  const internals = loadBundle().__internals;
  assert.equal(internals.modelKey('a/b', 'c'), modelKey('a/b', 'c'));
  for (const candidate of [
    [],
    shortcuts,
    [{ provider: '', model: 'model-1' }],
    [{ provider: 'provider-a', model: '' }],
    Array.from({ length: 4 }, (_, index) => ({ provider: 'provider-a', model: String(index) })),
    undefined,
  ]) {
    assert.equal(internals.validateShortcuts(candidate), validateShortcuts(candidate));
  }
  assert.deepEqual(internals.visibleShortcuts(shortcuts, groups), visibleShortcuts(shortcuts, groups));
  assert.deepEqual(internals.visibleShortcuts([], groups), []);
  assert.deepEqual(
    internals.activeShortcut(shortcuts, { provider: 'provider-a', model: 'model-2' }),
    activeShortcut(shortcuts, { provider: 'provider-a', model: 'model-2' }),
  );
  assert.equal(internals.activeShortcut(shortcuts, undefined), undefined);
  for (const model of [
    undefined,
    { id: 'model-1', name: 'Model One' },
    { reasoning: { efforts: [{ id: 'low', name: 'Low' }] } },
    { reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }] } },
  ]) {
    assert.deepEqual(internals.reasoningOptions(model), reasoningOptions(model));
  }
});

test('mirrors the save flow and its canonical failures', async () => {
  const internals = loadBundle().__internals;
  const form = (writable, accepted) => ({
    writable,
    calls: [],
    async set(field, value) {
      this.calls.push([field, value]);
      return accepted;
    },
  });
  const drafts = [
    [{ provider: 'provider-a', model: 'model-1', alias: '' }],
    [{ provider: '', model: 'model-1' }],
    Array.from({ length: 4 }, (_, index) => ({ provider: 'provider-a', model: String(index) })),
  ];
  for (const draft of drafts) {
    for (const [writable, accepted] of [[true, true], [true, false], [false, true]]) {
      const mirrored = form(writable, accepted);
      const host = form(writable, accepted);
      assert.deepEqual(
        await internals.persistShortcuts(mirrored, draft),
        await persistShortcuts(host, draft),
      );
      assert.deepEqual(mirrored.calls, host.calls);
    }
  }
});

test('keeps both locale files and the bundle dictionaries in step', () => {
  const internals = loadBundle().__internals;
  for (const language of ['en', 'zh']) {
    const file = JSON.parse(readFileSync(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'));
    assert.ok(file.meta.title, `${language} carries a title`);
    assert.ok(file.meta.description, `${language} carries a description`);
    assert.deepEqual(flatten(file).sort(), Object.keys(internals[language]).sort());
    for (const [key, text] of Object.entries(internals[language])) {
      assert.equal(typeof text, 'string', `${language} ${key} is text`);
      assert.ok(text.length > 0, `${language} ${key} is not empty`);
    }
  }
  assert.deepEqual(Object.keys(internals.en).sort(), Object.keys(internals.zh).sort());
});
