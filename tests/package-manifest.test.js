import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const readText = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

/** Providers this client half directly depends on, in declaration order. */
const PROVIDERS = [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-plugin-manager',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-model-selection',
];

/** Every file the bundle needs at run time, as the manifest must ship it. */
const RUNTIME_FILES = ['index.js', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg'];

test('manifest declares the installable bundle identity', () => {
  const manifest = readJson('package.json');
  assert.equal(manifest.name, '@local/dsh-model-selector');
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.dependencies['@deepseek-ai/schemastery'], '~3.18.5');
});

test('manifest exposes the host and client entries', () => {
  const { exports } = readJson('package.json');
  assert.equal(exports['.'], './index.js');
  assert.equal(exports['./client'], './client.js');
  assert.equal(exports['./locale/*.json'], './locale/*.json');
  assert.equal(exports['./icon'], './icon.svg');
});

test('manifest ships every runtime file and resource', () => {
  const { files } = readJson('package.json');
  for (const entry of RUNTIME_FILES) {
    assert.ok(files.includes(entry), `files is missing ${entry}`);
  }
});

test('manifest loads the web client half immediately over its providers', () => {
  const { dsh } = readJson('package.json');
  assert.equal(dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(dsh.client.platform, 'web');
  assert.equal(dsh.client.immediately, true);
  assert.deepEqual(dsh.client.inject, PROVIDERS);
});

test('the host half exports the Config schema and an apply hook', () => {
  const index = readText('index.js');
  assert.match(index, /export const Config/);
  assert.match(index, /export function apply\(ctx\)/);
});

test('the patch inserts exactly one host row for this bundle', () => {
  const patch = readText('cordis.patch.yml');
  const ids = [...patch.matchAll(/^\s*(?:-\s*)?id:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(ids, ['model-selector']);
  assert.match(patch, /^\s*-\s*insert:\s*$/m);
  assert.match(patch, /^\s*name:\s*'@local\/dsh-model-selector'\s*$/m);
});
