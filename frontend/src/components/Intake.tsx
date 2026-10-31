import { useEffect, useRef, useState } from 'react'
import type { StreamEvent } from '../api'

const STEPS: [string, string][] = [
  ['extract', 'Reading your statement'], ['categorise', 'Sorting spending into categories'], ['match', 'Matching student deals'],
  ['research', 'Searching the web for live student offers'], ['verify', 'Checking every claim against your transactions'], ['plan', 'Writing your plan'],
]

function Progress({ events }: { events: StreamEvent[] }) {
  const [t0] = useState(() => Date.now())
  const [now, setNow] = useState(Date.now())
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (window.innerWidth < 768) box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [])
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id) }, [])
  const started = new Set(events.filter(e => e.type === 'start').map(e => (e as { step: string }).step))
  const done = new Map(events.filter(e => e.type === 'step').map(e => [(e as { step: string }).step, e as Extract<StreamEvent, { type: 'step' }>]))
  return (
    <div ref={box} className="sheet scroll-mt-20 rounded-sm px-7 py-8" aria-live="polite">
      <div className="flex items-baseline justify-between">
        <p className="font-display text-xl font-semibold">Working through your statement</p>
        <span className="text-sm text-ink-soft num">{((now - t0) / 1000).toFixed(0)}s</span>
      </div>
      <ol className="mt-6 space-y-4">
        {STEPS.map(([key, label], i) => {
          const d = done.get(key); const live = started.has(key) && !d
          return (
            <li key={key} className={`flex gap-3 transition-colors duration-500 ${d || live ? 'text-ink' : 'text-ink-soft/60'}`}>
              <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs num ${d ? (d.status === 'ok' ? 'border-keep bg-keep text-sheet' : 'border-pen text-pen') : live ? 'border-transparent' : 'border-rule'}`}>
                {d ? <span className="settle">{d.status === 'ok' ? '✓' : '!'}</span> : live ? <span className="spinner" aria-hidden /> : i + 1}
              </span>
              <div className="min-w-0">
                <p>{d?.label || label}</p>
                {d?.detail && <p className="mt-0.5 text-sm text-ink-soft">{d.detail}{d.ms ? <span className="num"> · {(d.ms / 1000).toFixed(1)}s</span> : null}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function Intake({ onFile, onSample, busy, error, progress }: {
  onFile: (f: File, uni: string) => void; onSample: () => void; busy: boolean; error: string | null; progress: StreamEvent[]
}) {
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [uni, setUni] = useState('')

  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-5 pt-10 pb-16 md:grid-cols-[1.1fr_1fr] md:gap-16 md:pt-20">
      <div>
        <h1 className="font-display text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.03em] text-balance md:text-[4.2rem]">
          Making your money go further.
        </h1>
        <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-ink-soft">
          Drop in a month of transactions. grosh's Gemini agent reads each line, finds where a UNiDAYS, Student Beans,
          TOTUM or railcard deal beats what you paid, and checks every saving against your real spending before it shows you.
        </p>
        <label className="mt-8 block max-w-sm">
          <span className="text-sm text-ink-soft">University (optional, helps local deals)</span>
          <input value={uni} onChange={e => setUni(e.target.value)} placeholder="e.g. King's College London"
            className="mt-1.5 w-full rounded-lg border border-rule bg-sheet px-3.5 py-2.5 outline-none focus:border-ink" />
        </label>
      </div>

      <div>
        {busy ? (
          <Progress events={progress} />
        ) : (
          <div
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f, uni) }}
            className={`sheet relative rounded-sm transition-transform ${drag ? 'rotate-[-0.6deg] scale-[1.01]' : ''}`}
          >
            <div className="perf" />
            <div className="px-7 pt-6 pb-8">
              <div className="flex items-baseline justify-between border-b border-dashed border-rule pb-3 text-sm text-ink-soft">
                <span>Statement</span><span className="num">PDF, CSV or a photo</span>
              </div>
              <div className="space-y-2.5 py-6" aria-hidden>
                {[['Spotify', '11.99'], ['Deliveroo', '18.40'], ['Trainline', '34.10'], ['Pret A Manger', '4.25']].map(([m, a], i) => (
                  <div key={m} className="flex justify-between text-ink/70">
                    <span className={i % 2 === 0 ? 'marked' : ''} style={{ ['--d' as string]: `${400 + i * 250}ms` }}>{m}</span>
                    <span className="num">£{a}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => input.current?.click()}
                className="w-full rounded-lg bg-ink px-5 py-3.5 font-medium text-sheet hover:bg-ink/90 active:translate-y-px">
                Upload statement
              </button>
              <button onClick={onSample} className="mt-3 w-full rounded-lg px-5 py-3 text-ink underline decoration-rule underline-offset-4 hover:decoration-ink">
                Use a sample student statement
              </button>
              <input ref={input} type="file" hidden accept=".pdf,.csv,image/*"
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f, uni); e.target.value = '' }} />
              {error && <p role="alert" className="mt-4 text-sm text-pen">{error}</p>}
            </div>
          </div>
        )}
        <p className="mt-4 text-sm text-ink-soft">The file is read once to build your plan. Nothing is stored after you close the page.</p>
      </div>
    </section>
  )
}
