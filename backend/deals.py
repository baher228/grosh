import json
import re
from pathlib import Path

DATA = Path(__file__).parent / "data"


def load_deals(filename="deals.json"):
    return json.loads((DATA / filename).read_text())


def tokens(text):
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def matches(item, deal):
    query = tokens(item)
    category_words = tokens(deal["category"]) - {"tech"}
    words = tokens(" ".join([deal["brand"], *deal["tags"]])) | category_words
    return bool(query & words)


def deals_for_transactions(transactions, catalogue):
    candidates = []
    for transaction in transactions:
        if transaction["category"] == "Income":
            continue
        query = tokens(transaction["merchant"] + " " + transaction["description"])
        for deal in catalogue:
            if deal not in candidates and (
                deal["category"] == transaction["category"]
                or query & tokens(deal["brand"] + " " + " ".join(deal["tags"]))
            ):
                candidates.append(deal)
    return candidates
