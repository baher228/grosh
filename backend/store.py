import re
from datetime import datetime, timezone
from uuid import uuid4

from deals import load_deals, matches

wishlist = []
notifications = []
notified = set()
demo_wishlist_ids = set()


def now():
    return datetime.now(timezone.utc).isoformat()


def find_matches(item, catalogue=None):
    catalogue = catalogue or load_deals()
    result = []
    seen = set()
    for deal in catalogue:
        if not matches(item, deal):
            continue
        key = (deal["brand"].strip().casefold(), deal["offer"].strip().casefold())
        if key in seen:
            continue
        seen.add(key)
        result.append(deal)
        if len(result) == 2:
            break
    return result


def _notification_reason(item, deal):
    reason = f"New {deal['provider']} offer on {item['item']}"
    if item.get("max_price") is not None:
        target = f"{item['max_price']:,.2f}".rstrip("0").rstrip(".")
        reason += f", your target is £{target}"
    return reason + "."


def add_item(item, max_price=None):
    entry = {
        "id": str(uuid4()),
        "item": item,
        "max_price": max_price,
        "created_at": now(),
        "matches": find_matches(item),
    }
    wishlist.append(entry)
    return entry


def seed_demo():
    wishlist.clear()
    notifications.clear()
    notified.clear()
    demo_wishlist_ids.clear()
    items = [
        add_item("AirPods Pro 2", 200),
        add_item("Nike Tech Fleece", 110),
        add_item("MacBook Air M4", 1000),
    ]
    demo_wishlist_ids.update(item["id"] for item in items)
    return items


def remove_item(item_id):
    for index, item in enumerate(wishlist):
        if item["id"] == item_id:
            demo_wishlist_ids.discard(item_id)
            return wishlist.pop(index)
    return None


def scan():
    fresh = load_deals("new_deals.json")
    added = []
    for item in wishlist:
        for deal in find_matches(item["item"], fresh):
            pair = (item["id"], deal["id"])
            if pair in notified:
                continue
            notified.add(pair)
            notification = {
                "id": str(uuid4()),
                "wishlist_id": item["id"],
                "item": item["item"],
                "deal": deal,
                "reason": _notification_reason(item, deal),
                "created_at": now(),
                "read": False,
            }
            notifications.append(notification)
            added.append(notification)
    return added


def add_web_notifications(rows, skip_wishlist_ids=None):
    skip_wishlist_ids = set(skip_wishlist_ids or ())
    added = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        item_name = str(row.get("item") or "").strip()
        brand = str(row.get("brand") or "").strip()
        provider = str(row.get("provider") or "").strip()
        offer = str(row.get("offer") or "").strip()
        url = str(row.get("url") or "").strip()
        item = next(
            (entry for entry in wishlist if entry["item"].casefold() == item_name.casefold()),
            None,
        )
        if not item or not all((brand, provider, offer)) or not url.lower().startswith("http"):
            continue
        if item["id"] in demo_wishlist_ids or item["id"] in skip_wishlist_ids:
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", brand.casefold()).strip("-") or "offer"
        deal_id = f"web-{slug}"
        pair = (item["id"], deal_id)
        if pair in notified:
            continue
        notified.add(pair)
        try:
            discount_pct = round(float(row.get("discount_pct")))
            if discount_pct <= 0:
                discount_pct = None
        except (ValueError, TypeError):
            discount_pct = None
        deal = {
            "id": deal_id,
            "provider": provider,
            "brand": brand,
            "category": str(row.get("category") or "Other"),
            "offer": offer,
            "discount_pct": discount_pct,
            "url": url,
            "tags": ["web"],
        }
        notification = {
            "id": str(uuid4()),
            "wishlist_id": item["id"],
            "item": item["item"],
            "deal": deal,
            "reason": _notification_reason(item, deal),
            "created_at": now(),
            "read": False,
        }
        notifications.append(notification)
        added.append(notification)
    return added
