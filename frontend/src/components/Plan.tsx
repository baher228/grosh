import { useState } from 'react'
import type { MouseEvent } from 'react'
import { gbp } from '../api'
import type { Analysis, FeedbackKind, FeedbackRule, Saving } from '../types'

const SHADES = ['#17233D', '#3B4A6B', '#65739A', '#93A0BF', '#BDC6DA', '#DCE2EC']

function savingMerchants(a: Analysis, saving: Saving) {
  const evidence = saving.evidence.map(line => line.toLowerCase())
  const seen = new Set<string>()
  return a.transactions.flatMap(transaction => {
    const merchant = transaction.merchant.trim()
    const folded = merchant.toLowerCase()
    if (!merchant || seen.has(folded) || !evidence.some(line => line.includes(folded))) return []
    seen.add(folded)
    return [merchant]
  })
}

const FEEDBACK_CHOICES: { kind: FeedbackKind; label: string }[] = [
  { kind: 'keep', label: "I'll keep it" },
  { kind: 'have', label: 'Already have it' },
  { kind: 'not_relevant', label: 'Not relevant' },
]

const KIND_LABELS: Record<FeedbackKind, string> = {
  keep: 'Keeping',
  have: 'Already have',
  not_relevant: 'Not relevant',
}

export function Plan({
  a, active, onPick, rules, onFeedback, onForget,
}: {
  a: Analysis
  active: string | null
  onPick: (id: string | null) => void
  rules: FeedbackRule[]
  onFeedback: (kind: FeedbackKind, saving: Saving, merchants: string[], note: string | null) => Promise<void>
  onForget: (id: string) => Promise<void>
}) {
  const [showTrace, setShowTrace] = useState(false)
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null)
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind | null>(null)
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [forgetBusy, setForgetBusy] = useState<string | null>(null)
  const [forgetError, setForgetError] = useState<string | null>(null)
  const cats = a.categories.filter(c => c.name !== 'Income' && c.total > 0).sort((x, y) => y.total - x.total)
  const top = cats.slice(0, 5)
  const rest = cats.slice(5).reduce((s, c) => s + c.total, 0)
  const bars = rest > 0 ? [...top, { name: 'Everything else', total: rest, share: 0, count: 0 }] : top
  const sum = bars.reduce((s, c) => s + c.total, 0) || 1
  const rejected = a.trace.filter(t => t.status === 'rejected').length

  const closeFeedback = () => {
    setFeedbackFor(null)
    setFeedbackKind(null)
    setFeedbackNote('')
    setFeedbackError(null)
  }

  const saveFeedback = async (event: MouseEvent, saving: Saving) => {
    event.stopPropagation()
    if (!feedbackKind) return
    setFeedbackBusy(true)
    setFeedbackError(null)
    try {
      await onFeedback(feedbackKind, saving, savingMerchants(a, saving), feedbackNote.trim() || null)
      closeFeedback()
    } catch {
      setFeedbackError('Could not save your feedback. Please try again.')
    } finally {
      setFeedbackBusy(false)
    }
  }

  const forget = async (event: MouseEvent, id: string) => {
    event.stopPropagation()
    setForgetBusy(id)
    setForgetError(null)
    try {
      await onForget(id)
    } catch {
      setForgetError('Could not forget this rule. Please try again.')
    } finally {
      setForgetBusy(null)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-ink-soft">You could keep</p>
        <p className="font-display text-6xl font-semibold tracking-[-0.04em] text-keep num md:text-7xl">{gbp(a.plan.monthly_total, 0)}<span className="text-2xl text-ink-soft tracking-normal"> a month</span></p>
        <p className="mt-2 text-ink-soft num">That's {gbp(a.plan.yearly_total, 0)} over a year.</p>
        {a.source === 'gemini' && a.plan.headline && <p className="mt-4 max-w-[36rem] text-lg leading-snug">{a.plan.headline}</p>}
      </div>

      <div>
        <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label="Spending by category">
          {bars.map((c, i) => <span key={c.name} style={{ width: `${(c.total / sum) * 100}%`, background: SHADES[i] }} />)}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          {bars.map((c, i) => (
            <li key={c.name} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: SHADES[i] }} />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto text-ink-soft num">{gbp(c.total, 0)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">Where the deals are</h2>
        <ul className="mt-4 space-y-3">
          {a.savings.map(s => (
            <li key={s.id}>
              <article role="button" tabIndex={0} onClick={() => onPick(active === s.id ? null : s.id)}
                className={`cursor-pointer rounded-xl border bg-sheet p-4 transition-colors ${active === s.id ? 'border-ink' : 'border-rule hover:border-ink-soft'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-medium leading-snug">{s.title}</h3>
                    <p className="mt-1 text-sm text-ink-soft">{s.deal.brand} via {s.deal.provider}: {s.deal.offer}</p>
                    {s.deal.tags?.includes('web') && <p className="mt-1.5 inline-block rounded-full border border-rule px-2 py-0.5 text-xs text-ink-soft">Gemini web lookup, check before buying</p>}
                  </div>
                  <p className="shrink-0 text-right">
                    <span className="font-display text-xl font-semibold text-keep num">{gbp(s.est_monthly_saving)}</span>
                    <span className="block text-xs text-ink-soft">per month</span>
                  </p>
                </div>
                {active === s.id && (
                  <div className="mt-4 space-y-3 border-t border-rule pt-3 text-sm">
                    <p>{s.why}</p>
                    <div>
                      <p className="text-ink-soft">Based on these lines in your statement</p>
                      <ul className="mt-1 space-y-0.5 num">{s.evidence.map(e => <li key={e}>{e}</li>)}</ul>
                    </div>
                    <p className={s.verified ? 'text-keep' : 'text-pen'}>{s.verified ? 'Checked: ' : 'Not verified: '}{s.verification_note}</p>
                    <a href={s.deal.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                      className="inline-block rounded-lg bg-ink px-4 py-2 font-medium text-sheet">Open the {s.deal.brand} offer</a>
                  </div>
                )}
                {feedbackFor === s.id ? (
                  <div
                    className="mt-3 border-t border-rule/70 pt-3"
                    onClick={event => event.stopPropagation()}
                    onKeyDown={event => {
                      if (event.key === 'Escape') {
                        event.stopPropagation()
                        closeFeedback()
                      }
                    }}
                  >
                    <div className="grid grid-cols-3 gap-1 rounded-lg border border-rule bg-paper/50 p-1">
                      {FEEDBACK_CHOICES.map(choice => (
                        <button key={choice.kind} type="button" aria-pressed={feedbackKind === choice.kind}
                          onClick={event => { event.stopPropagation(); setFeedbackKind(choice.kind); setFeedbackError(null) }}
                          className={`min-w-0 rounded-md px-1.5 py-2 text-[11px] leading-tight transition-colors sm:text-xs ${feedbackKind === choice.kind ? 'bg-ink text-sheet' : 'text-ink-soft hover:bg-sheet hover:text-ink'}`}>
                          {choice.label}
                        </button>
                      ))}
                    </div>
                    <input value={feedbackNote} onChange={event => setFeedbackNote(event.target.value)}
                      onClick={event => event.stopPropagation()} type="text"
                      placeholder="Anything grosh should know? (optional)"
                      className="mt-2 w-full min-w-0 rounded-lg border border-rule bg-sheet px-3 py-2 text-base" />
                    {feedbackError && <p className="mt-2 text-sm text-pen">{feedbackError}</p>}
                    <div className="mt-2 flex justify-end gap-3">
                      <button type="button" onClick={event => { event.stopPropagation(); closeFeedback() }}
                        className="px-2 py-1.5 text-sm text-ink-soft hover:text-ink">Cancel</button>
                      <button type="button" disabled={!feedbackKind || feedbackBusy}
                        onClick={event => { void saveFeedback(event, s) }}
                        className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-sheet disabled:opacity-45">
                        {feedbackBusy ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex justify-end border-t border-rule/60 pt-2">
                    <button type="button" onClick={event => {
                      event.stopPropagation()
                      setFeedbackFor(s.id)
                      setFeedbackKind(null)
                      setFeedbackNote('')
                      setFeedbackError(null)
                    }} className="text-sm text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink">
                      Not for me
                    </button>
                  </div>
                )}
              </article>
            </li>
          ))}
        </ul>
        {a.savings.length === 0 && <p className="mt-4 text-ink-soft">No student deal beats what you paid this month. That's a good sign.</p>}
        {rules.length > 0 && (
          <section className="mt-6 border-t border-rule/70 pt-5">
            <h3 className="font-display text-xl font-semibold tracking-tight">grosh remembers</h3>
            <p className="mt-1 text-sm text-ink-soft">grosh skips these in every check, including Gemini's suggestions.</p>
            <ul className="mt-2 divide-y divide-rule/50">
              {rules.map(rule => (
                <li key={rule.id} className="flex min-w-0 items-start gap-3 py-2">
                  <p className="min-w-0 flex-1 break-words text-sm">
                    <span className="text-ink-soft">{KIND_LABELS[rule.kind]}</span>
                    <span className="mx-1">·</span>
                    <span>{rule.title}</span>
                    {rule.note && <span className="text-ink-soft"> · {rule.note}</span>}
                  </p>
                  <button type="button" disabled={forgetBusy === rule.id}
                    onClick={event => { void forget(event, rule.id) }}
                    className="shrink-0 py-0.5 text-sm text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink disabled:opacity-50">
                    Forget
                  </button>
                </li>
              ))}
            </ul>
            {forgetError && <p className="mt-1 text-sm text-pen">{forgetError}</p>}
          </section>
        )}
      </div>

      {a.plan.steps.length > 0 && (
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">This week</h2>
          <ol className="mt-3 space-y-2.5">
            {a.plan.steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[1.75rem_1fr] gap-2"><span className="text-ink-soft num">{i + 1}.</span><span>{s}</span></li>
            ))}
          </ol>
        </div>
      )}

      <div className="rounded-xl border border-dashed border-rule p-4">
        <button onClick={() => setShowTrace(v => !v)} className="flex w-full items-center justify-between text-left">
          <span>
            <span className="font-medium">How the agent got here</span>
            <span className="block text-sm text-ink-soft">
              {a.trace.length} steps on {a.source === 'gemini' ? a.model : 'offline rules (no Gemini key)'}
              {rejected > 0 ? `, ${rejected} claim${rejected > 1 ? 's' : ''} thrown out in checking` : ''}
            </span>
          </span>
          <span className="text-ink-soft">{showTrace ? 'Hide' : 'Show'}</span>
        </button>
        {showTrace && (
          <ol className="mt-4 space-y-3 border-l border-rule pl-4">
            {a.trace.map((t, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ${t.status === 'ok' ? 'bg-keep' : t.status === 'rejected' ? 'bg-pen' : 'bg-ink-soft'}`} />
                <p className="text-sm font-medium">{t.label} <span className="font-normal text-ink-soft num">{t.ms} ms</span></p>
                <p className="text-sm text-ink-soft">{t.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
