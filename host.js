/**
 * Caveman CN — Host half.
 *
 * Ports the `caveman-cn` skill (https://github.com/bbylw/caveman-cn, a Chinese
 * localization of JuliusBrussee/caveman) into the DeepSeek Harness: the agent
 * answers in terse caveman prose — or classical Chinese — while keeping every
 * technical detail exact.
 *
 * Three things are model-facing, and all three read one source of truth:
 *
 * 1. `ctx.sessionProjections` unit `caveman` — the level is folded from events
 *    that already exist in the Session log (`command/run`/`command/done` for
 *    `/caveman <level>` and `tool/call`/`tool/result` for the `caveman` tool).
 *    Nothing new is appended, so resume, fork and replay restore the level, and
 *    the Client reads the same value as a `wire.view` instead of guessing.
 * 2. `ctx.systemPrompt.section()` — while a level is active, one section
 *    carries that level's compression rules.
 * 3. The `caveman` tool and the `/caveman` command — one operation, two
 *    callers: the model switching style on its own, and the user (or the Web UI
 *    control) typing the command.
 *
 * The Client half (`client.js`) renders the level control in the composer dock
 * and writes through `remote.commands.execute(sessionId, '/caveman <level>')`;
 * it never holds state of its own.
 *
 * @module @local/dsh-caveman
 */

/** Cordis plugin name. */
export const name = 'caveman-cn';

/** Required services: the projection table and the prompt registry. */
export const inject = ['systemPrompt', 'sessionProjections'];

/** Every accepted level, weakest to strongest (mirrors the caveman-cn README). */
const LEVELS = ['off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-ultra'];

/** Level applied to a Session before any switch is logged. */
const DEFAULT_LEVEL = 'full';

/** The projection key the Client reads through `useProjection('caveman')`. */
const PROJECTION_KEY = 'caveman';

/** Prompt section name. */
const SECTION_NAME = 'caveman:policy';

/**
 * Section position. The repository order table allocates PLAN_POLICY at 500 and
 * TEAM_POLICY at 600, so 550 lands this mode policy beside the other
 * collaboration policies and before every tool section.
 */
const SECTION_ORDER = 550;

/** Command name (typed as `/caveman <level>`). */
const COMMAND_NAME = 'caveman';

/** Tool name the model calls to switch the level itself. */
const TOOL_NAME = 'caveman';

/**
 * Human spellings accepted in addition to the canonical ids, so `/caveman 文言文`
 * and `/caveman 关闭` work for the localized audience.
 */
const LEVEL_ALIASES = {
  normal: 'off',
  off: 'off',
  关闭: 'off',
  正常: 'off',
  lite: 'lite',
  轻量: 'lite',
  轻量级: 'lite',
  full: 'full',
  完整: 'full',
  ultra: 'ultra',
  极限: 'ultra',
  'wenyan-lite': 'wenyan-lite',
  半文言: 'wenyan-lite',
  wenyan: 'wenyan',
  文言: 'wenyan',
  文言文: 'wenyan',
  'wenyan-ultra': 'wenyan-ultra',
  极端文言: 'wenyan-ultra',
};

/**
 * A Zod-shaped pass-through schema. The projection registry only ever calls
 * `.parse(value)` on unit schemas, and this plugin owns no dependency on a
 * schema library, so the unit's values are validated by construction instead.
 */
const PASS_THROUGH_SCHEMA = {
  parse: (value) => value,
};

/** Rules that hold at every active level. */
const BASE_RULES = [
  'CAVEMAN MODE IS ACTIVE. Answer terse, like caveman. Technical substance stays exact; only fluff dies.',
  'Drop: articles, filler (just/really/basically/simply), pleasantries, apologies, hedging, and restating the question.',
  'Fragments are fine. Short synonyms. Keep the language the user wrote in — Chinese stays Chinese, just with far fewer characters.',
  'Shape: [thing] [action] [reason]. [next step].',
  'Never compress: code, diffs, commands, file paths, URLs, identifiers, error messages, numbers, or names. Technical content is unchanged.',
  'ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.',
  'When the user asks for commits, PR descriptions or documentation, write those in normal prose.',
  'Leave the mode only when the user says "stop caveman" / "normal mode" or types /caveman off — then call the caveman tool with level "off".',
].join('\n');

/** The per-level guidance appended to {@link BASE_RULES}. */
const LEVEL_RULES = {
  lite: 'Level LITE (轻量): delete filler words only; keep full grammar. Professional, zero fluff.',
  full: 'Level FULL (完整): the default caveman. Drop articles, use fragments, blunt and raw.',
  ultra: 'Level ULTRA (极限): maximum compression. Telegraphic. Abbreviate anything that stays readable.',
  'wenyan-lite': 'Level WENYAN-LITE (半文言): half-classical Chinese. Complete grammar, all filler gone.',
  wenyan: 'Level WENYAN (文言文): write the prose in classical Chinese. Maximum classical concision; technical tokens untouched.',
  'wenyan-ultra': 'Level WENYAN-ULTRA (极端文言): extreme. Ancient scholar on a token budget — compress the prose to the bone.',
};

/** Model-facing label per level (used in tool/command text). */
const LEVEL_LABELS = {
  off: 'off (正常模式)',
  lite: 'lite · 轻量级',
  full: 'full · 完整',
  ultra: 'ultra · 极限',
  'wenyan-lite': 'wenyan-lite · 半文言',
  wenyan: 'wenyan · 文言文',
  'wenyan-ultra': 'wenyan-ultra · 极端文言',
};

/** The runtime skill body (discoverable through the `skill` tool). */
const SKILL_CONTENT = [
  '# caveman',
  '',
  '**why use many token when few do trick** — answer in terse caveman prose, or classical Chinese,',
  'while keeping every technical fact exact. Same fix, ~75% fewer words.',
  '',
  '## Activate',
  '',
  'Call the `caveman` tool with the requested level, or let the user type `/caveman <level>`:',
  '',
  '| level | what changes |',
  '| --- | --- |',
  '| `lite` | filler words only die; grammar stays |',
  '| `full` | default caveman: drop articles, fragments, blunt |',
  '| `ultra` | telegraphic, abbreviate everything readable |',
  '| `wenyan-lite` | 半文言: half-classical Chinese, full grammar |',
  '| `wenyan` | 文言文: prose in classical Chinese |',
  '| `wenyan-ultra` | 极端文言: ancient scholar on a token budget |',
  '| `off` | back to normal prose |',
  '',
  '## Rules while active',
  '',
  'Drop articles, filler, pleasantries, hedging. Fragments OK. `[thing] [action] [reason]. [next step].`',
  'Never compress code, diffs, commands, paths, URLs, identifiers, error messages or numbers.',
  'Active every response — no revert after many turns, no filler drift.',
  'Commits, PR bodies and documentation stay normal prose.',
  '',
  '## Stop',
  '',
  '"stop caveman", "normal mode", `/caveman off`, or the `caveman` tool with level `off`.',
].join('\n');

/** Normalize one user- or model-supplied level token, or `undefined` when unknown. */
function parseLevel(raw) {
  if (typeof raw !== 'string') return undefined;
  const token = raw.trim().toLowerCase();
  if (token === '') return undefined;
  if (Object.hasOwn(LEVEL_ALIASES, token)) return LEVEL_ALIASES[token];
  const canonical = LEVELS.find((level) => level === token);
  return canonical;
}

/** Parse the JSON string a `tool/call` event carries, tolerating malformed input. */
function parseToolArguments(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fold one Session log into the level in force.
 *
 * Only two event pairs matter: a `/caveman` command (`command/run` then
 * `command/done`) and the `caveman` tool (`tool/call` then `tool/result`). The
 * switch commits on the settled pair, so a rejected command or a failed tool
 * call leaves the level alone. Events this unit ignores return the same state
 * reference, which keeps the projection cache and the Client view cheap.
 *
 * @param defaultLevel - level a Session starts from.
 * @returns A projection definition with a Client-visible wire view.
 */
function cavemanProjection(defaultLevel) {
  return {
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: PASS_THROUGH_SCHEMA,
    init: () => ({ level: defaultLevel, pending: null }),
    apply: (state, event) => {
      switch (event.type) {
        case 'command/run': {
          if (event.data.name !== COMMAND_NAME) return state;
          const level = parseLevel(event.data.args ?? '');
          if (level === undefined) return state;
          return { ...state, pending: { kind: 'command', id: String(event.data.commandId), level } };
        }
        case 'command/done': {
          const pending = state.pending;
          if (pending === null || pending.kind !== 'command' || pending.id !== String(event.data.commandId)) return state;
          if (event.data.kind !== 'success') return { ...state, pending: null };
          return { level: pending.level, pending: null };
        }
        case 'tool/call': {
          if (event.data.name !== TOOL_NAME) return state;
          const level = parseLevel(parseToolArguments(event.data.arguments)?.level);
          if (level === undefined) return state;
          return { ...state, pending: { kind: 'tool', id: String(event.data.callId), level } };
        }
        case 'tool/result': {
          const pending = state.pending;
          if (pending === null || pending.kind !== 'tool') return state;
          const message = event.data.message;
          if (message === undefined || String(message.toolCallId) !== pending.id) return state;
          if (message.isError === true) return { ...state, pending: null };
          return { level: pending.level, pending: null };
        }
        default:
          return state;
      }
    },
    wire: {
      viewSchema: PASS_THROUGH_SCHEMA,
      view: (state) => ({
        level: state.level,
        pending: state.pending === null ? null : state.pending.level,
      }),
    },
  };
}

/** The level actually in force, including a switch that is logged but not settled yet. */
function effectiveLevel(state, defaultLevel) {
  if (state === undefined) return defaultLevel;
  return state.pending?.level ?? state.level ?? defaultLevel;
}

/** Validate the plugin row's config before the plugin activates. */
function resolveConfig(config) {
  const raw = config ?? {};
  const level = raw.level ?? DEFAULT_LEVEL;
  const parsed = parseLevel(level);
  if (parsed === undefined) {
    throw new Error(
      `caveman-cn config.level must be one of ${LEVELS.join(', ')} (or a known alias); got ${JSON.stringify(raw.level)}`,
    );
  }
  return { level: parsed };
}

/**
 * Register the caveman projection, prompt section, tool and command.
 *
 * @param ctx - the plugin's context (global layer).
 * @param config - validated row config carrying the default level.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config);
  const defaultLevel = resolved.level;

  ctx.effect(
    () => ctx.sessionProjections.register(cavemanProjection(defaultLevel)),
    'caveman-cn: caveman projection',
  );

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: (context) => {
          const agent = context.agent;
          if (agent === undefined) return '';
          const state = ctx.sessionProjections.stateOf(agent.session, PROJECTION_KEY);
          const level = effectiveLevel(state, defaultLevel);
          if (level === 'off') return '';
          return `${BASE_RULES}\n\n${LEVEL_RULES[level] ?? ''}`.trim();
        },
      }),
    'caveman-cn: system prompt section',
  );

  // The tool registry is optional in the same sense the command registry is:
  // a deployment without it still gets the prompt section and the command.
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register({
      name: TOOL_NAME,
      description:
        'Switch this Session\'s caveman speech level. Use level "lite" for filler-free but grammatical, "full" for the default blunt caveman (no articles, fragments), "ultra" for telegraphic maximum compression, "wenyan-lite"/"wenyan"/"wenyan-ultra" for 文言文 (classical Chinese) at increasing extremity, and "off" to return to normal prose. Call it when the user asks for caveman/terse/"少用 token"/文言文 style, or to leave when they say "stop caveman" or "normal mode". Technical content — code, paths, commands, numbers — stays exact at every level.',
      parameters: {
        type: 'object',
        properties: {
          level: {
            type: 'string',
            enum: LEVELS,
            description: 'The level to activate: off, lite, full, ultra, wenyan-lite, wenyan or wenyan-ultra.',
          },
        },
        required: ['level'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            level: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['level', 'message'],
        },
        render: (_args, value) => [{ type: 'text', text: String(value?.message ?? '') }],
      },
      execute: async (args, exec) => {
        if (exec.agent === undefined) throw new Error(`${TOOL_NAME} needs a calling agent, and this call has no Session`);
        const level = parseLevel(args?.level);
        if (level === undefined) {
          throw new Error(`unknown caveman level ${JSON.stringify(args?.level)}; expected one of ${LEVELS.join(', ')}`);
        }
        const label = LEVEL_LABELS[level];
        const message =
          level === 'off'
            ? 'Caveman mode off — normal prose from the next step.'
            : `Caveman mode ${label} — active from your next step, every response, until the user changes it.`;
        return { level, message };
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `caveman → ${String(args?.level ?? '')}`,
        kind: 'other',
      }),
      presentResult: (_args, result) => ({
        card: 'generic',
        title: 'caveman',
        content: result.content,
      }),
    });
  });

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      definitionId: '@local/dsh-caveman#caveman',
      name: COMMAND_NAME,
      description: 'Set the caveman speech level (off|lite|full|ultra|wenyan-lite|wenyan|wenyan-ultra)',
      input: { hint: '[off|lite|full|ultra|wenyan-lite|wenyan|wenyan-ultra|status]' },
      handler: ({ agent, rawInput }) => {
        const argument = rawInput.trim();
        const token = argument.toLowerCase();
        if (token === '' || token === 'status') {
          const state = ctx.sessionProjections.stateOf(agent.session, PROJECTION_KEY);
          const current = effectiveLevel(state, defaultLevel);
          return { kind: 'success', text: `Caveman level: ${LEVEL_LABELS[current]}. Usage: /caveman <${LEVELS.join('|')}>` };
        }
        const level = parseLevel(token);
        if (level === undefined) {
          return {
            kind: 'error',
            text: `Unknown caveman level "${argument}". Use one of ${LEVELS.join(', ')} (文言文 aliases accepted).`,
          };
        }
        return level === 'off'
          ? { kind: 'success', text: 'Caveman mode off — normal prose from the next step.' }
          : { kind: 'success', text: `Caveman mode ${LEVEL_LABELS[level]} — active from the next step, every response.` };
      },
    });
  });

  ctx.inject(['skills'], (skillCtx) => {
    try {
      skillCtx.skills.register({
        name: 'caveman',
        description:
          'Answer in terse caveman prose or 文言文 to cut output tokens ~75% while keeping technical facts exact.',
        whenToUse:
          'When the user asks for caveman mode, terse/minimal answers, "少用点 token", "talk like caveman", or classical Chinese (文言文) style, or asks to leave it ("stop caveman", "normal mode").',
        content: SKILL_CONTENT,
        source: 'runtime',
      });
    } catch (error) {
      ctx.logger.warn('caveman-cn: could not register the caveman skill: %o', error);
    }
  });
}
