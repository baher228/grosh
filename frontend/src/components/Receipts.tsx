import { useEffect, useRef, useState } from 'react'
import { api, gbp } from '../api'
import type { Receipt } from '../types'

const READING = ['Reading every line on the receipt', 'Looking for cheaper swaps', 'Checking lines add up to the total']

export function Receipts() {
  const input = useRef<HTMLInputElement>(null)
  const [r, setR] = useState<Receipt | null>(null)
  const [img, setImg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => { if (!busy) return; setTick(0); const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id) }, [busy])

  const go = async (p: () => Promise<Receipt>, preview: string | null) => {
    setBusy(true); setError(null); setR(null); setImg(preview)
    try { setR(await p()) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const onFile = (f: File) => go(() => api.receipt(f), f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  const swaps = r?.items.filter(i => i.saving > 0).length ?? 0

  return (
    <main className="mx-auto max-w-6xl px-5 pt-8 pb-20 md:pt-12">
      <div className="grid gap-10 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-14">
        <div>
          <h1 className="font-display text-[2.2rem] leading-[1.04] font-semibold tracking-[-0.03em] text-balance md:text-[3.2rem]">
            Snap a receipt. See what the same basket costs done smarter.
          </h1>
          <p className="mt-5 max-w-[32rem] text-lg leading-relaxed text-ink-soft">
            Your bank only sees “Tesco £23.40”. Gemini reads each line on the receipt, suggests one realistic swap per item, and checks the lines add up before it tells you anything.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button onClick={() => input.current?.click()} disabled={busy}
              className="whitespace-nowrap rounded-lg bg-ink px-5 py-3.5 font-medium text-sheet hover:bg-ink/90 disabled:opacity-60">Photo or upload a receipt</button>
            <button onClick={() => go(api.receiptSample, '/sample-receipt.png')} disabled={busy}
              className="whitespace-nowrap rounded-lg px-5 py-3 underline decoration-rule underline-offset-4 hover:decoration-ink disabled:opacity-60">Use a sample receipt</button>
            <input ref={input} type="file" hidden accept="image/*,.pdf" capture="environment"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
          </div>
          {error && <p role="alert" className="mt-4 text-sm text-pen">{error}</p>}
          {img && <img src={img} alt="Your receipt" className="mt-8 hidden max-h-[28rem] w-auto rotate-[-1.2deg] rounded-sm shadow-[0_18px_40px_-20px_rgba(23,35,61,.45)] md:block" />}
        </div>

        <div>
          {busy && (
            <div className="sheet rounded-sm px-7 py-8" aria-live="polite">
              <div className="flex items-baseline justify-between">
                <p className="font-display text-xl font-semibold">Reading your receipt</p>
                <span className="text-sm text-ink-soft num">{tick}s</span>
              </div>
              <ol className="mt-6 space-y-4">
                {READING.map((s, i) => {
                  const live = i === Math.min(2, Math.floor(tick / 6))
                  return (
                    <li key={s} className={`flex items-center gap-3 ${i <= Math.floor(tick / 6) ? 'text-ink' : 'text-ink-soft/60'}`}>
                      <span className={`grid size-6 place-items-center rounded-full border text-xs num ${live ? 'border-ink' : 'border-rule'}`}>
                        {live ? <span className="size-2 animate-ping rounded-full bg-ink" /> : i + 1}
                      </span>{s}
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          {r && (
            <div className="space-y-8">
              <div>
                <p className="text-ink-soft">Same basket, smarter</p>
                <p className="font-display text-[3.4rem] leading-none font-semibold tracking-[-0.04em] text-keep num">
                  {gbp(r.total_saving)}<span className="ml-2 text-2xl font-medium text-ink-soft">cheaper</span>
                </p>
                <p className="mt-2 text-ink-soft num">If you shop like this every week, that's about {gbp(r.monthly_saving, 0)} a month.</p>
              </div>

              <div className="sheet relative mx-auto max-w-[30rem] rounded-sm font-mono text-[15px]">
                <div className="perf" />
                <div className="px-6 pt-6 pb-7">
                  <div className="text-center">
                    <p className="font-semibold tracking-wide uppercase">{r.store || 'Receipt'}</p>
                    {r.date && <p className="text-sm text-ink-soft">{r.date}</p>}
                  </div>
                  <ul className="mt-5 space-y-3 border-t border-dashed border-rule pt-4">
                    {r.items.map((it, i) => (
                      <li key={i}>
                        <div className="flex justify-between gap-3">
                          <span className={`min-w-0 ${it.saving > 0 ? 'marked' : ''}`} style={{ ['--d' as string]: `${200 + i * 90}ms` }}>
                            {it.qty > 1 ? `${it.qty}× ` : ''}{it.name}
                          </span>
                          <span className={`shrink-0 num ${it.saving > 0 ? 'text-ink-soft line-through decoration-pen' : ''}`}>{gbp(it.price)}</span>
                        </div>
                        {it.saving > 0 && it.swap && (
                          <div className="mt-1 flex justify-between gap-3 pl-3 font-sans text-sm text-pen">
                            <span className="min-w-0">→ {it.swap}{it.reason ? <span className="text-ink-soft">. {it.reason}</span> : null}</span>
                            <span className="shrink-0 num">{gbp(it.swap_price || 0)}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 space-y-1 border-t border-dashed border-rule pt-4">
                    {r.discounts > 0 && <div className="flex justify-between text-ink-soft"><span>Savings on receipt</span><span className="num">−{gbp(r.discounts)}</span></div>}
                    <div className="flex justify-between font-semibold"><span>Total paid</span><span className="num">{gbp(r.total ?? r.checks.items_sum)}</span></div>
                    <div className="flex justify-between font-semibold text-keep"><span>With swaps</span><span className="num">{gbp((r.total ?? r.checks.items_sum) - r.total_saving)}</span></div>
                  </div>
                  <p className={`mt-4 font-sans text-sm ${r.checks.matches ? 'text-keep' : 'text-pen'}`}>{r.checks.matches ? '✓ ' : '! '}{r.checks.note}</p>
                </div>
              </div>

              {r.tips.length > 0 && (
                <section>
                  <h2 className="font-display text-2xl font-semibold tracking-tight">What your basket says</h2>
                  <ol className="mt-3 space-y-2.5">
                    {r.tips.map((t, i) => (
                      <li key={i} className="flex gap-3"><span className="num text-ink-soft">{i + 1}.</span><span>{t}</span></li>
                    ))}
                  </ol>
                </section>
              )}
              <p className="text-sm text-ink-soft">{swaps} of {r.items.length} lines have a cheaper option · read by {r.model}{r.trace.find(t => t.step === 'read')?.ms ? ` in ${((r.trace.find(t => t.step === 'read')!.ms) / 1000).toFixed(1)}s` : ''}</p>
            </div>
          )}

          {!busy && !r && (
            <div className="sheet relative mx-auto max-w-[24rem] md:rotate-[1deg] rounded-sm font-mono text-[15px] text-ink/70" aria-hidden>
              <div className="perf" />
              <div className="space-y-2.5 px-6 py-7">
                <p className="text-center font-semibold">TESCO EXPRESS</p>
                {[['Meal deal', '3.85', 'Lidl meal deal 2.99'], ['Coca-Cola 500ml', '1.85', 'Multipack can 0.62'], ['Ben & Jerry’s', '5.50', 'Clubcard price 4.00']].map(([n, p, s]) => (
                  <div key={n}>
                    <div className="flex justify-between"><span className="marked">{n}</span><span className="line-through decoration-pen">£{p}</span></div>
                    <p className="pl-3 font-sans text-sm text-pen">→ {s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
