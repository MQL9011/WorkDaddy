import { Bot, LockKeyhole } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { SettingsSectionProps } from './contracts'

export function PrivacySettings(_props: SettingsSectionProps) {
  const { t } = useI18n()
  return (
    <>
      <header><h1>{t('settings.privacy')}</h1><p>{t('settings.privacyPage.description')}</p></header>
      <section className="settings-group">
        <h2>{t('settings.privacyPage.localData.title')}</h2>
        <div className="info-row"><LockKeyhole size={15} /><div><strong>{t('settings.privacyPage.localData.label')}</strong><small>{t('settings.privacyPage.localData.description')}</small></div></div>
      </section>
      <section className="settings-group">
        <h2>{t('settings.privacyPage.agentRequests.title')}</h2>
        <div className="info-row"><Bot size={15} /><div><strong>{t('settings.privacyPage.agentRequests.label')}</strong><small>{t('settings.privacyPage.agentRequests.description')}</small></div></div>
      </section>
    </>
  )
}
