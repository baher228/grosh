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
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <button onClick={() => { setA(null); setView('statement') }} className="font-display text-xl font-bold tracking-[-0.03em]">
            margin<span className="text-pen">.</span>
          </button>
          <nav className="flex items-center gap-1">
            <button onClick={() => { if (view === 'statement') setA(null); setView('statement') }} className={`rounded-lg px-3 py-1.5 hover:text-ink ${view === 'statement' ? 'text-ink' : 'text-ink-soft'}`}>{a && view === 'statement' ? 'New statement' : 'Statement'}</button>
            <button onClick={() => setView('receipt')} className={`rounded-lg px-3 py-1.5 hover:text-ink ${view === 'receipt' ? 'text-ink' : 'text-ink-soft'}`}>Receipt</button>
            <button onClick={() => setWish(true)} className="relative rounded-lg border border-rule bg-sheet px-3.5 py-1.5 hover:border-ink">
              Wishlist
              {unread > 0 && <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-pen text-[11px] font-semibold text-white num">{unread}</span>}
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
