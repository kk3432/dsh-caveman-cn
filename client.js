/**
 * Caveman CN — Client half.
 *
 * Renders the level control above the composer and writes through the Session
 * command `/caveman <level>`. The control owns no state: the level it shows
 * comes from the Host projection wire view (`useProjection('caveman')`), which
 * folds the Session log, so a switch made by the model's `caveman` tool, by the
 * user typing the command, or by this control all render identically.
 *
 * Layout contract: the composer-dock slot renders each entry as a bare child of
 * the composer stack, which has no shared width of its own. The shipped docks
 * (queue, todo) therefore pin themselves to the composer card with
 * `--dsh-composer-side-clearance` / `--dsh-composer-dock-inset` /
 * `--dsh-composer-card-max-width`; this control does the same, so it lines up
 * with the input card instead of stretching the whole conversation column.
 *
 * @module @local/dsh-caveman
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-caveman',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'caveman';

    /** The projection key the Host registers. */
    const PROJECTION_KEY = 'caveman';

    /**
     * The seven levels, in ascending strength, in the order the Host accepts
     * them. `key` names this plugin's own dictionary entry.
     */
    const LEVELS = [
      { id: 'off', key: 'level.off' },
      { id: 'lite', key: 'level.lite' },
      { id: 'full', key: 'level.full' },
      { id: 'ultra', key: 'level.ultra' },
      { id: 'wenyan-lite', key: 'level.wenyan-lite' },
      { id: 'wenyan', key: 'level.wenyan' },
      { id: 'wenyan-ultra', key: 'level.wenyan-ultra' },
    ];

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'dock.aria': '原始人模式强度',
      'dock.badge': '原始人',
      'dock.separator': '｜',
      'dock.switching': '切换中…',
      'dock.failed': '切换失败',
      'dock.unavailable': '当前会话无法执行 /caveman 命令',
      'dock.chip': '切换到{level}',
      'dock.current': '当前强度：{level}',
      'level.off': '正常',
      'level.lite': '轻量',
      'level.full': '完整',
      'level.ultra': '极限',
      'level.wenyan-lite': '半文言',
      'level.wenyan': '文言文',
      'level.wenyan-ultra': '极端文言',
    };

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      'dock.aria': 'Caveman level',
      'dock.badge': 'Caveman',
      'dock.separator': '|',
      'dock.switching': 'Switching…',
      'dock.failed': 'Switch failed',
      'dock.unavailable': 'This Session cannot run the /caveman command',
      'dock.chip': 'Switch to {level}',
      'dock.current': 'Current level: {level}',
      'level.off': 'Normal',
      'level.lite': 'Lite',
      'level.full': 'Full',
      'level.ultra': 'Ultra',
      'level.wenyan-lite': 'Wenyan-lite',
      'level.wenyan': 'Wenyan',
      'level.wenyan-ultra': 'Wenyan-ultra',
    };

    /**
     * Plugin styles.
     *
     * Geometry mirrors the shipped composer docks: the root is clipped to the
     * composer card width and inset, so the chips sit over the input card
     * rather than spanning the conversation column. The seven levels form one
     * compact segmented track that keeps its natural width and only starts
     * scrolling inside itself on a very narrow window, so no label is clipped.
     * Every colour is a `--dsw-alias-*` theme token, so light and dark follow
     * the Host palette.
     */
    const CSS = `
.cvm-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));max-width:calc(var(--dsh-composer-card-max-width,952px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));margin:0 auto;padding:0 var(--dsh-composer-dock-inset,8px);display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.cvm-chips{display:flex;align-items:stretch;flex:0 1 auto;gap:2px;margin:0;padding:2px;min-width:0;max-width:100%;list-style:none;overflow-x:auto;scrollbar-width:none;background:var(--dsw-alias-interactive-bg-hover);border-radius:10px}
.cvm-chips::-webkit-scrollbar{height:0}
.cvm-item{display:flex;flex:none}
.cvm-chip{box-sizing:border-box;display:flex;align-items:center;justify-content:center;height:22px;margin:0;padding:0 10px;border:.5px solid transparent;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,color .12s ease,border-color .12s ease}
.cvm-chip:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.cvm-chip[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:500}
.cvm-chip:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.cvm-chip:disabled{cursor:default;opacity:.5}
.cvm-sep{flex:none;width:1px;height:14px;margin:0 2px;background:var(--dsw-alias-border-l2)}
.cvm-lead{flex:none;display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;letter-spacing:.02em}
.cvm-now{color:var(--dsw-alias-label-primary);font-weight:500}
.cvm-note{flex:none;color:var(--dsw-alias-state-warn-primary)}
.cvm-error{flex:none;color:var(--dsw-alias-state-error-primary)}
`;

    /**
     * The composer-dock control: one segmented chip per level, the effective
     * level pressed, and a trailing label naming the current level.
     *
     * @param props - slot props: the projection reader, the composer lock, the
     * injected command write, and the bound locale.
     */
    function CavemanDock({ useProjection, locked, setLevel, t }) {
      const view = useProjection(PROJECTION_KEY);
      const [busy, setBusy] = React.useState(null);
      const [error, setError] = React.useState(null);
      const alive = React.useRef(true);
      React.useEffect(() => () => {
        alive.current = false;
      }, []);

      // No value means the Host half is not mounted (or this Session predates
      // it): render nothing rather than guess a level.
      if (view === undefined || view === null) return null;
      const effective = view.pending ?? view.level;
      const switching = view.pending !== null && view.pending !== view.level;

      const choose = (id) => {
        if (locked === true || busy !== null || id === effective) return;
        setBusy(id);
        setError(null);
        // Retry after a failure clears the previous message first.
        Promise.resolve(setLevel(id)).then(
          (failure) => {
            if (!alive.current) return;
            setBusy(null);
            setError(failure ?? null);
          },
          (reason) => {
            if (!alive.current) return;
            setBusy(null);
            setError(reason instanceof Error ? reason.message : String(reason));
          },
        );
      };

      const chips = LEVELS.map((level) => {
        const label = t(level.key);
        const active = level.id === effective;
        return h(
          'li',
          { key: level.id, className: 'cvm-item' },
          h(
            'button',
            {
              type: 'button',
              className: 'cvm-chip',
              'aria-pressed': active,
              'aria-label': t('dock.chip', { level: label }),
              title: t('dock.chip', { level: label }),
              disabled: locked === true || busy !== null,
              onClick: () => choose(level.id),
            },
            h('span', { className: 'cvm-chipLabel' }, label),
          ),
        );
      });

      const currentKey = LEVELS.find((level) => level.id === effective);
      const currentLabel = currentKey === undefined ? String(effective ?? '') : t(currentKey.key);

      const status = error !== null
        ? h('span', { className: 'cvm-error', role: 'status', title: error }, t('dock.failed'))
        : switching
          ? h('span', { className: 'cvm-note', role: 'status' }, t('dock.switching'))
          : h('span', { className: 'cvm-now' }, currentLabel);

      return h(
        'div',
        { className: 'cvm-dock', role: 'group', 'aria-label': t('dock.aria'), 'data-caveman-level': effective },
        h('ul', { className: 'cvm-chips' }, chips),
        h('span', { className: 'cvm-sep', 'aria-hidden': true }),
        h(
          'span',
          { className: 'cvm-lead', title: t('dock.current', { level: currentLabel }) },
          h('span', { 'aria-hidden': true }, '🪨'),
          t('dock.badge'),
        ),
        status,
      );
    }

    return {
      inject: ['slots', 'remote', 'remote.commands', 'locale'],

      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'caveman-cn: dictionaries');
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/dsh-caveman';
          tag.dataset.pluginCss = 'caveman-cn';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'caveman-cn: styles');

        ctx.effect(
          () =>
            ctx.slots.inject('conversation.input.dock', () =>
              ctx.slots.register(
                {
                  name: 'conversation.input.dock',
                  id: '@local/dsh-caveman',
                  order: 20,
                  locale: NS,
                  inject: (sessionId) => ({
                    setLevel: async (level) => {
                      const result = await ctx.remote.commands.execute(sessionId, `/caveman ${level}`, []);
                      if (!result.ok) return `${result.error.message} (${result.error.code})`;
                      const execution = result.value;
                      if (execution === undefined) return t('dock.unavailable');
                      if (execution.result?.kind === 'error') return execution.result.text ?? t('dock.failed');
                      return null;
                    },
                  }),
                },
                CavemanDock,
              ),
            ),
          'caveman-cn: composer dock',
        );
      },
    };
  },
});
