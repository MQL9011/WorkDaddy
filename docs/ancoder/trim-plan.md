# 单后端裁剪方案（只保留 OMP）

上游 gooey-pi 是「Pi / OMP / Prime Agent 三后端通用工作台」。WorkDaddy 只做 OMP。
本文件定义怎么把三后端收敛成一个，且**每一步都保持 typecheck 与测试为绿**。

## 0. 基线（2026-08-17 实测）

| 项 | 值 |
| --- | --- |
| fork 自 | `am-will/gooey-pi` `v1.1.11-6-g6f40736` |
| 源码规模 | `src/` + `electron/` 共 172 个 `.ts/.tsx`，32,672 行 |
| Node | 24.15.0（`.nvmrc`），npm 11.12.1 |
| `npm run typecheck` | ✅ 4 个 tsconfig 全绿 |

耦合面（`grep -ril` 命中文件数，含 `tests/`）：

| 关键词 | 命中文件 | 判断 |
| --- | --- | --- |
| `prime` | 207 | 深度耦合，必须类型驱动逐个收敛 |
| `schedule` | 69 | 中度，有独立目录 |
| `voice` | 42 | 低，独立文件为主 |
| `pet` | 33 | 低 |
| `cua-driver` | 5 | 极低 |

## 1. 核心手法：类型驱动收敛

上游的后端抽象是干净的判别联合：

```ts
// src/types/api.ts
export const HARNESS_IDS = ['omp', 'prime', 'pi'] as const
export type HarnessId = (typeof HARNESS_IDS)[number]
```

并且几乎所有分支都以 `Record<HarnessId, …>` 表达（`electron/main/harness.ts` 的
`HARNESSES`、`src/lib/harness.ts` 的三张名称表）。

因此裁剪的第一刀是**改一行类型**：

```ts
export const HARNESS_IDS = ['omp'] as const
```

然后 `npm run typecheck` 会把所有需要处理的位置全部报出来，逐个删。
**不要先手工删文件再跑类型检查**——那样会失去编译器的导航能力，变成盲删。

## 2. 分阶段执行

每个阶段结束都必须：`npm run typecheck && npm test && npm run check` 全绿，然后单独提交。

### T1 · 摘掉独立特性（低风险，先做）— 全部完成

| 特性 | 状态 | 提交 |
| --- | --- | --- |
| CUA 计算机控制 | ✅ | `c68f5fc` |
| 语音听写 / 实时语音、桌宠 | ✅（合并一次提交，二者通过 `App.tsx`/`VoiceOrb`/`DesktopPet` 深度耦合，拆开做反而更容易出错） | `11c21ed` |
| 定时任务（含 Heartbeats） | ✅ | `4959135` |
| Prime daemon socket 与协作分享（`/collab`） | ✅ | 待提交 |

**协作分享（`/collab`）与 daemon socket 实际执行记录**：

- 一开始按 trim-plan 原计划把两者归为一组，动手后发现范围判断有误：
  `agent-daemon.ts` 的 `queueDaemonFollowUp` 被 `sessions.ts`（T2 列表里的"核心资产"）
  直接调用，而不是像最初设想的完全独立文件。拆解后确认：`sessions.ts` 的
  `primeAgentPath` 对 OMP 恒为 `null`，daemon 分支对 OMP 从未可达，删除对
  OMP 行为零影响，遂当场决定连带处理，不再拖到 T2。
- `collaboration/*`（2 文件）与 daemon socket 相互独立，分别处理：
  - collaboration 触达 `index.ts`（`AgentCollaborationBridge` 构造、三个 harness 的
    `setRuntimeEnvironmentProvider`/`setRuntimeStartListener`/`revokeRuntimeCapabilities`）、
    `harness-adapter.ts`（三个 adapter 的 `--extension` 注入列表）、
    `sessions/transcript.ts`（渲染 guest 消息的信封解析）。
  - daemon socket 只触达 `sessions.ts` 的 `queueActiveFollowUp` 私有方法尾部，
    简化为固定 `return false`（"没有常驻 daemon 集成，外部会话收不到回复"），
    保留了方法前半的入参校验与"找不到可执行文件就抛错"契约，未来 T2 再决定
    是否连 `followUp()` 整个方法一起删。
- 顺手清理了 T1 前几步遗留的死引用：`harness-adapter.ts` 三个 adapter 里
  `PRIME_WORK_SCHEDULE_SKILL_PATH`/`PRIME_WORK_SCHEDULE_EXTENSION_PATH`
  （schedules 提交时只删了 `index.ts` 侧的注入源，没删 `harness-adapter.ts`
  侧的消费点，因为当时这两个文件的改动分属不同的关注点，容易漏），
  在这次改 collaboration 时一并清掉。
- 测试层：删除 `agent-collaboration-bridge.test.ts`；`transcript.test.ts` 删除整个
  `'GooeyPi agent messages'` describe 块；`pi-extension-host.test.ts` 删除 collaboration
  扩展注册测试；`omp/pi-agent-rpc.test.ts`、`extension-environment.test.ts` 修正
  `--extension` 注入断言；`sessions.test.ts` 删除两个 daemon 投递专属测试
  （`queues a follow-up through the active Prime Agent daemon...`、
  `rejects a daemon endpoint that is not a same-user Unix socket`）。
- **已知技术债，留给 T2**：`sessions.test.ts` 里
  `'resolves follow-up candidates through the cached live catalog...'` 和
  `'does not send a follow-up when the session is no longer active'` 两个测试
  目前仍能通过，但断言已经不再验证真实行为——`followUp()` 现在无论会话状态
  如何都直接返回 `false`，这两个测试是"凑巧通过"而非"验证正确"。T2 删除
  Prime 时应重新审视 `followUp()`/`queueActiveFollowUp()` 整个方法是否还有
  存在必要。

**定时任务实际执行记录**（比预想深，记录下来供 T2 参考）：

- `electron/main/schedules/*`（6 文件）+ `src/pages/ScheduledPage.tsx`（584 行）标准删除。
- `extensionRuntimeEnvironment()`/`CapabilityExtensionPaths`（`index.ts`）与 schedule bridge
  深度耦合在同一个「共享能力注入」函数里，与 browser/collaboration 共用一套
  `revokeRuntimeCapabilities` 撤销逻辑——**不是**独立可摘的模块，需要重构函数签名
  （去掉 `scheduleBridgeEnvironment` 参数）而不是整段删除。
- `activeShutdownWork`/`shutdownPrompt`（关闭确认弹窗）的 `activeSchedules` 字段贯穿
  `ActiveShutdownWork` 类型和两条消息文案，一并简化。
- `electron/main/store.ts` 里 schedule 的持久化 parser（`parseSchedule`/`parseScheduleRun`/
  `parseScheduleTarget`/`parseScheduleTiming`/`parseScheduleExecution` 等 5 个函数）随
  `DesktopState.schedules` 字段一起删；但 Windows 兼容层的
  `parseWindowsLegacyTombstone()`（校验旧版 v3 tombstone 文件的原始 JSON 结构）和
  `publishWindowsLegacyTombstone()`（写入固定的历史 v3 格式）**故意保留 `schedules: []`
  字面量不动**——那是模拟历史文件格式的死配置，不是我们当前的类型，改了反而破坏兼容层契约。
- 麦克风相关的 `com.apple.security.device.audio-input` entitlement 和对应的
  `scripts/release/verify-package.mjs` 打包校验一并清理（语音功能带来的残留）。
- **`zeromq` 打包验证是一整套独立机制**，不只是 package.json 一行依赖：
  `scripts/release/lib.mjs`（`assertAsarLayout`/`expectedUnpackedNativeLayout`/
  `assertUnpackedNativeLayout`）、`scripts/release/verify-cross-platform-package.mjs`
  （`nativeRuntimeDirectory`/`zeroMqAddonPattern`）、以及 `tests/release-scripts.test.ts`
  里约 15 处断言都要同步改，否则 `npm test` 直接红。`zeromq` 本身作为 `prime-agent` 的
  传递依赖，只有 T2 删掉 `prime-agent`/`prime-agent-ai` 后才会真正从 `node_modules` 消失。
- 定时任务是当时唯一被认为「可能想留」的特性；执行后判断：价值不足以抵消它在
  `index.ts` 共享能力注入函数里的耦合成本，维持删除决定。

> **注意**：`electron/main/settings-schedules.ts` 尽管文件名带 schedules，实际是
> 整个 `AppSettings` 的通用校验服务（主题、语言、harness 选择、MCP 禁用列表等都在这里），
> **不能删除**，只能在对应特性被摘除后同步删掉该文件里属于那些特性的字段校验器
> （`petEnabled`/`petId`/`petSize`、`voice*`、`computerUseEnabled`）。

> **注意**：`zeromq` 未被任何源码 `import`，只出现在 `package.json` 的
> `build.*.asarUnpack`/`files` 排除规则与 `tests/release-scripts.test.ts` 里，
> 是已死配置，不依附于 daemon/collaboration 的删除，直接清理。

### T2 · 收敛 HarnessId（主刀）

1. 把 `HARNESS_IDS` 收敛为 `['omp']`。
2. 跑 typecheck，按报错逐个处理：
   - `Record<HarnessId, X>` 的字面量对象 → 删掉 `prime` / `pi` 两个键。
   - `harness === 'prime'` 分支 → 删分支，保留 omp 路径。
   - `providers-pi.ts`、`providers.ts`（Prime provider）、`sessions/pi.ts` → 整文件删。
3. 删除 `vendor/prime-agent*.tgz`（4 个包，22MB）与 `package.json` 里的
   `prime-agent` / `prime-agent-ai` 依赖。
4. 删除 `assets/prime-integrations/`。
5. `BROWSER_PARTITION = 'persist:prime-work-browser'` 等历史字符串一并改名。

**保留不动的核心资产**（这就是 fork 上游的全部理由，不要顺手重构）：

```
electron/main/agent-rpc/          RPC 传输、分块重组、事件归一化、命令 schema
electron/main/sessions/           会话目录、转录、元数据
electron/main/plugins/            插件/扩展/MCP 安装与目录
electron/main/{projects,git,terminal,store,ipc}.ts
electron/main/model-catalog*.ts   omp models --json
src/components/transcript/        会话流渲染
src/components/ExtensionUiModal.tsx   ★ omp 的工具审批弹窗载体，安全命门
```

### T3 · 后端抽象的去留

`HarnessDescriptor` / `harness-adapter.ts` 这层抽象在只剩一个后端后看似冗余，
**但不要拆掉**。理由有二：

- `HarnessDescriptor` 里的 `bundledResourceDirs` 正是我们后面「随包分发 / 首启下载 omp 二进制」
  要用的机制，上游已经为 Prime 实现过一遍。
- 保留一层薄抽象，未来若要接 DSH 或其他后端，成本从「重写」降到「新增一个 adapter」。

处理方式：把 `Record<HarnessId, …>` 简化为单值常量，但保留 `harness-adapter.ts` 的接口形状。

### T4 · 依赖与体积复核

删完后应当能移除：`rrule`（随定时任务）、`zeromq`（已死配置，与 daemon/collaboration 删除无关但顺手清）、`prime-agent`、`prime-agent-ai`（T2 阶段）。
`node-pty` 保留（内置终端，给高级用户的后门）。
验收：`npm ls --omit=dev` 中不再出现上述包；`.git` 之外的仓库体积较基线明显下降。

## 3. 风险与回退

| 风险 | 处置 |
| --- | --- |
| 删 Prime 时误伤共享代码路径（provider 目录、MCP 目录、会话目录三处最容易） | 每阶段独立提交；`tests/backend/` 里的 omp 用例是回归网 |
| 上游后续 bugfix 无法合入 | 保留 `upstream` remote，按需 cherry-pick；不做长期同步 |
| 测试基线本身依赖 Prime | T1 前先记录 baseline 测试通过数，删除后逐条核对减少的用例是否都属于被删特性 |
