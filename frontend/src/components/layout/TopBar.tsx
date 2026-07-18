// Sticky top bar: brand + primary navigation + Skip to Demo.

import { useStore } from '../../store/useStore'
import { SkipToDemoButton } from './SkipToDemoButton'

export function TopBar() {
  const goToPage = useStore((s) => s.goToPage)
  return (
    <header className="top">
      <div className="topin">
        <div className="brand">
          <div className="mark">SF</div>
          <div>
            <strong>SmartFolio</strong>
            <span>AI investment intelligence platform</span>
          </div>
        </div>
        <div className="topnav">
          <button onClick={() => goToPage('landing')}>Home</button>
          <button onClick={() => goToPage('setup')}>Start Setup</button>
          <SkipToDemoButton className="dark" />
        </div>
      </div>
    </header>
  )
}
