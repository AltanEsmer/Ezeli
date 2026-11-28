import { Component, type ReactNode } from 'react'
import { t } from './i18n.ts'
import { follow } from './route.ts'

export function GlobeUnavailable({ retry }: { retry?: () => void }) {
  return <div className="notice">
    <h1>{t.globeUnavailable}</h1>
    <a className="btn" href="/" onClick={follow('/')}>{t.allMemories}</a>
    {retry && <button className="btn" onClick={retry}>{t.retry}</button>}
  </div>
}

export class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  render() {
    return this.state.failed ? <GlobeUnavailable /> : this.props.children
  }
}
