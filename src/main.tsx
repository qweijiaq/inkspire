import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PetWindow } from './components/PetWindow'
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/app.css'

const isPetWindow = new URLSearchParams(window.location.search).get('pet') === '1'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('[inkspire] render error', error)
  }
  render() {
    if (this.state.error) {
      const detail = String(this.state.error.stack || this.state.error)
      return (
        <div className="crash">
          <div className="crash-card">
            <h1>页面遇到了一点问题</h1>
            <p>文档已经自动保存。可以先重试；如果反复出现，把下面的技术细节复制给开发者。</p>
            <pre>{detail}</pre>
            <div className="crash-actions">
              <button className="tbtn primary" onClick={() => window.location.reload()}>
                重新加载
              </button>
              <button
                className="tbtn"
                onClick={() => {
                  void navigator.clipboard?.writeText(detail)
                }}
              >
                复制细节
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>{isPetWindow ? <PetWindow /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
)
