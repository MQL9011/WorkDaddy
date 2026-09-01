import { CircleHelp } from 'lucide-react'
import { AppMark } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import type { AppMeta } from '@/types/api'

interface AboutSettingsProps {
  meta?: AppMeta | null
  onOpenDocs(): void
}

export function AboutSettings({ meta, onOpenDocs }: AboutSettingsProps) {
  const { t } = useI18n()
  return (
    <>
      <header><h1>{t('settings.aboutPage.title')}</h1><p>{t('settings.aboutPage.subtitle')}</p></header>
      <section className="about-card"><AppMark size={48} /><div><h2>WorkDaddy</h2><p>{t('settings.aboutPage.versionLabel', { version: meta?.version ?? '0.1.0' })}</p></div></section>
      <section className="settings-group">
        <div className="settings-row"><span><strong>{t('settings.aboutPage.platform')}</strong><small>{meta?.platform ?? 'macOS'}</small></span></div>
        <div className="settings-row"><span><strong>{t('settings.aboutPage.homeDirectory')}</strong><small className="mono">{meta?.homeDir ?? '—'}</small></span></div>
        <div className="settings-row"><span><strong>{t('settings.aboutPage.helpAndDocs')}</strong></span><button className="button" type="button" onClick={onOpenDocs}><CircleHelp size={13} /> {t('settings.aboutPage.openDocs')}</button></div>
      </section>
    </>
  )
}
