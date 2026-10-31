from datetime import datetime, timezone
from uuid import uuid4

from deals import load_deals, matches

wishlist = []
notifications = []
notified = set()


def now():
    return datetime.now(timezone.utc).isoformat()


def find_matches(item, catalogue=None):
    catalogue = catalogue or load_deals()
    return [deal for deal in catalogue if matches(item, deal)]


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


def remove_item(item_id):
    for index, item in enumerate(wishlist):
        if item["id"] == item_id:
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
                "reason": f"{deal['brand']} matches your wishlist item “{item['item']}”.",
                "created_at": now(),
                "read": False,
            }
            notifications.append(notification)
            added.append(notification)
    return added
