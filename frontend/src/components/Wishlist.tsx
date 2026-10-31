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
  const [adding, setAdding] = useState(false)

  const refresh = async () => {
    try {
      const [w, n] = await Promise.all([api.wishlist(), api.notifications()])
      setItems(w); setNotices(n); onNotices(n)
    } catch { /* backend not up yet */ }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [])
  useEffect(() => {
    if (!open) return
    const id = setInterval(async () => {
      try { const n = await api.notifications(); setNotices(n); onNotices(n) } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true); setMsg(null)
    try {
      await api.addWish(text.trim(), price ? Number(price) : null)
      setText(''); setPrice(''); setAdding(false); await refresh()
    } catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }
  const scan = async () => {
    setBusy(true); setMsg(null)
    try {
      const fresh = await api.scan()
      setMsg(fresh.length ? `${fresh.length} new match${fresh.length > 1 ? 'es' : ''}. Still checking the web.` : 'Nothing new yet. Still checking the web.')
      await refresh()
    } catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }

  const demo = async () => {
    setBusy(true); setMsg(null)
    try { await api.wishDemo(); await refresh(); setMsg(null) }
    catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.shiftKey && e.key === 'D' && !(e.target instanceof HTMLInputElement)) demo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const budget = (w?: { max_price: number | null }) => w?.max_price ? `Budget £${w.max_price.toLocaleString('en-GB')}` : 'No budget'
  const offerText = (offer: string, item: string) => offer.toLowerCase().startsWith(item.toLowerCase() + ':') ? offer.slice(item.length + 1).trim().replace(/^./, c => c.toUpperCase()) : offer
  const byId = Object.fromEntries(items.map(w => [w.id, w]))
  const fresh = [...notices].reverse()

  const Status = ({ web }: { web: boolean }) => web
    ? <span title="Found by a Gemini web lookup. Check the price on the shop's site." className="inline-flex items-center gap-1.5 text-amber-700"><span className="size-1.5 rounded-full bg-amber-500" />Unconfirmed</span>
    : <span title="Listed in a student-deal provider's catalogue." className="inline-flex items-center gap-1.5 text-keep"><span className="size-1.5 rounded-full bg-keep" />Verified</span>

  return (
    <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div onClick={onClose} className={`absolute inset-0 bg-ink/25 backdrop-blur-[2px] transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <aside role="dialog" aria-label="Wishlist"
        className={`absolute right-0 top-0 flex h-dvh w-full flex-col bg-sheet transition-transform duration-300 sm:max-w-[600px] ${open ? 'translate-x-0 shadow-[-24px_0_60px_-30px_rgba(23,35,61,.45)]' : 'translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <header className="flex items-center justify-between gap-4 border-b border-rule/60 px-5 py-4 sm:px-10 sm:py-6">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">Wishlist</h2>
            <p className="mt-0.5 text-sm text-ink-soft">{items.length} watching{notices.length ? ` · ${notices.length} new` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setAdding(v => !v)} aria-expanded={adding}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-sheet hover:bg-ink/90">
              <span aria-hidden className="text-base leading-none">{adding ? '×' : '+'}</span>{adding ? 'Cancel' : 'Add item'}
            </button>
            <button onClick={onClose} aria-label="Close wishlist" className="grid size-9 place-items-center rounded-full text-xl leading-none text-ink-soft hover:bg-paper hover:text-ink">×</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 sm:px-10">
          {adding && (
            <form onSubmit={add} className="flex flex-wrap gap-2 border-b border-rule/60 py-5">
              <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="What are you after?"
                className="min-w-0 flex-[1_1_14rem] rounded-lg border border-rule bg-paper/50 px-3.5 py-2.5 outline-none focus:border-ink" />
              <div className="relative w-28">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft">£</span>
                <input value={price} onChange={e => setPrice(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="Budget"
                  className="w-full rounded-lg border border-rule bg-paper/50 py-2.5 pr-3 pl-7 outline-none focus:border-ink" />
              </div>
              <button disabled={busy || !text.trim()} className="rounded-lg bg-ink px-5 py-2.5 font-medium text-sheet hover:bg-ink/90 disabled:opacity-40">Add</button>
            </form>
          )}

          <section className="pt-7">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-semibold tracking-[.12em] text-ink-soft uppercase">New matches</h3>
              {items.length > 0 && <button onClick={scan} disabled={busy} className="text-sm font-medium text-ink underline decoration-rule underline-offset-4 hover:decoration-ink">{busy ? 'Checking…' : 'Check for deals'}</button>}
            </div>
            {msg && <p className="mt-2 text-sm text-ink-soft">{msg}</p>}
            {fresh.length === 0 ? (
              <p className="py-6 text-sm text-ink-soft">{items.length ? 'No new matches yet. Deals that fit your list will show up here.' : 'Add something you want and grosh will flag student deals that fit your budget.'}</p>
            ) : (
              <ul className="divide-y divide-rule/60">
                {fresh.map(n => (
                  <li key={n.id} className="notice flex flex-col items-start gap-3 py-5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="w-full min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium">{!n.read && <span className="size-1.5 shrink-0 rounded-full bg-pen" aria-label="new" />}<span className="truncate">{n.item}</span></p>
                      <p className="mt-1 text-[15px] leading-snug text-ink">{offerText(n.deal.offer, n.item)}</p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
                        <span className="font-medium text-ink">{n.deal.provider}</span>
                        <span>{budget(byId[n.wishlist_id])}</span>
                        <Status web={!!n.deal.tags?.includes('web')} />
                      </p>
                    </div>
                    <a href={n.deal.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-full border border-ink px-4 py-2 text-sm font-medium hover:bg-ink hover:text-sheet">View deal</a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="pt-8 pb-10">
            <h3 className="text-xs font-semibold tracking-[.12em] text-ink-soft uppercase">Watching</h3>
            {items.length === 0 ? (
              <p className="py-6 text-sm text-ink-soft">Your list is empty. <button onClick={demo} disabled={busy} className="font-medium text-ink underline underline-offset-4">Load a demo list</button></p>
            ) : (
              <ul className="mt-1 divide-y divide-rule/60">
                {items.map(w => {
                  const alert = notices.find(n => n.wishlist_id === w.id)?.deal
                  const best = alert ?? w.matches[0]
                  return (
                    <li key={w.id} className="group flex items-center gap-4 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{w.item}</p>
                        <p className="mt-0.5 truncate text-sm text-ink-soft">
                          <span>{budget(w)}</span>
                          <span aria-hidden> · </span>
                          {best ? <>{best.discount_pct ? `${best.discount_pct}% off` : 'Student offer'} via {best.provider === 'Direct' ? best.brand : best.provider}</> : 'No match yet'}
                        </p>
                      </div>
                      <button onClick={async () => { await api.delWish(w.id); refresh() }} aria-label={`Remove ${w.item}`}
                        className="grid size-8 shrink-0 place-items-center rounded-full text-lg text-ink-soft opacity-60 group-hover:opacity-100 hover:bg-paper hover:text-pen focus-visible:opacity-100">×</button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}
