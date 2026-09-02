# 发布配置指南

打 tag → GitHub Actions 自动构建三平台 → 自动发布 GitHub Release。
本文列出跑通这条流水线**必须**先配好的凭据，以及每一项的获取方式。

> GitHub Actions 跑不了（比如账号 billing 问题）时的应急路径——本机签名公证、跨平台交叉构建、
> 手动发布——见 [`LOCAL_BUILD_AND_RELEASE.md`](LOCAL_BUILD_AND_RELEASE.md)，本文不覆盖那条路径。

---

## 1. 发布怎么触发

流水线只认**语义化版本 tag**，且 tag 名必须与 `package.json` 的 `version` 完全一致：

```bash
npm version 0.2.0 --no-git-tag-version   # 若版本号还没对齐，记得 package-lock.json 也要跟着更新
git commit -am "chore(release): 0.2.0"
git tag v0.2.0
git push origin main --tags
```

推送后 [Actions](https://github.com/MQL9011/WorkDaddy/actions) 会依次跑：

| Job | 内容 | 需要凭据 |
| --- | --- | --- |
| `validate` | 校验 tag 与 package.json/package-lock.json 版本一致、且该 commit 在 `main` 上 | 否 |
| `quality` | typecheck + lint + 覆盖率测试 + 打包体积检查 | 否 |
| `hermetic-e2e` | 隔离环境 E2E | 否 |
| `package` | macOS arm64/x64 签名 + 公证 + 验证 | **是（Apple）** |
| `package-linux` | Linux arm64/x64 AppImage/deb/rpm/pacman | 否 |
| `package-windows` | Windows x64 nsis/zip/msix | 需开开关 |
| `release-packages` | 汇总产物、生成 SHA256SUMS.txt、构建溯源签章、发布 Release | 否 |

几条内建的安全约束（不要绕过）：

- tag 必须指向 `main` 上的 commit，`validate` 会解析出唯一 commit SHA，其余 job 全部 checkout 这个
  SHA——中途移动 tag 不会让两个 job 构建出不同代码。
- 已经正式发布（非草稿）的同名 Release 不会被覆盖，流水线会直接失败。
- 每个安装包都会进 `SHA256SUMS.txt`，并附带 GitHub build-provenance 构建溯源签章。

手动补发某个已存在的 tag，用 Actions 页的 **Run workflow**（`workflow_dispatch`），填 tag 名即可。

---

## 2. macOS：必须先解决证书类型问题

> **当前本机缺少可用于对外分发的证书。** 钥匙串里有
> `Apple Distribution: Wuxi Marvin Technology Co., Ltd (R9G6NSM985)`，
> 但这是**上架 App Store 用的**证书。DMG/ZIP 这种在 App Store 之外分发的包，
> Apple 要求的是另一种证书：**Developer ID Application**。两者不能互相替代。

### 2.1 创建 Developer ID Application 证书

> **实测结论（2026-08-18，团队 R9G6NSM985）**：用 App Store Connect API Key 走
> `fastlane get_certificates` 创建 Developer ID 证书**会被 Apple 拒绝**，原文是：
>
> ```
> This request is forbidden for security reasons -
> This operation can only be performed by the Account Holder.
> ```
>
> API Key 本身是有效的（可以正常列出团队现有证书），但 Apple 对 Developer ID 证书的签发
> 有额外限制：**只有 Account Holder 本人登录才能创建**，Admin 角色的 API Key 也不行。
> 所以这一步无法自动化，必须由账号持有人手动完成。

注意两条 Apple 的硬性限制：

- 只有团队的 **Account Holder（账号持有人）** 能创建 Developer ID 证书，Admin 角色不行，
  API Key 也不行。
- 每个团队的 Developer ID Application 证书数量有上限（目前 5 个），且**吊销会导致已发布的
  旧版本失效**，所以不要反复创建、删除。

#### 唯一可行方式：Account Holder 登录网页端创建

1. 用**账号持有人**的 Apple ID 登录 [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates/list)
2. 确认右上角团队切换到 **Wuxi Marvin Technology Co., Ltd (R9G6NSM985)**
3. 点 `+` → 选 **Developer ID Application** → Continue
4. 需要上传 CSR：打开「钥匙串访问」→ 菜单栏「证书助理」→「从证书颁发机构请求证书」→
   邮箱填账号持有人邮箱、常用名随意、选「存储到磁盘」→ 生成 `.certSigningRequest`
5. 上传该 CSR → 下载生成的 `.cer` → 双击导入钥匙串

导入后确认它出现了：

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
```

### 2.2 导出为 p12 并转 base64

CI 需要的是 base64 编码的 `.p12`。**导出密码请自己新拟一个**，不要复用 Apple ID 密码：

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
```

拿到证书名后，用「钥匙串访问」右键该证书 → 导出 → 格式选「个人信息交换 (.p12)」→ 设一个导出密码。
然后：

```bash
base64 -i /path/to/DeveloperID.p12 | pbcopy
```

剪贴板里的内容就是 `MAC_CERTIFICATE_P12_BASE64` 的值。

### 2.3 公证凭据（二选一）

**方式 A：App 专用密码**（简单，推荐先用这个）

到 [appleid.apple.com](https://appleid.apple.com) → 登录 → 「App 专用密码」→ 生成一个，
格式形如 `abcd-efgh-ijkl-mnop`。

**方式 B：App Store Connect API Key**（更适合长期 CI，无 2FA 干扰）

App Store Connect → 用户和访问 → 集成 → App Store Connect API → 生成密钥，
下载 `.p8`（**只能下载一次**），记下 Key ID 与 Issuer ID。

> 注意：公证（notarization）用 API Key 是**可以**的，受 Account Holder 限制的只有
> 证书签发那一步。所以即便证书必须手动创建，公证依然可以全自动。
>
> 本机已配好一份可用的 API Key 描述文件：`~/.appstoreconnect/workdaddy-key.json`
> （权限 600，位于仓库之外，不会被 git 追踪）。它已验证可以正常访问 Apple API。

流水线会强制要求「恰好配齐其中一套」，两套都填或都不填都会失败。

---

## 3. 需要在 GitHub 配置的 Secrets 与 Variables

仓库 → Settings → Secrets and variables → Actions。

### 3.1 Secrets（macOS 签名与公证，必填）

| 名称 | 值 | 来源 |
| --- | --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | p12 的 base64 | 见 2.2 |
| `MAC_CERTIFICATE_PASSWORD` | 导出 p12 时自设的密码 | 见 2.2 |
| `APPLE_TEAM_ID` | `R9G6NSM985` | 团队 ID |
| `APPLE_ID` | `301063915@qq.com` | 方式 A |
| `APPLE_APP_SPECIFIC_PASSWORD` | `xxxx-xxxx-xxxx-xxxx` | 方式 A |

> 用方式 B 的话，把最后两项换成 `APPLE_API_KEY`（.p8 路径）、`APPLE_API_KEY_ID`、
> `APPLE_API_ISSUER`，并且**不要**同时配 `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`。
>
> `APPLE_TEAM_ID` 必须与 `RELEASE_SIGNING_TEAM_ID` 相等，流水线会显式校验；
> workflow 里 `RELEASE_SIGNING_TEAM_ID` 已经绑定到 `secrets.APPLE_TEAM_ID`，配一个即可。

### 3.2 Variables（Windows 开关，可选）

Windows 默认不参与发布，需要显式打开其中一个：

| 变量名 | 值 | 含义 |
| --- | --- | --- |
| `RELEASE_WINDOWS_UNSIGNED_ENABLED` | `true` | 出**免签名** Windows 包（无需买证书，用户会看到 SmartScreen 警告） |
| `RELEASE_WINDOWS_ENABLED` | `true` | 出**签名** Windows 包，另需下方证书凭据 |

签名 Windows 包还需要（没有 Authenticode 代码签名证书就用上面的免签名开关）：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `WIN_CSC_LINK` | Secret | Authenticode 证书 p12 的 base64 |
| `WIN_CSC_KEY_PASSWORD` | Secret | 证书密码 |
| `WORKDADDY_WINDOWS_CERT_SUBJECT` | Variable | 期望的证书主题，精确匹配 |
| `WORKDADDY_WINDOWS_CERT_THUMBPRINT` | Variable | 期望的 SHA-1 指纹（40 字符） |

后两个至少配一个：验证的是「签名者是不是**预期的那一个**」，而不是「有没有被某个可信 CA 签过」。
两个都不配时签名 Windows 打包会显式失败，而不是接受 runner 恰好信任的任意证书链。

---

## 4. 各平台用户拿到的是什么

| 平台 | 产物 | 首次打开 |
| --- | --- | --- |
| macOS | `WorkDaddy-<版本>-m-chip.dmg`（Apple 芯片）、`-intel-chip.dmg` | 已签名公证，直接双击 |
| Linux | AppImage / deb / rpm / pacman，arm64 与 x64 | 直接运行 |
| Windows（免签名） | nsis 安装包 / zip / msix | SmartScreen 会拦，需点「更多信息 → 仍要运行」 |

---

## 5. 常见失败

**`Release preflight failed: Developer ID signing credentials are incomplete`**
`MAC_CERTIFICATE_P12_BASE64` / `MAC_CERTIFICATE_PASSWORD` / `APPLE_TEAM_ID` 没配全。

**`Provide exactly one complete notarization credential set`**
Apple ID 那套和 API Key 那套同时配了、或都没配全。只留一套。

**`APPLE_TEAM_ID must match RELEASE_SIGNING_TEAM_ID`**
两者值不一致，检查是否手工覆盖过其中一个。

**`Release tag vX.Y.Z must exactly match package.json version`**
tag 与 `package.json` 的 `version` 不一致，或 `package-lock.json` 没跟着更新。
改完版本号记得跑一次 `npm install --package-lock-only`。

**`No identity found` / 签名阶段报找不到证书**
多半是导出成了 Apple Distribution 而不是 Developer ID Application，回到第 2 节确认证书类型。

**Release 已存在且非草稿**
流水线拒绝覆盖已正式发布的版本。要重发请先删掉那个 Release，或改用新版本号。
