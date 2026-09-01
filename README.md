# WorkDaddy

**一个 [oh-my-pi (omp)](https://github.com/can1357/oh-my-pi) 的桌面客户端，把「技能」做成主界面。**

- 面向**有技能资产、想分发给团队**的人：技能库（按项目/个人/内置分组浏览，同名冲突诚实提示，
  而不是假装能判断哪个生效）、技能详情（frontmatter、正文渲染、非递归发现校验）、
  会话内「可能命中的技能」提示。
- 面向**不熟悉终端**的人：首启向导——自动检测/下载 omp（校验官方 SHA256SUMS.txt）、
  图形化选工作目录、审批模式用大白话解释、登录引导直接带你打开终端。

> 状态：**S1–S6 已完成，0.2.0 已发布**（macOS 已签名公证，Windows 为免签名 beta，Linux 待补）。
> 开发计划与每个 Sprint 的实际完成情况见 [`docs/ancoder/ITERATION_PLAN.md`](docs/ancoder/ITERATION_PLAN.md)。

---

## 为什么是 omp

- 技能体系完整：`SKILL.md` 目录发现（`~/.omp/skills`、项目内 `.omp/skills`、omp plugin
  内置技能），模型侧按需读取正文。**没有跨来源优先级判定**——omp 按 `kind:realpath` 去重，
  两个不同文件即使同名也会一起出现；WorkDaddy 如实标注「重名」而不是编造一个仲裁结果。
- 原生兼容 Claude Code 的技能格式——已有的 `~/.claude/skills` 开箱即用。
- 嵌入接口完备：`omp --mode rpc` 是有完整规范的 NDJSON over stdio 协议，不需要 pty 抓屏。
- MIT 协议，官方提供各平台单文件二进制。

## 项目关系

本项目 fork 自 [am-will/gooey-pi](https://github.com/am-will/gooey-pi)（MIT），
上游是「Pi / OMP / Prime Agent 三后端通用工作台」，我们收敛为 **omp 单后端 + 技能优先**。
详见 [`NOTICE.md`](NOTICE.md)。

视觉参考 [DeepSeek Harness Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)，
设计规范见 [`docs/ancoder/design-system.md`](docs/ancoder/design-system.md)。

---

## 开发

### 环境要求

需要 Node.js 24.15.0 or newer and npm 12.0.2 or newer。仓库在 `.nvmrc` 里锁定了 24.15.0，配合
[nvm](https://github.com/nvm-sh/nvm) 可以直接选中：

```bash
nvm install && nvm use
npm run toolchain:bootstrap
```

`toolchain:bootstrap` 会校验仓库内置 npm 归档的大小与 SHA-512，install-time lifecycle scripts disabled
离线装进 invoked npm's configured global prefix，再核对 CLI 与两个工具版本是否与 `package.json`、
`.nvmrc` 一致。这一步只在 CI 或需要固定 npm 版本时必要；本地开发通常直接用系统里已装好的 npm 即可跳过。

```bash
npm install
npm run dev
```

另需一份已安装并登录的 omp：

```bash
curl -fsSL https://omp.sh/install | sh
```

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发环境（electron-vite） |
| `npm run typecheck` | 4 个 tsconfig 的类型检查 |
| `npm test` | vitest 单元与集成测试 |
| `npm run check` | lint + 格式检查 |
| `npm run package:mac` | 产出 macOS 安装包 |

### 提交前

```bash
npm run typecheck && npm test && npm run check
```

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/user-guide-zh.md) | 面向最终用户：首启向导、日常使用、常见问题 FAQ |
| [开发迭代实施计划](docs/ancoder/ITERATION_PLAN.md) | Sprint 划分、验收条件、每个 Sprint 的实际完成情况 |
| [发布配置指南](docs/ancoder/RELEASE_SETUP.md) | 打 tag 自动发布流程、签名证书与 secrets 配置清单 |
| [本地构建与手动发布](docs/ancoder/LOCAL_BUILD_AND_RELEASE.md) | CI 跑不了时的应急路径：本机签名公证、跨平台交叉构建、手动发布 |
| [设计规范](docs/ancoder/design-system.md) | 配色、布局、组件规则（DSH 风格取样） |
| [裁剪方案](docs/ancoder/trim-plan.md) | 三后端收敛为 omp 单后端的执行方案 |
| [上游 README](docs/ancoder/upstream-README.md) | 保留的 gooey-pi 原始说明，供对照 |

`docs/` 下其余文件为上游文档，逐步替换中；我们自己的文档统一放在 `docs/ancoder/`，
以便与上游做 cherry-pick 时不冲突。

## 安全

疑似安全漏洞请遵循[security policy](.github/SECURITY.md)，不要公开发布敏感细节；
完整技术安全模型见 [docs/security.md](docs/security.md)。

## License

MIT，见 [`LICENSE`](LICENSE) 与 [`NOTICE.md`](NOTICE.md)。
