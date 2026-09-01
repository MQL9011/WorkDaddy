#!/usr/bin/env bash
# 一键本地构建 + 发布。详细背景见 docs/ancoder/LOCAL_BUILD_AND_RELEASE.md —— 这是
# GitHub Actions 跑不了时的应急路径，正常情况下应该走 docs/ancoder/RELEASE_SETUP.md
# 那条 tag-push 自动发布的路。
#
# 用法：
#   scripts/release/local-release.sh                 # 版本号 patch +1，构建 mac + win，确认后发布
#   scripts/release/local-release.sh --minor          # 版本号 minor +1（0.2.3 -> 0.3.0）
#   scripts/release/local-release.sh --major          # 版本号 major +1（0.2.3 -> 1.0.0）
#   scripts/release/local-release.sh --no-bump        # 不自动升版本号，用 package.json 里现有的
#   scripts/release/local-release.sh --mac-only
#   scripts/release/local-release.sh --win-only
#   scripts/release/local-release.sh --dry-run        # 只构建，不升版本号 / 不 tag / 不 push / 不 publish
#   scripts/release/local-release.sh --yes            # 跳过发布前的确认提示
#
# 默认每次跑都会自动把版本号 patch +1（改 package.json + package-lock.json，提交一个
# "chore(release): 版本号提升到 x.y.z" commit）。已经手动定好版本号、不想被脚本改动时用
# --no-bump（--dry-run 下永远不会真的升号，只是预览）。
#
# 不做的事：不产出 Linux 包（未验证过在 macOS 宿主上交叉构建 Linux 是否可行），
# 不产出 macOS x64（arm64 宿主上跨架构编译 node-pty 会打包进错误架构的二进制）。

set -euo pipefail
cd "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"

REPO="MQL9011/WorkDaddy"
TEAM_ID="${WORKDADDY_APPLE_TEAM_ID:-R9G6NSM985}"
APPLE_ID="${WORKDADDY_APPLE_ID:-301063915@qq.com}"
P12_PATH="${WORKDADDY_P12_PATH:-$HOME/WorkDaddy-signing/DeveloperID.p12}"
NODE_VERSION="24.15.0"
KEYCHAIN_ACCOUNT="workdaddy-release"

PLATFORMS="mac,win"
DRY_RUN=0
ASSUME_YES=1
BUMP_LEVEL="patch"

for arg in "$@"; do
  case "$arg" in
    --mac-only) PLATFORMS="mac" ;;
    --win-only) PLATFORMS="win" ;;
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --minor) BUMP_LEVEL="minor" ;;
    --major) BUMP_LEVEL="major" ;;
    --no-bump) BUMP_LEVEL="" ;;
    -h|--help)
      sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数: ${arg}（用 --help 看用法）" >&2
      exit 2
      ;;
  esac
done

log() { printf '\n==> %s\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. 环境
# ---------------------------------------------------------------------------

log "切换 Node ${NODE_VERSION}"
# npm_config_prefix 是经典的 nvm 冲突源——某些工具/shell 配置会设置它，nvm 检测到就
# 直接拒绝切换版本（避免把 prefix 状态搞乱）。这个变量对本脚本没用，清掉。
unset npm_config_prefix || true
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
fi
nvm use "$NODE_VERSION" >/dev/null || die "nvm install $NODE_VERSION 之后再跑一次"

npm run toolchain:bootstrap >/dev/null || die "toolchain:bootstrap 失败，看上面的报错"

if [[ "$PLATFORMS" == *mac* ]]; then
  [ "$(uname -s)" = "Darwin" ] || die "构建 mac 目标必须在 macOS 宿主上跑"
  [ -f "$P12_PATH" ] || die "找不到签名证书: ${P12_PATH}（设置 WORKDADDY_P12_PATH 指到正确路径，或先看 docs/ancoder/RELEASE_SETUP.md 生成一个）"
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "main" ] || die "当前在分支 $CURRENT_BRANCH，切到 main 再发布"

if [ -n "$(git status --porcelain)" ]; then
  die "工作区有未提交的改动，先 commit 或 stash 干净再发布——发布的产物版本号要能对应到一个具体 commit"
fi

# ---------------------------------------------------------------------------
# 1. 质量门禁（必须在升版本号 / 推送 main 之前跑：门禁没过就不能让半发布状态的
#    "chore(release)" commit 出现在 origin/main 上，那样每次重试都会白白再升
#    一次版本号、留下一堆没有 tag 的空跑 commit）。
#    testTimeout 放宽到 20s：这条路本来就是给本机（常年跑着一堆别的 App）用的
#    应急路径，几个真实起子进程的用例在机器繁忙时容易压线超过 vitest 默认的
#    5s——CI 跑在干净的 runner 上，不受影响，所以只在这里放宽，不改全局配置。
# ---------------------------------------------------------------------------

log "质量门禁：typecheck + lint + test"
npm run typecheck
npm run check
npm test -- --testTimeout=20000

if [ "${DRY_RUN:-0}" != "1" ] && [ -n "${BUMP_LEVEL:-}" ]; then
  log "版本号自动 +1（${BUMP_LEVEL}）"
  OLD_VERSION="$(node -p "require('./package.json').version")"
  NEW_VERSION="$(npm version "$BUMP_LEVEL" --no-git-tag-version)"
  NEW_VERSION="${NEW_VERSION#v}"
  git add package.json package-lock.json
  git commit -m "chore(release): 版本号提升到 $NEW_VERSION" >/dev/null
  echo "  $OLD_VERSION -> $NEW_VERSION"
fi

if [ "$DRY_RUN" != "1" ]; then
  log "推送 main 到 origin"
  git push origin main
  git fetch origin main --quiet
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "本地 main 和 origin/main 不一致，先同步"
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
log "本次发布版本: $TAG"

node scripts/release/validate-release-tag.mjs --tag "$TAG" >/dev/null \
  || die "package.json/package-lock.json 版本号没对齐，先修好（validate-release-tag.mjs 会告诉你具体哪里不一致）"

if [ "$DRY_RUN" != "1" ]; then
  if git rev-parse "$TAG" >/dev/null 2>&1; then
    die "本地已经有 tag $TAG 了——用 --no-bump 时容易撞到这个，去掉 --no-bump 让脚本自动升号，或者自己先 npm version 升一下"
  fi
  if git ls-remote --tags origin | grep -q "refs/tags/$TAG\$"; then
    die "远端已经有 tag $TAG 了，同上"
  fi
  if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
    die "GitHub 上已经有 $TAG 的 Release 了，不会覆盖已发布的版本——换个版本号"
  fi
fi

# ---------------------------------------------------------------------------
# 2. 密码：优先读 macOS 钥匙串，没有就现场问，可选存起来下次不用再问
# ---------------------------------------------------------------------------

get_secret() {
  local service="$1" prompt="$2" value
  value="$(security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$service" -w 2>/dev/null || true)"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return
  fi
  read -rsp "$prompt: " value >&2
  echo >&2
  [ -n "$value" ] || die "密码不能为空"
  local save
  read -rp "存进 macOS 钥匙串，下次不用再输入？(y/N): " save >&2
  if [[ "$save" =~ ^[Yy]$ ]]; then
    security add-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$service" -w "$value" -U
  fi
  printf '%s' "$value"
}

# ---------------------------------------------------------------------------
# 3. 构建
# ---------------------------------------------------------------------------

RELEASE_STAGE="$(mktemp -d)"
trap 'rm -rf "$RELEASE_STAGE"' EXIT

if [[ "$PLATFORMS" == *mac* ]]; then
  log "构建 macOS arm64（签名 + 公证，Apple 服务器排队处理可能要十几分钟）"

  CSC_KEY_PASSWORD="$(get_secret workdaddy-mac-p12 'p12 导出密码')"
  APPLE_APP_SPECIFIC_PASSWORD="$(get_secret workdaddy-apple-asp 'App 专用密码 (xxxx-xxxx-xxxx-xxxx)')"

  export CSC_LINK
  CSC_LINK="$(base64 -i "$P12_PATH")"
  export CSC_KEY_PASSWORD
  export APPLE_APP_SPECIFIC_PASSWORD
  export RELEASE_SIGNING_TEAM_ID="$TEAM_ID"
  export APPLE_TEAM_ID="$TEAM_ID"
  export APPLE_ID="$APPLE_ID"

  npm run package:mac -- --arch arm64 --skip-verify

  unset CSC_LINK CSC_KEY_PASSWORD APPLE_APP_SPECIFIC_PASSWORD RELEASE_SIGNING_TEAM_ID APPLE_TEAM_ID APPLE_ID

  log "独立校验 Gatekeeper / 公证票据"
  spctl -a -vvv "release/mac/arm64/mac-arm64/WorkDaddy.app" 2>&1 | grep -q "accepted" \
    || die "spctl 没有 accept 这个 .app，构建可能有问题，不要发布"
  xcrun stapler validate "release/mac/arm64/mac-arm64/WorkDaddy.app" >/dev/null \
    || die "公证票据校验失败，不要发布"

  cp "release/mac/arm64/WorkDaddy-${VERSION}-arm64.dmg" "$RELEASE_STAGE/WorkDaddy-${VERSION}-m-chip.dmg"
  cp "release/mac/arm64/WorkDaddy-${VERSION}-arm64.zip" "$RELEASE_STAGE/WorkDaddy-${VERSION}-arm64.zip"
fi

if [[ "$PLATFORMS" == *win* ]]; then
  log "构建 Windows x64（免签名 beta，nsis + zip，跳过 appx——见 LOCAL_BUILD_AND_RELEASE.md 3.3）"

  npm run build:bundle
  rm -rf release/win/x64
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder \
    --win nsis zip --x64 --publish never \
    --config.npmRebuild=false \
    --config.directories.output=release/win/x64

  cp "release/win/x64/WorkDaddy-${VERSION}-win-x64.exe" "$RELEASE_STAGE/WorkDaddy-${VERSION}-win-x64.exe"
  cp "release/win/x64/WorkDaddy-${VERSION}-win-x64.zip" "$RELEASE_STAGE/WorkDaddy-${VERSION}-win-x64.zip"
fi

(cd "$RELEASE_STAGE" && shasum -a 256 * > SHA256SUMS.txt)

log "本次产物"
ls -la "$RELEASE_STAGE"

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "--dry-run：不 tag / push / publish。产物留在 $RELEASE_STAGE，自己看完删掉。"
  trap - EXIT
  exit 0
fi

# ---------------------------------------------------------------------------
# 4. 确认后发布
# ---------------------------------------------------------------------------

MISSING_NOTE=""
[[ "$PLATFORMS" == *mac* ]] || MISSING_NOTE+=$'\n- **macOS**：本次未构建'
[[ "$PLATFORMS" == *win* ]] || MISSING_NOTE+=$'\n- **Windows**：本次未构建'

MAC_LINE=""
if [[ "$PLATFORMS" == *mac* ]]; then
  MAC_LINE=$'- **macOS (Apple 芯片 / arm64)**：已签名 + Apple 公证，spctl 独立验证通过，双击直接打开。\n'
fi
WIN_LINE=""
if [[ "$PLATFORMS" == *win* ]]; then
  WIN_LINE=$'- **Windows (x64)**：未签名 beta，首次运行会触发 SmartScreen 提示。\n'
fi

NOTES="本机手动构建发布（GitHub Actions 未参与）。

## 平台支持
${MAC_LINE}${WIN_LINE}- **macOS (Intel / x64)**：未产出——需要 Intel Mac 原生构建。
- **Linux**：未产出——需要 Linux 机器（或恢复 CI）原生构建。${MISSING_NOTE}

所有产物的 SHA-256 见 \`SHA256SUMS.txt\`。"

if [ "$ASSUME_YES" != "1" ]; then
  echo
  echo "即将："
  echo "  1. 打 tag $TAG 并推送到 origin"
  echo "  2. 创建 GitHub Release WorkDaddy ${VERSION}，上传上面列出的产物"
  echo
  read -rp "确认发布？(y/N): " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "已取消，产物留在 $RELEASE_STAGE"; trap - EXIT; exit 0; }
fi

log "打 tag 并推送"
git tag -a "$TAG" -m "WorkDaddy $VERSION"
git push origin "$TAG"

log "发布 GitHub Release"
gh release create "$TAG" "$RELEASE_STAGE"/* \
  -R "$REPO" \
  --title "WorkDaddy $VERSION" \
  --notes "$NOTES"

log "完成: https://github.com/$REPO/releases/tag/$TAG"
