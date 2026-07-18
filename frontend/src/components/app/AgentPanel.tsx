// The A2A-style agent network panel.

import { AGENT_NETWORK } from '../../lib/data/constants'

export function AgentPanel() {
  return (
    <section className="panel">
      <div className="body">
        <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Agent Network</h2>
        <ul className="list">
          {AGENT_NETWORK.map((agent) => (
            <li key={agent}>{agent}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
