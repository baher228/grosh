import { useState } from 'react'
import { gbp } from '../api'
import type { Analysis, Saving } from '../types'

function savingFor(t: Analysis['transactions'][number], savings: Saving[]) {
  return savings.find(s => s.evidence.some(e => e.toLowerCase().includes(t.merchant.toLowerCase()) && e.includes(t.date)))
    ?? savings.find(s => s.evidence.some(e => e.toLowerCase().includes(t.merchant.toLowerCase())))
}

export function Statement({ a, active, onPick }: { a: Analysis; active: string | null; onPick: (id: string) => void }) {
  const all = a.transactions.filter(t => t.category !== 'Income')
  const [onlyMarked, setOnlyMarked] = useState(a.savings.length > 0)
  const out = onlyMarked ? all.filter(t => savingFor(t, a.savings)) : all
  let marks = 0
  return (
    <div className="sheet rounded-sm">
      <div className="perf" />
      <div className="px-5 pt-5 pb-6 md:px-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed border-rule pb-3">
          <p className="font-display text-lg font-semibold">{a.profile.name ?? 'Your statement'}</p>
          <p className="text-sm text-ink-soft num">{a.profile.period}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 border-b border-dashed border-rule py-4 text-sm">
          <div><p className="text-ink-soft">Money in</p><p className="font-display text-xl font-semibold num">{gbp(a.profile.income)}</p></div>
          <div><p className="text-ink-soft">Money out</p><p className="font-display text-xl font-semibold num">{gbp(a.profile.spent)}</p></div>
        </div>
        <div className="flex items-center justify-between pt-4 pb-1 text-sm">
          <p className="text-ink-soft num">{onlyMarked ? `${out.length} of ${all.length} lines have a cheaper student option` : `${all.length} payments`}</p>
          <button onClick={() => setOnlyMarked(v => !v)} className="underline decoration-rule underline-offset-4 hover:decoration-ink">
            {onlyMarked ? 'Show every payment' : 'Show marked lines only'}
          </button>
        </div>
        <ul className="divide-y divide-rule/60">
          {out.map((t, i) => {
            const s = savingFor(t, a.savings)
            const d = s ? marks++ * 140 : 0
            return (
              <li key={i}>
                <button disabled={!s} onClick={() => s && onPick(s.id)}
                  className={`grid w-full grid-cols-[3.4rem_1fr_auto] items-baseline gap-3 py-2.5 text-left ${s ? 'cursor-pointer' : 'cursor-default'} ${s && active === s.id ? 'bg-marker/25' : ''}`}>
                  <span className="text-xs text-ink-soft num">{t.date.slice(5).split('-').reverse().join('/')}</span>
                  <span className="min-w-0">
                    <span className={`truncate ${s ? 'marked' : ''}`} style={{ ['--d' as string]: `${300 + d}ms` }}>{t.merchant}</span>
                    {s && <span className="ml-2 align-middle text-xs text-pen">save {gbp(s.est_monthly_saving)}</span>}
                    <span className="block text-xs text-ink-soft">{t.category}</span>
                  </span>
                  <span className="num">{gbp(Math.abs(t.amount))}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
