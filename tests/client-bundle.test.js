import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  activeShortcut, modelKey, persistShortcuts, reasoningOptions, shortcutChoices, validateShortcuts,
  visibleShortcuts,
} from '../shortcut-config.js';

/** Flatten the children the recording stub hands to a component. */
function spread(children) {
  const list = Array.isArray(children) ? children : [children];
  return list.filter((child) => child !== null && child !== undefined).flat();
}

/**
 * A stand-in for `@deepseek-ai/dsh-client-ui-primitives`, the module the shell
 * seeds into every bundle. The real menu material is a black box here, so the
 * stubs keep only the public shape the page renders through, plus a record of
 * the hooks the page hands back to the platform.
 *
 * @param react - the React stub the material builds its nodes with.
 * @returns the module and the calls the page made into it.
 */
function primitivesStub(react) {
  const calls = { dismiss: [], sticky: [] };
  const module = {
    Button: (props) => react.createElement('button', {
      type: 'button',
      className: props.className,
      disabled: props.disabled,
      'data-variant': props.variant,
      onClick: props.onClick,
    }, ...spread(props.children)),
    Input: (props) => react.createElement('input', {
      className: props.className,
      type: props.type ?? 'text',
      value: props.value,
      disabled: props.disabled,
      onChange: props.onChange,
    }),
    MenuSurface: (props) => react.createElement('div', {
      className: props.className,
      role: props.role,
    }, ...spread(props.children)),
    MenuGroup: (props) => react.createElement('section', {
      className: 'stub-group',
      label: props.label,
    }, ...spread(props.children)),
    Menu: (props) => react.createElement('div', {
      className: 'stub-menu',
      items: props.items,
      open: props.open === true,
      selectedId: props.selectedId,
    }, props.anchor, ...(props.open === true ? (props.items ?? []) : []).map((item) => react.createElement('button', {
      type: 'button',
      key: item.id,
      className: 'stub-menu-item',
      'data-id': item.id,
    }, item.label))),
    useDismissOnOutsidePointer: (root, open, setOpen) => {
      calls.dismiss.push({ root, open, setOpen });
    },
    useAnchoredPosition: () => null,
    observeStickyMenuGroups: (viewport) => {
      calls.sticky.push(viewport);
      return () => {};
    },
  };
  return { module, calls };
}

/**
 * Load the browser bundle the way the module loader does, without a browser.
 *
 * The factory only needs `react` and the platform's UI primitives at render time,
 * so recording stubs are enough to reach the exports the page actually uses.
 *
 * @param react - an optional React stub; the default one stops at the exports.
 * @param primitives - an optional primitive stub, when a test reads its calls.
 * @returns the bundle's exports.
 */
function loadBundle(react, primitives) {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  let loaded;
  const window = { __ModuleLoader__: { load: (spec) => { loaded = spec; } } };
  new Function('window', source)(window);
  assert.equal(loaded.id, '@local/dsh-model-selector');
  const stub = react ?? {
    createElement: () => null,
    useCallback: (callback) => callback,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useSyncExternalStore: () => undefined,
  };
  const material = primitives ?? primitivesStub(stub).module;
  return loaded.factory((name) => {
    if (name === 'react') return stub;
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return material;
    // The portaled menu needs `createPortal`; the stub returns the node where the
    // real renderer would mount it in the document body.
    if (name === 'react-dom') return { createPortal: (node) => node };
    throw new Error(`the bundle may not require ${name}`);
  });
}

/**
 * A React stub that keeps hook state, so a test can render an interactive page.
 *
 * `start` renders the component once, `step` replays the state updates it left
 * pending, and `settle` lets the page's promises land before the replay. The
 * nodes of the latest render are the recorded `createElement` results.
 *
 * @returns the stub, the latest render's nodes, and the three drivers.
 */
function statefulReact() {
  const nodes = [];
  const hooks = [];
  const queued = [];
  let cursor = 0;
  let pending;
  let view = () => {};
  const flush = () => {
    for (let round = 0; round < 20; round += 1) {
      if (pending === undefined && queued.length === 0) return;
      const next = pending;
      pending = undefined;
      if (next !== undefined) view = next;
      // Every render starts at the first hook slot again; without this the
      // cursor walks past the effects and they would replay on every render.
      cursor = 0;
      nodes.length = 0;
      view();
      // Effects run once the tree is in place, the way the real renderer commits
      // them, so a ref an effect reads is already attached.
      while (queued.length > 0) queued.shift()();
    }
  };
  const react = {
    createElement: (type, properties, ...children) => {
      const props = properties ?? {};
      // A function type is a component, which the real renderer would call with
      // these props; the stub calls it inline, so nested pages render too.
      if (typeof type === 'function') return type({ ...props, children });
      const node = { type, props, children };
      // A host element hands itself to its ref before the effects run, which is
      // what lets an effect measure the node it just rendered.
      if (typeof type === 'string' && props.ref !== null && props.ref !== undefined) props.ref.current = node;
      nodes.push(node);
      return node;
    },
    useCallback: (callback) => callback,
    useEffect: (effect) => {
      const index = cursor++;
      if (hooks[index] === true) return;
      hooks[index] = true;
      queued.push(effect);
    },
    useRef: (value) => {
      const index = cursor++;
      if (hooks[index] === undefined) hooks[index] = { current: value };
      return hooks[index];
    },
    useState: (initial) => {
      const index = cursor++;
      if (hooks[index] === undefined) hooks[index] = typeof initial === 'function' ? initial() : initial;
      const set = (next) => {
        const current = hooks[index];
        hooks[index] = typeof next === 'function' ? next(current) : next;
        pending = view;
      };
      return [hooks[index], set];
    },
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  };
  return {
    react,
    nodes,
    /** Render one component with the props its slot would hand in. */
    start(component, props) {
      view = () => component(props);
      cursor = 0;
      nodes.length = 0;
      view();
      flush();
    },
    /** Render whatever the last interaction left pending. */
    step: flush,
    /** Let the page's promises land, then render their result. */
    async settle() {
      for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
        flush();
      }
    },
  };
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
  assert.deepEqual(bundle.inject, ['slots', 'locale', 'remote', 'remote.session', 'configForms', 'modelDirectories']);
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
  for (const [rows, index] of [
    [shortcuts, 0],
    [shortcuts, 1],
    [[{ provider: '', model: '', alias: '' }], 0],
    [[{ provider: '  provider-a  ', model: ' model-2 ', alias: '' }], 0],
    [[{ provider: 'provider-a', model: 'model-gone', alias: '' }], 0],
    [[{ provider: 'gone', model: 'model-gone', alias: '' }], 0],
    [undefined, 0],
  ]) {
    assert.deepEqual(internals.shortcutChoices(groups, rows, index), shortcutChoices(groups, rows, index));
  }
});

const catalog = [
  { id: 'provider-a', name: 'Provider A', models: [
    { id: 'model-1', name: 'Model One' },
    { id: 'model-2', name: 'Model Two' },
  ] },
  { id: 'provider-b', name: 'Provider B', models: [{ id: 'model-3', name: 'Model Three' }] },
];

test('offers only the configured models a row can still take', () => {
  const rows = [
    { provider: 'provider-a', model: 'model-1', alias: '' },
    { provider: 'provider-a', model: 'model-2', alias: '' },
  ];
  const first = shortcutChoices(catalog, rows, 0);
  // The pair the second row holds is out of reach for the first row, and the
  // provider still offers every model the first row can take.
  assert.equal(first.provider, 'provider-a');
  assert.deepEqual(first.providers.map((entry) => [entry.id, entry.models.map((model) => model.id)]), [
    ['provider-a', ['model-1']],
    ['provider-b', ['model-3']],
  ]);

  // A provider whose every model is taken offers nothing; an empty row picks up
  // the providers that still have room.
  const blank = shortcutChoices(catalog, [...rows, { provider: '', model: '', alias: '' }], 2);
  assert.equal(blank.provider, '');
  assert.deepEqual(blank.models, []);
  assert.deepEqual(blank.providers.map((entry) => [entry.id, entry.models.map((model) => model.id)]), [
    ['provider-b', ['model-3']],
  ]);
});

test('keeps a pair the catalog no longer offers readable and removable', () => {
  const retired = shortcutChoices(catalog, [{ provider: 'provider-a', model: 'model-retired', alias: '' }], 0);
  assert.deepEqual(retired.models.map((entry) => [entry.id, entry.unavailable]), [
    ['model-retired', true],
    ['model-1', false],
    ['model-2', false],
  ]);

  const gone = shortcutChoices(catalog, [{ provider: 'provider-gone', model: 'model-x', alias: '' }], 0);
  // The provider itself is gone, so the row carries it back as its only entry.
  assert.deepEqual(gone.providers[0], {
    id: 'provider-gone',
    name: 'provider-gone',
    models: [{ id: 'model-x', name: 'model-x', unavailable: true }],
  });
  assert.equal(gone.models.length, 1);
});

test('mirrors the save flow and its canonical failures', async () => {
  const internals = loadBundle().__internals;
  const form = (writable, accepted, mirrored) => ({
    writable,
    calls: [],
    ...(mirrored ? { getSnapshot: () => ({ revision: 1, writable }) } : {}),
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
    // `mirrored` covers the live shape (writability on the snapshot) next to the
    // bare flag a stand-in may carry.
    for (const [writable, accepted, snapshot] of [
      [true, true, false], [true, false, false], [false, true, false],
      [true, true, true], [true, false, true], [false, true, true],
    ]) {
      const mirrored = form(writable, accepted, snapshot);
      const host = form(writable, accepted, snapshot);
      assert.deepEqual(
        await internals.persistShortcuts(mirrored, draft),
        await persistShortcuts(host, draft),
      );
      assert.deepEqual(mirrored.calls, host.calls);
    }
  }
});

/**
 * Mount the bundle against a recording context.
 *
 * The stubs are the smallest surface `apply` touches: one configuration form,
 * one shared model directory, the Host catalog namespace, a slot registry that
 * records every claim, and the `document` the style tag needs.
 *
 * @param react - an optional interactive React stub, for tests that render.
 * @param primitives - an optional primitive stub, when a test reads its calls.
 * @returns the recorded registrations and the Host events subscribed.
 */
function mountBundle(react, primitives) {
  const bundle = loadBundle(react, primitives);
  const registered = [];
  const subscribed = [];
  const fakeForm = {
    writable: true,
    subscribe: () => () => {},
    getSnapshot: () => ({
      revision: 0,
      writable: true,
      value: { shortcuts: [{ provider: 'provider-a', model: 'model-retired', alias: '' }] },
    }),
    set: async () => true,
  };
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (run) => {
      const stop = run();
      return typeof stop === 'function' ? stop : () => {};
    },
    inject: (names, run) => {
      run(Object.assign({
        slots: ctx.slots, configForms: ctx.configForms, modelDirectories: ctx.modelDirectories,
        remote: ctx.remote, effect: ctx.effect,
      }));
      return () => {};
    },
    slots: {
      register: (spec, component) => {
        registered.push({ spec, component });
        return () => {};
      },
      inject: (name, run) => {
        run();
        return () => {};
      },
    },
    configForms: { get: () => fakeForm },
    modelDirectories: {
      directoryFor: () => ({
        store: {
          subscribe: () => () => {},
          getSnapshot: () => ({ status: 'ready', groups, current: { provider: 'provider-a', model: 'model-2' } }),
        },
        load: async () => {},
        select: async () => ({ ok: true }),
      }),
    },
    remote: {
      $on: (event) => {
        subscribed.push(event);
        return () => {};
      },
      session: { modelCatalog: async () => ({ ok: true, value: { groups: catalog } }) },
    },
  };
  const documentStub = {
    createElement: () => ({ dataset: {}, remove: () => {} }),
    head: { append: () => {} },
  };
  const original = globalThis.document;
  globalThis.document = documentStub;
  try {
    bundle.apply(ctx);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
  return { registered, subscribed };
}

test('registers its settings form in the seats the Plugins page renders', () => {
  const { registered } = mountBundle();
  assert.deepEqual(
    registered.map((entry) => `${entry.spec.name}\t${entry.spec.key ?? entry.spec.id ?? ''}`),
    [
      'plugins.row.config\t@local/dsh-model-selector#model-selector',
      'plugins.bundle.config\t@local/dsh-model-selector',
      'settings.section\tmodel-selector',
      'conversation.input.model\t',
    ],
  );
  // `plugins.item` lists official Host-plane plugins only, so a profile bundle
  // must never claim it: nothing would render there.
  assert.ok(!registered.some((entry) => entry.spec.name === 'plugins.item'));
});

test('takes the composer model seat and its own settings page', () => {
  const { registered } = mountBundle();
  const seat = registered.find((entry) => entry.spec.name === 'conversation.input.model');
  // A single seat renders its lowest priority, and the shipped model trigger
  // registers without one (priority 0), so the row has to sit below it.
  assert.equal(seat.spec.priority, -1000);
  assert.equal(seat.component.name, 'ControlRow');
  const face = seat.spec.inject('session-1');
  assert.equal(typeof face.directory.subscribe, 'function');
  assert.equal(typeof face.directory.getSnapshot, 'function');
  assert.equal(typeof face.select, 'function');
  assert.equal(typeof face.settingsForm.set, 'function');
  face.load();

  const section = registered.find((entry) => entry.spec.name === 'settings.section');
  assert.equal(section.spec.id, 'model-selector');
  assert.equal(section.spec.order, 12);
  assert.equal(section.spec.label(), 'settings.title');
  assert.equal(section.component.name, 'SettingsSection');
  assert.deepEqual(Object.keys(section.spec.inject()), ['settingsForm', 'modelCatalog']);

  // The row no longer hangs below the composer on the dock line: the buttons
  // belong beside submit, inside the seat itself.
  assert.ok(!registered.some((entry) => entry.spec.name === 'conversation.composer.dock'));
});

test('reads the configured models from the Host catalog', async () => {
  const { registered, subscribed } = mountBundle();
  for (const name of ['plugins.row.config', 'plugins.bundle.config', 'settings.section']) {
    const entry = registered.find((candidate) => candidate.spec.name === name);
    const face = entry.spec.inject();
    assert.deepEqual(Object.keys(face), ['settingsForm', 'modelCatalog']);
    assert.deepEqual(await face.modelCatalog.load(), { ok: true, value: { groups: catalog } });
  }
  // The page keeps up with every Host event that can move the model list.
  const stop = registered[0].spec.inject().modelCatalog.subscribe(() => {});
  assert.deepEqual(subscribed, [
    'llm/adapters-updated', 'settings/document-updated', 'credentials/record-updated', 'credentials/reference-updated',
  ]);
  assert.equal(typeof stop, 'function');
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

test('renders the shortcut pickers out of the configured catalog', async () => {
  const page = statefulReact();
  const { registered } = mountBundle(page.react);
  const section = registered.find((entry) => entry.spec.name === 'settings.section');
  page.start(section.component, { t: (key) => key, ...section.spec.inject() });
  await page.settle();

  // Both dropdowns are the shell's own menu, never the browser's dropdown box.
  const menus = () => page.nodes.filter((node) => node.props.className === 'stub-menu');
  const offered = (menu) => menu.props.items.map((item) => [item.id, item.label]);
  assert.ok(!page.nodes.some((node) => node.type === 'select'));
  assert.equal(menus().length, 2);
  // The configured pair survives even though the catalog retired it, and both
  // configured providers stay on offer.
  assert.deepEqual(offered(menus()[0]), [
    ['', 'settings.pickProvider'],
    ['provider-a', 'Provider A'],
    ['provider-b', 'Provider B'],
  ]);
  assert.deepEqual(offered(menus()[1]), [
    ['model-retired', 'model-retiredsettings.unavailable'],
    ['model-1', 'Model One'],
    ['model-2', 'Model Two'],
  ]);
  assert.equal(menus()[0].props.selectedId, 'provider-a');
  assert.equal(menus()[1].props.selectedId, 'model-retired');
  // A loaded catalog explains nothing; the alias stays a text field.
  assert.ok(!page.nodes.some((node) => node.props.className === 'modelSelectorNotice'));
  const alias = page.nodes.find((node) => node.type === 'label' && node.props.className === 'modelSelectorField');
  assert.equal(alias.children[0].children[0], 'field.alias');
  assert.equal(alias.children[1].type, 'input');

  // Adding a row seeds a pair the catalog actually offers, holding back only the
  // pairs the other rows already took.
  const add = page.nodes.find((node) => node.type === 'button' && node.children[0] === 'settings.add');
  add.props.onClick();
  page.step();
  assert.equal(menus().length, 4);
  assert.equal(menus()[2].props.selectedId, 'provider-a');
  assert.equal(menus()[3].props.selectedId, 'model-1');
});

/**
 * Run a test body against a minimal document, which the portaled menu and the
 * key listener reach for the way a browser would.
 *
 * @param body - the test body to run.
 * @returns the body's promise.
 */
async function withDocument(body) {
  const original = globalThis.document;
  globalThis.document = { body: {}, addEventListener: () => {}, removeEventListener: () => {} };
  try {
    return await body();
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
}

test('dresses the composer row in the shell’s own controls', () => withDocument(async () => {
  const page = statefulReact();
  const material = primitivesStub(page.react);
  const { registered } = mountBundle(page.react, material.module);
  const seat = registered.find((entry) => entry.spec.name === 'conversation.input.model');
  page.start(seat.component, { t: (key) => key, ...seat.spec.inject('session-1') });
  await page.settle();

  // The reasoning picker is a menu, not the browser's dropdown box, and its
  // dismissal belongs to the native hook from the first render on.
  const reasoning = page.nodes.find((node) => node.props.className === 'stub-menu');
  assert.deepEqual(reasoning.props.items, [
    { id: '', label: 'effort.providerDefault' },
    { id: 'low', label: 'Low' },
  ]);
  assert.ok(!page.nodes.some((node) => node.type === 'select'));
  assert.equal(material.calls.dismiss.at(-1).open, false);

  const trigger = page.nodes.find((node) => node.type === 'button' && node.props['aria-haspopup'] === 'dialog');
  assert.equal(trigger.props.className, 'modelSelectorChip');
  trigger.props.onClick();
  page.step();

  assert.equal(material.calls.dismiss.at(-1).open, true);
  const surface = page.nodes.find((node) => node.props.className === 'modelSelectorMenu');
  assert.equal(surface.type, 'div');
  // Provider names come from the native group, so they are styled apart from the
  // model names inside them.
  assert.deepEqual(
    page.nodes.filter((node) => node.props.className === 'stub-group').map((node) => node.props.label),
    ['Provider A'],
  );
  assert.equal(page.nodes.find((node) => node.props.className === 'modelSelectorSearch').props.type, 'search');
  assert.equal(material.calls.sticky.length, 1);
  // A typed query brings the native clear affordance back, and clearing it puts
  // the search box back to its plain shape.
  const search = () => page.nodes.find((node) => node.type === 'input' && String(node.props.className).startsWith('modelSelectorSearch'));
  search().props.onChange({ target: { value: 'one' } });
  page.step();
  assert.equal(search().props.className, 'modelSelectorSearch modelSelectorSearchWithQuery');
  const clear = page.nodes.find((node) => node.props.className === 'modelSelectorSearchClear');
  assert.equal(clear.props['aria-label'], 'menu.clear');
  clear.props.onClick();
  page.step();
  assert.equal(search().props.value, '');
  assert.ok(!page.nodes.some((node) => node.props.className === 'modelSelectorSearchClear'));
  // The platform hook dismisses the menu, so it needs no close button.
  assert.ok(!page.nodes.some((node) => (node.children ?? []).includes('menu.close')));
}));
