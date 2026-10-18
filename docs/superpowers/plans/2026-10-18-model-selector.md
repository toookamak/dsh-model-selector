# DSH 对话框模型快捷切换插件实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可安装的 DSH Web 插件，在 composer 卡片下方显示推理等级、最多三个快捷模型和完整模型选择器，并在 Plugins 设置页配置快捷模型。

**Architecture:** 以独立 Cordis bundle 扩展 DSH，不修改核心模型逻辑。Host `Config` 和 `configForms` 保存快捷模型；Client 复用 `@deepseek-ai/dsh-client-ui-model-selection` 的会话级 `ModelDirectory`，以 `conversation.composer.dock` 承载控制行，并用高优先级空组件隐藏 composer 原生单模型插槽，避免重复菜单。设置页挂载到 `plugins.item`，仅在 Host 提供 `model-selector` 配置时显示。

**Tech Stack:** ESM JavaScript、DSH Cordis bundle / Client module loader、React 18（由宿主提供）、`@deepseek-ai/schemastery` `~3.18.5`、Node 内置 `node:test`；不引入运行时 UI 组件库或构建依赖。

---

## 代码结构与边界

- 创建 `package.json`：bundle、Client 入口、资源 exports、`dsh.client.inject` 依赖声明。
- 创建 `cordis.patch.yml`：插入唯一 Host 行 `model-selector`，配置初始值 `{}`。
- 创建 `index.js`：定义 Host `Config` schema；关闭重复的自动配置页。
- 创建 `client.js`：一个可直接由 DSH 模块加载器执行的 Client bundle；包含设置页、composer 控制行、目录绑定及视图逻辑，不跨包导入 DSH 私有 React 组件。
- 创建 `locale/en.json`、`locale/zh.json`、`icon.svg`：插件展示元数据、全部 UI 文案及原创图标。
- 创建 `tests/shortcut-config.test.js`：使用 Node 内置测试覆盖纯配置/目录映射逻辑。
- 新插件 ID：`@local/dsh-model-selector`；Host 配置行 ID / `configForms` namespace：`model-selector`。

## Task 1：先测试快捷配置与目录映射规则

**Files:**
- Create: `tests/shortcut-config.test.js`
- Create: `shortcut-config.js`
- Create: `package.json`

- [ ] **Step 1：编写失败测试**

使用 `node:test` 写入以下测试。它们固定最多三个、provider/model 组合唯一、别名回退、不可用模型隐藏、设置顺序保持等业务规则：

```js
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
```

- [ ] **Step 2：确认测试失败**

Run: `node --test tests/shortcut-config.test.js`  
Expected: FAIL，因为 `shortcut-config.js` 尚不存在。

- [ ] **Step 3：实现纯 helper**

创建 `shortcut-config.js`：

```js
export const MAX_SHORTCUTS = 3;

export function modelKey(provider, model) {
  return JSON.stringify([provider, model]);
}

export function validateShortcuts(shortcuts) {
  if (!Array.isArray(shortcuts)) return 'Shortcuts must be an array.';
  if (shortcuts.length > MAX_SHORTCUTS) return 'At most three shortcuts are allowed.';
  const seen = new Set();
  for (const item of shortcuts) {
    if (typeof item?.provider !== 'string' || !item.provider.trim()) return 'A provider ID is required.';
    if (typeof item?.model !== 'string' || !item.model.trim()) return 'A model ID is required.';
    const key = modelKey(item.provider.trim(), item.model.trim());
    if (seen.has(key)) return 'Duplicate provider/model pairs are not allowed.';
    seen.add(key);
  }
  return undefined;
}

export function visibleShortcuts(shortcuts, groups) {
  const models = new Map();
  for (const group of groups ?? []) {
    for (const model of group.models ?? []) {
      models.set(modelKey(group.id, model.id), model);
    }
  }
  return (shortcuts ?? []).flatMap((item) => {
    const key = modelKey(item.provider, item.model);
    const model = models.get(key);
    return model ? [{
      key,
      provider: item.provider,
      model: item.model,
      label: item.alias?.trim() || model.name,
      modelName: model.name,
    }] : [];
  });
}
```

在根 `package.json` 声明 `"type":"module"` 和 `"scripts":{"test":"node --test tests"}`；不安装测试框架。

- [ ] **Step 4：运行测试**

Run: `node --test tests/shortcut-config.test.js`  
Expected: 3 tests PASS。

- [ ] **Step 5：提交**

```powershell
git add package.json shortcut-config.js tests/shortcut-config.test.js
git commit -m "test: define model shortcut configuration rules"
```

## Task 2：建立可安装 bundle 与 Host 配置 schema

**Files:**
- Modify: `package.json`
- Create: `cordis.patch.yml`
- Create: `index.js`
- Create: `tests/package-manifest.test.js`

- [ ] **Step 1：先测试 package 与 Host 配置约定**

新增 Node 测试读取 `package.json`，验证包名、ESM、Host/Client exports、Web 立即加载和必要的 Client 注入依赖；通过 `JSON.parse` 保证 manifest 可解析。测试还要验证 `cordis.patch.yml` 含唯一 `id: model-selector` 和 `name: '@local/dsh-model-selector'`，不依赖额外 YAML parser。

- [ ] **Step 2：确认测试失败**

Run: `node --test tests/package-manifest.test.js`  
Expected: FAIL，因为 bundle 文件尚不存在。

- [ ] **Step 3：实现 bundle、Host schema 和关闭自动页**

`package.json` 使用 decoration bundle 的 ESM 结构；`dsh.client.inject` 至少按此顺序声明本插件直接使用的提供方：`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-ui-plugin-manager`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-model-selection`。配置表 schema 用已核实的 `@deepseek-ai/schemastery` API：

```js
import z from '@deepseek-ai/schemastery';

const Shortcut = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  alias: z.string().default(''),
});

export const Config = z.object({
  shortcuts: z.array(Shortcut).max(3).default([]),
});

export function apply(ctx) {
  ctx.inject(['settings'], (scope) => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber));
  });
}
```

`package.json` 使用 Cordis decoration 模板的精确字段：

```json
{
  "name": "@local/dsh-model-selector",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-plugin-manager",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-model-selection"
      ]
    }
  },
  "dependencies": { "@deepseek-ai/schemastery": "~3.18.5" },
  "scripts": { "test": "node --test tests" }
}
```

`cordis.patch.yml` 插入唯一 Host 行：

```yaml
- insert:
    - id: model-selector
      name: '@local/dsh-model-selector'
      config: {}
```

`files` 清单必须包含每个运行文件与资源。`auto:false` 避免自动 schema 表单与下一个 Task 的自定义 Plugins 页重复。

- [ ] **Step 4：验证本地结构**

Run: `node --test tests/package-manifest.test.js`  
Expected: manifest tests PASS。随后安装前用 Host `Config.listConfigs` 查询 `model-selector`，Expected: schema 的 `shortcuts` 是最多 3 项的 provider/model/alias 数组，默认空数组。

- [ ] **Step 5：提交**

```powershell
git add package.json cordis.patch.yml index.js tests/package-manifest.test.js
git commit -m "feat: add model selector bundle config"
```

## Task 3：实现 Plugins 设置页和持久化编辑

**Files:**
- Modify: `client.js`
- Modify: `locale/en.json`
- Create: `locale/zh.json`
- Modify: `tests/shortcut-config.test.js`

- [ ] **Step 1：补充设置表单测试**

验证保存入口使用同一个 `validateShortcuts`，无效草稿不会调用 `form.set`；合法草稿只调用一次 `form.set('shortcuts', draft)`；返回 `false` 时显示保存失败、保留草稿。

- [ ] **Step 2：确认测试失败**

Run: `node --test tests/shortcut-config.test.js`  
Expected: 新增的设置保存测试 FAIL。

- [ ] **Step 3：注册 `plugins.item` 页面**

`client.js` 按模板用 `window.__ModuleLoader__.load({ id, factory(require) { ... } })`，从 `require('react')` 取得 React；Host 配置的 entry ID 是 `model-selector`。在 `apply(ctx)` 中取得 `ctx.configForms.get('model-selector')`，使用 `ctx.configForms.whileServed(['model-selector'], ...)` 限定页面生命周期，并注册到已核实的 `plugins.item` Slot：

```js
scope.configForms.whileServed(['model-selector'], () =>
  scope.slots.inject('plugins.item', () => scope.slots.register({
    name: 'plugins.item',
    id: 'model-selector',
    order: 50,
    label: () => t('settings.title'),
    locale: NS,
    inject: () => ({ settingsForm: form }),
  }, SettingsPage)),
);
```

`SettingsPage` 根据 `view === 'summary'` 返回一行说明；`view === 'page'` 渲染不超过 3 组输入字段（provider ID、model ID、可选别名）及添加、删除、保存、撤销控件。避免与 `plugins.item` 自带的 `form` prop 冲突，注入对象命名为 `settingsForm`。用稳定的订阅 wrapper 调用 `React.useSyncExternalStore((notify) => settingsForm.subscribe(notify), () => settingsForm.getSnapshot())`，不要把原型方法未绑定地直接传给 React；以 snapshot 中 Host 接受的配置初始化/同步草稿，本地编辑不提前写入。

将保存流程提取到纯 helper 并以 Node 测试：

```js
export async function persistShortcuts(form, draft) {
  const error = validateShortcuts(draft);
  if (error) return { ok: false, error };
  if (!form.writable) return { ok: false, error: 'Configuration is read-only.' };
  const saved = await form.set('shortcuts', draft);
  return saved
    ? { ok: true }
    : { ok: false, error: 'The host rejected the configuration.' };
}
```

`SettingsPage` 调用 helper；只有 `ok` 为 true 才显示保存成功，拒绝时显示错误并保留草稿。配置以 provider ID + model ID 精确对应模型；不可用的 ID 仍可保存，后续仅影响快捷按钮显隐。

所有按钮、输入标签、错误文案和摘要通过 `locale/en.json` / `locale/zh.json` 注册到 `NS = 'modelSelector'`；不从其它 Harness UI 包导入表单组件。

- [ ] **Step 4：验证设置逻辑**

Run: `node --test tests/shortcut-config.test.js`  
Expected: 新增测试 PASS。实现后再用 Cordis Inspect 验证 `plugins.item` live 树有 `id: model-selector`，且 Host 未提供该配置时页面不注册。

- [ ] **Step 5：提交**

```powershell
git add client.js locale/en.json locale/zh.json tests/shortcut-config.test.js
git commit -m "feat: add shortcut settings page"
```

## Task 4：绑定共享目录并实现 composer 控制行

**Files:**
- Modify: `client.js`
- Modify: `shortcut-config.js`
- Modify: `tests/shortcut-config.test.js`

- [ ] **Step 1：先写状态映射和交互测试**

在 `shortcut-config.js` 增加 `activeShortcut(shortcuts, current)`，以 provider/model 精确匹配，缺少 current 时返回 `undefined`；增加 `reasoningOptions(model)`，无 `model.reasoning` 时返回空数组，有元数据时返回原生 `efforts`，且仅在 `defaultEffort === undefined` 时在首位加入 `{ id: '' }`（文案由 UI 的 `effort.providerDefault` 本地化）。先写失败测试，覆盖快捷项匹配/列表外不高亮、按目录存在性过滤、无推理元数据时隐藏，以及原生档位和 provider default 显示规则。

- [ ] **Step 2：确认测试失败**

Run: `node --test tests/shortcut-config.test.js`  
Expected: 新增状态映射测试 FAIL。

- [ ] **Step 3：接入当前 DSH Slot 与 `ModelDirectory`**

使用 Client 依赖 `@deepseek-ai/dsh-client-ui-model-selection`，在 `ctx.inject(['slots','locale','configForms','modelDirectories'], ...)` 中进行 slot 注册。`conversation.input.model` 是单组件插槽：当前 live 树同时列出 `installDirectorySlots`（priority `-10`，`active: true`）与 `Kb`（priority `0`，`active: false`），说明单插槽按 priority 升序取首个（数值越小越优先）。因此注册空组件时必须取更小的值，例如 `priority: -1000`，让原生模型组件不再渲染、避免重复菜单；安装后必须用 live 树确认本插件 occupant 为 active、原生 occupant 变为 inactive，若语义相反则改用更大的正值并在注释中记录实测结论。将完整插件控制行放在 `conversation.composer.dock`（其 live 目的为 composer 卡片下方，列表型、可追加、无 replace risk），条目 id 使用 `model-selector-controls`、order 为 `5`。两项注册都经 `ctx.slots.inject`，由 Cordis effect 自动清理。

`conversation.composer.dock` 的会话注入按官方同包做法解析 `scope.modelDirectories.directoryFor(sessionId)`，组件订阅 `directory.store` 的 `subscribe/getSnapshot`，首次挂载调用 `directory.load()`。所有模型变化都从 store 的 `current` 读取；不得从按钮点击乐观推断成功。快捷项通过 `visibleShortcuts(config.shortcuts, state.groups)` 映射，点击调用 `directory.select({ provider, model })`，不传快捷配置中的 reasoning；选择失败时读取返回的失败结果并显示消息，仍以 store 实际状态渲染。

`ControlRow` 以一条可换行 flex 行按顺序渲染推理等级、快捷按钮、模型菜单。快捷按钮使用 alias 或模型原名；高亮由 `activeShortcut` 的 provider/model 精确匹配结果决定。当前模型元数据从 `state.groups` 中按 `state.current` 的 provider/model 查找；用 `reasoningOptions(currentModel)` 渲染下拉，已生效值为 `state.current?.reasoningEffort ?? currentModel?.reasoning?.defaultEffort`。若没有 reasoning 元数据，隐藏该控件；当等级选择器列出 provider default 项时，选择该项调用 `directory.select({ provider: current.provider, model: current.model })`，选择其他项才附加 `reasoningEffort`。切换快捷模型仅调用 `directory.select({ provider, model })`，让宿主对目标模型应用其默认推理等级。完整菜单显示全部 provider 分组和全部可用模型，菜单内有本地搜索框，允许选择任意项，仍经同一 `directory.select()` 提交。快捷按钮、菜单和等级控件均以目录状态为准；菜单标签始终展示当前模型名。

- [ ] **Step 4：实现并验证状态映射**

Run: `node --test tests/shortcut-config.test.js`  
Expected: 所有配置和状态映射测试 PASS。使用 Cordis Inspect 确认原生 `conversation.input.model` 被本插件高优先级贡献覆盖、composer dock 新增一项；卸载插件后确认宿主原贡献恢复。

- [ ] **Step 5：提交**

```powershell
git add client.js shortcut-config.js tests/shortcut-config.test.js
git commit -m "feat: add shared model selector controls"
```

## Task 5：完成状态、样式、展示资源与包检查

**Files:**
- Modify: `client.js`
- Modify: `locale/en.json`
- Modify: `locale/zh.json`
- Create: `icon.svg`
- Modify: `package.json`
- Create: `tests/package-manifest.test.js`

- [ ] **Step 1：补充显示与异常测试**

先给纯 helper 增加失败测试：空 groups 下 `visibleShortcuts` 返回空数组；设置无效和只读时不调用 `form.set`；Host 拒绝保存时 `persistShortcuts` 返回失败；快捷配置输入不会被 helper 修改。目录加载失败、模型切换失败的 React 消息和无障碍呈现列为最终 GUI 手工验收，不声称 Node 单测可覆盖这些渲染行为。

- [ ] **Step 2：确认回归测试失败**

Run: `node --test tests`  
Expected: 新增用例在 UI/状态处理尚未实现时失败，或明确记录需集成测试覆盖的浏览器行为。

- [ ] **Step 3：实现主题和资源**

容器及按钮使用 `--dsw-alias-*` 主题 token、局部 class 前缀 `modelSelector` 和窄宽度 `flex-wrap`；模型菜单支持 Escape 关闭、搜索结果、空目录/无结果提示、等待/失败反馈。`locale/en.json` 和 `locale/zh.json` 都包含 `meta.title`、`meta.description`、设置页及 composer 控件文案。`icon.svg` 使用原创 SVG，manifest 的 `files` 明确列入每个运行文件与资源。

- [ ] **Step 4：运行本地验证**

Run: `node --test tests`  
Expected: 所有 Node 测试 PASS。用 Node 检查 JSON：`node -e "for (const f of ['package.json','locale/en.json','locale/zh.json']) JSON.parse(require('node:fs').readFileSync(f,'utf8')); console.log('JSON OK')"`，Expected: `JSON OK`。检查 `icon.svg` 可解析、`files` 清单包含 `index.js`、`client.js`、`cordis.patch.yml`、两个 locale 和 `icon.svg`；不创建独立 HTML mock 或第二个 Harness server。

- [ ] **Step 5：提交**

```powershell
git add client.js locale/en.json locale/zh.json icon.svg package.json tests
git commit -m "feat: polish model selector plugin"
```

## Task 6：安装到目标 DSH 并逐项验收

**Files:**
- Verify: bundle package in the current worktree
- Verify: live Cordis Slot tree and the DSH Web GUI

- [ ] **Step 1：安装前静态检查**

Run: `node --check index.js`、`node --check client.js`、`node --test tests`。Expected: 语法检查和测试全部 PASS。通过 `plugin_manager.install_bundle` 使用当前工作树的绝对路径安装；只在工具回报 pending build scripts 时另行取得明确批准，禁止绕过 plugin manager 手工改 profile 文件。

- [ ] **Step 2：确认运行时贡献**

使用 `cordis_inspect_query` 读取 `conversation.composer.dock`、`conversation.input.model`、`plugins.item`；Expected：新 dock 控件、原模型 slot 被高优先级接管、插件设置页存在。检查 `Config.listConfigs` 中 `model-selector` schema 为最多三个条目。

- [ ] **Step 3：在现有 Web GUI 验收**

刷新当前 DSH Web GUI 后验证：设置页可保存/撤销并跨刷新保留；配置顺序和别名正确；不可用模型配置保留但不显示；快捷按钮及完整菜单能切换任意模型；菜单选中快捷模型时同步高亮；列表外模型有名称且不误高亮；reasoning 选项与当前模型一致，不支持时隐藏；失败不改变真实状态；窄窗口换行且顺序不变。安装/slot 注册不能代替视觉验收。

- [ ] **Step 4：提交验收修复**

若有失败，只在同一插件内修复后重复对应测试和验收；确认全部通过后提交：

```powershell
git add package.json cordis.patch.yml index.js client.js shortcut-config.js locale icon.svg tests
git commit -m "test: verify model selector in dsh"
```

## 规格覆盖自检

- 最多三模型、顺序、别名、重复拒绝、保存即时更新、不可用项保留：Task 1、2、3、5。
- 推理等级独立、原生选项、不支持时隐藏：Task 4、6。
- 原菜单任意选择、当前名称、快捷高亮与失败状态：Task 4、6。
- 原生模型 slot 接管风险、原目录与选择逻辑复用、窄窗换行：Task 4、6。
- 插件设置入口、持久化和元数据/图标：Task 2、3、5。
- 非目标（修改核心逻辑、增加模型/推理服务、每模型保存等级、超过三键）：本计划均不包含。
