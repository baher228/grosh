# API contract (backend FastAPI on :8000, frontend Vite on :5173 proxies /api)

POST /api/analyze  multipart: file (pdf|csv|png|jpg|jpeg|webp), optional form: university (str), notes (str)
GET  /api/sample   -> same response, using bundled sample statement (backend/data/sample_statement.csv)
Response (Analysis):
{
  "source": "gemini" | "fallback",          // which engine produced it
  "model": "gemini-...",
  "profile": {"name": str|null, "period": "1 Sep – 30 Sep 2026", "income": float, "spent": float, "currency": "GBP"},
  "transactions": [{"date": "2026-09-03", "merchant": "Tesco", "description": str, "amount": 12.4, "category": "Groceries"}],
  "categories": [{"name": "Groceries", "total": 210.5, "share": 0.23, "count": 14}],
  "savings": [{
      "id": str, "title": "Switch Spotify Premium to Student", "category": "Subscriptions",
      "current_spend": 11.99, "est_monthly_saving": 6.0,
      "deal": {"id": str, "provider": "UNiDAYS"|"Student Beans"|"TOTUM"|"Direct"|..., "brand": "Spotify", "offer": "Premium Student £5.99/mo", "url": str},
      "evidence": ["2026-09-01 Spotify £11.99"],     // real transaction lines the claim rests on
      "verified": true, "verification_note": "Saving ≤ actual Subscriptions spend; merchant seen 1×",
      "why": "personal one-line reason"
  }],
  "plan": {"headline": str, "monthly_total": float, "yearly_total": float, "steps": [str]},
  "trace": [{"step": "extract"|"categorise"|"match"|"verify"|"plan", "label": str, "status": "ok"|"fallback"|"rejected", "detail": str, "ms": int}]
}

Wishlist (in-memory store is fine):
GET    /api/wishlist                 -> [{"id","item","max_price":float|null,"created_at","matches":[Deal]}]
POST   /api/wishlist {item, max_price?} -> created item with matches (deals currently in catalogue similar to item)
DELETE /api/wishlist/{id}
POST   /api/wishlist/scan            -> simulates a fresh deals feed (backend/data/new_deals.json) arriving; returns new notifications
GET    /api/notifications            -> [{"id","wishlist_id","item","deal":Deal,"reason":str,"created_at","read":bool}]

Deal = {"id","provider","brand","category","offer","discount_pct":int|null,"url","tags":[str]}
GET /api/health -> {"ok":true,"gemini":bool,"model":str}
