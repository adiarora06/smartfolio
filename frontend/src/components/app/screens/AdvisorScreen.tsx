// AI advisor — conversational Q&A over portfolio + current stock context.

import { useEffect, useRef, useState } from 'react'
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
  const chatRef = useRef<HTMLDivElement>(null)

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat, advisorPending])

  const canSend = draft.trim().length > 0 && !advisorPending

  const send = () => {
    if (!canSend) return
    void ask(draft)
    setDraft('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <section className="screen active" id="advisor">
      <AppHero
        title="AI advisor"
        subtitle="Ask anything — answers grounded in your actual numbers."
      />
      <div className="grid2">
        <Panel>
          <PanelHead title="Conversation" />
          <div className="body">
            <div className="chat" ref={chatRef}>
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
                placeholder="Ask about my portfolio or a stock... (Enter to send)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={advisorPending}
              />
              <button className="primary" onClick={send} disabled={!canSend}>
                {advisorPending ? 'Thinking…' : 'Send'}
              </button>
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Shortcuts" />
          <div className="body" style={{ display: 'grid', gap: 8 }}>
            {SHORTCUTS.map(([prompt, label]) => (
              <button key={label} onClick={() => void ask(prompt)} disabled={advisorPending}>
                {label}
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </section>
  )
}
