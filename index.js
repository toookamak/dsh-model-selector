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
