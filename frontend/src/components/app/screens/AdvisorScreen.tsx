// AI advisor — conversational Q&A over portfolio + current stock context.

import { useState } from 'react'
import { useStore } from '../../../store/useStore'
import { Panel, PanelHead, AppHero } from '../../shared/ui'

const SHORTCUTS: Array<[prompt: string, label: string]> = [
  ['What is my biggest diversification issue?', 'Biggest risk'],
  ['Analyze the current stock for my portfolio.', 'Current stock'],
  ['How should I rebalance gradually?', 'Rebalance plan'],
  ['What data should I connect next?', 'Next connection'],
]

export function AdvisorScreen() {
  const chat = useStore((s) => s.chat)
  const advisorPending = useStore((s) => s.advisorPending)
  const ask = useStore((s) => s.ask)
  const [draft, setDraft] = useState('')

  const send = () => {
    ask(draft)
    setDraft('')
  }

  return (
    <section className="screen active" id="advisor">
      <AppHero
        title="AI advisor"
        subtitle="Ask about diversification, stock analysis, rebalancing, and connected apps."
      />
      <div className="grid2">
        <Panel>
          <PanelHead title="Conversation" />
          <div className="body">
            <div className="chat">
              {chat.map((m, i) => (
                <div className={`msg ${m.role === 'user' ? 'user' : 'ai'}`} key={i}>
                  {m.text}
                </div>
              ))}
              {advisorPending && (
                <div className="msg ai" style={{ color: 'var(--muted)' }}>
                  Thinking…
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 12 }}>
              <textarea
                placeholder="Ask about my portfolio or a stock..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button className="primary" onClick={send}>
                Send
              </button>
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Shortcuts" />
          <div className="body" style={{ display: 'grid', gap: 8 }}>
            {SHORTCUTS.map(([prompt, label]) => (
              <button key={label} onClick={() => ask(prompt)}>
                {label}
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </section>
  )
}
