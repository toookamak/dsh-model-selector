/**
 * Model selector, browser half.
 *
 * Served as a standalone module-loader bundle: the factory receives only the
 * baseline `require`, and there is no build step, so the pure shortcut rules
 * that `shortcut-config.js` exports are mirrored here for the page to use.
 * Keep both copies in step; `tests/client-bundle.test.js` compares them.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-model-selector',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const react = require('react');

    /** Dictionary namespace this plugin owns. */
    const NS = 'modelSelector';
    /** Host configForms namespace, identical to the patch row id. */
    const CONFIG_NAMESPACE = 'model-selector';
    /** Package name, also the `data-plugin` stamp of this plugin's style tag. */
    const PLUGIN_ID = '@local/dsh-model-selector';
    /** The settings page never offers a fourth shortcut. */
    const MAX_SHORTCUTS = 3;
    /** Host events that can move the list of configured models. */
    const CATALOG_EVENTS = [
      'llm/adapters-updated',
      'settings/document-updated',
      'credentials/record-updated',
      'credentials/reference-updated',
    ];

    /* ------------------------------------------------------------------ *
     * Pure shortcut rules (mirror of shortcut-config.js)
     * ------------------------------------------------------------------ */

    function modelKey(provider, model) {
      return JSON.stringify([provider, model]);
    }

    function validateShortcuts(shortcuts) {
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

    // Writability lives on the snapshot the Host mirrors, not on the form
    // object: the live `configForms` form offers only getSnapshot/subscribe/
    // set/unset/mutate. A bare `writable` flag still counts, so a lightweight
    // stand-in keeps working.
    function formWritable(form) {
      let snapshot;
      try {
        snapshot = typeof form?.getSnapshot === 'function' ? form.getSnapshot() : undefined;
      } catch {
        return false;
      }
      if (snapshot !== undefined && typeof snapshot.writable === 'boolean') return snapshot.writable;
      return form?.writable === true;
    }

    async function persistShortcuts(form, draft) {
      const error = validateShortcuts(draft);
      if (error) return { ok: false, error };
      if (!formWritable(form)) return { ok: false, error: 'Configuration is read-only.' };
      const saved = await form.set('shortcuts', draft);
      return saved
        ? { ok: true }
        : { ok: false, error: 'The host rejected the configuration.' };
    }

    /**
     * Keep the configured shortcuts whose models the directory still offers.
     *
     * A configured model that is currently unavailable keeps its configuration
     * but loses its button, and the surviving buttons keep the configured order.
     *
     * @param shortcuts - the configured shortcut rows.
     * @param groups - the directory's provider groups.
     * @returns one entry per visible shortcut, aliases already resolved.
     */
    function visibleShortcuts(shortcuts, groups) {
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

    /**
     * Build the two pickers' choices for one shortcut row from the live catalog
     * (mirror of `shortcutChoices` in shortcut-config.js).
     *
     * The settings page never asks for a provider or a model ID by hand: the
     * choices come from the same catalog the composer menu reads, so a saved
     * shortcut always has a button to show. Models another row already holds are
     * left out of this row's choices, which is what keeps the duplicate rule from
     * only firing on Save; the row's own pair survives even when the catalog no
     * longer advertises it, so an unavailable shortcut can still be read and
     * removed instead of being silently rewritten.
     *
     * @param groups - the catalog's provider groups, in catalog order.
     * @param rows - every draft row, in page order.
     * @param index - the row these choices are for.
     * @returns the offered providers (each with its selectable models), the row's
     *   normalized provider, and that provider's models.
     */
    function shortcutChoices(groups, rows, index) {
      const row = (rows ?? [])[index] ?? {};
      const provider = typeof row.provider === 'string' ? row.provider.trim() : '';
      const model = typeof row.model === 'string' ? row.model.trim() : '';
      const taken = new Set();
      (rows ?? []).forEach((item, at) => {
        if (at === index) return;
        const held = typeof item?.provider === 'string' ? item.provider.trim() : '';
        const heldModel = typeof item?.model === 'string' ? item.model.trim() : '';
        if (held && heldModel) taken.add(modelKey(held, heldModel));
      });
      const providers = [];
      for (const group of groups ?? []) {
        const own = group.id === provider;
        const models = [];
        for (const entry of group.models ?? []) {
          if (taken.has(modelKey(group.id, entry.id))) continue;
          models.push({ id: entry.id, name: entry.name ?? entry.id, unavailable: false });
        }
        // A provider whose every model is already held offers nothing; only the
        // row that points at it keeps it, so its configured value stays readable.
        if (models.length === 0 && !own) continue;
        if (own && model && !models.some((entry) => entry.id === model)) {
          models.unshift({ id: model, name: model, unavailable: true });
        }
        providers.push({ id: group.id, name: group.name ?? group.id, models });
      }
      if (provider && !providers.some((entry) => entry.id === provider)) {
        providers.unshift({
          id: provider,
          name: provider,
          models: model ? [{ id: model, name: model, unavailable: true }] : [],
        });
      }
      const selected = providers.find((entry) => entry.id === provider);
      return { providers, provider, models: selected === undefined ? [] : selected.models };
    }

    /**
     * Find the configured shortcut the current selection is showing.
     *
     * Only the provider/model pair decides the match: the reasoning effort is an
     * independent choice and never makes a shortcut stop being the active one.
     *
     * @param shortcuts - the configured shortcut rows.
     * @param current - the directory's current selection, if any.
     * @returns the matching configured row, or undefined when none matches.
     */
    function activeShortcut(shortcuts, current) {
      if (current?.provider === undefined || current?.model === undefined) return undefined;
      return (shortcuts ?? []).find(
        (item) => item.provider === current.provider && item.model === current.model,
      );
    }

    /**
     * List the reasoning efforts a model advertises, in the directory's order.
     *
     * A model that says nothing about reasoning gets no control at all. When the
     * directory does not name a default effort, the list opens with the provider
     * default, marked by an empty id so the UI can localize its label.
     *
     * @param model - the directory entry of one model.
     * @returns the options to render, never the caller's own arrays.
     */
    function reasoningOptions(model) {
      const reasoning = model?.reasoning;
      if (!reasoning || !Array.isArray(reasoning.efforts)) return [];
      const options = reasoning.efforts.map((effort) => ({ id: effort.id, name: effort.name }));
      if (reasoning.defaultEffort === undefined) options.unshift({ id: '', name: '' });
      return options;
    }

    /**
     * Read the Host-accepted shortcut rows out of a configuration snapshot.
     *
     * @param value - the snapshot's accepted value.
     * @returns one editable row per configured shortcut.
     */
    function shortcutRows(value) {
      const rows = value?.shortcuts;
      if (!Array.isArray(rows)) return [];
      return rows.map((row) => ({
        provider: typeof row?.provider === 'string' ? row.provider : '',
        model: typeof row?.model === 'string' ? row.model : '',
        alias: typeof row?.alias === 'string' ? row.alias : '',
      }));
    }

    /** Map the helper's canonical failures onto this plugin's dictionary. */
    const ERROR_KEYS = {
      'Shortcuts must be an array.': 'error.array',
      'At most three shortcuts are allowed.': 'error.limit',
      'A provider ID is required.': 'error.provider',
      'A model ID is required.': 'error.model',
      'Duplicate provider/model pairs are not allowed.': 'error.duplicate',
      'Configuration is read-only.': 'error.readOnly',
      'The host rejected the configuration.': 'error.rejected',
    };

    function errorText(t, error) {
      return t(ERROR_KEYS[error] ?? 'error.rejected');
    }

    /* ------------------------------------------------------------------ *
     * Copy
     * ------------------------------------------------------------------ */

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'meta.title': '模型选择器',
      'meta.description': '在对话输入框右下角提供推理等级、快捷模型与完整模型菜单。',
      'settings.title': '模型选择器',
      'settings.summary': '配置输入框右下角的快捷模型按钮（最多三个）。',
      'settings.intro': '快捷模型按钮显示在输入框右下角的模型按钮旁；别名为空时使用模型原名。',
      'settings.empty': '尚未配置快捷模型。',
      'settings.add': '添加快捷模型',
      'settings.remove': '删除',
      'settings.save': '保存',
      'settings.saving': '保存中…',
      'settings.saved': '已保存。',
      'settings.discard': '撤销修改',
      'settings.readOnly': '本部署的设置为只读。',
      'settings.pickProvider': '选择服务商…',
      'settings.pickModel': '选择模型…',
      'settings.unavailable': '（不可用）',
      'settings.catalogLoading': '正在读取已配置的模型…',
      'settings.catalogFailed': '无法读取已配置的模型：',
      'settings.catalogRetry': '重试',
      'settings.catalogEmpty': '还没有已配置的模型，请先在「模型」设置里添加服务商。',
      'field.provider': '服务商',
      'field.model': '模型',
      'field.alias': '显示名称（可选）',
      'control.reasoning': '推理等级',
      'control.modelMenu': '选择模型',
      'effort.providerDefault': '默认',
      'menu.search': '搜索模型',
      'menu.empty': '当前没有可用的模型。',
      'menu.noResults': '没有匹配的模型。',
      'menu.loading': '正在加载模型…',
      'menu.selecting': '正在切换…',
      'menu.failed': '切换失败：',
      'menu.close': '关闭',
      'error.array': '配置格式不正确。',
      'error.limit': '最多只能配置三个快捷模型。',
      'error.provider': '请选择服务商。',
      'error.model': '请选择模型。',
      'error.duplicate': '同一个模型不能重复配置。',
      'error.readOnly': '本部署的设置为只读。',
      'error.rejected': '本部署没有接受这些值，已保留供你修改。',
    };

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      'meta.title': 'Model selector',
      'meta.description': 'Reasoning effort, shortcut models, and the full model menu in the composer’s right corner.',
      'settings.title': 'Model selector',
      'settings.summary': 'Configure the shortcut model buttons in the composer’s right corner (up to three).',
      'settings.intro': 'Shortcuts sit in the composer’s right corner beside the model button, in this order; an empty alias falls back to the model name.',
      'settings.empty': 'No shortcut models configured yet.',
      'settings.add': 'Add shortcut',
      'settings.remove': 'Remove',
      'settings.save': 'Save',
      'settings.saving': 'Saving…',
      'settings.saved': 'Saved.',
      'settings.discard': 'Discard changes',
      'settings.readOnly': 'This deployment’s settings are read-only.',
      'settings.pickProvider': 'Choose a provider…',
      'settings.pickModel': 'Choose a model…',
      'settings.unavailable': ' (unavailable)',
      'settings.catalogLoading': 'Reading the configured models…',
      'settings.catalogFailed': 'Could not read the configured models: ',
      'settings.catalogRetry': 'Retry',
      'settings.catalogEmpty': 'No models are configured yet; add a provider under Models first.',
      'field.provider': 'Provider',
      'field.model': 'Model',
      'field.alias': 'Display name (optional)',
      'control.reasoning': 'Reasoning effort',
      'control.modelMenu': 'Choose a model',
      'effort.providerDefault': 'Default',
      'menu.search': 'Search models',
      'menu.empty': 'No models are available.',
      'menu.noResults': 'No models match.',
      'menu.loading': 'Loading models…',
      'menu.selecting': 'Switching…',
      'menu.failed': 'Could not switch: ',
      'menu.close': 'Close',
      'error.array': 'The configuration has the wrong shape.',
      'error.limit': 'At most three shortcut models are allowed.',
      'error.provider': 'A provider ID is required.',
      'error.model': 'A model ID is required.',
      'error.duplicate': 'The same model cannot be configured twice.',
      'error.readOnly': 'This deployment’s settings are read-only.',
      'error.rejected': 'This deployment did not accept these values; they are kept for you to edit.',
    };

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    const CSS = `
.modelSelectorSection{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary)}
.modelSelectorHeading{margin:0;font-size:15px;font-weight:600;line-height:22px}
.modelSelectorPage{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.modelSelectorIntro,.modelSelectorEmpty,.modelSelectorNotice{margin:0}
.modelSelectorIntro{color:var(--dsw-alias-label-secondary)}
.modelSelectorEmpty{color:var(--dsw-alias-label-tertiary)}
.modelSelectorRow{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.modelSelectorField{display:flex;flex:1 1 150px;flex-direction:column;gap:4px;min-width:150px}
.modelSelectorWide{flex:1 1 220px;min-width:220px}
.modelSelectorLabel{color:var(--dsw-alias-label-secondary);font-size:12px}
.modelSelectorInput{box-sizing:border-box;width:100%;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:inherit;font:inherit}
.modelSelectorInput:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.modelSelectorInput:disabled{opacity:.6}
.modelSelectorActions{display:flex;flex-wrap:wrap;gap:8px}
.modelSelectorButton{font:inherit;padding:5px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.modelSelectorButton:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.modelSelectorButton:disabled{opacity:.5;cursor:default}
.modelSelectorPrimary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.modelSelectorError{color:var(--dsw-alias-state-error-primary)}
.modelSelectorControls{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0;font-size:12px}
.modelSelectorEffort{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary)}
.modelSelectorSelect{font:inherit;font-size:12px;padding:3px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.modelSelectorSelect:disabled{opacity:.5}
.modelSelectorShortcutActive{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.modelSelectorMenuWrap{position:relative}
.modelSelectorMenu{position:absolute;right:0;bottom:calc(100% + 6px);z-index:20;display:flex;flex-direction:column;gap:6px;box-sizing:border-box;width:260px;max-height:320px;overflow:auto;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(0,0,0,.18)}
.modelSelectorMenuHead{display:flex;gap:6px;align-items:center}
.modelSelectorGroup{display:flex;flex-direction:column;gap:2px}
.modelSelectorGroupName{margin:2px 0;color:var(--dsw-alias-label-secondary);font-size:11px}
.modelSelectorItem{font:inherit;font-size:12px;text-align:left;padding:4px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
.modelSelectorItem:hover{background:var(--dsw-alias-bg-layer-2)}
.modelSelectorItemActive{color:var(--dsw-alias-brand-primary)}
`;

    /* ------------------------------------------------------------------ *
     * Settings page (Plugins page entry)
     * ------------------------------------------------------------------ */

    /**
     * One labelled text input of the settings form.
     *
     * @param t - the page's locale reader.
     * @param labelKey - dictionary key of the field label.
     * @param value - the draft value.
     * @param disabled - whether the Host accepts writes at all.
     * @param onChange - receives the edited text.
     * @returns the field element.
     */
    function field(t, labelKey, value, disabled, onChange) {
      return react.createElement('label', { className: 'modelSelectorField', key: labelKey },
        react.createElement('span', { className: 'modelSelectorLabel' }, t(labelKey)),
        react.createElement('input', {
          className: 'modelSelectorInput',
          type: 'text',
          value,
          disabled,
          onChange: (event) => onChange(event.target.value),
        }),
      );
    }

    /**
     * One labelled dropdown of the settings form.
     *
     * @param t - the page's locale reader.
     * @param labelKey - dictionary key of the field label.
     * @param value - the selected option value.
     * @param disabled - whether the field accepts input.
     * @param options - the selectable options, in render order.
     * @param onChange - receives the picked value.
     * @returns the field element.
     */
    function selectField(t, labelKey, value, disabled, options, onChange) {
      return react.createElement('label', { className: 'modelSelectorField modelSelectorWide', key: labelKey },
        react.createElement('span', { className: 'modelSelectorLabel' }, t(labelKey)),
        react.createElement('select', {
          className: 'modelSelectorInput',
          value,
          disabled,
          'aria-label': t(labelKey),
          onChange: (event) => onChange(event.target.value),
        }, options.map((option) => react.createElement('option', {
          key: option.value === '' ? 'empty' : option.value,
          value: option.value,
        }, option.label))),
      );
    }

    /**
     * The editable shortcut list.
     *
     * Every row picks its provider and model out of the live catalog instead of
     * accepting free text, so a saved pair is always a pair the composer can
     * render; a pair the catalog no longer offers stays in the list, marked
     * unavailable, so it can be removed deliberately.
     *
     * @param props - the locale reader, the config form, its snapshot, and the
     *   configured-model reader.
     * @returns the settings form.
     */
    function ShortcutSettingsForm(props) {
      const { t, form, snapshot, modelCatalog } = props;
      const writable = snapshot.writable === true;
      const [draft, setDraft] = react.useState(() => shortcutRows(snapshot.value));
      const [notice, setNotice] = react.useState();
      const [busy, setBusy] = react.useState(false);
      const catalog = useModelGroups(modelCatalog);
      const groups = catalog.groups;

      // Follow the Host-accepted value whenever it changes; local edits stay
      // local until Save, so a rejected draft is never silently overwritten.
      react.useEffect(() => {
        setDraft(shortcutRows(snapshot.value));
      }, [snapshot.revision]);

      const update = (index, field_, value) => {
        setDraft((rows) => rows.map((row, at) => (at === index ? { ...row, [field_]: value } : row)));
      };
      // A provider always brings one of its models with it, so the second
      // dropdown never points at a model that belongs to another provider.
      const pickProvider = (index, provider) => {
        setDraft((rows) => rows.map((row, at) => {
          if (at !== index) return row;
          const choice = shortcutChoices(groups, rows, at).providers.find((entry) => entry.id === provider);
          const model = choice === undefined || choice.models.length === 0 ? '' : choice.models[0].id;
          return { ...row, provider, model };
        }));
      };
      const addRow = () => {
        setDraft((rows) => {
          if (rows.length >= MAX_SHORTCUTS) return rows;
          const choice = shortcutChoices(groups, rows, rows.length).providers[0];
          return [...rows, {
            provider: choice === undefined ? '' : choice.id,
            model: choice === undefined || choice.models.length === 0 ? '' : choice.models[0].id,
            alias: '',
          }];
        });
      };
      const removeRow = (index) => {
        setDraft((rows) => rows.filter((_, at) => at !== index));
      };
      const discard = () => {
        setDraft(shortcutRows(snapshot.value));
        setNotice(undefined);
      };
      const save = async () => {
        setBusy(true);
        let result;
        try {
          result = await persistShortcuts(form, draft);
        } catch {
          result = { ok: false, error: 'The host rejected the configuration.' };
        }
        setBusy(false);
        setNotice(result.ok
          ? { tone: 'success', text: t('settings.saved') }
          : { tone: 'error', text: errorText(t, result.error) });
      };

      const rows = draft.map((row, index) => {
        const choice = shortcutChoices(groups, draft, index);
        const known = choice.models.some((entry) => entry.id === row.model);
        const noProvider = choice.provider === '';
        const providerOptions = [{ value: '', label: t('settings.pickProvider') }].concat(
          choice.providers.map((entry) => ({ value: entry.id, label: entry.name })),
        );
        const modelOptions = (known ? [] : [{ value: '', label: t('settings.pickModel') }]).concat(
          choice.models.map((entry) => ({
            value: entry.id,
            label: entry.unavailable ? `${entry.name}${t('settings.unavailable')}` : entry.name,
          })),
        );
        return react.createElement('div', { className: 'modelSelectorRow', key: `row-${index}` },
          selectField(t, 'field.provider', noProvider ? '' : choice.provider, !writable, providerOptions, (value) => pickProvider(index, value)),
          selectField(t, 'field.model', known ? row.model : '', !writable || noProvider, modelOptions, (value) => update(index, 'model', value)),
          field(t, 'field.alias', row.alias, !writable, (value) => update(index, 'alias', value)),
          react.createElement('button', {
            type: 'button',
            className: 'modelSelectorButton',
            disabled: !writable,
            onClick: () => removeRow(index),
          }, t('settings.remove')),
        );
      });

      return react.createElement('div', { className: 'modelSelectorPage' },
        react.createElement('p', { className: 'modelSelectorIntro' }, t('settings.intro')),
        catalogNotice(t, catalog),
        rows.length > 0 ? rows : react.createElement('p', { className: 'modelSelectorEmpty' }, t('settings.empty')),
        react.createElement('div', { className: 'modelSelectorActions' },
          react.createElement('button', {
            type: 'button',
            className: 'modelSelectorButton',
            disabled: !writable || draft.length >= MAX_SHORTCUTS,
            onClick: addRow,
          }, t('settings.add')),
          react.createElement('button', {
            type: 'button',
            className: 'modelSelectorButton modelSelectorPrimary',
            disabled: !writable || busy,
            onClick: save,
          }, busy ? t('settings.saving') : t('settings.save')),
          react.createElement('button', {
            type: 'button',
            className: 'modelSelectorButton',
            disabled: busy,
            onClick: discard,
          }, t('settings.discard')),
        ),
        writable ? null : react.createElement('p', { className: 'modelSelectorNotice', role: 'status' }, t('settings.readOnly')),
        notice === undefined ? null : react.createElement('p', {
          className: notice.tone === 'error' ? 'modelSelectorNotice modelSelectorError' : 'modelSelectorNotice',
          role: 'status',
        }, notice.text),
      );
    }

    /**
     * Follow one configuration form's accepted snapshots.
     *
     * @param form - the Host-backed configuration form.
     * @returns the latest snapshot.
     */
    function useFormSnapshot(form) {
      const subscribe = react.useCallback((notify) => form.subscribe(notify), [form]);
      const getSnapshot = react.useCallback(() => form.getSnapshot(), [form]);
      return react.useSyncExternalStore(subscribe, getSnapshot);
    }

    /**
     * Follow the Host's configured-model catalog.
     *
     * The settings page offers the very models the composer menu shows, so a
     * saved shortcut is always renderable; the catalog is re-read whenever the
     * Host reports that providers, credentials, or settings moved.
     *
     * @param modelCatalog - the catalog reader: `load()` and `subscribe(notify)`.
     * @returns the current provider groups, the load status, and a reload.
     */
    function useModelGroups(modelCatalog) {
      const [state, setState] = react.useState({ status: 'loading', groups: [], error: undefined });
      // The slot hands in a fresh reader object on every render, so the effect
      // below must not depend on its identity: call through the ref instead.
      const catalogRef = react.useRef(modelCatalog);
      catalogRef.current = modelCatalog;
      const load = react.useCallback(() => {
        setState((current) => ({ ...current, status: 'loading', error: undefined }));
        let answer;
        try {
          answer = Promise.resolve(catalogRef.current.load());
        } catch (error) {
          answer = Promise.reject(error);
        }
        answer.then((response) => {
          if (response === undefined || response === null || response.ok !== true) {
            const failure = response === undefined || response === null ? undefined : response.error;
            setState({ status: 'error', groups: [], error: failure === undefined ? '' : `${failure.code}: ${failure.message}` });
            return;
          }
          setState({ status: 'ready', groups: response.value?.groups ?? [], error: undefined });
        }).catch((error) => {
          setState({ status: 'error', groups: [], error: String(error?.message ?? error) });
        });
      }, []);
      react.useEffect(() => {
        load();
        const stop = catalogRef.current.subscribe(load);
        return typeof stop === 'function' ? stop : undefined;
      }, [load]);
      return { status: state.status, groups: state.groups, error: state.error, reload: load };
    }

    /**
     * The catalog's load state, as the line of the settings page that explains
     * why the dropdowns are empty.
     *
     * @param t - the page's locale reader.
     * @param catalog - the current catalog state, including its reload.
     * @returns the notice, or nothing once the catalog has groups.
     */
    function catalogNotice(t, catalog) {
      if (catalog.status === 'error') {
        return react.createElement('div', { className: 'modelSelectorActions' },
          react.createElement('p', { className: 'modelSelectorNotice modelSelectorError', role: 'alert' },
            `${t('settings.catalogFailed')}${catalog.error ?? ''}`),
          react.createElement('button', { type: 'button', className: 'modelSelectorButton', onClick: catalog.reload },
            t('settings.catalogRetry')),
        );
      }
      if (catalog.status === 'loading' && catalog.groups.length === 0) {
        return react.createElement('p', { className: 'modelSelectorNotice', role: 'status' }, t('settings.catalogLoading'));
      }
      if (catalog.groups.length === 0) {
        return react.createElement('p', { className: 'modelSelectorNotice', role: 'status' }, t('settings.catalogEmpty'));
      }
      return null;
    }

    /**
     * The Plugins page entry: a one-liner in the card list, the form once opened.
     *
     * @param props - the asked-for view, the slot's locale reader, the form, and
     *   the configured-model reader.
     * @returns the summary line or the settings form.
     */
    function SettingsPage(props) {
      const t = props.t;
      const form = props.settingsForm;
      const modelCatalog = props.modelCatalog;
      const snapshot = useFormSnapshot(form);
      if (props.view === 'summary') return t('settings.summary');
      return react.createElement(ShortcutSettingsForm, { t, form, snapshot, modelCatalog });
    }

    /**
     * The Settings panel's own page for the same configuration.
     *
     * The panel renders the section and no heading of its own, so this page
     * supplies the title and then the very form the Plugins page shows: one
     * configuration, two doors, no second copy of the state.
     *
     * @param props - the slot's locale reader, the shortcut configuration form,
     *   and the configured-model reader.
     * @returns the settings section page.
     */
    function SettingsSection(props) {
      const t = props.t;
      const form = props.settingsForm;
      const modelCatalog = props.modelCatalog;
      const snapshot = useFormSnapshot(form);
      return react.createElement('div', { className: 'modelSelectorSection' },
        react.createElement('h2', { className: 'modelSelectorHeading' }, t('settings.title')),
        react.createElement(ShortcutSettingsForm, { t, form, snapshot, modelCatalog }),
      );
    }

    /* ------------------------------------------------------------------ *
     * Composer controls
     * ------------------------------------------------------------------ */

    /**
     * Find one model's directory entry by the directory's current selection.
     *
     * @param groups - the directory's provider groups.
     * @param current - the directory's current selection, if any.
     * @returns the matching model entry, or undefined.
     */
    function findModel(groups, current) {
      if (current === undefined || current === null) return undefined;
      for (const group of groups ?? []) {
        if (group.id !== current.provider) continue;
        for (const model of group.models ?? []) {
          if (model.id === current.model) return model;
        }
      }
      return undefined;
    }

    /**
     * Match one model against the menu's local search text.
     *
     * @param model - the directory entry of one model.
     * @param needle - the lowercased search text, empty for no filter.
     * @returns whether the model belongs in the filtered menu.
     */
    function matchesQuery(model, needle) {
      if (!needle) return true;
      return `${model.name ?? ''} ${model.id ?? ''}`.toLowerCase().includes(needle);
    }

    /**
     * The reasoning-effort picker, hidden for models without reasoning metadata.
     *
     * @param props - the locale reader, the model's options, the effective value,
     *   whether the directory is busy, and the pick handler.
     * @returns the picker element, or nothing when the model advertises nothing.
     */
    function ReasoningPicker(props) {
      const { t, options, value, disabled, onChange } = props;
      if (options.length === 0) return null;
      return react.createElement('label', { className: 'modelSelectorEffort' },
        react.createElement('span', { className: 'modelSelectorLabel' }, t('control.reasoning')),
        react.createElement('select', {
          className: 'modelSelectorSelect',
          value: value ?? '',
          disabled,
          'aria-label': t('control.reasoning'),
          onChange: (event) => onChange(event.target.value),
        }, options.map((option) => react.createElement('option', {
          key: option.id === '' ? 'provider-default' : option.id,
          value: option.id,
        }, option.id === '' ? t('effort.providerDefault') : option.name))),
      );
    }

    /**
     * The full model menu: every provider group the directory advertises, with a
     * local search box. Every pick goes through the shared directory selection.
     *
     * @param props - the locale reader, the groups, the current selection, the
     *   search text and its setter, the pick handler, and the close handler.
     * @returns the menu panel.
     */
    function ModelMenu(props) {
      const { t, groups, current, query, onQuery, onPick, onClose } = props;
      const needle = query.trim().toLowerCase();
      const sections = [];
      for (const group of groups) {
        const models = (group.models ?? []).filter(
          (model) => matchesQuery(model, needle) || (group.name ?? '').toLowerCase().includes(needle),
        );
        if (models.length === 0) continue;
        sections.push(react.createElement('div', { className: 'modelSelectorGroup', key: group.id },
          react.createElement('p', { className: 'modelSelectorGroupName' }, group.name),
          models.map((model) => {
            const active = group.id === current?.provider && model.id === current?.model;
            return react.createElement('button', {
              type: 'button',
              key: model.id,
              className: active ? 'modelSelectorItem modelSelectorItemActive' : 'modelSelectorItem',
              'aria-current': active ? 'true' : undefined,
              onClick: () => onPick({ provider: group.id, model: model.id }),
            }, model.name);
          }),
        ));
      }
      return react.createElement('div', {
        className: 'modelSelectorMenu',
        role: 'dialog',
        'aria-label': t('control.modelMenu'),
      },
      react.createElement('div', { className: 'modelSelectorMenuHead' },
        react.createElement('input', {
          className: 'modelSelectorInput',
          type: 'search',
          value: query,
          placeholder: t('menu.search'),
          'aria-label': t('menu.search'),
          autoFocus: true,
          onChange: (event) => onQuery(event.target.value),
        }),
        react.createElement('button', { type: 'button', className: 'modelSelectorButton', onClick: onClose }, t('menu.close')),
      ),
      sections.length > 0
        ? sections
        : react.createElement('p', { className: 'modelSelectorEmpty' }, needle ? t('menu.noResults') : t('menu.empty')),
      );
    }

    /**
     * The composer's model seat: reasoning effort, the shortcuts, the menu.
     *
     * The seat is the one the shipped model trigger occupied, so the row sits in
     * the composer's right corner beside submit. Everything rendered here is read
     * back from the shared directory store, so a rejected switch shows the
     * failure instead of a selection that never landed.
     *
     * @param props - the locale reader, the directory store and its operations,
     *   the shortcut configuration form, and the seat's own lock state.
     * @returns the control row.
     */
    function ControlRow(props) {
      const { t, directory, load, select, settingsForm, locked } = props;
      const subscribe = react.useCallback((notify) => directory.subscribe(notify), [directory]);
      const getSnapshot = react.useCallback(() => directory.getSnapshot(), [directory]);
      const state = react.useSyncExternalStore(subscribe, getSnapshot);
      const formSubscribe = react.useCallback((notify) => settingsForm.subscribe(notify), [settingsForm]);
      const getFormSnapshot = react.useCallback(() => settingsForm.getSnapshot(), [settingsForm]);
      const formSnapshot = react.useSyncExternalStore(formSubscribe, getFormSnapshot);
      const [open, setOpen] = react.useState(false);
      const [query, setQuery] = react.useState('');
      const [failure, setFailure] = react.useState(undefined);

      // Load the shared catalog once per mount, through the latest operation.
      const loadRef = react.useRef(load);
      loadRef.current = load;
      react.useEffect(() => {
        loadRef.current();
      }, []);
      react.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          setOpen(false);
          setQuery('');
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [open]);

      const shortcuts = Array.isArray(formSnapshot.value?.shortcuts) ? formSnapshot.value.shortcuts : [];
      const groups = Array.isArray(state.groups) ? state.groups : [];
      const currentModel = findModel(groups, state.current);
      const options = reasoningOptions(currentModel);
      const effort = state.current?.reasoningEffort ?? currentModel?.reasoning?.defaultEffort;
      const busy = state.status === 'selecting';
      // A locked composer refuses every interaction of its own, so the seat it
      // hosts must refuse with it rather than stay a live control in a frozen
      // card.
      const blocked = busy || locked === true;
      const loading = state.status === 'loading' || (state.status === 'idle' && groups.length === 0);
      const active = activeShortcut(shortcuts, state.current);
      const activeKey = active === undefined ? undefined : modelKey(active.provider, active.model);
      const visible = visibleShortcuts(shortcuts, groups).slice(0, MAX_SHORTCUTS);
      const currentName = currentModel?.name ?? state.current?.model ?? '';
      const notice = failure ?? (state.status === 'error' ? state.error : undefined);

      const change = async (selection) => {
        setFailure(undefined);
        let result;
        try {
          result = await select(selection);
        } catch (error) {
          result = { ok: false, error: { code: 'selection-failed', message: String(error?.message ?? error) } };
        }
        if (result !== undefined && result !== null && result.ok === false) {
          setFailure(`${t('menu.failed')}${result.error?.message ?? ''}`);
          return false;
        }
        return true;
      };
      const pick = async (selection) => {
        setOpen(false);
        setQuery('');
        if (selection.provider === state.current?.provider && selection.model === state.current?.model) return;
        await change(selection);
      };

      return react.createElement('div', { className: 'modelSelectorControls' },
        react.createElement(ReasoningPicker, {
          t,
          options,
          value: effort,
          disabled: blocked,
          onChange: (id) => change({
            provider: state.current.provider,
            model: state.current.model,
            ...(id === '' ? {} : { reasoningEffort: id }),
          }),
        }),
        visible.map((item) => react.createElement('button', {
          type: 'button',
          key: item.key,
          className: item.key === activeKey ? 'modelSelectorButton modelSelectorShortcutActive' : 'modelSelectorButton',
          disabled: blocked,
          title: item.modelName,
          onClick: () => change({ provider: item.provider, model: item.model }),
        }, item.label)),
        react.createElement('div', { className: 'modelSelectorMenuWrap' },
          react.createElement('button', {
            type: 'button',
            className: 'modelSelectorButton',
            disabled: blocked,
            'aria-haspopup': 'dialog',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => {
              setOpen((was) => !was);
              setQuery('');
            },
          }, currentName || t('control.modelMenu')),
          open ? react.createElement(ModelMenu, {
            t,
            groups,
            current: state.current,
            query,
            onQuery: setQuery,
            onPick: pick,
            onClose: () => {
              setOpen(false);
              setQuery('');
            },
          }) : null,
        ),
        loading ? react.createElement('p', { className: 'modelSelectorNotice', role: 'status' }, t('menu.loading')) : null,
        busy ? react.createElement('p', { className: 'modelSelectorNotice', role: 'status' }, t('menu.selecting')) : null,
        notice === undefined || notice === null || notice === ''
          ? null
          : react.createElement('p', { className: 'modelSelectorNotice modelSelectorError', role: 'status' }, notice),
      );
    }

    /* ------------------------------------------------------------------ *
     * Plugin entry
     * ------------------------------------------------------------------ */

    const inject = ['slots', 'locale', 'remote', 'remote.session', 'configForms', 'modelDirectories'];

    /**
     * Mount the settings page and the composer controls.
     *
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-selector: dictionaries');
      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = PLUGIN_ID;
        tag.textContent = CSS;
        document.head.append(tag);
        return () => tag.remove();
      }, 'model-selector: style');
      ctx.inject(['slots', 'remote', 'remote.session', 'configForms', 'modelDirectories'], (scope) => {
        const form = scope.configForms.get(CONFIG_NAMESPACE);
        const directories = scope.modelDirectories;

        // The settings page offers the configured models and nothing else, and it
        // must offer them without a session: the catalog behind `remote.session`
        // is the Host generation's one list, shared by every session, which is
        // exactly the list the composer menu shows. Every Host event that can
        // move that list re-reads it, so an open page keeps up.
        const catalog = {
          load: () => scope.remote.session.modelCatalog(),
          subscribe: (notify) => {
            const on = scope.remote.$on;
            if (typeof on !== 'function') return undefined;
            const stops = CATALOG_EVENTS.map((event) => on.call(scope.remote, event, notify));
            return () => { for (const stop of stops) if (typeof stop === 'function') stop(); };
          },
        };

        // `plugins.item` only lists the official Host-plane plugins, so a profile
        // bundle's own settings belong in the two bundle seats instead: the row's
        // page (keyed by `<package name>#<row id>`), which is what puts a
        // Configure control on the row, and the bundle page itself, keyed by the
        // package name and rendered between its description and its rows.
        scope.effect(() => scope.slots.inject('plugins.row.config', () => scope.slots.register({
          name: 'plugins.row.config',
          key: `${PLUGIN_ID}#${CONFIG_NAMESPACE}`,
          locale: NS,
          inject: () => ({ settingsForm: form, modelCatalog: catalog }),
        }, SettingsPage)), 'model-selector: row configuration page');
        scope.effect(() => scope.slots.inject('plugins.bundle.config', () => scope.slots.register({
          name: 'plugins.bundle.config',
          key: PLUGIN_ID,
          locale: NS,
          inject: () => ({ settingsForm: form, modelCatalog: catalog }),
        }, SettingsPage)), 'model-selector: bundle configuration page');

        // The settings panel's own page, for the same shortcut list. The panel
        // projects one nav row per registration and renders the chosen section
        // inside its content column, so this page reads as a top-level settings
        // entry ("Settings → the plugin's title") instead of a nested card.
        scope.effect(() => scope.slots.inject('settings.section', () => scope.slots.register({
          name: 'settings.section',
          id: CONFIG_NAMESPACE,
          order: 12,
          label: () => t('settings.title'),
          locale: NS,
          inject: () => ({ settingsForm: form, modelCatalog: catalog }),
        }, SettingsSection)), 'model-selector: settings page');

        // The composer's own model seat, where the shipped model trigger sits:
        // the right corner of the control row, immediately left of submit. One
        // registration per session, bound to that session's shared directory.
        // A single slot renders its lowest priority, and the shipped
        // `ModelSelect` registers without one (priority 0), so this row takes
        // the seat. Evidence from the live slot tree on this machine: the
        // occupants of `conversation.input.model` were `-10` (active) and `0`
        // (inactive), which is why a lower value wins. Verify after install that
        // this registration is the active one; if that tree ever reports the
        // opposite, raise this value above the shipped registration instead.
        scope.effect(() => scope.slots.inject('conversation.input.model', () => scope.slots.register({
          name: 'conversation.input.model',
          priority: -1000,
          locale: NS,
          inject: (sessionId) => {
            const directory = directories.directoryFor(sessionId);
            return {
              t,
              directory: directory.store,
              load: () => {
                directory.load().catch(() => {});
              },
              select: (selection) => directory.select(selection),
              settingsForm: form,
            };
          },
        }, ControlRow)), 'model-selector: composer model seat');
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__internals = {
      modelKey,
      validateShortcuts,
      persistShortcuts,
      visibleShortcuts,
      activeShortcut,
      reasoningOptions,
      shortcutRows,
      shortcutChoices,
      zh,
      en,
    };
    return module.exports;
  },
});
