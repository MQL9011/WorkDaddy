import { useI18n } from '@/lib/i18n'
import type { AppSettings } from '@/types/api'
import type { SettingsSectionProps } from './contracts'
import { SettingsToggle } from './SettingsToggle'

export function GeneralSettings({ settings, onUpdate, platform }: SettingsSectionProps & { platform: NodeJS.Platform }) {
  const { t } = useI18n()
  return (
    <>
      <header><h1>{t('settings.general')}</h1><p>{t('settings.generalPage.description')}</p></header>
      <section className="settings-group">
        <h2>{t('settings.generalPage.window.title')}</h2>
        <SettingsToggle checked={settings.sidebarOpen} onChange={(sidebarOpen) => { void onUpdate({ sidebarOpen }) }} label={t('settings.generalPage.sidebar.label')} description={t('settings.generalPage.sidebar.description')} />
        <SettingsToggle checked={settings.inspectorOpen} onChange={(inspectorOpen) => { void onUpdate({ inspectorOpen }) }} label={t('settings.generalPage.inspector.label')} description={t('settings.generalPage.inspector.description')} />
        <SettingsToggle checked={settings.showFileChangesPopup} onChange={(showFileChangesPopup) => { void onUpdate({ showFileChangesPopup }) }} label={t('settings.generalPage.fileChangesPopup.label')} description={t('settings.generalPage.fileChangesPopup.description')} />
      </section>
      {platform === 'darwin' ? (
        <section className="settings-group">
          <h2>{t('settings.generalPage.startup.title')}</h2>
          <SettingsToggle checked={settings.keepRunningInBackground} onChange={(keepRunningInBackground) => { void onUpdate({ keepRunningInBackground }) }} label={t('settings.generalPage.keepRunning.label')} description={t('settings.generalPage.keepRunning.description')} />
          <SettingsToggle checked={settings.launchAtLogin} onChange={(launchAtLogin) => { void onUpdate({ launchAtLogin }) }} label={t('settings.generalPage.launchAtLogin.label')} description={t('settings.generalPage.launchAtLogin.description')} />
        </section>
      ) : null}
      <section className="settings-group">
        <h2>{t('settings.generalPage.sessionDefaults.title')}</h2>
        <label className="settings-row">
          <span><strong>{t('settings.generalPage.defaultInspectorTab.label')}</strong><small>{t('settings.generalPage.defaultInspectorTab.description')}</small></span>
          <select value={settings.defaultInspectorTab} onChange={(event) => { void onUpdate({ defaultInspectorTab: event.target.value as AppSettings['defaultInspectorTab'] }) }}>
            <option value="summary">{t('settings.generalPage.inspectorTab.summary')}</option>
            <option value="changes">{t('settings.generalPage.inspectorTab.changes')}</option>
            <option value="browser">{t('settings.browser')}</option>
            <option value="files">{t('settings.generalPage.inspectorTab.files')}</option>
          </select>
        </label>
      </section>
    </>
  )
}
