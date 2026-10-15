/**
 * Offline harness for the Caveman CN Client half.
 *
 * `client.js` is a browser artifact: it registers a lazy factory whose id must
 * equal the package name and whose `apply` fills a composer slot. This test
 * loads it against a stand-in React, `document`, and slot registry, then renders
 * the dock component by hand to check what a user would see and what a click
 * would send — without a browser.
 *
 * Run: node --test dsh-plugins/caveman-cn/test/client.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

/** Minimal React stand-in: enough for createElement and the hooks the dock uses. */
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child != null) };
  },
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
};

/** Locale stand-in: `{name}` interpolation against a flat dictionary. */
const t = (key, params) => {
  const dictionary = {
    'dock.badge': '原始人',
    'dock.aria': '原始人模式强度',
    'dock.switching': '切换中…',
    'dock.failed': '切换失败',
    'dock.unavailable': '当前会话无法执行 /caveman 命令',
    'dock.chip': '切换到{level}',
    'level.off': '正常',
    'level.lite': '轻量',
    'level.full': '完整',
    'level.ultra': '极限',
    'level.wenyan-lite': '半文言',
    'level.wenyan': '文言文',
    'level.wenyan-ultra': '极端文言',
  };
  const text = dictionary[key] ?? key;
  return params === undefined ? text : text.replace(/\{(\w+)\}/g, (_match, name) => String(params[name]));
};

/** Collect every element of one type from a rendered tree. */
function findAll(node, type, found = []) {
  if (node == null || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, type, found);
    return found;
  }
  if (node.type === type) found.push(node);
  for (const child of node.children ?? []) findAll(child, type, found);
  return found;
}

// Load the artifact exactly once: the module registers itself into a stubbed
// browser global as a side effect, and the ESM cache serves later imports.
let definition;
globalThis.window = {
  __ModuleLoader__: {
    load: (loaded) => {
      definition = loaded;
    },
  },
};
globalThis.document = {
  createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
  head: { appendChild: () => {} },
};
await import('../client.js');
const exported = definition.factory((id) => {
  assert.equal(id, 'react', 'the artifact only requires React from the browser module table');
  return React;
});

/** Apply the plugin against a stand-in Client context and capture its registration. */
function createHarness({ remoteResult } = {}) {
  const registration = {};
  const executed = [];
  let answer = remoteResult ?? { ok: true, value: { commandId: 'c1', result: { kind: 'success', text: 'ok' } } };
  const ctx = {
    effect: (callback) => {
      const result = callback();
      return typeof result === 'function' ? result : () => {};
    },
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (name, callback) => {
        registration.slot = name;
        registration.value = callback();
        return () => {};
      },
      register: (options, component) => {
        registration.options = options;
        registration.component = component;
        return () => {};
      },
    },
    remote: {
      commands: {
        execute: async (sessionId, line, attachments) => {
          executed.push({ sessionId, line, attachments });
          return typeof answer === 'function' ? answer(sessionId, line) : answer;
        },
      },
    },
  };
  exported.apply(ctx);
  return {
    registration,
    executed,
    setAnswer: (next) => {
      answer = next;
    },
  };
}

test('the client module registers under the package id and fills the composer dock', async () => {
  const { registration } = createHarness();
  assert.deepEqual(exported.inject, ['slots', 'remote', 'remote.commands', 'locale']);
  assert.equal(registration.slot, 'conversation.input.dock');
  assert.equal(registration.options.name, 'conversation.input.dock');
  assert.equal(registration.options.id, '@local/dsh-caveman');
  assert.equal(registration.options.order, 20);
  assert.equal(registration.options.locale, 'caveman');
  assert.equal(typeof registration.component, 'function');
});

test('the dock renders nothing while the Host projection is absent', () => {
  const { registration } = createHarness();
  assert.equal(registration.component({ useProjection: () => undefined, t }), null);
  assert.equal(registration.component({ useProjection: () => null, t }), null);
});

test('the dock renders one chip per level with the effective level pressed', () => {
  const { registration } = createHarness();
  const tree = registration.component({ useProjection: () => ({ level: 'full', pending: null }), t });
  const chips = findAll(tree, 'button');
  assert.equal(chips.length, 7, 'off, lite, full, ultra, wenyan-lite, wenyan, wenyan-ultra');
  const pressed = chips.filter((chip) => chip.props['aria-pressed'] === true);
  assert.equal(pressed.length, 1);
  assert.match(pressed[0].props['aria-label'], /切换到完整/);
  assert.equal(tree.props['data-caveman-level'], 'full');
  assert.equal(tree.props.role, 'group');
  assert.equal(findAll(tree, 'span').some((node) => node.props.role === 'status'), false, 'no status while settled');
});

test('the dock aligns with the composer card and names the current level once', () => {
  const { registration } = createHarness();
  const tree = registration.component({ useProjection: () => ({ level: 'ultra', pending: null }), t });

  assert.match(tree.props.className, /cvm-dock/, 'the root is the styled dock');
  const list = findAll(tree, 'ul');
  assert.equal(list.length, 1, 'the chips live in a list track so they share the composer width');
  assert.equal(findAll(list[0], 'li').length, 7, 'one list item per chip');
  const labels = findAll(tree, 'span')
    .filter((node) => node.props.className === 'cvm-chipLabel')
    .map((node) => node.children[0]);
  assert.deepEqual(labels, ['正常', '轻量', '完整', '极限', '半文言', '文言文', '极端文言']);

  // The trailing badge names the level; it must not repeat the chip row.
  const badge = findAll(tree, 'span').filter((node) => node.children.includes('原始人'));
  assert.equal(badge.length, 1, 'the badge appears exactly once');
  assert.equal(tree.children.at(-1).children[0], '极限', 'the badge states the effective level');
});

test('a pending switch is announced and keeps the logged level pressed', () => {
  const { registration } = createHarness();
  const tree = registration.component({ useProjection: () => ({ level: 'full', pending: 'wenyan' }), t });
  const status = findAll(tree, 'span').find((node) => node.props.role === 'status');
  assert.ok(status, 'pending status is rendered');
  assert.equal(status.children[0], '切换中…');
  const pressed = findAll(tree, 'button').filter((chip) => chip.props['aria-pressed'] === true);
  assert.equal(pressed.length, 1);
  assert.equal(tree.props['data-caveman-level'], 'wenyan', 'the effective level drives the row attribute');
});

test('clicking a chip executes the matching /caveman command', async () => {
  const { registration, executed } = createHarness();
  const applied = [];
  const tree = registration.component({
    useProjection: () => ({ level: 'full', pending: null }),
    setLevel: (level) => registration.options.inject('session-level').setLevel(level).then((failure) => {
      applied.push(level);
      return failure;
    }),
    t,
  });
  const ultra = findAll(tree, 'button').find((chip) => chip.props['aria-label'].includes('极限'));
  assert.ok(ultra, 'the ultra chip exists');
  await ultra.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(applied, ['ultra']);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].sessionId, 'session-level');
  assert.equal(executed[0].line, '/caveman ultra');
  assert.deepEqual(executed[0].attachments, []);
});

test('clicking the pressed chip is a no-op, and a locked composer disables every chip', async () => {
  const { registration, executed } = createHarness();
  const injected = { setLevel: () => registration.options.inject('s').setLevel('off') };
  const tree = registration.component({
    useProjection: () => ({ level: 'off', pending: null }),
    setLevel: injected.setLevel,
    t,
  });
  const off = findAll(tree, 'button').find((chip) => chip.props['aria-pressed'] === true);
  await off.props.onClick();
  assert.equal(executed.length, 0, 'the already-active chip sends nothing');

  const locked = registration.component({
    useProjection: () => ({ level: 'off', pending: null }),
    locked: true,
    setLevel: async () => null,
    t,
  });
  for (const chip of findAll(locked, 'button')) assert.equal(chip.props.disabled, true);
});

test('the Host outcome decides whether the dock shows a failure', async () => {
  const { registration, setAnswer } = createHarness();
  const injected = registration.options.inject('session-level');

  assert.equal(await injected.setLevel('wenyan'), null, 'a successful execution reports no failure');

  setAnswer({ ok: false, error: { message: 'no such command', code: 'UNKNOWN_COMMAND' } });
  assert.equal(await injected.setLevel('ultra'), 'no such command (UNKNOWN_COMMAND)');

  setAnswer({ ok: true, value: undefined });
  assert.equal(await injected.setLevel('ultra'), '当前会话无法执行 /caveman 命令');

  setAnswer({ ok: true, value: { commandId: 'c1', result: { kind: 'error', text: 'Unknown caveman level' } } });
  assert.equal(await injected.setLevel('nope'), 'Unknown caveman level');

  setAnswer({ ok: true, value: { commandId: 'c1', result: { kind: 'error' } } });
  assert.equal(await injected.setLevel('nope'), '切换失败');

  setAnswer({ ok: true, value: { commandId: 'c1', result: { kind: 'success' } } });
  assert.equal(await injected.setLevel('full'), null);
});
