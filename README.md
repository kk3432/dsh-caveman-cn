# @local/dsh-caveman

把 [caveman-cn](https://github.com/bbylw/caveman-cn)（`JuliusBrussee/caveman` 的汉化版技能/插件）移植到
DeepSeek Harness：让智能体用**极简原始人语言**或**文言文**回答，在技术内容完全不变的前提下压缩约 75% 的输出 token，
并在 Harness Web UI 的作曲栏上方提供一键强度面板。

## 效果

| 级别 | 命令 | 行为 |
| --- | --- | --- |
| off | `/caveman off` | 正常散文 |
| lite | `/caveman lite` | 只删填充词，语法完整；专业但无废话 |
| full | `/caveman full` | 默认。删冠词、用片段、完全原始 |
| ultra | `/caveman ultra` | 最大压缩，电报式，能缩写的都缩写 |
| wenyan-lite | `/caveman wenyan-lite` | 半文言：语法完整，填充词消失 |
| wenyan | `/caveman wenyan` | 完整文言文 |
| wenyan-ultra | `/caveman wenyan-ultra` | 极端文言，预算有限的古代学者 |

别名可用中文：`/caveman 文言文`、`/caveman 极限`、`/caveman 关闭`。
无论哪个级别，**代码、diff、命令、路径、URL、标识符、报错信息、数字、名称一律不压缩**。

## 三个入口，一套状态

1. **模型**：常驻工具 `caveman`（参数 `level`）。用户说「talk like caveman」「少用点 token」「用文言文」时模型自行切换。
2. **用户**：会话命令 `/caveman <level|status>`，不发送给模型，只写会话日志。
3. **UI**：作曲栏上方（`conversation.input.dock`）的强度分段控件，点击即执行 `/caveman <level>`。

三者读写同一个真源：`sessionProjections` 单元 `caveman`。
它只折叠**已存在**的事件——`command/run` / `command/done`（`/caveman` 命令）与 `tool/call` / `tool/result`（`caveman` 工具）——
不追加任何自定义事件类型，因此 resume、fork、replay 都能恢复级别；Web UI 通过 `useProjection('caveman')` 的
`wire.view` 直接读到 Host 算好的值，不做乐观猜测。切换在配对事件落定后才生效：命令报错或工具调用失败不会改变级别。

提示词注入走 `ctx.systemPrompt.section()`：级别为 `off` 时该 section 返回空串，不产生任何 token 开销。
section 位置为 550，位于仓库顺序表 `PLAN_POLICY`(500) 与 `TEAM_POLICY`(600) 之间。

## 面板布局

`conversation.input.dock` 把每个插件条目直接渲染为 composer stack 的子节点，而该 stack **自身没有宽度**。
内置的 queue / todo dock 因此都用 `--dsh-composer-side-clearance`、`--dsh-composer-dock-inset`、
`--dsh-composer-card-max-width` 把自己夹到输入卡片宽度上；本插件沿用同一套几何：

```css
width: calc(100% - 2 * var(--dsh-composer-side-clearance) - 2 * var(--dsh-composer-dock-inset));
max-width: calc(var(--dsh-composer-card-max-width) - 2 * var(--dsh-composer-dock-inset));
margin: 0 auto;
padding: 0 var(--dsh-composer-dock-inset);
```

七个级别放进一条 `flex:1 1 0` 的等分轨道，因此整排宽度等于输入卡片、不再被拉满整个会话栏；
标签用 `text-overflow: ellipsis` 截断而不是把行撑高；右侧只保留一个「🪨 原始人」标签 + 当前级别，
切换中显示「切换中…」，失败显示「切换失败」（`title` 给出 Host 的原始错误）。
所有颜色都取自 `--dsw-alias-*` 主题 token（`interactive-bg-active`、`interactive-bg-hover`、
`label-primary/secondary/tertiary`、`border-l2`、`state-warn/error-primary`），因此亮色 / 暗色主题都跟随宿主调色板。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | bundle 清单：`dsh.bundle.patch` + `dsh.client`（web，immediately） |
| `cordis.patch.yml` | 插入插件行 `caveman-cn`；`config.level` 为新会话的默认级别 |
| `index.js` | 包入口，`export * from './host.js'` |
| `host.js` | Host：投影单元、提示词 section、`caveman` 工具、`/caveman` 命令、`caveman` 技能 |
| `client.js` | Client：语言字典、主题 token 样式、作曲栏 dock 强度面板 |
| `test/host.test.mjs`、`test/client.test.mjs` | 离线自测：22 条断言，桩 Cordis 上下文 / 桩 React 驱动 |
| `icon.svg`、`locale/*.json` | 插件管理页的展示元数据 |

## 配置

```yaml
- id: caveman-cn
  name: '@local/dsh-caveman'
  config:
    level: full   # off | lite | full | ultra | wenyan-lite | wenyan | wenyan-ultra
```

级别本身是**按会话**的（与 caveman-cn 一致：级别保持不变，直到你更改或会话结束）；
`config.level` 只决定新会话的初始级别。默认 `full`；配置值非法时插件在激活阶段直接报错，不会静默降级。

## 安装

```
plugin_manager install_bundle  target = <本目录绝对路径>
```

前置条件：`pnpm` 在 PATH 上（`install_bundle` 内部调用它）。安装后 `application: applied` 即已生效。复核方式：

- Host：`Tool.listTools` 出现 `caveman`；系统提示词出现 caveman section；技能目录出现 `caveman`。
- Client：`cordis_inspect_query(client, Slots, listSubTree, {root: 'conversation.input.dock'})`
  的 occupants 出现 `@local/dsh-caveman`（order 20，active true）。
- 逻辑：`node --test test/host.test.mjs test/client.test.mjs`（在包目录内运行）。

## 卸载

```
plugin_manager remove_bundle  target = @local/dsh-caveman
```

## 开发注意

运行中的 Harness 对**模块代次**有强缓存：loader 按 specifier 缓存解析结果，Node 按 URL 缓存 ESM 模块，
且该包位于 profile 的 `node_modules`（HMR 的 `ignored` 默认排除）——因此**改了插件代码后，禁用/启用 bundle 不会加载新代码**，
必须重启 Harness（`plugin_manager` 文档同样说明：替换已安装包需要重启才能加载新的 JS 代次）。
Client 侧的 bundle 由 Host 按 `mtimeMs` / `ctimeMs` / size 派生 revision 后分片下发，改完代码刷新页面即可拿到新代次。

## 许可证

[MIT](LICENSE)
