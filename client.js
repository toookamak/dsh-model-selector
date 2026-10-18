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

    async function persistShortcuts(form, draft) {
      const error = validateShortcuts(draft);
      if (error) return { ok: false, error };
      if (!form.writable) return { ok: false, error: 'Configuration is read-only.' };
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
      'meta.description': '在对话输入框下方提供推理等级、快捷模型与完整模型菜单。',
      'settings.title': '模型选择器',
      'settings.summary': '配置对话输入框下方的快捷模型按钮（最多三个）。',
      'settings.intro': '快捷模型按此处顺序显示在输入框下方；别名为空时使用模型原名。',
      'settings.empty': '尚未配置快捷模型。',
      'settings.add': '添加快捷模型',
      'settings.remove': '删除',
      'settings.save': '保存',
      'settings.saving': '保存中…',
      'settings.saved': '已保存。',
      'settings.discard': '撤销修改',
      'settings.readOnly': '本部署的设置为只读。',
      'field.provider': 'Provider ID',
      'field.model': 'Model ID',
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
      'error.provider': '请填写 Provider ID。',
      'error.model': '请填写 Model ID。',
      'error.duplicate': '同一个模型不能重复配置。',
      'error.readOnly': '本部署的设置为只读。',
      'error.rejected': '本部署没有接受这些值，已保留供你修改。',
    };

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      'meta.title': 'Model selector',
      'meta.description': 'Reasoning effort, shortcut models, and the full model menu below the composer.',
      'settings.title': 'Model selector',
      'settings.summary': 'Configure the shortcut model buttons below the composer (up to three).',
      'settings.intro': 'Shortcuts appear below the composer in this order; an empty alias falls back to the model name.',
      'settings.empty': 'No shortcut models configured yet.',
      'settings.add': 'Add shortcut',
      'settings.remove': 'Remove',
      'settings.save': 'Save',
      'settings.saving': 'Saving…',
      'settings.saved': 'Saved.',
      'settings.discard': 'Discard changes',
      'settings.readOnly': 'This deployment’s settings are read-only.',
      'field.provider': 'Provider ID',
      'field.model': 'Model ID',
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
.modelSelectorPage{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.modelSelectorIntro,.modelSelectorEmpty,.modelSelectorNotice{margin:0}
.modelSelectorIntro{color:var(--dsw-alias-label-secondary)}
.modelSelectorEmpty{color:var(--dsw-alias-label-tertiary)}
.modelSelectorRow{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.modelSelectorField{display:flex;flex:1 1 150px;flex-direction:column;gap:4px;min-width:150px}
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
.modelSelectorControls{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px}
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
     * The editable shortcut list.
     *
     * @param props - the locale reader, the config form, and its snapshot.
     * @returns the settings form.
     */
    function ShortcutSettingsForm(props) {
      const { t, form, snapshot } = props;
      const writable = snapshot.writable === true;
      const [draft, setDraft] = react.useState(() => shortcutRows(snapshot.value));
      const [notice, setNotice] = react.useState();
      const [busy, setBusy] = react.useState(false);

      // Follow the Host-accepted value whenever it changes; local edits stay
      // local until Save, so a rejected draft is never silently overwritten.
      react.useEffect(() => {
        setDraft(shortcutRows(snapshot.value));
      }, [snapshot.revision]);

      const update = (index, field_, value) => {
        setDraft((rows) => rows.map((row, at) => (at === index ? { ...row, [field_]: value } : row)));
      };
      const addRow = () => {
        setDraft((rows) => (rows.length >= MAX_SHORTCUTS ? rows : [...rows, { provider: '', model: '', alias: '' }]));
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

      const rows = draft.map((row, index) => react.createElement('div', { className: 'modelSelectorRow', key: `row-${index}` },
        field(t, 'field.provider', row.provider, !writable, (value) => update(index, 'provider', value)),
        field(t, 'field.model', row.model, !writable, (value) => update(index, 'model', value)),
        field(t, 'field.alias', row.alias, !writable, (value) => update(index, 'alias', value)),
        react.createElement('button', {
          type: 'button',
          className: 'modelSelectorButton',
          disabled: !writable,
          onClick: () => removeRow(index),
        }, t('settings.remove')),
      ));

      return react.createElement('div', { className: 'modelSelectorPage' },
        react.createElement('p', { className: 'modelSelectorIntro' }, t('settings.intro')),
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
     * The Plugins page entry: a one-liner in the card list, the form once opened.
     *
     * @param props - the asked-for view, the slot's locale reader, and the form.
     * @returns the summary line or the settings form.
     */
    function SettingsPage(props) {
      const t = props.t;
      const form = props.settingsForm;
      const subscribe = react.useCallback((notify) => form.subscribe(notify), [form]);
      const getSnapshot = react.useCallback(() => form.getSnapshot(), [form]);
      const snapshot = react.useSyncExternalStore(subscribe, getSnapshot);
      if (props.view === 'summary') return t('settings.summary');
      return react.createElement(ShortcutSettingsForm, { t, form, snapshot });
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
     * The composer row: reasoning effort, the configured shortcuts, the menu.
     *
     * Everything rendered here is read back from the shared directory store, so a
     * rejected switch shows the failure instead of a selection that never landed.
     *
     * @param props - the locale reader, the directory store and its operations,
     *   and the shortcut configuration form.
     * @returns the control row.
     */
    function ControlRow(props) {
      const { t, directory, load, select, settingsForm } = props;
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
          disabled: busy,
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
          disabled: busy,
          title: item.modelName,
          onClick: () => change({ provider: item.provider, model: item.model }),
        }, item.label)),
        react.createElement('div', { className: 'modelSelectorMenuWrap' },
          react.createElement('button', {
            type: 'button',
            className: 'modelSelectorButton',
            disabled: busy,
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

    /**
     * The empty stand-in that takes over the shipped model seat.
     *
     * This plugin's composer row owns the model menu now, so the seat inside the
     * composer renders nothing. A single slot renders the lowest priority, and
     * the shipped `ModelSelect` registers without one (priority 0), so this empty
     * registration sits far below it. Evidence from the live slot tree on this
     * machine: the occupants of `conversation.input.model` were `-10` (active)
     * and `0` (inactive), which is why a lower value wins. Verify after install
     * that this registration is the active one; if that tree ever reports the
     * opposite, raise this value above the shipped registration instead.
     *
     * @returns nothing at all.
     */
    function ModelSelectShadow() {
      return null;
    }

    /* ------------------------------------------------------------------ *
     * Plugin entry
     * ------------------------------------------------------------------ */

    const inject = ['slots', 'locale', 'configForms', 'modelDirectories'];

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
      ctx.inject(['slots', 'configForms', 'modelDirectories'], (scope) => {
        const form = scope.configForms.get(CONFIG_NAMESPACE);
        const directories = scope.modelDirectories;

        // `plugins.item` only lists the official Host-plane plugins, so a profile
        // bundle's own settings belong in the two bundle seats instead: the row's
        // page (keyed by `<package name>#<row id>`), which is what puts a
        // Configure control on the row, and the bundle page itself, keyed by the
        // package name and rendered between its description and its rows.
        scope.effect(() => scope.slots.inject('plugins.row.config', () => scope.slots.register({
          name: 'plugins.row.config',
          key: `${PLUGIN_ID}#${CONFIG_NAMESPACE}`,
          locale: NS,
          inject: () => ({ settingsForm: form }),
        }, SettingsPage)), 'model-selector: row configuration page');
        scope.effect(() => scope.slots.inject('plugins.bundle.config', () => scope.slots.register({
          name: 'plugins.bundle.config',
          key: PLUGIN_ID,
          locale: NS,
          inject: () => ({ settingsForm: form }),
        }, SettingsPage)), 'model-selector: bundle configuration page');

        // The composer row, bound to one session's shared model directory.
        scope.effect(() => scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
          name: 'conversation.composer.dock',
          id: 'model-selector-controls',
          order: 5,
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
        }, ControlRow)), 'model-selector: composer controls');

        // Take over the shipped seat, so the model menu exists exactly once.
        scope.effect(() => scope.slots.inject('conversation.input.model', () => scope.slots.register({
          name: 'conversation.input.model',
          priority: -1000,
          locale: NS,
        }, ModelSelectShadow)), 'model-selector: empty model seat');
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
      zh,
      en,
    };
    return module.exports;
  },
});
