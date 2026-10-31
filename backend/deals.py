import json
import re
from pathlib import Path

DATA = Path(__file__).parent / "data"
GENERIC = {
    "online", "instore", "in", "store", "stores", "uk", "the", "student",
    "students", "shop", "co", "com", "and",
}


def load_deals(filename="deals.json"):
    deals = json.loads((DATA / filename).read_text())
    if filename != "deals.json":
        return deals
    scraped_path = DATA / "scraped_deals.json"
    if not scraped_path.is_file():
        return deals
    try:
        scraped = json.loads(scraped_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return deals
    if not isinstance(scraped, list):
        return deals
    existing_ids = {
        deal.get("id")
        for deal in deals
        if isinstance(deal, dict) and deal.get("id") is not None
    }
    for deal in scraped:
        if not isinstance(deal, dict):
            continue
        deal_id = deal.get("id")
        if deal_id is not None and deal_id in existing_ids:
            continue
        deals.append(deal)
        if deal_id is not None:
            existing_ids.add(deal_id)
    return deals


def tokens(text):
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _scraped_brand_tokens(deal):
    tags = deal.get("tags") if isinstance(deal.get("tags"), list) else []
    first_tag = tags[0] if tags else ""
    return tokens(f"{deal.get('brand') or ''} {first_tag}") - GENERIC


def _matches_scraped_brand(query, deal):
    brand_tokens = _scraped_brand_tokens(deal)
    return bool(brand_tokens) and brand_tokens <= query


def matches(item, deal):
    query = tokens(item)
    if deal.get("source") == "studentbeans":
        return bool(query & _scraped_brand_tokens(deal))
    category_words = tokens(deal["category"]) - {"tech"}
    words = tokens(" ".join([deal["brand"], *deal["tags"]])) | category_words
    return bool(query & words)


def deals_for_transactions(transactions, catalogue):
    candidates = []
    scraped_by_brand = {}
    for transaction in transactions:
        if transaction["category"] == "Income":
            continue
        query = tokens(transaction["merchant"] + " " + transaction["description"])
        for deal in catalogue:
            if deal.get("source") == "studentbeans":
                if not _matches_scraped_brand(query, deal):
                    continue
                brand = str(deal.get("brand") or "").casefold()
                if not brand:
                    continue
                bucket = scraped_by_brand.setdefault(brand, [])
                deal_id = deal.get("id")
                if not any(existing.get("id") == deal_id for existing in bucket):
                    bucket.append(deal)
                continue
            if deal not in candidates and (
                deal["category"] == transaction["category"]
                or query & tokens(deal["brand"] + " " + " ".join(deal["tags"]))
            ):
                candidates.append(deal)
    for deals in scraped_by_brand.values():
        def discount_key(deal):
            try:
                discount = float(deal.get("discount_pct"))
            except (TypeError, ValueError):
                discount = None
            return (discount is None, -(discount or 0))

        candidates.extend(sorted(deals, key=discount_key)[:3])
    return candidates
