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

/**
 * Find the configured shortcut that the current selection is showing.
 *
 * Only the provider/model pair decides the match: the reasoning effort is an
 * independent choice and never makes a shortcut stop being the active one.
 *
 * @param shortcuts - the configured shortcut rows.
 * @param current - the directory's current selection, if any.
 * @returns the matching configured row, or undefined when none matches.
 */
export function activeShortcut(shortcuts, current) {
  if (current?.provider === undefined || current?.model === undefined) return undefined;
  return (shortcuts ?? []).find(
    (item) => item.provider === current.provider && item.model === current.model,
  );
}

/**
 * List the reasoning efforts a model advertises, in the directory's own order.
 *
 * A model that says nothing about reasoning gets no control at all. When the
 * directory does not name a default effort, the list opens with the provider
 * default, marked by an empty id so the UI can localize its label.
 *
 * @param model - the directory entry of one model.
 * @returns the options to render, never the caller's own arrays.
 */
export function reasoningOptions(model) {
  const reasoning = model?.reasoning;
  if (!reasoning || !Array.isArray(reasoning.efforts)) return [];
  const options = reasoning.efforts.map((effort) => ({ id: effort.id, name: effort.name }));
  if (reasoning.defaultEffort === undefined) options.unshift({ id: '', name: '' });
  return options;
}

/**
 * Read whether the configuration form accepts writes right now.
 *
 * The live `configForms` form carries writability on its snapshot
 * (`{ status, value, base, user, revision, writable }`); the form object itself
 * exposes only `getSnapshot`, `subscribe`, `set`, `unset`, and `mutate`. A
 * lightweight stand-in may still hand the flag over directly, so both shapes
 * are accepted and neither is guessed at when the snapshot is silent.
 *
 * @param form - the configuration form, or a test stand-in for one.
 * @returns whether a write would be submitted to the Host.
 */
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

/**
 * Save one shortcut draft through the Host-backed configuration form.
 *
 * The draft is validated with the same rules the settings page enforces, and it
 * is never written before the Host answers: a rejected write keeps the draft in
 * the caller's hands so the user can correct it.
 *
 * @param form - the `model-selector` configuration form.
 * @param draft - the shortcut rows the user edited.
 * @returns whether the Host accepted the draft, or the reason it did not.
 */
export async function persistShortcuts(form, draft) {
  const error = validateShortcuts(draft);
  if (error) return { ok: false, error };
  if (!formWritable(form)) return { ok: false, error: 'Configuration is read-only.' };
  const saved = await form.set('shortcuts', draft);
  return saved
    ? { ok: true }
    : { ok: false, error: 'The host rejected the configuration.' };
}
