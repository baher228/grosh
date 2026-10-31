export type Deal = { id: string; provider: string; brand: string; category?: string; offer: string; discount_pct?: number | null; url: string; tags?: string[]; source?: string; fetched_at?: string }
export type Txn = { date: string; merchant: string; description?: string; amount: number; category: string }
export type FeedbackKind = 'keep' | 'have' | 'not_relevant'
export type FeedbackRule = {
  id: string; kind: FeedbackKind; note: string | null; title: string; category: string
  deal: { id: string; brand: string; provider: string }; merchants: string[]; created_at: string
}
export type Saving = {
  id: string; title: string; category: string; current_spend: number; est_monthly_saving: number
  deal: Deal; evidence: string[]; verified: boolean; verification_note: string; why: string
  confidence?: 'verified' | 'unconfirmed'; critic_note?: string
}
export type TraceStep = { step: string; label: string; status: 'ok' | 'fallback' | 'rejected'; detail: string; ms: number }
export type Analysis = {
  source: 'gemini' | 'fallback'; model: string
  profile: { name: string | null; period: string; income: number; spent: number; currency: string }
  transactions: Txn[]
  categories: { name: string; total: number; share: number; count: number }[]
  savings: Saving[]
  plan: { headline: string; monthly_total: number; yearly_total: number; unconfirmed_monthly?: number; steps: string[] }
  trace: TraceStep[]
  replay?: { elapsed_ms: number; recorded_at: string }
  remembered?: { rule_id: string; kind: FeedbackKind; title: string }[]
}
export type WishItem = { id: string; item: string; max_price: number | null; created_at: string; matches: Deal[] }
export type Notice = { id: string; wishlist_id: string; item: string; deal: Deal; reason: string; created_at: string; read: boolean }
export type ReceiptItem = { name: string; qty: number; price: number; category: string; swap: string | null; swap_price: number | null; saving: number; reason: string | null }
export type Receipt = {
  source: 'gemini'; model: string; store: string | null; date: string | null; total: number | null
  items: ReceiptItem[]; discounts: number; tips: string[]; total_saving: number; monthly_saving: number
  checks: { items_sum: number; total: number | null; matches: boolean; note: string }
  trace: TraceStep[]
}
