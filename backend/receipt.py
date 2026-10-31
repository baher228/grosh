import math
import time
from datetime import date

from google.genai import types

import gemini

RECEIPT_PROMPT = """You are reading a shopping receipt for a UK university student on a tight budget. Extract every purchased line exactly as printed (do not merge or invent lines). For each line, suggest at most one realistic cheaper alternative the student could buy next time: a supermarket own-brand or value-range equivalent, the same item at a cheaper UK supermarket (Aldi, Lidl), a loyalty price (Tesco Clubcard, Lidl Plus, Nectar), a multipack or larger size with a lower unit price, or a student discount. If there is no sensible swap, set swap to null. Estimate swap_price in GBP conservatively; never above the original price. Return JSON only:
{"store": string|null, "date": "YYYY-MM-DD"|null, "total": number|null, "items": [{"name": string, "qty": number, "price": number, "category": "Groceries"|"Snacks"|"Drinks"|"Alcohol"|"Household"|"Toiletries"|"Ready meals"|"Other", "swap": string|null, "swap_price": number|null, "reason": string|null}], "discounts": number, "tips": [string]}
price is the line total actually paid. discounts is the total of any savings/discount lines as a positive number (0 if none). tips: 2-3 short habit-level suggestions based on what this person bought (e.g. meal-deal frequency, branded snacks), each naming the actual products."""

CATEGORIES = {
    "Groceries", "Snacks", "Drinks", "Alcohol",
    "Household", "Toiletries", "Ready meals", "Other",
}


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _optional_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalise_items(rows):
    items = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        name = _optional_text(row.get("name"))
        price = _number(row.get("price"))
        if not name or price is None:
            continue
        price = round(max(0.0, price), 2)
        qty = _number(row.get("qty"))
        qty = 1 if qty is None else max(0.0, qty)
        if qty.is_integer():
            qty = int(qty)
        else:
            qty = round(qty, 3)
        category = str(row.get("category") or "Other").strip()
        if category not in CATEGORIES:
            category = "Other"
        swap = _optional_text(row.get("swap"))
        swap_price = _number(row.get("swap_price"))
        reason = _optional_text(row.get("reason"))
        saving = 0.0
        if not swap:
            swap_price = None
            reason = None
        elif swap_price is not None and 0 < round(swap_price, 2) < price:
            swap_price = round(swap_price, 2)
            saving = round(price - swap_price, 2)
        elif swap_price is not None:
            swap = None
            swap_price = None
            reason = None
        items.append({
            "name": name,
            "qty": qty,
            "price": price,
            "category": category,
            "swap": swap,
            "swap_price": swap_price,
            "saving": saving,
            "reason": reason,
        })
    return items


def _receipt_date(value):
    text = _optional_text(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return None


def analyze_receipt(file_bytes, mime_type):
    if not gemini.available():
        raise RuntimeError("Receipt reading needs Gemini")
    part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
    started = time.perf_counter()
    extracted = gemini.ask_json(
        RECEIPT_PROMPT,
        parts=[part],
        model=gemini.MODEL,
    )
    read_ms = int((time.perf_counter() - started) * 1000)

    started = time.perf_counter()
    items = _normalise_items(extracted.get("items", []))
    discounts = round(max(0.0, _number(extracted.get("discounts")) or 0.0), 2)
    total = _number(extracted.get("total"))
    total = round(max(0.0, total), 2) if total is not None else None
    items_sum = round(sum(item["price"] for item in items) - discounts, 2)
    matches = abs(items_sum - total) <= 0.05 if total is not None else None
    if total is None:
        note = f"{len(items)} lines add up to £{items_sum:.2f}; no receipt total was read"
    elif matches:
        note = f"{len(items)} lines add up to the £{total:.2f} total"
    else:
        note = (
            f"Lines add up to £{items_sum:.2f} but the receipt says £{total:.2f}; "
            "some lines may be misread"
        )
    checks = {"items_sum": items_sum, "total": total, "matches": matches, "note": note}
    verify_ms = int((time.perf_counter() - started) * 1000)
    tips = [
        text for tip in extracted.get("tips", []) if (text := _optional_text(tip))
    ][:3] if isinstance(extracted.get("tips"), list) else []
    if len(tips) < 2 and items:
        for item in items:
            tips.append(f"Compare value alternatives for {item['name']} next time.")
            if len(tips) == 2:
                break
    total_saving = round(sum(item["saving"] for item in items), 2)
    trace = [
        {
            "step": "read",
            "label": "Reading every line on the receipt",
            "status": "ok",
            "detail": f"{len(items)} lines extracted",
            "ms": read_ms,
        },
        {
            "step": "swap",
            "label": "Finding cheaper alternatives",
            "status": "ok",
            "detail": f"{sum(item['swap'] is not None for item in items)} swaps suggested",
            "ms": 0,
        },
        {
            "step": "verify",
            "label": "Checking lines add up to the total",
            "status": "ok",
            "detail": note,
            "ms": verify_ms,
        },
    ]
    return {
        "source": "gemini",
        "model": gemini.MODEL,
        "store": _optional_text(extracted.get("store")),
        "date": _receipt_date(extracted.get("date")),
        "total": total,
        "items": items,
        "discounts": discounts,
        "tips": tips,
        "total_saving": total_saving,
        "monthly_saving": round(total_saving * 4.33, 2),
        "checks": checks,
        "trace": trace,
    }
