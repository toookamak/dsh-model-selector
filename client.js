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
     * Plugin entry
     * ------------------------------------------------------------------ */

    const inject = ['slots', 'locale', 'configForms'];

    /**
     * Mount the settings page while the Host serves this bundle's namespace.
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
      ctx.inject(['slots', 'configForms'], (scope) => {
        const form = scope.configForms.get(CONFIG_NAMESPACE);
        scope.effect(() => scope.configForms.whileServed([CONFIG_NAMESPACE], () => scope.slots.inject('plugins.item', () => scope.slots.register({
          name: 'plugins.item',
          id: CONFIG_NAMESPACE,
          order: 50,
          label: () => t('settings.title'),
          locale: NS,
          inject: () => ({ settingsForm: form }),
        }, SettingsPage))), 'model-selector: settings page');
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__internals = { modelKey, validateShortcuts, persistShortcuts, shortcutRows, zh, en };
    return module.exports;
  },
});
