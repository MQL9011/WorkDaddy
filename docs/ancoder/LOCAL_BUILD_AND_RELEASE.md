# 本地构建与手动发布

[`RELEASE_SETUP.md`](RELEASE_SETUP.md) 讲的是"打 tag → GitHub Actions 自动构建三平台 → 自动发布"这条正常流水线。
本文讲另一件事：**当 GitHub Actions 跑不了时（账号 billing 问题、临时没有 CI 额度、或者就是想在本机
先出一版验证），怎么绕开 CI 在本机把包构建出来并手动发布。**

这不是常规路径，是应急路径。`scripts/release/package.mjs` 本身有平台守卫，故意不让你在错误的宿主上打
错误平台的包——本文档记录的是什么时候、怎么安全地绕开它，以及绕不开的地方。

> **想直接跑，不想看这堆背景**：`npm run release:local`（等价于
> `scripts/release/local-release.sh`）把下面第 1–5 节全部自动化了——版本号 patch +1、质量门禁、
> mac 签名公证、win 交叉构建、改名、算 SHA256SUMS、打 tag、发布 Release，一条命令走完，中间只
> 在没有缓存密码时问你两个密码。`--minor`/`--major`/`--no-bump`/`--mac-only`/`--win-only`/
> `--dry-run`/`--yes` 看 `--help`。本文档剩下的部分是这个脚本背后的原理和排错参考——脚本
> 报错时回来查对应章节。

2026-08-19 用（当时还是手工版本的）这套流程在一台 macOS (Apple 芯片) 机器上手动构建并发布了 `v0.2.0`
（macOS arm64 签名公证 + Windows x64 免签名 beta），过程中的具体产出见
[`ITERATION_PLAN.md`](ITERATION_PLAN.md) S6 节的"后续更新"部分。本文档抽取的是可复用的方法，不是那次的流水账。

---

## 1. 前置条件

```bash
nvm install 24.15.0 && nvm use 24.15.0
npm run toolchain:bootstrap   # 装 pinned npm 12.0.2，release-scripts.test.ts 依赖这个版本
```

不做这一步，`package.mjs` 会在 `assertSupportedToolchain()` 直接拒绝执行（Node/npm 版本不达标）；
绕开 `package.mjs` 直接调 `electron-builder` 的路径（本文档第 3 节）不受这条限制，但仍然建议用同一
个受控的 Node/npm 版本，避免其他环境差异。

如果 `npm run toolchain:bootstrap`/`npm install` 报 `ERR_INVALID_AUTH: email must be renamed...`，
是全局 `~/.npmrc` 里有旧格式的 `email=` 配置，跑 `npm config fix` 修复（只重写过期 key 格式，不动其他配置）。

---

## 2. macOS：本机能完整走通签名 + 公证

不需要绕开任何守卫，`package.mjs` 支持的就是这条路径——前提是本机就是 macOS，且要打的架构和本机一致
（Apple 芯片机器打 arm64，Intel 机器打 x64；**不要跨架构**，见第 4 节）。

### 2.1 证书从哪来

Developer ID Application 证书**只能由 Apple 开发者账号的 Account Holder 登录网页端创建**，
App Store Connect API Key 无法代签发（哪怕是 Admin 角色的 key 也不行，会被 Apple 拒绝：
`This operation can only be performed by the Account Holder`）。完整步骤见
[`RELEASE_SETUP.md`](RELEASE_SETUP.md#21-创建-developer-id-application-证书)。

证书 + 私钥导出成一个 p12 文件（fastlane 的 `get_certificates` action 只给证书和裸私钥，
要自己用 `openssl pkcs12 -export` 把两者合并，`RELEASE_SETUP.md` 里有完整命令）。

### 2.2 跑构建

`package:mac` 就是 `node scripts/release/package.mjs --public --platform mac`。它默认走
`release:verify:package`（preflight + typecheck + lint + 覆盖率测试 + bundle 体积），**不含
e2e**——e2e 是 CI 自己独立的一个 job（`hermetic-e2e`），本地打包不应该被它卡住，`package.mjs`
早期版本曾经把两者耦合在一起（mac 平台走的是包含 e2e 的 `release:verify`），已经修好，现在
mac/linux/win 三个平台在本地打包时都统一不跑 e2e。需要单独验证 e2e 时手动跑
`npm run test:e2e:hermetic`（当前这套 e2e 有已知问题，见第 6 节）。

```bash
npm run package:mac -- --arch arm64
```

`--skip-verify` 仍然存在，是给"已经在别处确认过质量门禁（比如 CI 刚跑完这个 commit），本地只
是想重新出个包"这种场景用的——加了它连 typecheck/lint/覆盖率测试都会跳过，自己确认过这些已经
通过再用：

```bash
npm run typecheck && npm run check && npm test   # 自己确认门禁，替代被跳过的 release:verify:package
npm run package:mac -- --arch arm64 --skip-verify
```

需要的环境变量（`RELEASE_SIGNING_TEAM_ID`/`APPLE_TEAM_ID` 就是团队 ID；`CSC_LINK` 是 p12 转
base64；公证走 Apple ID + App 专用密码这条链路，`APPLE_API_KEY*` 那条链路当前在这条本地脚本里
没有被 CI workflow 实际接线，仍建议走 Apple ID 方式）：

```
CSC_LINK
CSC_KEY_PASSWORD
RELEASE_SIGNING_TEAM_ID
APPLE_TEAM_ID
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
```

**密码不要以字面量出现在你会保存/分享的命令里**——它们会留在 shell 历史文件里。推荐用临时文件
+ 一次性读取的模式：

```bash
# 密码单独写入仅当前用户可读的临时文件（不要用 echo "密码" > file，那样密码还是会进历史）
chmod 600 /tmp/.mac_pw /tmp/.apple_asp   # 文件内容自己填，第一行就是密码，不带引号不带换行以外的字符

export CSC_LINK=$(base64 -i /path/to/DeveloperID.p12)
export CSC_KEY_PASSWORD=$(cat /tmp/.mac_pw)
export APPLE_APP_SPECIFIC_PASSWORD=$(cat /tmp/.apple_asp)
export RELEASE_SIGNING_TEAM_ID=<TEAM_ID>
export APPLE_TEAM_ID=<TEAM_ID>
export APPLE_ID=<APPLE_ID_EMAIL>
rm -f /tmp/.mac_pw /tmp/.apple_asp   # 读进环境变量后立刻销毁临时文件

npm run package:mac -- --arch arm64 --skip-verify
```

公证是在等 Apple 服务器排队处理，实测单次十几分钟是正常的，别看着卡住就以为挂了。

### 2.3 验证产物

`package.mjs` 自带的 `verify-package.mjs` 已经会校验签名、公证票据、Gatekeeper——但那是同一条
流水线自己的校验，独立交叉验证一遍更放心：

```bash
spctl -a -vvv release/mac/arm64/mac-arm64/WorkDaddy.app
# 期望输出：accepted / source=Notarized Developer ID

xcrun stapler validate release/mac/arm64/mac-arm64/WorkDaddy.app
# 期望输出：The validate action worked!
```

注意 `.dmg`/`.zip` 容器本身不带 staple，`stapler validate` 要对**解包出来的 `.app`** 跑，不是对
`.dmg` 文件跑——DMG 文件本身没有单独签名是正常现象，Gatekeeper 真正检查的是里面的 `.app`。

### 2.4 用完立刻做的事

- p12 密码、App 专用密码：如果它们在任何时候被打字到过不该看到的地方（贴进聊天、写进日志），
  构建完立刻轮换，不要留着"下次再说"。
- 私钥文件（`.p12`、导出中间产物 `cert.pem`/`intermediate.pem`）：不需要了就删，不要留在磁盘上
  也不要提交进仓库。

---

## 3. Windows：本机 macOS 能交叉构建，但要绕开守卫

### 3.1 为什么 `package.mjs` 会拒绝

```
if (process.platform !== platformHosts[platform]) throw new Error(`${platform} packaging must run natively on ${platformHosts[platform]}`)
```

这是策略限制，不是技术限制——但底下确实有需要小心的地方，见 3.2、3.3。

### 3.2 原生模块：node-pty 在 Windows 侧不需要本机编译

`electron-builder` 打包非原生平台时默认会跑 `@electron/rebuild` 重新编译原生模块，
node-gyp 在 macOS 上编译不出 Windows 二进制，会直接报错：

```
node-gyp does not support cross-compiling native modules from source.
```

不需要走这一步——`node-pty` 的 npm 包本身**已经把 win32-x64/win32-arm64 的预编译二进制打包
在 `node_modules/node-pty/prebuilds/` 里**（`prebuild`/`prebuildify` 模式，不依赖本机编译，
也不依赖联网下载）。加 `--config.npmRebuild=false` 跳过这一步，运行时 node-pty 自己的加载逻辑
（`lib/utils.js`）会按**运行它的那台机器**的 `process.platform`/`process.arch` 去
`prebuilds/win32-x64/` 找对应二进制，跟打包时的宿主平台无关。

### 3.3 AppX 目标做不了，Wine/PowerShell Core/Parallels 至少要有一个

`nsis` 和 `zip` 目标在 macOS 上能完整走通（`makensis` 有原生 darwin 二进制，图标/版本信息注入
在这个 electron-builder 版本上是纯 JS 实现，都不需要 Wine）。`appx` 目标不行，实测报错：

```
Cannot find suitable Parallels Desktop virtual machine (Windows 10 is required)
and cannot access `pwsh` and `wine` locally
```

`electron-builder --win` 默认会把 `package.json` 里 `build.win.target` 配置的全部目标一起打，
一个目标失败会中断整个进程，连已经成功的目标都不落盘。所以要显式只指定能在 macOS 上完成的
目标，用位置参数（不是 `--config.win.target=nsis,zip`，CLI 不会把逗号分隔的字符串拆成数组，
会报 `Unknown target: nsis,zip`）：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder \
  --win nsis zip --x64 --publish never \
  --config.npmRebuild=false \
  --config.directories.output=release/win/x64
```

`CSC_IDENTITY_AUTO_DISCOVERY=false` 是免签名路径——本机没有 Windows Authenticode 证书时必须加，
否则 electron-builder 会去找一个不存在的签名身份。产物是免签名的，用户第一次运行会被 SmartScreen
拦一下，需要点"更多信息 → 仍要运行"。

想要 AppX（比如要上架 Microsoft Store），得在真 Windows 机器、或装了 Wine/PowerShell Core 的
macOS/Linux 上单独补，或者等 CI 恢复走原生 `windows-2022` runner。

### 3.4 跨平台打包会暴露的一个真实 bug（已修）

`scripts/release/after-pack.cjs` 的 `hardenElectron`（给可执行文件加 Electron 安全 fuse）曾经
调用 `executablePath(context)` 时没传打包目标平台，参数默认值 `= process.platform` 会静默退回
**宿主平台**。原生 CI 三个平台各自在匹配的 runner 上跑，宿主平台恰好总等于打包目标，这个 bug
从未被触发；本地跨平台打包 Windows 目标时第一次暴露——会拿 macOS 的
`.app/Contents/MacOS/...` 路径去处理一个 Windows `.exe`，直接报 `ENOENT`。

已经修好（用 electron-builder 在 afterPack context 上提供的 `electronPlatformName` 字段，
去掉了 `executablePath` 危险的默认参数）。以后类似跨平台打包应该不会再撞见这个具体问题，但这
也说明：**只要打包平台和宿主不一致，就有踩到未被 CI 覆盖过的路径的风险**，产物要按第 5 节做
额外验证。

---

## 4. 明确做不到的事，不要在这上面浪费时间

- **macOS x64（Intel）从 arm64 宿主打包**：node-pty 在 mac 端走本机编译（`build/Release/pty.node`），
  这个路径是被"执行 npm install 那台机器的架构"决定的，跟 electron-builder 的 `--arch` 参数无关。
  在 arm64 宿主上打 x64 包，装进去的会是架构错误的原生模块，x64 用户打开直接崩溃。这也是上游 CI
  故意用两台不同架构 runner（`macos-15` 打 arm64、`macos-15-intel` 打 x64）分开构建的真实原因，
  不是过度谨慎。要打 x64 mac 包，必须在真 Intel Mac 上跑。
- **Linux 从 macOS 宿主打包**：`package.mjs` 的平台守卫同样拦这个，而且没有像 Windows 那样验证过
  "绕开守卫直接调 electron-builder 是否可行"——不要假设它能按 Windows 那套方案照搬，验证成本
  没付过。

---

## 5. 手动发布到 GitHub Release

CI 自己的 `release-packages` job 用 [`scripts/release/prepare-github-release.mjs`](../../scripts/release/prepare-github-release.mjs)
做资产改名、校验完整性、生成 `SHA256SUMS.txt`，然后 `gh release create`。手动发布时这个脚本
期望的是"三个平台产物都在"的完整目录结构，本地只有一两个平台不好直接套用，手工做等价的事：

```bash
mkdir -p /tmp/release-assets && cd /tmp/release-assets

# 文件名要匹配 releaseAssetNames() 里定义的公开命名（mac dmg 会改名成 m-chip/intel-chip）
cp .../WorkDaddy-<version>-arm64.dmg  WorkDaddy-<version>-m-chip.dmg
cp .../WorkDaddy-<version>-arm64.zip  WorkDaddy-<version>-arm64.zip
cp .../WorkDaddy-<version>-win-x64.exe WorkDaddy-<version>-win-x64.exe
cp .../WorkDaddy-<version>-win-x64.zip WorkDaddy-<version>-win-x64.zip

shasum -a 256 * > SHA256SUMS.txt

gh release create v<version> * \
  -R MQL9011/WorkDaddy \
  --title "WorkDaddy <version>" \
  --notes "说明这次发布覆盖了哪些平台、哪些没有、为什么，参考 v0.2.0 的 release notes 格式"
```

发布前确认 tag 已经指向正确的 commit（`git tag -a v<version> -m "..."` + `git push origin v<version>`），
且 `package.json`/`package-lock.json` 的 version 字段与 tag 完全一致
（`node scripts/release/validate-release-tag.mjs --tag v<version>` 可以本地先校验一遍）。

**Release notes 里如实写清楚哪些平台/架构缺失、为什么**——比自动生成的 changelog 更重要。用户
需要知道"我这个平台有没有覆盖"，而不是被一份看起来完整实则报喜不报忧的说明误导。

---

## 6. 已知技术债：本地构建会暴露、CI 从没真正验证过的东西

这条流水线走一遍会顺带暴露一些原本被 CI 覆盖但 CI 长期没跑（billing 问题）而没人发现的问题，
记录下来避免下次又从头排查：

- `tests/e2e/app.spec.ts`（Playwright hermetic e2e）从品牌重构（改名 WorkDaddy）起就没有真正
  跑通过——选择器还残留改名前的 "Prime Work" 字样，加上后来加入的首启向导没有在 hermetic
  fixture 里预置 `onboardingCompleted: true`，弹窗会挡住测试要交互的所有元素。`npm test` 只跑
  vitest，不包含这套 e2e，只有单独跑 `npm run test:e2e:hermetic`（或完整 `release:verify`/CI）
  才会触发它，所以问题一直没暴露。`package:mac` 本身已经不再默认捎带 e2e（见 2.2），不会自动
  撞见这个坑，但只要手动跑一次 e2e 就会重新踩到。
