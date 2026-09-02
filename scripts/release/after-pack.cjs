const { copyFileSync } = require('node:fs')
const { join } = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

function executablePath(context, platform) {
  const { appOutDir, packager } = context
  const { productFilename } = packager.appInfo
  if (platform === 'darwin') return join(appOutDir, `${productFilename}.app`, 'Contents', 'MacOS', productFilename)
  if (platform === 'win32') return join(appOutDir, `${productFilename}.exe`)
  // app-builder-lib's LinuxPackager names the binary after the lowercased sanitized name unless executableName overrides it.
  return join(appOutDir, packager.appInfo.sanitizedName.toLowerCase())
}

function resourcesIconPath(context, platform) {
  const { appOutDir, packager } = context
  const { productFilename } = packager.appInfo
  if (platform === 'darwin') return join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources', 'icon.png')
  return join(appOutDir, 'resources', 'icon.png')
}

/**
 * @param {{ packager: { projectDir: string, appInfo: { productFilename: string } }, appOutDir: string }} context
 * @param {string} platform
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(src: string, dest: string) => void} [copyFile]
 */
function applyQaAppIcon(context, platform, env = process.env, copyFile = copyFileSync) {
  if (env.WORKDADDY_QA !== '1') return
  copyFile(join(context.packager.projectDir, 'assets', 'icon-dev.png'), resourcesIconPath(context, platform))
}

exports.executablePath = executablePath
exports.resourcesIconPath = resourcesIconPath
exports.applyQaAppIcon = applyQaAppIcon

exports.default = async function hardenElectron(context) {
  const platform = context.electronPlatformName
  applyQaAppIcon(context, platform)
  await flipFuses(executablePath(context, platform), {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: platform === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  })
}
