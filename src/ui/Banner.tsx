/** Connection banner. Every input is blocked while the link is down. */

import type { LinkStatus } from '../net/mqtt'

const TEXT: Record<LinkStatus, string | null> = {
  connecting: 'A ligar ao broker…',
  online: null,
  reconnecting: 'A religar…',
  offline: 'Sem ligação ao broker.',
  failed: 'Falha de ligação.',
}

export function Banner({ status }: { status: LinkStatus }) {
  const text = TEXT[status]
  if (!text) return null
  return <div className="banner">{text}</div>
}
