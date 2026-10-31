import type { Analysis, Deal, FeedbackKind, FeedbackRule, Notice, Receipt, Saving, TraceStep, WishItem } from './types'

export type StreamEvent =
  | { type: 'start'; step: string; label: string }
  | ({ type: 'step' } & TraceStep)
  | { type: 'result'; data: Analysis }
  | { type: 'error'; message: string }

async function stream(r: Response, on: (e: StreamEvent) => void): Promise<Analysis> {
  if (!r.ok || !r.body) return j<Analysis>(r)
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    buf += dec.decode(value || new Uint8Array(), { stream: !done })
    const lines = buf.split('\n'); buf = done ? '' : lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      const e = JSON.parse(line) as StreamEvent
      if (e.type === 'result') return e.data
      if (e.type === 'error') throw new Error(e.message)
      on(e)
    }
    if (done) throw new Error('The analysis stopped before it finished')
  }
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `Request failed (${r.status})`
    try { const b = await r.json(); msg = b.detail || msg } catch { /* not json */ }
    throw new Error(msg)
  }
  return r.json()
}

export const api = {
  sample: () => fetch('/api/sample').then(j<Analysis>),
  analyze: (file: File, university: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (university) fd.append('university', university)
    return fetch('/api/analyze', { method: 'POST', body: fd }).then(j<Analysis>)
  },
  sampleStream: (on: (e: StreamEvent) => void) => fetch('/api/sample/stream').then(r => stream(r, on)),
  analyzeStream: (file: File, university: string, on: (e: StreamEvent) => void) => {
    const fd = new FormData()
    fd.append('file', file)
    if (university) fd.append('university', university)
    return fetch('/api/analyze/stream', { method: 'POST', body: fd }).then(r => stream(r, on))
  },
  receipt: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch('/api/receipt', { method: 'POST', body: fd }).then(j<Receipt>)
  },
  receiptSample: () => fetch('/api/receipt/sample').then(j<Receipt>),
  feedback: () => fetch('/api/feedback').then(j<FeedbackRule[]>),
  addFeedback: (kind: FeedbackKind, saving: Saving, merchants: string[], note?: string | null) =>
    fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, saving, merchants, note }) }).then(j<FeedbackRule>),
  delFeedback: (id: string) =>
    fetch(`/api/feedback/${id}`, { method: 'DELETE' }).then(j<FeedbackRule>),
  applyFeedback: (analysis: Analysis) =>
    fetch('/api/feedback/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(analysis) }).then(j<Analysis>),
  wishDemo: () => fetch('/api/wishlist/demo', { method: 'POST' }).then(j<WishItem[]>),
  wishlist: () => fetch('/api/wishlist').then(j<WishItem[]>),
  addWish: (item: string, max_price: number | null) =>
    fetch('/api/wishlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item, max_price }) }).then(j<WishItem>),
  delWish: (id: string) => fetch(`/api/wishlist/${id}`, { method: 'DELETE' }),
  scan: () => fetch('/api/wishlist/scan', { method: 'POST' }).then(j<Notice[]>),
  notifications: () => fetch('/api/notifications').then(j<Notice[]>),
}

export const gbp = (n: number, dp = 2) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n)

export const dealProvider = (deal: Pick<Deal, 'provider' | 'fetched_at'>) => {
  if (!deal.fetched_at) return deal.provider
  const date = new Date(deal.fetched_at)
  if (Number.isNaN(date.valueOf())) return deal.provider
  const checked = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(date)
  return `${deal.provider} · checked ${checked}`
}
