import type { Analysis, Notice, TraceStep, WishItem } from './types'

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
  wishlist: () => fetch('/api/wishlist').then(j<WishItem[]>),
  addWish: (item: string, max_price: number | null) =>
    fetch('/api/wishlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item, max_price }) }).then(j<WishItem>),
  delWish: (id: string) => fetch(`/api/wishlist/${id}`, { method: 'DELETE' }),
  scan: () => fetch('/api/wishlist/scan', { method: 'POST' }).then(j<Notice[]>),
  notifications: () => fetch('/api/notifications').then(j<Notice[]>),
}

export const gbp = (n: number, dp = 2) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n)
