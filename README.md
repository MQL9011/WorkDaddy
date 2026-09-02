# WorkDaddy

**把技能做成主界面的桌面工作台。** 浏览、校验、分发技能，再在图形界面里发起对话——不需要先熟悉终端。

技能在命令行里通常是黑盒：装了什么、有没有同名冲突、深层目录会不会被静默忽略，用户看不见。WorkDaddy 把这些摊开：技能库按项目 / 个人 / 内置分组，详情页渲染 `SKILL.md` 与 frontmatter，发现校验标出不会被扫到的定义；同名冲突如实提示，而不是假装能判断哪个生效。会话过程中若回复读到了匹配已知技能的路径，会给出「可能命中」提示。

面向两类人：

- **有技能资产、要分发给团队**：技能库是一等公民，不是藏在设置里的附属项。冲突、来源、正文都可查。
- **不熟悉终端**：首启向导检测并安装运行时、图形化选工作目录、用大白话解释审批模式，并引导完成登录。干净机器上走完向导即可开始对话。

凭据由运行时自己管理。本应用不读取、不存储、不转发模型登录信息。

---

## 下载

当前版本 **0.2.12**。安装包发布在 GitHub Releases：

**https://github.com/MQL9011/WorkDaddy/releases/latest**

| 平台 | 安装包 | 说明 |
| --- | --- | --- |
| macOS（Apple 芯片） | [WorkDaddy-0.2.12-m-chip.dmg](https://github.com/MQL9011/WorkDaddy/releases/download/v0.2.12/WorkDaddy-0.2.12-m-chip.dmg) | 已签名公证，双击安装 |
| Windows（x64） | [WorkDaddy-0.2.12-win-x64.exe](https://github.com/MQL9011/WorkDaddy/releases/download/v0.2.12/WorkDaddy-0.2.12-win-x64.exe) | 免签名 beta；SmartScreen 可能提示，选「更多信息 → 仍要运行」 |

也可下便携包：[macOS arm64 zip](https://github.com/MQL9011/WorkDaddy/releases/download/v0.2.12/WorkDaddy-0.2.12-arm64.zip) · [Windows zip](https://github.com/MQL9011/WorkDaddy/releases/download/v0.2.12/WorkDaddy-0.2.12-win-x64.zip)。校验和见同目录 [SHA256SUMS.txt](https://github.com/MQL9011/WorkDaddy/releases/download/v0.2.12/SHA256SUMS.txt)。

Linux 与 Intel Mac 安装包尚未随 0.2.12 发布，后续版本会放在同一 Releases 页。

仓库与问题反馈：[github.com/MQL9011/WorkDaddy](https://github.com/MQL9011/WorkDaddy)

---

## 使用

1. 按上表下载对应平台安装包并打开。
2. 第一次启动会进入向导：检测 / 安装运行时 → 选择工作目录 → 选择审批模式 → 登录引导。任一步可跳过，之后在设置里补完。
3. 侧栏点 **New session**（`⌘N` / `Ctrl+N`）开始对话；底部 **技能** 入口打开技能库。

审批模式随时可在「设置 → Agent」更改：

- **Always ask**（默认）：改文件、跑命令前都会问。
- **Ask before running commands**：可以改文件，执行命令前仍会确认。
- **Never ask**：完全自主，只在充分信任当前任务时使用。

更细的日常操作与 FAQ 见 [使用指南](docs/user-guide-zh.md)。

---

## 开发

需要 Node.js 24.15.0 或更新，以及 npm 12.0.2 或更新。仓库在 `.nvmrc` 里锁定了 24.15.0，配合 [nvm](https://github.com/nvm-sh/nvm) 可以直接选中：

```bash
nvm install && nvm use
npm run toolchain:bootstrap
npm install
npm run dev
```

`toolchain:bootstrap` 会校验仓库内置 npm 归档并固定工具链版本，只在 CI 或需要钉死 npm 时必要；本地开发通常可跳过，直接 `npm install && npm run dev`。首次启动若本机还没有智能体运行时，应用会通过向导检测并安装。

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发环境（electron-vite） |
| `npm run typecheck` | 四个 tsconfig 的类型检查 |
| `npm test` | vitest 单元与集成测试 |
| `npm run check` | lint + 格式检查 |
| `npm run package:mac` | 产出 macOS 安装包 |

提交前：

```bash
npm run typecheck && npm test && npm run check
```

---

## 文档

更细的使用说明见 [使用指南](docs/user-guide-zh.md)。

## 安全

疑似安全漏洞请遵循 [security policy](.github/SECURITY.md)，不要公开发布敏感细节；完整技术安全模型见 [docs/security.md](docs/security.md)。

## License

MIT，见 [`LICENSE`](LICENSE)。
