/**
 * Package entry: the Host half lives in `./host.js`, which the bundle patch
 * loads as `@local/dsh-caveman/host`. Keeping the implementation in its own
 * module lets an installed bundle be reloaded without a process restart, while
 * `import '@local/dsh-caveman'` still resolves for tooling and tests.
 *
 * @module @local/dsh-caveman
 */
export * from './host.js';
