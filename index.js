import z from '@deepseek-ai/schemastery';

const Shortcut = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  alias: z.string().default(''),
});

export const Config = z.object({
  // Volatile makes the field editable from the settings form: the settings
  // service only exposes fields beneath a declared volatile node and refuses
  // every other write path (`volatileForm`/`isVolatilePath` in
  // @deepseek-ai/dsh-settings).
  shortcuts: z.array(Shortcut).max(3).default([]).volatile(),
});

export function apply(ctx) {
  ctx.inject(['settings'], (scope) => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber));
  });
}
