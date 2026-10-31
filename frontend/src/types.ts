export type Deal = { id: string; provider: string; brand: string; category?: string; offer: string; discount_pct?: number | null; url: string; tags?: string[] }
export type Txn = { date: string; merchant: string; description?: string; amount: number; category: string }
export type Saving = {
  id: string; title: string; category: string; current_spend: number; est_monthly_saving: number
  deal: Deal; evidence: string[]; verified: boolean; verification_note: string; why: string
}
export type TraceStep = { step: string; label: string; status: 'ok' | 'fallback' | 'rejected'; detail: string; ms: number }
export type Analysis = {
  source: 'gemini' | 'fallback'; model: string
  profile: { name: string | null; period: string; income: number; spent: number; currency: string }
  transactions: Txn[]
  categories: { name: string; total: number; share: number; count: number }[]
  savings: Saving[]
  plan: { headline: string; monthly_total: number; yearly_total: number; steps: string[] }
  trace: TraceStep[]
}
export type WishItem = { id: string; item: string; max_price: number | null; created_at: string; matches: Deal[] }
export type Notice = { id: string; wishlist_id: string; item: string; deal: Deal; reason: string; created_at: string; read: boolean }
