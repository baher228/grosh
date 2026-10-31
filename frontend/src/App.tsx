import { useState } from 'react'
import { api, type StreamEvent } from './api'
import type { Analysis, Notice } from './types'
import { Intake } from './components/Intake'
import { Statement } from './components/Statement'
import { Plan } from './components/Plan'
import { Wishlist } from './components/Wishlist'
import { Receipts } from './components/Receipts'

export default function App() {
  const [a, setA] = useState<Analysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [wish, setWish] = useState(false)
  const [view, setView] = useState<'statement' | 'receipt'>('statement')
  const [notices, setNotices] = useState<Notice[]>([])

  const [progress, setProgress] = useState<StreamEvent[]>([])
  const onEvent = (e: StreamEvent) => setProgress(p => [...p, e])
  const run = async (start: () => Promise<Analysis>) => {
    setBusy(true); setError(null); setProgress([])
    const p = start()
    try { setA(await p); setActive(null); window.scrollTo({ top: 0 }) }
    catch (e) { setError(`${(e as Error).message}. Try a CSV export from your banking app, or the sample statement.`) }
    finally { setBusy(false) }
  }
  const unread = notices.filter(n => !n.read).length

  return (
    <div className="min-h-dvh" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="sticky top-0 z-30 border-b border-rule/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3.5 sm:px-5">
          <button onClick={() => { setA(null); setView('statement') }} className="font-display text-xl font-bold tracking-[-0.03em]">
            margin<span className="text-pen">.</span>
          </button>
          <nav className="flex items-center gap-2 sm:gap-3">
            {a && view === 'statement' && (
              <button onClick={() => setA(null)} className="hidden rounded-lg px-3 py-1.5 text-ink-soft hover:text-ink sm:block">New statement</button>
            )}
            <div role="tablist" aria-label="Mode" className="flex rounded-full border border-rule bg-sheet p-0.5 text-sm shadow-[0_1px_0_rgba(23,35,61,.04)]">
              {([['statement', 'Statement'], ['receipt', 'Receipt']] as const).map(([v, label]) => (
                <button key={v} role="tab" aria-selected={view === v}
                  onClick={() => { if (v === 'statement' && view === 'statement') setA(null); setView(v) }}
                  className={`rounded-full px-3.5 py-1.5 font-medium transition-colors sm:px-4 ${view === v ? 'bg-ink text-sheet' : 'text-ink-soft hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setWish(true)} aria-label={`Wishlist${unread ? `, ${unread} new` : ''}`}
              className="relative grid size-9 place-items-center rounded-full border border-rule bg-sheet hover:border-ink sm:flex sm:h-9 sm:w-auto sm:gap-2 sm:rounded-full sm:px-4">
              <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z" />
              </svg>
              <span className="hidden text-sm font-medium sm:inline">Wishlist</span>
              {unread > 0 && <span className="absolute -top-1 -right-1 grid size-[18px] place-items-center rounded-full bg-pen text-[10px] font-semibold text-white num ring-2 ring-paper">{unread}</span>}
            </button>
          </nav>
        </div>
      </header>

      {view === 'receipt' ? <Receipts /> : !a ? (
        <Intake busy={busy} error={error} progress={progress} onSample={() => run(() => api.sampleStream(onEvent))} onFile={(f, u) => run(() => api.analyzeStream(f, u, onEvent))} />
      ) : (
        <main className="mx-auto grid max-w-6xl gap-10 px-5 pt-8 pb-20 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:gap-14 md:pt-12">
          <div className="order-2 md:order-1"><Statement a={a} active={active} onPick={setActive} /></div>
          <div className="order-1 md:order-2 md:sticky md:top-20 md:self-start"><Plan a={a} active={active} onPick={setActive} /></div>
        </main>
      )}

      <Wishlist open={wish} onClose={() => setWish(false)} onNotices={setNotices} />
    </div>
  )
}
