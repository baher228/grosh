import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Notice, WishItem } from '../types'

export function Wishlist({ open, onClose, onNotices }: { open: boolean; onClose: () => void; onNotices: (n: Notice[]) => void }) {
  const [items, setItems] = useState<WishItem[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [text, setText] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const refresh = async () => {
    try {
      const [w, n] = await Promise.all([api.wishlist(), api.notifications()])
      setItems(w); setNotices(n); onNotices(n)
    } catch { /* backend not up yet */ }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true); setMsg(null)
    try {
      await api.addWish(text.trim(), price ? Number(price) : null)
      setText(''); setPrice(''); await refresh()
    } catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }
  const scan = async () => {
    setBusy(true); setMsg(null)
    try {
      const fresh = await api.scan()
      setMsg(fresh.length ? `${fresh.length} new deal${fresh.length > 1 ? 's' : ''} match your list.` : 'No new matches in today\'s deals.')
      await refresh()
    } catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }

  const demo = async () => {
    setBusy(true); setMsg(null)
    try { await api.wishDemo(); await refresh(); setMsg('Demo list ready. Now press “Check today’s deals”.') }
    catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div onClick={onClose} className={`absolute inset-0 bg-ink/30 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <aside role="dialog" aria-label="Wishlist"
        className={`absolute right-0 top-0 flex h-dvh w-full max-w-md flex-col bg-paper transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Wishlist</h2>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-ink-soft hover:text-ink">Close</button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-8">
          <form onSubmit={add} className="space-y-2">
            <p className="text-sm text-ink-soft">Tell Margin what you're saving up for. It watches new student deals and tells you when one fits.</p>
            <div className="flex gap-2">
              <input value={text} onChange={e => setText(e.target.value)} placeholder="AirPods, Nike trainers, a laptop"
                className="min-w-0 flex-1 rounded-lg border border-rule bg-sheet px-3.5 py-2.5 outline-none focus:border-ink" />
              <input value={price} onChange={e => setPrice(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="Max £"
                className="w-20 rounded-lg border border-rule bg-sheet px-3 py-2.5 outline-none focus:border-ink" />
            </div>
            <button disabled={busy} className="w-full rounded-lg bg-ink px-4 py-2.5 font-medium text-sheet disabled:opacity-60">Add to wishlist</button>
          </form>

          {notices.length > 0 && (
            <section>
              <h3 className="font-medium">New for you</h3>
              <ul className="mt-2 space-y-2">
                {notices.map(n => (
                  <li key={n.id} className="notice rounded-xl border border-ink bg-sheet p-3.5">
                    <p className="flex items-center gap-2 text-sm text-ink-soft"><span className="size-1.5 rounded-full bg-pen" />For your “{n.item}”{n.deal.tags?.includes('web') && <span className="rounded-full border border-rule px-1.5 text-xs">live web</span>}</p>
                    <p className="font-medium">{n.deal.brand}: {n.deal.offer}</p>
                    <p className="mt-1 text-sm text-ink-soft">{n.reason}</p>
                    <a className="mt-2 inline-block text-sm underline underline-offset-4" href={n.deal.url} target="_blank" rel="noreferrer">See deal on {n.deal.provider}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Watching</h3>
              <div className="flex gap-3 text-sm">
                {items.length > 0 && <button onClick={demo} disabled={busy} className="text-ink-soft underline decoration-rule underline-offset-4 disabled:opacity-40">Reset demo</button>}
                <button onClick={scan} disabled={busy || items.length === 0} className="font-medium underline underline-offset-4 disabled:opacity-40">{busy ? 'Checking…' : 'Check today’s deals'}</button>
              </div>
            </div>
            {msg && <p className="mt-2 text-sm text-keep">{msg}</p>}
            {items.length === 0 && (
              <div className="mt-2 rounded-xl border border-dashed border-rule p-4 text-sm text-ink-soft">
                Nothing yet. Add the first thing you want above, or
                <button onClick={demo} disabled={busy} className="ml-1 text-ink underline underline-offset-4">try the demo list</button>.
              </div>
            )}
            <ul className="mt-2 space-y-2">
              {items.map(w => (
                <li key={w.id} className="rounded-xl border border-rule bg-sheet p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{w.item}{w.max_price ? <span className="font-normal text-ink-soft num"> under £{w.max_price}</span> : null}</p>
                    <button onClick={async () => { await api.delWish(w.id); refresh() }} className="text-sm text-ink-soft hover:text-pen">Remove</button>
                  </div>
                  {w.matches.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {w.matches.slice(0, 3).map(d => (
                        <li key={d.id}><a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">{d.brand}: {d.offer} <span className="text-ink-soft">({d.provider})</span></a></li>
                      ))}
                    </ul>
                  ) : <p className="mt-1 text-sm text-ink-soft">No deal yet. You'll see it here when one turns up.</p>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>
  )
}
