import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { saveComposerDraftFromDom } from './lib/composer-draft'
import { resolveLocale, translate } from './lib/i18n'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('WorkDaddy root element was not found')

// This fallback wraps <App/> itself (which renders I18nProvider internally),
// so it cannot rely on React context if App fails before mounting it.
const fatalLocale = resolveLocale('system')
const t = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate(fatalLocale, key, values)

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary
      onCatch={saveComposerDraftFromDom}
      fallback={(
        <div className="empty-state app-error-fallback" role="alert">
          <h2>{t('app.fatalError.title')}</h2>
          <p>{t('app.fatalError.body')}</p>
          <div className="empty-state__action">
            <button type="button" className="button button--primary" onClick={() => window.location.reload()}>{t('common.reload')}</button>
          </div>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
