/**
 * Offline harness for the Caveman CN Host half.
 *
 * The running Harness keeps one ESM module generation per URL, so a plugin that
 * fails to activate cannot be re-tested by toggling its bundle. This test drives
 * `apply()` against a stand-in Cordis context that implements exactly the seams
 * the plugin uses (`effect`, `inject`, and the four registries), then folds a
 * synthetic Session log through the projection the plugin registered.
 *
 * Run: node --test dsh-plugins/caveman-cn/test/
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { apply, inject, name } from '../index.js';

/** Build a context stand-in with the requested optional services present. */
function createHarness({ services = ['systemPrompt', 'sessionProjections', 'tools', 'commands', 'skills'], config } = {}) {
  const registry = {
    sections: new Map(),
    projections: new Map(),
    tools: new Map(),
    commands: new Map(),
    skills: new Map(),
    warnings: [],
  };

  const build = (available) => {
    const ctx = {
      logger: {
        warn: (...args) => registry.warnings.push(args),
        info: () => {},
        error: () => {},
      },
      effect: (callback) => {
        const disposer = callback();
        return typeof disposer === 'function' ? disposer : () => {};
      },
      inject: (deps, callback) => {
        if (!deps.every((dep) => available.includes(dep))) return () => {};
        return callback(build(available)) ?? (() => {});
      },
      systemPrompt: {
        section: (section) => {
          registry.sections.set(section.name, section);
          return () => registry.sections.delete(section.name);
        },
      },
      sessionProjections: {
        register: (definition) => {
          registry.projections.set(definition.key, definition);
          return () => registry.projections.delete(definition.key);
        },
        /** Fold the whole log, the way the real registry materializes a cell. */
        stateOf: (session, key) => {
          const definition = registry.projections.get(key);
          if (definition === undefined) return undefined;
          let state = definition.init({}, 0);
          for (const event of session.events) state = definition.apply(state, event);
          return state;
        },
      },
      tools: {
        register: (definition) => {
          registry.tools.set(definition.name, definition);
          return () => registry.tools.delete(definition.name);
        },
      },
      commands: {
        register: (definition) => {
          registry.commands.set(definition.name, definition);
          return () => registry.commands.delete(definition.name);
        },
      },
      skills: {
        register: (skill) => {
          registry.skills.set(skill.name, skill);
          return () => registry.skills.delete(skill.name);
        },
      },
    };
    return ctx;
  };

  const ctx = build(services);
  apply(ctx, config ?? { level: 'full' });
  return { ctx, registry };
}

/** A Session stand-in: only `events` is read by the projection under test. */
function session(events = []) {
  return { id: 'session-test', events };
}

const runCommand = (id, name, args) => ({
  type: 'command/run',
  data: { commandId: id, name, args, source: { kind: 'user' } },
});
const doneCommand = (id, kind = 'success') => ({
  type: 'command/done',
  data: { commandId: id, kind, text: 'ok' },
});
const callTool = (callId, toolName, args) => ({
  type: 'tool/call',
  data: { turn: 1, step: 1, callId, name: toolName, arguments: JSON.stringify(args) },
});
const resultTool = (callId, isError = false) => ({
  type: 'tool/result',
  data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, isError } },
});

/** Read the level the projection reports for a log. */
function levelOf(registry, events) {
  const definition = registry.projections.get('caveman');
  assert.ok(definition, 'the caveman projection is registered');
  let state = definition.init({}, 0);
  for (const event of events) state = definition.apply(state, event);
  return definition.wire.view(state);
}

test('plugin identity and declared dependencies', () => {
  assert.equal(name, 'caveman-cn');
  assert.deepEqual(inject, ['systemPrompt', 'sessionProjections']);
});

test('activation registers projection, section, tool, command and skill', () => {
  const { registry } = createHarness();
  assert.ok(registry.projections.has('caveman'), 'projection');
  assert.ok(registry.sections.has('caveman:policy'), 'prompt section');
  assert.ok(registry.tools.has('caveman'), 'tool');
  assert.ok(registry.commands.has('caveman'), 'command');
  assert.ok(registry.skills.has('caveman'), 'skill');
  assert.equal(registry.sections.get('caveman:policy').order, 550);
  assert.equal(registry.warnings.length, 0);
});

test('activation survives deployments without the optional registries', () => {
  const { registry } = createHarness({ services: ['systemPrompt', 'sessionProjections'] });
  assert.ok(registry.projections.has('caveman'));
  assert.ok(registry.sections.has('caveman:policy'));
  assert.equal(registry.tools.size, 0);
  assert.equal(registry.commands.size, 0);
  assert.equal(registry.skills.size, 0);
});

test('a bad configured level fails activation loudly', () => {
  assert.throws(() => createHarness({ config: { level: 'shouty' } }), /config\.level must be one of/);
  assert.throws(() => createHarness({ config: { level: 7 } }), /config\.level must be one of/);
});

test('new Sessions start at the configured level', () => {
  const { registry } = createHarness();
  assert.deepEqual(levelOf(registry, []), { level: 'full', pending: null });
  const { registry: off } = createHarness({ config: { level: 'off' } });
  assert.deepEqual(levelOf(off, []), { level: 'off', pending: null });
});

test('a successful /caveman command switches the level, a failed one does not', () => {
  const { registry } = createHarness();
  assert.deepEqual(levelOf(registry, [runCommand('c1', 'caveman', ' ultra'), doneCommand('c1')]), {
    level: 'ultra',
    pending: null,
  });
  assert.deepEqual(levelOf(registry, [runCommand('c1', 'caveman', ' ultra'), doneCommand('c1', 'error')]), {
    level: 'full',
    pending: null,
  });
  assert.deepEqual(
    levelOf(registry, [runCommand('c1', 'caveman', ' ultra'), doneCommand('c1'), runCommand('c2', 'caveman', ' nope'), doneCommand('c2', 'error')]),
    { level: 'ultra', pending: null },
    'an unknown level never becomes pending',
  );
});

test('localized aliases select the canonical level', () => {
  const { registry } = createHarness();
  const cases = [
    ['文言文', 'wenyan'],
    ['极限', 'ultra'],
    ['关闭', 'off'],
    ['半文言', 'wenyan-lite'],
    ['极端文言', 'wenyan-ultra'],
    ['LITE', 'lite'],
  ];
  for (const [alias, expected] of cases) {
    const view = levelOf(registry, [runCommand('c', 'caveman', ` ${alias}`), doneCommand('c')]);
    assert.equal(view.level, expected, `${alias} → ${expected}`);
  }
});

test('a pending switch is visible before the command settles', () => {
  const { registry } = createHarness();
  assert.deepEqual(levelOf(registry, [runCommand('c1', 'caveman', ' wenyan')]), {
    level: 'full',
    pending: 'wenyan',
  });
});

test('the caveman tool switches the level when its result succeeds', () => {
  const { registry } = createHarness();
  assert.deepEqual(levelOf(registry, [callTool('t1', 'caveman', { level: 'lite' }), resultTool('t1')]), {
    level: 'lite',
    pending: null,
  });
  assert.deepEqual(levelOf(registry, [callTool('t1', 'caveman', { level: 'lite' }), resultTool('t1', true)]), {
    level: 'full',
    pending: null,
  });
  assert.deepEqual(
    levelOf(registry, [callTool('t1', 'caveman', { level: 'nope' }), resultTool('t1')]),
    { level: 'full', pending: null },
    'an unknown tool level never becomes pending',
  );
  assert.deepEqual(
    levelOf(registry, [callTool('t1', 'bash', { command: 'ls' })]),
    { level: 'full', pending: null },
    'another tool is ignored',
  );
});

test('ignored events keep the state reference', () => {
  const definition = createHarness().registry.projections.get('caveman');
  const state = definition.init({}, 0);
  assert.equal(definition.apply(state, { type: 'turn/start', data: { turn: 1 } }), state);
  assert.equal(definition.apply(state, runCommand('c1', 'plan', ' off')), state);
  assert.equal(definition.apply(state, doneCommand('c1')), state);
  assert.notEqual(definition.apply(state, runCommand('c1', 'caveman', ' ultra')), state);
});

test('the prompt section follows the level and stays empty when off', () => {
  const { registry } = createHarness();
  const section = registry.sections.get('caveman:policy');
  const agent = (events) => ({ session: session(events) });

  assert.equal(section.text({}), '', 'no agent, no text');
  assert.match(section.text({ agent: agent([]) }), /CAVEMAN MODE IS ACTIVE/);
  assert.match(section.text({ agent: agent([]) }), /Level FULL/);
  const wenyan = section.text({ agent: agent([runCommand('c', 'caveman', ' wenyan'), doneCommand('c')]) });
  assert.match(wenyan, /Level WENYAN \(文言文\)/);
  assert.doesNotMatch(wenyan, /Level FULL/);
  assert.equal(
    section.text({ agent: agent([runCommand('c', 'caveman', ' off'), doneCommand('c')]) }),
    '',
    'off emits no section text at all',
  );
  assert.match(section.text({ agent: agent([runCommand('c', 'caveman', ' ultra')]) }), /Level ULTRA/);
});

test('the tool validates its input and reports the new level', async () => {
  const { registry } = createHarness();
  const tool = registry.tools.get('caveman');
  const exec = { agent: { id: 'session-test', session: session([]) } };

  const applied = await tool.execute({ level: 'wenyan' }, exec);
  assert.deepEqual(applied, {
    level: 'wenyan',
    message: 'Caveman mode wenyan · 文言文 — active from your next step, every response, until the user changes it.',
  });
  assert.equal((await tool.execute({ level: 'off' }, exec)).message, 'Caveman mode off — normal prose from the next step.');
  await assert.rejects(() => tool.execute({ level: 'loud' }, exec), /unknown caveman level/);
  await assert.rejects(() => tool.execute({}, { agent: undefined }), /needs a calling agent/);
  assert.equal(tool.parameters.type, 'object');
  assert.deepEqual(tool.parameters.required, ['level']);
  assert.equal(tool.output.render({}, { level: 'full', message: 'hi' })[0].text, 'hi');
});

test('the /caveman command reports status, switches, and rejects junk', () => {
  const { registry } = createHarness();
  const command = registry.commands.get('caveman');
  const agent = (events) => ({ id: 'session-test', session: session(events) });

  const status = command.handler({ agent: agent([]), rawInput: '' });
  assert.equal(status.kind, 'success');
  assert.match(status.text, /full · 完整/);
  assert.match(status.text, /off\|lite\|full\|ultra\|wenyan-lite\|wenyan\|wenyan-ultra/);

  const statusAfter = command.handler({
    agent: agent([runCommand('c', 'caveman', ' ultra'), doneCommand('c')]),
    rawInput: 'status',
  });
  assert.match(statusAfter.text, /ultra · 极限/);

  const switched = command.handler({ agent: agent([]), rawInput: ' 文言文 ' });
  assert.equal(switched.kind, 'success');
  assert.match(switched.text, /wenyan · 文言文/);

  const off = command.handler({ agent: agent([]), rawInput: 'off' });
  assert.match(off.text, /normal prose/);

  const junk = command.handler({ agent: agent([]), rawInput: 'shout' });
  assert.equal(junk.kind, 'error');
  assert.match(junk.text, /Unknown caveman level "shout"/);
});

test('the skill body teaches the same levels the plugin enforces', () => {
  const { registry } = createHarness();
  const skill = registry.skills.get('caveman');
  assert.equal(skill.source, 'runtime');
  for (const level of ['lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-ultra', 'off']) {
    assert.match(skill.content, new RegExp(`\\b${level}\\b`), `skill documents ${level}`);
  }
});
