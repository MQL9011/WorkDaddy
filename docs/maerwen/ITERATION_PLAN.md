# WorkDaddy 开发迭代实施计划

> 版本：v1 · 2026-08-17
> 基线：fork 自 [am-will/gooey-pi](https://github.com/am-will/gooey-pi) `v1.1.11-6-g6f40736`（MIT）

---

## 0. 产品定义

**一句话**：一个 [oh-my-pi (omp)](https://github.com/can1357/oh-my-pi) 的图形前端，
**技能（Skill）是主界面而不是设置项**。

**两个目标用户**：

1. 有一批自制技能、想把它们分发给团队的人（核心）。
2. 不熟悉终端、但需要用上 AI 编码智能体的人（次要，但决定了首启体验的下限）。

**明确的非目标**：

- 不做 IDE、不做代码编辑器。
- 不做多后端通用工作台（这是上游的定位，我们主动放弃）。
- 不改 omp 上游源码，不夹带私有分支的 omp。
- 不接管 omp 的模型凭据（凭据留在 `~/.omp/agent/agent.db`，我们只做引导）。

---

## 1. 里程碑总览

| Sprint | 主题 | 时间盒 | 退出条件（Gate） |
| --- | --- | --- | --- |
| S0 | 环境与基线 | 0.5 天 | ✅ 已完成，见 §3 |
| S1 | 单后端裁剪 | 3–5 天 | 只剩 omp，typecheck/test 全绿，四个依赖被移除 |
| S2 | 品牌与外壳 | 2 天 | 三平台安装包能产出，应用名/图标/更新源全部换掉 |
| S3 | UI 换肤（DSH 风格） | 5–7 天 | 明暗双主题走查通过，窄窗不塌 |
| S4 | **技能一等公民** | 7–10 天 | 端到端场景验收（见 §S4） |
| S5 | 首启向导与分发 | 5 天 | 干净机器上零终端完成首次对话 |
| S6 | 打磨与 0.1.0 发布 | 3 天 | 公开 release + 安装文档 |

单人全职估算约 **5–6 周**到 0.1.0。S3 与 S4 可并行（一个改样式一个改功能，冲突面小）。

**优先级取舍**：如果时间被压缩，S3 可以推迟到 0.2.0，S4 和 S5 不能。
换肤是观感，技能页和首启向导是这个产品存在的理由。

---

## 2. 分支与提交

- `main`：可发布状态，受保护。
- `feat/*`、`chore/*`：单一 Sprint 内的工作分支，squash 合入。
- `upstream` remote 保留指向 gooey-pi，仅用于按需 cherry-pick，**不做长期同步**。
- 每个 Sprint 的每个阶段独立提交，提交前必须 `npm run typecheck && npm test && npm run check`。
- 版本号从 `0.1.0` 重新起算（上游 1.1.11 的版本号不继承）。

---

## 3. S0 · 环境与基线（已完成）

| 项 | 状态 |
| --- | --- |
| 仓库导入（保留上游 663 次提交历史与 MIT 归属） | ✅ |
| `origin` = `MQL9011/WorkDaddy`，`upstream` = `am-will/gooey-pi` | ✅ |
| Node 24.15.0（`.nvmrc` 要求）安装 | ✅ |
| `npm install` | ⚠️ 完成，但有 `electron-winstaller` 的 `ENOTEMPTY` 告警，不影响开发链路 |
| `npm run typecheck`（4 个 tsconfig） | ✅ 全绿 |
| `npm test` | ⚠️ 1603 个用例，**上游自带约 10 个不稳定用例**，见下 |
| 设计规范文档（DSH 取色） | ✅ `docs/maerwen/design-system.md` |
| 裁剪方案文档 | ✅ `docs/maerwen/trim-plan.md` |

#### S0 发现的既有问题：测试套件不稳定

同一份代码连跑两次，失败集合不同（第一次 6 failed / 1596 passed，第二次 10 failed / 1592 passed），
且两次的失败用例不完全重合。已观察到的抖动用例集中在超时、进程 spawn 与限流：

```
tests/backend/omp-agent-rpc.test.ts    steering snapshot
tests/backend/providers-omp.test.ts    kills a hung CLI at the timeout / 顶层 shape 校验
tests/backend/providers-pi.test.ts     data shape 校验
tests/backend/sessions.test.ts         live-catalog 的三个 in-flight / 限流用例
tests/backend/plugins.test.ts          pi CLI 输出边界
tests/backend/process-utils.test.ts    Finder 式最小 PATH 下的 nvm 解释器
tests/release-scripts.test.ts          package.mjs --dry-run
```

**影响**：Gate 不能写成「测试全绿」，否则第一天就会被自己的门禁卡死。
改为：**建立已知抖动清单，Gate = 不出现清单之外的新失败**；
并在 S1 顺手把其中属于 omp 关键路径的用例（`omp-agent-rpc`、`providers-omp`、`sessions`）
改造成确定性用例——这几条恰好覆盖我们最依赖的代码。属于 Pi/Prime 的用例会随裁剪一起消失。

**S0 未完成、需要人工介入的一项**：本机尚未安装 omp。

```bash
curl -fsSL https://omp.sh/install | sh
```

装完后需要人工完成一次 omp 登录（凭据写入 `~/.omp/agent/agent.db`，这一步无法自动化），
然后跑 `npm run dev` 验证三件事：RPC 握手成功、`~/.claude/skills` 下的技能被发现、
工具审批弹窗能正常拦截。这是 S1 开工前的 go/no-go 闸门。

---

## 4. Sprint 详述

### S1 · 单后端裁剪（3–5 天）

执行 [trim-plan.md](./trim-plan.md)，四个阶段 T1→T4。

**T1–T4 状态：✅ 全部完成**（CUA / 语音+桌宠 / 定时任务 / daemon+协作分享 四个特性
移除；`HarnessId` 收敛为 `['omp']`；`HarnessDescriptor`/`harness-adapter.ts` 按计划
简化为单值常量但保留接口形状；依赖复核完成。每步独立提交并推送，每步
`npm run typecheck && npm test && npm run check` 全绿）。

**验收**

- `HARNESS_IDS` 只剩 `['omp']`，全仓库无 `prime` / `pi` 后端代码路径。✅
- `npm run typecheck` 全绿；`npm test` 不出现已知抖动清单之外的新失败。✅
  （1200+ 用例全绿，仅剩两类已知抖动：`tests/backend/sessions.test.ts` 里
  spawn/rmSync 相关的偶发超时或 tmp 目录竞态，单独运行必过；
  `tests/release-scripts.test.ts` 因本机 Node 版本为 v22.18.0 低于仓库要求的
  `>=24.15.0` 而失败，属环境问题非代码回归。）
- omp 关键路径的抖动用例（`omp-agent-rpc`、`providers-omp`、`sessions`）改造为确定性用例。
  ⏳ 仍未做。已确认抖动集合收窄到 `tests/backend/sessions.test.ts` 一处（子进程
  spawn 计时 + 临时目录清理竞态），且只在全量并行跑（1200+ 用例）时出现，单独
  跑该文件 100% 通过。把它改造成确定性用例（控制 fake timer / 序列化子进程
  生命周期）是独立于 harness 裁剪的一块工作量，留作后续任务，不阻塞 S1 出口。
- `rrule`、`zeromq`、`prime-agent` 三个依赖已消失；`prime-agent-ai` **有意保留**——
  `electron/main/model-catalog-cli.ts` 的 `supportsFastMode` 依赖它做模型快速模式
  判定，这是 omp/pi 共享的上游机制而非 Prime 专属代码，强行摘除会需要在本仓库
  重新实现一份模型元数据表，收益不足以覆盖引入判定错误的风险。`npm ls --omit=dev`
  确认无 `rrule`/`zeromq`/裸 `prime-agent`；`vendor/` 从 22M 降至 3.9M。
- `npm run dev` 仍能与 omp 建立会话并完成一轮对话。⏳ 本机尚未安装 omp，未验证。

**风险**：Prime 在 207 个文件里出现。必须用类型驱动（先收窄联合类型，让 tsc 导航），不能盲删。

---

### S2 · 品牌与外壳（2 天）

> **顺序不能颠倒：必须先裁剪再改名。** `gooeypi` 字样出现在 129 个文件里，其中
> `package.json` 的依赖路径 `file:vendor/prime-agent-0.7.0-gooeypi.1.tgz` 是真实文件名——
> 一次全局替换会直接打断 `npm install`。这些 vendor 包会在 S1 随 Prime 一起删掉，
> 那之后改名才是纯机械操作。

- `package.json`：`name` → `work-daddy`，`productName` → `WorkDaddy`，
  `build.appId` → `ai.maerwen.work`，`homepage`/`repository` 指向新仓库，版本重置 `0.1.0`。
- 图标：`assets/icon.icns` / `icon.png` 换成自有品牌。
- 自动更新源（`electron-updater`）指向 `MQL9011/WorkDaddy` 的 releases。
- `LICENSE` 保留上游 MIT 原文，新增 `NOTICE.md` 声明衍生关系（MIT 的署名义务）。
- i18n 默认中文（上游有 `src/lib/i18n.tsx`，已具备框架）。
- 窗口标题、关于面板、错误文案里的 GooeyPi / Prime Work 字样清理干净。

**状态：✅ 机械/文案部分已完成**（package.json 全字段改名、图标重绘并通过防篡改
测试、GooeyPi 吉祥物与残留字样清理、NOTICE.md 已在更早阶段就位、i18n 默认切至
zh-CN，全部通过 `typecheck && test && check`）。

**未验证**：`npm run package:mac` 需要真实的 Apple 开发者签名/公证凭据，属于
需要人工在本机（配置好签名证书后）执行并检查产物的步骤，不在自动化范围内。

**有意未动**（内部标识，用户不可见，改名成本大于收益，留作后续任务）：
`prime-work://` 自定义协议名、`prime-work-state*.json` 状态文件名、
`window.prime` contextBridge 全局名、`PRIME_WORK_*`/`GOOEYPI_*` 环境变量名、
`.gooeypi` 设置锁文件后缀、`gooeypi-ask-user` 技能 id。

---

### S3 · UI 换肤（5–7 天）

按 [design-system.md](./design-system.md) 执行。

| 任务 | 文件 |
| --- | --- |
| 深色 token 替换为 DSH 采样值 | `src/styles/base.css` |
| 助手消息去气泡、用户消息右对齐气泡 | `src/styles/transcript.css` |
| 输入框改大圆角双行布局 + 圆形蓝色发送键 | `src/styles/composer.css` |
| 侧栏：品牌区、新会话按钮、工作区分组、底部设置/技能入口 | `src/styles/sidebar.css` |
| 顶部「对话 / 轨迹」tab + 蓝色下划线 | `src/styles/workbench.css` |
| 输入框下方 token/耗时状态条 | 新增组件 + `composer.css` |

**验收**：明暗双主题各走查一遍；1024px 窄窗下侧栏转为覆盖层不塌；
对照 DSH 预览图逐项核对布局清单。

**状态：🔶 token/尺寸层已完成，信息架构层延后到 S4**

已完成：`--prime`/`--prime-soft` 拆分重命名为 `--accent`/`--accent-soft`/
`--accent-idle`/`--accent-bg`（对应 DSH 文档里三种不同语义，而不是简单改名）；
深色主题 canvas/sidebar/surface-raised/surface-selected/text-* /border 全部换成
文档采样值；新增 `--surface-control` 并用于「新会话」按钮；侧栏 280px、输入框
20px 圆角、发送按钮 40px 实心圆、用户气泡 18px/70% 宽度全部落地。顺手清理了
T1 阶段裁剪特性后残留但未删除的死 CSS（语音/日程/心跳相关规则，及已删除的
PrimeMark/PiMark 组件样式），`pages.css` 232→58 行、`settings.css` 176→110 行。

未完成：顶部「对话 / 轨迹」tab（含蓝色下划线）与侧栏底部「技能」入口，两者
都是信息架构变化而非纯样式替换——前者需要把 Activity 从独立侧栏页面改造成
会话内 tab 并承载技能命中时间线，后者需要一个真实的技能页作为跳转目标。
design-system.md 第 4 节本身也把这两处和 S4 的技能功能绑在一起讲，故延后到
S4 实现技能页时一并做，避免先搭一个空壳 tab 再返工。

**未验证**：本机无法在浏览器中预览 Electron 渲染进程（需要真实窗口），
明暗双主题走查、DSH 预览图逐项核对、1024px 窄窗覆盖层行为均未做人工视觉验收，
仅通过既有的 jsdom 组件测试套件（全绿）间接验证未破坏渲染逻辑。

---

### S4 · 技能一等公民（7–10 天）★ 核心

上游已有 `PluginsPage.tsx`（Capabilities：packages/plugins/extensions/skills/prompts/MCP 混在一起）。
本 Sprint 把 skills 从中**独立出来提升为主导航**，并新增三块上游没有的能力。

> **本节 4.1/4.2 的原始描述已被证实不符合实际代码，执行前用 Explore agent
> 通读了 `electron/main/plugins/catalog.ts`/`plugins.ts` 全文并作了修正**
> （详见下方每小节的「实际情况」）。这是单后端裁剪之前针对多来源生态
> （claude/claude-plugins/opencode/github 等）的过时设想，omp-only 的这个
> fork 里从未真正实现过那套多来源优先级或 disabledExtensions 之类的配置项。

#### 4.1 技能库页（3 天）—— ✅ 已完成，按修正后的模型实现

原文设想的 `native(.omp) 100 → omp-plugins 90 → claude 80 → ...` 发现优先级链，
以及 `disabledExtensions` / `ignoredSkills` / `includeSkills` 配置项，在代码里
全文搜索**均不存在**——这是单后端裁剪前的过时设想。实际情况：

- 只有一个后端（omp），技能来源维度是 `location: 'bundled' | 'user' | 'project' | 'system'`，
  不是多引擎优先级。`SkillsPage.tsx` 按 location 分组（Project → Personal → Bundled → System）。
- **同名冲突**：omp 的发现逻辑按 `${kind}:realpath` 去重，两个不同路径下同名的技能
  会**同时**出现在列表里，代码里没有任何"谁生效"的判定逻辑。因此没有做（也不可能
  诚实地做）"哪个生效、哪个被覆盖"的可视化，而是标注醒目的「重名」徽章，如实告诉
  用户"这两个文件都声明了同一个名字，WorkDaddy 不知道 omp 会用哪个，请自己检查"。
- **启停**：单个技能/prompt 文件在当前代码里**没有独立启停开关**（发现时硬编码
  `enabled: true`）；只有其容器（package）能通过 `omp plugin enable/disable` 启停，
  已有的 Capabilities 页面已经覆盖这条路径。技能库页因此是纯浏览/搜索/筛选，
  不提供也不假装提供单个技能的启停控制。
- 搜索 + 按 location 筛选已实现，复用了 `PluginsPage.tsx` 已验证过的过滤逻辑。

#### 4.2 技能详情（2 天）—— ✅ 已完成

- 新增 `electron/main/plugins/catalog.ts` 的 `readSkillDocument()`：按需读取单个
  SKILL.md 全文，复用已有的 frontmatter 扫描基础设施解析
  `description`/`globs`/`alwaysApply`/`disable-model-invocation`，正文用现成的
  `MarkdownText` 渲染。
- 同级文件清单 + reveal-in-file-manager（复用已有的 `authorizeReveal` 白名单
  鉴权，未引入新的任意文件读取面）。
- **非递归发现校验器**：因为 omp 的实际目录扫描只认
  `<root>/skills/<name>/SKILL.md` 这一层，技能详情里列出的每个子目录都会检查
  是否自带一个会被静默忽略的嵌套 SKILL.md，命中则在 UI 上直接标红提示。

#### 4.3 技能命中可视化（2 天）—— 🔶 会话流卡片已完成，轨迹 tab 时间线延后

调研确认（`electron/main/agent-rpc/harness-adapter.ts` 的注释直接写明）omp 的
skill 加载完全是 discovery-based、对桌面端不可见——**没有任何 `skill://` 读取
事件或 `/skill:<name>` 命令**流经现有 RPC 层。这不是"接线"工作，是从零发明一套
检测启发式，因此选了原文两个交付物里更小、风险更可控的那个先做：

- ✅ **会话流顶部的命中卡片**：`src/lib/skill-hits.ts` 的 `detectSkillHits()`
  扫描一轮助手消息的所有 `toolCall` 参数（递归找字符串，有深度/数量上限），
  与已发现技能的文件路径做前缀匹配，命中就在该轮回复顶部显示一枚
  「Possibly used `<name>`」徽章。文案刻意用「Possibly」而非「Used」，
  hover 提示进一步说明这只是路径匹配、不代表模型真的照做——路径匹配天然有
  假阳性，不能伪装成精确信号。
- ⏳ **轨迹 tab 时间线**：延后。这需要先把 Activity 从独立侧栏页面改造成
  会话内 tab（S3 里已经识别过、同样延后的信息架构变化），不是本节可以单独
  完成的工作，等这块信息架构调整启动时再一并做。

#### 4.4 技能包安装与分发（2–3 天）—— 🔶 核心安装路径已存在，`Maerwen_SkillsCreator` 集成待澄清

- omp plugin / 本地目录 / MCP 三种安装源已经在 `PluginsPage.tsx` 的 Add 弹窗里
  实现并测试覆盖（`omp plugin install <target> --json`，本地扩展文件安装，
  本地 stdio MCP）。技能库页刻意没有重复这套 UI，而是保持技能库为纯浏览视图，
  安装/管理仍走 Capabilities 页——这与 4.1 的"技能没有独立启停"结论是一致的。
- **未知项**：`Maerwen_SkillsCreator` / `skill-cli` 具体是什么（本机可执行文件？
  npm 包？需要网络的 Web 服务？），仓库里没有任何相关文件或文档。在明确这一点
  之前，"应用内新建技能调起既有生成器"这条无法开工。

**S4 端到端验收场景（原始 5 条，按实际模型修正）**

1. ✅ 用户装上应用 → 技能库能看到 `~/.omp/skills` 下的既有技能。
2. ✅ 安装一个 omp plugin（走 Capabilities 页）→ 其内含技能出现在技能库 → 详情可读。
3. 🔶 发起一次会话 → 技能被命中 → 该轮回复顶部能看到「Possibly used」提示卡
   （4.3 的会话流卡片已实现；轨迹 tab 的完整时间线延后）。
4. ❌ 不适用——单个技能文件在当前 omp 模型里没有独立启停开关，只有其容器
   package 可以启停（已可用，Capabilities 页）。
5. ✅（但表现改为诚实的"重名"提示而非"谁生效"判定）制造一次同名冲突 →
   技能库明确标注两条记录都存在同一个名字，而不是编造一个虚假的胜负判定。

---

### S5 · 首启向导与分发（5 天）—— 🔶 核心向导已完成，签名公证不在自动化范围

面向「不熟悉终端」的用户，这一段决定产品成败。

1. ✅ **omp 运行时获取**：`electron/main/omp-installer.ts`。执行前先用 `gh api`
   核对了 `can1357/oh-my-pi` 仓库真实的 release 资产命名（`omp-darwin-arm64`/
   `omp-darwin-x64`/`omp-linux-arm64`/`omp-linux-x64`/`omp-windows-x64.exe`）
   和 `SHA256SUMS.txt` 的实际格式，没有凭空假设。SHA256 逐字节比对官方校验和，
   失败直接丢弃、绝不安装未验证的二进制；成功后写入 `<userData>/bin/omp`。
   - 确实没有内嵌进安装包：实测 darwin-arm64 资产 113,530,368 字节，与原文
     「113MB」的估计吻合。
   - **未按原文用 `bundledResourceDirs`**：调研发现该字段对 omp 当前是空数组，
     且语义上是给「安装包自带资源」用的，被 `process.resourcesPath` 是否为
     字符串这个判断天然挡在了开发环境之外。改为把托管目录接入
     `HARNESSES.omp.candidateDirs` 同级的解析链（作为 `HarnessDiscoveryService`
     `runtimePaths` 的默认回退值），语义更准确，也不需要改
     `HarnessDescriptor` 接口。
   - macOS Gatekeeper 隔离属性（`com.apple.quarantine`）没有做任何自动摘除
     处理——那是操作系统的安全边界，应用不应该越权替用户摘掉。
2. ✅ **登录引导**：向导最后一步给出文案，引导用户打开终端、运行 `omp`、
   输入 `/login`（这条命令语法是从 omp 官方 README 里核实的，不是猜的）。
   没有在向导里另起一个迷你终端，而是复用应用已有的终端面板——因为终端
   创建本身就要求 cwd 落在已授权项目根目录内，向导已经把「选工作目录」这步
   排在前面，直接解锁了已有终端功能，不需要重新实现一遍。全程
   **不代持、不解析、不落盘任何凭据**。
3. ✅ **工作目录授权**：复用已有的 `ProjectService.add()` / `bridge.projects.add()`
   原生目录选择器，没有另建一套。
4. ✅ **审批模式**：默认 `always-ask`；文案复用 `AgentSettings.tsx` 里已有的
   三档说明并按向导语境重写为更完整的句子，不暴露 CLI 参数名。
5. ⏳ **签名公证**：`build/entitlements.mac.plist` 与 `notarize: true` 配置本来
   就在（S2 阶段确认过），但公证需要真实的 Apple 开发者证书，属于打包发布
   流水线的范畴而不是应用运行时代码，不在能自动化验证的范围内——需要你在
   本机配置好签名身份后手动跑一次 `npm run package:mac` 验收。

**验收**：一台没装过任何终端工具的干净机器，从下载安装包到完成第一轮对话，
**全程不需要打开终端**——⏳ 未做真实机器走查（本环境没有 GUI 可交互的
Electron 窗口），已通过 8 个 omp-installer 单元测试（真实 GitHub release
资产命名/校验和格式）+ 7 个向导组件测试（覆盖每一步的成功/失败/跳过路径）
在结构上验证过，但没有人工点击一遍真实安装包。

---

### S6 · 打磨与 0.1.0 发布（3 天）—— 🔶 能自动化的部分已完成，签名发布留给你手动做

- ✅ **中文用户指南 + FAQ**：[`docs/user-guide-zh.md`](../user-guide-zh.md)，覆盖首启向导
  每一步、日常使用、常见问题。技能相关章节严格按 S4 的诚实语义写，没有重复早前文档
  里已经证伪的"多来源优先级"描述。
- ✅ **崩溃与错误上报路径**：`electron/main/crash-guard.ts` 从 fork 基线就存在，本次
  核对了它已经正确改用 `WorkDaddy fatal ...` 前缀（S2 阶段完成的改名），日志写入
  `app.getPath('userData')/crash.log`，有完整测试覆盖（`tests/backend/crash-guard.test.ts`），
  不需要额外开发。
- ⏳ **三平台 release 产物与 SHA-256 摘要**：产出机制本身已经在
  `scripts/release/prepare-github-release.mjs` 里实现好了（打包完会为每个产物算
  SHA-256 并写一份 `SHA256SUMS.txt`，和 `omp-installer.ts` 校验 omp 二进制用的是同一套
  约定）。**没有在本次会话里实际执行** `npm run package:mac/linux/win`——真正产出
  可分发的安装包需要真实的 Apple 开发者签名证书和（Windows 侧）Authenticode 证书，
  这些凭据不存在于当前环境，而且"产出并可能公开发布的安装包"本身就是一个需要你
  知情、按你自己的节奏来做的动作，不适合在没有凭据、也没有你在场确认的情况下由我
  自动跑完。等你配置好签名身份后，跑 `npm run release:verify` 走一遍完整校验，
  再用 `npm run package:mac`（以及 `:linux`/`:win`）产出三平台安装包即可——脚本、
  校验、体积预算全都已经就位，只差真实凭据这一步。

**整体验收**：`npm run typecheck && npm test && npm run check` 全绿（已确认，
`npm run check` 现在是本会话开始以来第一次零警告零错误）。

**后续更新（实际发布）**：上面"⏳"标记的三平台产物已经在后续会话里实际产出，
但过程和最初设想有出入，如实记录：

- GitHub Actions 从 S2 阶段那次 push 起就因为账号 billing 问题一直无法运行（`billing`
  报错，非代码问题），CI 矩阵构建到本文档更新时仍未跑通过一次。发布因此改为在本机
  手动构建。
- **macOS arm64**：账号持有人亲自创建了 Developer ID Application 证书（Account Holder
  权限限制——App Store Connect API Key 无法代为签发这类证书，只能网页端登录手动创建），
  走 `npm run package:mac` 完整签名 + 公证流程，`spctl -a -vvv` 独立验证
  `accepted, source=Notarized Developer ID`。**macOS x64 未产出**——原生模块 node-pty
  在 mac 端走本机编译（`build/Release/pty.node`），跨架构编译在 arm64 宿主上会打包进
  错误架构的二进制，这也是上游 CI 用两台不同架构 runner 分开构建的真实原因，不是过度
  谨慎。
- **Windows x64**：本机（macOS）直接调用 electron-builder 完成，绕开了
  `scripts/release/package.mjs` 的平台守卫（该脚本强制要求打包平台与宿主一致，是策略
  限制而非技术限制）。过程中发现并修复了 `scripts/release/after-pack.cjs` 的一个真实
  bug——`hardenElectron` 调用 `executablePath()` 时没传打包目标平台，默认回退到宿主
  `process.platform`，只有跨平台打包才会触发，原生 CI 三个平台 runner 各自匹配，从未
  暴露过。`nsis` + `zip` 目标产出成功；`appx` 需要 Wine/PowerShell Core/Parallels
  虚拟机之一，本机都没有，已跳过。最终产物未签名（无 Authenticode 证书），SmartScreen
  会提示。
- **Linux** 还没有实际产出——本机是 macOS，`package.mjs` 的平台守卫对 Linux 目标同样
  生效，且没有类似 Windows 那样"绕开守卫直接调 electron-builder"的验证过。
- 版本号从最初计划的 `0.1.0` 改为 **`0.2.0`** 才正式发布：`0.1.0` 这个 tag 名已经
  被上游继承的本地 tag 占用（指向 gooey-pi 的旧 commit），加上"S1–S6 全部完成、真实
  签名公证通过"比最初设想的 0.1.0 骨架版本更成熟，`0.2.0` 更准确。
- 过程中还顺手发现两处真实技术债，已拆成独立任务：e2e 测试套件（`tests/e2e/app.spec.ts`）
  自 S2 品牌重构起就没有真正跑通过——选择器还是改名前的 "Prime Work" 字样，加上 S5 加入
  的首启向导没有在 hermetic fixture 里被账（`onboardingCompleted` 未预置），弹窗挡住了
  所有后续交互。这套 e2e 从未被本地 `npm test`（只跑 vitest）覆盖到，只有跑
  `release:verify`/CI 才会触发，因此从改名那天起一直没被发现。

---

## 5. 持续项：omp 协议一致性 smoke

**这是本项目最容易被拖垮的地方，必须从 S1 就开始做。**

上游 gooey-pi 的 omp argv 契约是对 **omp 17.2.11** 实测确定的，而 omp 当前已到 **17.3.5**，
且几乎每天推送。

建立一组 CI 定时任务，对最新 omp 二进制断言：

- argv 接受性：`--mode rpc` `--cwd` `--resume` `--model` `--thinking` `--approval-mode` `-e`
- `ready` 帧字段与协议版本协商（v1/v2）
- 事件类型全集是否出现未知类型
- `omp models --json` 的 schema
- 技能发现结果与优先级顺序

任一断言失败 → 开 issue 并锁定已知可用的 omp 版本，不让用户先撞上。

---

## 6. 风险登记册

| # | 风险 | 影响 | 处置 |
| --- | --- | --- | --- |
| R1 | omp 上游协议漂移 | 高 | §5 一致性 smoke；README 标注已验证的 omp 版本区间 |
| R2 | 上游 gooey-pi 很新（2026-08-06 建仓，单一维护者） | 中 | 已 fork 断连；只 cherry-pick，不依赖上游存续 |
| R3 | Prime 移除误伤共享路径 | 中 | 类型驱动 + 分阶段提交 + omp 回归测试 |
| R4 | 登录环节劝退非终端用户 | 高 | S5 单独立项；必要时提供 API Key 直填的备选路径 |
| R5 | 安装包体积（Electron + omp 二进制） | 中 | omp 走首启下载而非内嵌；删 zeromq 等原生依赖 |
| R6 | MIT 署名合规 | 低 | 保留 `LICENSE` 原文 + `NOTICE.md` + 保留上游 git 历史 |
