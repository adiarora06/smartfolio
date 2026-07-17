// The "Skip to Demo" button — jumps straight into the dashboard.
// Reused in the top bar, the landing hero, and the setup header.

import { useStore } from '../../store/useStore'

export function SkipToDemoButton({
  className,
  children = 'Skip to Demo',
}: {
  className?: string
  children?: React.ReactNode
}) {
  const openDemo = useStore((s) => s.openDemo)
  return (
    <button className={className} onClick={openDemo}>
      {children}
    </button>
  )
}
