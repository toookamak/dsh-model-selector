import assert from 'node:assert/strict';
import test from 'node:test';
import z from '@deepseek-ai/schemastery';

import { Config } from '../index.js';

/**
 * Mirrors `volatileForm` in @deepseek-ai/dsh-settings (lib/index.js:122-131):
 * the settings service exposes a form only for fields whose nearest volatile
 * ancestor makes them editable, and skips entries without one.
 */
function volatileForm(schema) {
  if (schema.meta.volatile) return schema;
  if (schema.type !== 'object') return undefined;
  const dict = Object.fromEntries(
    Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = volatileForm(child);
      return field === undefined ? [] : [[key, field]];
    }),
  );
  return Object.keys(dict).length === 0 ? undefined : z.object(dict);
}

/** Mirrors `isVolatilePath` in @deepseek-ai/dsh-settings (lib/index.js:153-158). */
function isVolatilePath(schema, path) {
  if (schema.meta.volatile) return true;
  const [key, ...rest] = path;
  const child = key === undefined ? undefined : schema.dict?.[key];
  return child !== undefined && isVolatilePath(child, rest);
}

const shortcut = (index) => ({ provider: `provider-${index}`, model: `model-${index}` });

test('the host schema exposes the shortcut list as a settings field', () => {
  assert.equal(Config.dict.shortcuts.meta.volatile, true);
  const form = volatileForm(Config);
  assert.ok(form !== undefined, 'the entry must have at least one volatile field');
  assert.deepEqual(Object.keys(form.dict), ['shortcuts']);
  assert.equal(isVolatilePath(Config, ['shortcuts']), true);
});

test('the shortcut list accepts at most three entries', () => {
  assert.doesNotThrow(() => Config({ shortcuts: [shortcut(1), shortcut(2), shortcut(3)] }));
  assert.throws(() => Config({ shortcuts: [1, 2, 3, 4].map(shortcut) }));
});

test('the shortcut list defaults to empty and screens incomplete entries', () => {
  const parsed = Config({});
  const value = parsed?.shortcuts?.get ? parsed.shortcuts.get() : parsed.shortcuts;
  assert.deepEqual(value, []);
  assert.throws(() => Config({ shortcuts: [{ provider: 'provider-1' }] }));
});
