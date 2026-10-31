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
      setText(''); setPrice(''); await refresh()
    } catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }
  const scan = async () => {
    setBusy(true); setMsg(null)
    try {
      const fresh = await api.scan()
      setMsg(`${fresh.length ? `${fresh.length} new deal${fresh.length > 1 ? 's' : ''} match your list.` : 'No new matches in today\'s deals.'} Still searching the web for live offers…`)
      await refresh()
    } catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }

  const demo = async () => {
    setBusy(true); setMsg(null)
    try { await api.wishDemo(); await refresh(); setMsg('Demo list ready. Now press “Check today’s deals”.') }
    catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }

  const dedupe = (ds: WishItem['matches']) => ds.filter((d, i) => ds.findIndex(x => x.brand === d.brand && x.offer === d.offer) === i)
  const Provider = ({ name }: { name: string }) => (
    <span className="rounded-full border border-rule bg-paper px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink-soft">{name}</span>
  )

  return (
    <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div onClick={onClose} className={`absolute inset-0 bg-ink/30 backdrop-blur-[2px] transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <aside role="dialog" aria-label="Wishlist"
        className={`absolute right-0 top-0 flex h-dvh w-full max-w-md flex-col bg-paper transition-transform duration-300 md:max-w-[880px] ${open ? 'translate-x-0 shadow-[-24px_0_60px_-30px_rgba(23,35,61,.5)]' : 'translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-start justify-between gap-4 border-b border-rule/70 px-5 py-4 md:px-8 md:py-6">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Wishlist</h2>
            <p className="mt-1 max-w-[34rem] text-sm text-ink-soft">Tell Margin what you're saving up for. It watches new student deals and tells you when one fits your price.</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-ink-soft hover:text-ink">Close</button>
        </div>

        <div className="flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:overflow-hidden">
          <div className="space-y-6 px-5 py-5 md:overflow-y-auto md:px-8 md:py-6">
            <form onSubmit={add} className="sheet rounded-xl p-4">
              <div className="flex gap-2">
                <input value={text} onChange={e => setText(e.target.value)} placeholder="Nike Tech Fleece, AirPods Pro 2…"
                  className="min-w-0 flex-1 rounded-lg border border-rule bg-sheet px-3.5 py-2.5 outline-none focus:border-ink" />
                <div className="relative w-24">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft">£</span>
                  <input value={price} onChange={e => setPrice(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="max"
                    className="w-full rounded-lg border border-rule bg-sheet py-2.5 pr-3 pl-7 outline-none focus:border-ink" />
                </div>
              </div>
              <button disabled={busy} className="mt-2 w-full rounded-lg bg-ink px-4 py-2.5 font-medium text-sheet hover:bg-ink/90 disabled:opacity-60">Add to wishlist</button>
            </form>

            <section>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-lg font-semibold">Watching <span className="text-ink-soft num">{items.length || ''}</span></h3>
                <div className="flex gap-4 text-sm">
                  {items.length > 0 && <button onClick={demo} disabled={busy} className="text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink">Reset demo</button>}
                  <button onClick={scan} disabled={busy || items.length === 0} className="font-medium underline underline-offset-4">{busy ? 'Checking…' : 'Check today’s deals'}</button>
                </div>
              </div>
              {msg && <p className="mt-2 text-sm text-keep">{msg}</p>}
              {items.length === 0 && (
                <div className="mt-3 rounded-xl border border-dashed border-rule p-5 text-sm text-ink-soft">
                  Nothing yet. Add the first thing you want above, or
                  <button onClick={demo} disabled={busy} className="ml-1 font-medium text-ink underline underline-offset-4">try the demo list</button>.
                </div>
              )}
              <ul className="mt-3 space-y-3">
                {items.map(w => {
                  const ms = dedupe(w.matches)
                  const hits = notices.filter(n => n.wishlist_id === w.id).length
                  return (
                    <li key={w.id} className="group rounded-xl border border-rule bg-sheet p-4 transition-colors hover:border-ink/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-display text-lg leading-tight font-semibold">{w.item}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
                            {w.max_price ? <span className="num">Target under £{w.max_price}</span> : <span>Any price</span>}
                            <span className="flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${hits ? 'bg-pen' : 'bg-keep'}`} />{hits ? `${hits} new alert${hits > 1 ? 's' : ''}` : 'Watching'}</span>
                          </p>
                        </div>
                        <button onClick={async () => { await api.delWish(w.id); refresh() }} className="text-sm text-ink-soft opacity-70 group-hover:opacity-100 hover:text-pen">Remove</button>
                      </div>
                      {ms.length > 0 ? (
                        <ul className="mt-3 space-y-2 border-t border-dashed border-rule pt-3 text-sm">
                          {ms.slice(0, 2).map(d => (
                            <li key={d.id}>
                              <a href={d.url} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 hover:underline">
                                <span className="min-w-0">{d.offer}</span><Provider name={d.provider} />
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="mt-3 border-t border-dashed border-rule pt-3 text-sm text-ink-soft">No deal yet. You'll see it here when one turns up.</p>}
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>

          <section className="border-rule/70 px-5 pt-1 pb-8 md:overflow-y-auto md:border-l md:bg-sheet/40 md:px-8 md:py-6">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-lg font-semibold">New for you</h3>
              {notices.length > 0 && <span className="text-sm text-ink-soft num">{notices.length} alert{notices.length > 1 ? 's' : ''}</span>}
            </div>
            {notices.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-rule p-5 text-sm text-ink-soft">
                Deals that drop for anything you're watching land here. Press <span className="text-ink">Check today’s deals</span> to run a scan.
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {[...notices].reverse().map(n => (
                  <li key={n.id} className="notice rounded-xl border border-ink bg-sheet p-4 shadow-[0_10px_30px_-22px_rgba(23,35,61,.6)]">
                    <div className="flex items-center justify-between gap-3 text-sm text-ink-soft">
                      <span className="flex min-w-0 items-center gap-2"><span className="size-1.5 shrink-0 rounded-full bg-pen" /><span className="truncate">For your {n.item}</span></span>
                      {n.deal.tags?.includes('web') ? <Provider name="web lookup" /> : <Provider name={n.deal.provider} />}
                    </div>
                    <p className="mt-2 font-medium leading-snug">{n.deal.brand}: {n.deal.offer}</p>
                    <p className="mt-1 text-sm text-ink-soft">{n.reason}</p>
                    <a className="mt-3 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4" href={n.deal.url} target="_blank" rel="noreferrer">See the deal →</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}
