import csv
import io
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict
from datetime import date

import gemini
from deals import deals_for_transactions, load_deals

CATEGORIES = [
    "Groceries", "Eating out", "Takeaway/Delivery", "Transport", "Subscriptions",
    "Shopping/Clothes", "Tech", "Entertainment", "Coffee", "Bills/Phone", "Rent",
    "Income", "Other",
]

STEP_LABELS = {
    "extract": "Reading your statement",
    "categorise": "Sorting spending into categories",
    "match": "Matching student deals",
    "research": "Searching the web for live student offers",
    "verify": "Checking every claim against your transactions",
    "plan": "Writing your plan",
}

RULES = [
    ("Income", ("student loan", "maintenance loan", "salary", "wages", "payroll", "income")),
    ("Rent", ("rent", "accommodation", "landlord")),
    ("Groceries", ("tesco", "lidl", "aldi", "sainsbury", "morrisons", "asda", "co-op", "waitrose")),
    ("Takeaway/Delivery", ("deliveroo", "uber eats", "just eat", "domino", "deliveroo")),
    ("Coffee", ("pret", "starbucks", "costa", "caffe nero", "coffee")),
    ("Transport", ("tfl", "trainline", "rail", "national express", "megabus", "uber", "bolt", "bus")),
    ("Subscriptions", ("spotify", "netflix", "prime", "icloud", "disney", "youtube", "subscription")),
    ("Bills/Phone", ("vodafone", "ee mobile", "o2", "three", "giffgaff", "phone", "broadband", "energy")),
    ("Shopping/Clothes", ("asos", "nike", "adidas", "zara", "h&m", "clothing", "clothes")),
    ("Tech", ("apple store", "currys", "samsung", "microsoft", "tech")),
    ("Entertainment", ("odeon", "vue", "cinema", "theatre", "concert", "headspace")),
    ("Eating out", ("restaurant", "mcdonald", "nando", "greggs", "wagamama", "restaurant")),
    ("Other", ()),
]


def _fallback_category(transaction):
    text = (transaction["merchant"] + " " + transaction["description"]).lower()
    if transaction.get("_income"):
        return "Income"
    return next((category for category, words in RULES if any(word in text for word in words)), "Other")


def _parse_csv(file_bytes):
    reader = csv.DictReader(io.StringIO(file_bytes.decode("utf-8-sig")))
    if not reader.fieldnames:
        return []
    fields = {field.strip().lower(): field for field in reader.fieldnames}
    date_field = next((fields[key] for key in ("date", "transaction date", "posted date") if key in fields), None)
    desc_field = next((fields[key] for key in ("description", "merchant", "details", "name") if key in fields), None)
    amount_field = next((fields[key] for key in ("amount", "value", "debit/credit") if key in fields), None)
    if not desc_field or not amount_field:
        raise ValueError("CSV requires description and amount columns")
    transactions = []
    for row in reader:
        desc = (row.get(desc_field) or "").strip()
        amount_text = (row.get(amount_field) or "").replace(",", "").replace("£", "").strip()
        if not desc or not amount_text:
            continue
        amount_text = amount_text.replace("(", "-").replace(")", "")
        try:
            amount = abs(float(amount_text))
        except ValueError:
            continue
        raw_date = (row.get(date_field) or "").strip() if date_field else ""
        try:
            parsed_date = date.fromisoformat(raw_date[:10]).isoformat()
        except ValueError:
            parsed_date = "2026-09-01"
        merchant = re.split(r"\s{2,}|[#*]", desc, maxsplit=1)[0].strip() or desc
        is_income = amount_text.startswith("+") or (
            not amount_text.startswith("-")
            and any(word in desc.lower() for word in ("loan", "salary", "wages", "income", "payroll"))
        )
        transactions.append({
            "date": parsed_date,
            "merchant": merchant[:60],
            "description": desc,
            "amount": round(amount, 2),
            "_income": is_income,
        })
    return transactions


def _normalise_transactions(items):
    output = []
    for row in items if isinstance(items, list) else []:
        if not isinstance(row, dict):
            continue
        description = str(row.get("description") or row.get("merchant") or "Transaction").strip()
        merchant = str(row.get("merchant") or description.split()[0]).strip()
        try:
            amount = abs(float(row.get("amount", 0)))
        except (ValueError, TypeError):
            continue
        if not description or amount <= 0:
            continue
        raw_date = str(row.get("date") or "2026-09-01")[:10]
        try:
            raw_date = date.fromisoformat(raw_date).isoformat()
        except ValueError:
            raw_date = "2026-09-01"
        output.append({
            "date": raw_date,
            "merchant": merchant[:60],
            "description": description[:160],
            "amount": round(amount, 2),
            "_category": str(row.get("category") or ""),
            "_income": str(row.get("category", "")).lower() == "income",
        })
    return output


def _line(transaction):
    return f"{transaction['date']} {transaction['merchant']} £{transaction['amount']:.2f}"


def _period(transactions):
    if not transactions:
        return "This statement"
    dates = sorted(date.fromisoformat(transaction["date"]) for transaction in transactions)
    start, end = dates[0], dates[-1]
    if start.year == end.year:
        return f"{start.day} {start:%b} – {end.day} {end:%b} {end.year}"
    return f"{start.day} {start:%b} {start.year} – {end.day} {end:%b} {end.year}"


def _aggregate(transactions):
    by_category = defaultdict(lambda: {"total": 0.0, "count": 0})
    income = spent = 0.0
    for transaction in transactions:
        category = transaction["category"]
        bucket = by_category[category]
        bucket["total"] += transaction["amount"]
        bucket["count"] += 1
        if category == "Income":
            income += transaction["amount"]
        else:
            spent += transaction["amount"]
    categories = [
        {"name": name, "total": round(values["total"], 2),
         "share": round(values["total"] / spent, 4) if name != "Income" and spent else 0,
         "count": values["count"]}
        for name, values in by_category.items()
    ]
    return categories, round(income, 2), round(spent, 2)


def _fallback_savings(transactions, catalogue):
    savings = []
    seen_brands = set()
    for deal in catalogue:
        brand = deal["brand"].lower()
        if brand in seen_brands:
            continue
        matching = [
            tx for tx in transactions
            if tx["category"] != "Income"
            and tx["category"] == deal["category"]
            and (brand in tx["merchant"].lower() or brand in tx["description"].lower())
        ]
        if not matching:
            continue
        merchant_spend = round(sum(tx["amount"] for tx in matching), 2)
        category_total = round(sum(
            tx["amount"] for tx in transactions if tx["category"] == matching[0]["category"]
        ), 2)
        offer = deal["offer"].lower()
        price_match = re.search(r"£\s*(\d+(?:\.\d{1,2})?)", offer)
        if price_match and "student" in offer:
            saving = max(0, merchant_spend - float(price_match.group(1)))
        elif deal.get("discount_pct"):
            saving = merchant_spend * deal["discount_pct"] / 100
        else:
            saving = merchant_spend * 0.05
        saving = round(min(saving, merchant_spend, category_total), 2)
        if not saving:
            continue
        lines = [_line(tx) for tx in matching]
        savings.append({
            "id": deal["id"],
            "title": f"Save with {deal['brand']} student offer",
            "category": matching[0]["category"],
            "current_spend": merchant_spend,
            "est_monthly_saving": saving,
            "deal": deal,
            "evidence": lines,
            "verified": False,
            "verification_note": "",
            "why": f"You spent £{merchant_spend:.2f} at {deal['brand']} this month; this student offer could reduce that cost.",
        })
        seen_brands.add(brand)
        if len(savings) == 8:
            break
    return savings


def _fallback_plan(total):
    return {
        "headline": f"You could save about £{total:.2f} each month with student deals.",
        "monthly_total": round(total, 2),
        "yearly_total": round(total * 12, 2),
        "steps": [
            "Check each provider’s student eligibility and activate the linked offer.",
            "Switch recurring subscriptions to the student plan before the next renewal.",
            "Use student discounts at checkout and compare transport fares before booking.",
        ],
    }


def analyze(file_bytes, filename, mime_type, university=None, notes=None, emit=None, use_gemini=None):
    is_csv = filename.lower().endswith(".csv") or mime_type == "text/csv"
    catalogue = load_deals()
    use_gemini = gemini.available() if use_gemini is None else use_gemini
    if not use_gemini:
        return _run(
            file_bytes, filename, is_csv, mime_type, university, notes,
            catalogue, use_gemini=False, emit=emit,
        )
    try:
        return _run(
            file_bytes, filename, is_csv, mime_type, university, notes,
            catalogue, use_gemini=True, emit=emit,
        )
    except Exception as error:
        failure = {
            "step": "extract",
            "label": "Gemini call failed, used offline rules",
            "status": "fallback",
            "detail": str(error)[:160],
            "ms": 0,
        }
        if emit:
            emit({"type": "step", **failure})
        result = _run(
            file_bytes, filename, is_csv, mime_type, university, notes,
            catalogue, use_gemini=False, emit=emit,
        )
        result["trace"].insert(0, failure)
        return result


def _research_targets(transactions, catalogue):
    catalogue_brands = [
        deal["brand"].casefold()
        for deal in catalogue
        if deal.get("brand")
    ]
    groups = {}
    for index, transaction in enumerate(transactions):
        if transaction["category"] == "Income":
            continue
        key = transaction["merchant"].casefold()
        group = groups.setdefault(key, {
            "merchant": transaction["merchant"],
            "spend": 0.0,
            "evidence_ids": [],
            "category_spend": defaultdict(float),
        })
        group["spend"] += transaction["amount"]
        group["evidence_ids"].append(index)
        group["category_spend"][transaction["category"]] += transaction["amount"]
    targets = []
    for group in groups.values():
        merchant = group["merchant"].casefold()
        if any(brand in merchant for brand in catalogue_brands):
            continue
        group["spend"] = round(group["spend"], 2)
        group["category"] = max(
            group["category_spend"],
            key=lambda category: (group["category_spend"][category], category),
        )
        targets.append(group)
    return sorted(
        targets,
        key=lambda row: (-row["spend"], row["merchant"].casefold()),
    )[:3]


def _match_savings(transactions, categories, candidates, catalogue, use_gemini):
    if use_gemini and candidates:
        selected = gemini.choose_savings(
            transactions, categories, candidates
        ).get("savings", [])
        by_id = {deal["id"]: deal for deal in candidates}
        savings = []
        for row in selected[:8]:
            deal = by_id.get(row.get("deal_id"))
            if not deal:
                continue
            evidence_ids = row.get("evidence_ids")
            evidence_ids = evidence_ids if isinstance(evidence_ids, list) else []
            savings.append({
                "id": deal["id"],
                "title": str(row.get("title") or f"Save with {deal['brand']} student offer"),
                "category": str(row.get("category") or deal["category"]),
                "current_spend": row.get("current_spend", 0),
                "est_monthly_saving": row.get("est_monthly_saving", 0),
                "deal": deal,
                "evidence": [
                    _line(transactions[index])
                    for index in evidence_ids
                    if type(index) is int and 0 <= index < len(transactions)
                ],
                "evidence_ids": evidence_ids,
                "verified": False,
                "verification_note": "",
                "why": str(row.get("why") or ""),
            })
        return savings
    return _fallback_savings(transactions, catalogue)


def _research_savings(targets, transactions):
    started = time.perf_counter()
    try:
        if not targets:
            detail = "No unsaved non-Income merchants to research"
            web_savings = []
        else:
            research, domains = gemini.research_discounts(targets)
            web_savings = _web_savings(research, targets, transactions)
            source_detail = ", ".join(domains) if domains else "no grounding sources reported"
            detail = f"{len(web_savings)} web savings proposed; grounding sources: {source_detail}"
        status = "ok"
    except Exception as error:
        web_savings = []
        status = "fallback"
        detail = f"web research unavailable: {str(error)[:120]}"
    entry = {
        "step": "research",
        "label": "Research live student discounts",
        "status": status,
        "detail": detail,
        "ms": int((time.perf_counter() - started) * 1000),
    }
    return web_savings, entry


def _web_savings(result, targets, transactions):
    by_merchant = {row["merchant"].casefold(): row for row in targets}
    savings = []
    for row in result.get("deals", []):
        if not isinstance(row, dict):
            continue
        target = by_merchant.get(str(row.get("merchant", "")).casefold())
        if not target:
            continue
        try:
            pct = max(0.0, min(50.0, float(row["est_discount_pct"])))
        except (ValueError, TypeError, KeyError):
            continue
        brand = str(row.get("brand") or "").strip()
        provider = str(row.get("provider") or "").strip()
        offer = str(row.get("offer") or "").strip()
        url = str(row.get("url") or "").strip()
        if not all((brand, provider, offer, url)) or pct <= 0:
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", brand.lower()).strip("-") or "offer"
        evidence_ids = row.get("evidence_ids", [])
        evidence_ids = evidence_ids if isinstance(evidence_ids, list) else []
        evidence = [
            _line(transactions[index])
            for index in evidence_ids
            if type(index) is int and 0 <= index < len(transactions)
        ]
        saving = round(target["spend"] * pct / 100, 2)
        savings.append({
            "id": f"web-{slug}",
            "title": f"Save with {brand} student offer",
            "category": target["category"],
            "current_spend": target["spend"],
            "est_monthly_saving": saving,
            "deal": {
                "id": f"web-{slug}",
                "provider": provider,
                "brand": brand,
                "category": target["category"],
                "offer": offer,
                "discount_pct": round(pct),
                "url": url,
                "tags": ["web"],
            },
            "evidence": evidence,
            "evidence_ids": evidence_ids,
            "verified": False,
            "verification_note": "",
            "why": f"Search found a student offer for {brand}.",
        })
    return savings


def _run(file_bytes, filename, is_csv, mime_type, university, notes, catalogue, use_gemini, emit=None):
    trace = []
    status = "ok" if use_gemini else "fallback"

    def start(step):
        if emit:
            emit({"type": "start", "step": step, "label": STEP_LABELS[step]})

    def record(step, label, started, detail=""):
        entry = {
            "step": step,
            "label": label,
            "status": status,
            "detail": detail,
            "ms": int((time.perf_counter() - started) * 1000),
        }
        trace.append(entry)
        if emit:
            emit({"type": "step", **entry})
        return entry

    started = time.perf_counter()
    start("extract")
    extract_model = None
    if is_csv:
        transactions = _parse_csv(file_bytes)
    elif use_gemini:
        start("categorise")
        extract_model = gemini.FAST_MODEL
        extracted = gemini.extract_statement(
            file_bytes, mime_type, CATEGORIES, model=extract_model
        )
        transactions = _normalise_transactions(extracted.get("transactions", []))
        for transaction in transactions:
            category = transaction.pop("_category")
            if category not in CATEGORIES:
                raise ValueError("Gemini returned an invalid transaction category")
            transaction["category"] = category
    else:
        transactions = []
    extract_detail = f"{len(transactions)} transactions"
    if extract_model:
        extract_detail += f" read by {extract_model}"
    record("extract", "Extract transactions", started, extract_detail)

    if use_gemini and not is_csv:
        started = time.perf_counter()
        record(
            "categorise",
            "Categorise transactions",
            started,
            f"categorised during extraction by {extract_model}",
        )
    else:
        started = time.perf_counter()
        start("categorise")
        if use_gemini:
            public_rows = [{key: value for key, value in tx.items() if not key.startswith("_")} for tx in transactions]
            result = gemini.categorise_transactions(public_rows, CATEGORIES)
            assigned = result.get("categories", [])
            if len(assigned) != len(transactions) or any(category not in CATEGORIES for category in assigned):
                raise ValueError("Gemini returned invalid category assignments")
            for tx, category in zip(transactions, assigned):
                tx["category"] = category
        else:
            for tx in transactions:
                tx["category"] = _fallback_category(tx)
        record("categorise", "Categorise transactions", started, f"{len(transactions)} categorised")

    categories, income, spent = _aggregate(transactions)
    for tx in transactions:
        tx.pop("_income", None)
    targets = _research_targets(transactions, catalogue) if use_gemini else []
    candidates = deals_for_transactions(transactions, catalogue)
    match_started = time.perf_counter()
    start("match")
    if use_gemini:
        start("research")
        with ThreadPoolExecutor(max_workers=2) as executor:
            match_future = executor.submit(
                _match_savings, transactions, categories, candidates, catalogue, True
            )
            research_future = executor.submit(_research_savings, targets, transactions)
            for future in as_completed((match_future, research_future)):
                if future is match_future:
                    savings = future.result()
                    record(
                        "match", "Match student deals", match_started,
                        f"{len(savings)} savings proposed from {len(candidates)} candidate deals",
                    )
                else:
                    web_savings, research_entry = future.result()
                    trace.append(research_entry)
                    if emit:
                        emit({"type": "step", **research_entry})
                    savings.extend(web_savings)
    else:
        savings = _match_savings(
            transactions, categories, candidates, catalogue, False
        )
        record(
            "match", "Match student deals", match_started,
            f"{len(savings)} savings proposed from {len(candidates)} candidate deals",
        )

    started = time.perf_counter()
    start("verify")
    transactions_by_line = {_line(tx): tx for tx in transactions}
    real_lines = set(transactions_by_line)
    category_totals = {row["name"]: row["total"] for row in categories}
    verified = []
    rejected = []
    for saving in savings:
        try:
            estimate = max(0.0, round(float(saving["est_monthly_saving"]), 2))
            claimed_spend = max(0.0, round(float(saving["current_spend"]), 2))
        except (ValueError, TypeError, KeyError):
            rejected.append((saving, "invalid numeric amount"))
            continue
        evidence_ids = saving.get("evidence_ids")
        invalid_evidence_id = False
        if evidence_ids is not None:
            invalid_evidence_id = not isinstance(evidence_ids, list)
            evidence = []
            for index in evidence_ids if isinstance(evidence_ids, list) else []:
                if type(index) is not int or not 0 <= index < len(transactions):
                    invalid_evidence_id = True
                elif transactions[index]["category"] == "Income":
                    invalid_evidence_id = True
                else:
                    evidence.append(_line(transactions[index]))
        else:
            evidence = [line for line in saving.get("evidence", []) if line in real_lines]
        evidence = list(dict.fromkeys(evidence))
        category_total = category_totals.get(saving["category"], 0.0)
        evidence_spend = round(sum(
            transactions_by_line[line]["amount"] for line in set(evidence)
        ), 2)
        limit = min(claimed_spend, evidence_spend, category_total)
        if invalid_evidence_id:
            rejected.append((saving, "evidence ids include an out-of-range or Income transaction"))
        elif not evidence:
            rejected.append((saving, "evidence did not match a real transaction"))
        elif estimate > limit:
            rejected.append((saving, f"estimated saving £{estimate:.2f} exceeds spend limit £{limit:.2f}"))
        elif not saving.get("deal"):
            rejected.append((saving, "deal was not found in the catalogue"))
        else:
            saving["current_spend"] = round(limit, 2)
            saving["est_monthly_saving"] = estimate
            saving["evidence"] = evidence
            saving.pop("evidence_ids", None)
            saving["verified"] = True
            saving["verification_note"] = (
                f"Saving ≤ actual {saving['category']} spend; evidence matches {len(evidence)} transaction(s)."
            )
            verified.append(saving)
    critic = ""
    if use_gemini:
        critique = gemini.critique_savings(transactions, verified)
        critic = json.dumps(critique.get("flags", []), ensure_ascii=False)
    for saving, reason in rejected:
        rejection = {
            "step": "verify", "label": f"Rejected {saving.get('title', 'saving')}",
            "status": "rejected", "detail": reason, "ms": 0,
        }
        trace.append(rejection)
        if emit:
            emit({"type": "step", **rejection})
    record(
        "verify", "Verify savings", started,
        f"{len(verified)} verified; {len(rejected)} rejected"
        + (f"; critic flags: {critic}" if use_gemini else ""),
    )

    started = time.perf_counter()
    start("plan")
    monthly = round(sum(item["est_monthly_saving"] for item in verified), 2)
    if use_gemini:
        plan = gemini.build_plan(verified, categories, university)
        headline = str(plan.get("headline") or "").strip()
        steps = plan.get("steps")
        if not headline or not isinstance(steps, list) or not 3 <= len(steps) <= 5:
            raise ValueError("Gemini returned an invalid savings plan")
        plan = {
            "headline": headline,
            "monthly_total": monthly,
            "yearly_total": round(monthly * 12, 2),
            "steps": [str(step) for step in steps],
        }
    else:
        plan = _fallback_plan(monthly)
    record("plan", "Build savings plan", started, "Totals computed from verified savings")

    name = "Sample student (synthetic)" if filename == "sample_statement.csv" else (university or None)
    if name and university and filename != "sample_statement.csv":
        name = f"{university} student"
    return {
        "source": "gemini" if use_gemini else "fallback",
        "model": gemini.MODEL,
        "profile": {
            "name": name,
            "period": _period(transactions),
            "income": income,
            "spent": spent,
            "currency": "GBP",
        },
        "transactions": transactions,
        "categories": categories,
        "savings": verified,
        "plan": plan,
        "trace": trace,
    }
