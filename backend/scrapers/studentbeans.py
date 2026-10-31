"""Read public Student Beans UK brand pages (allowed by robots.txt) into deal rows.

Usage: python -m scrapers.studentbeans slug1 slug2 ... [--out data/scraped_deals.json]
"""
import json, re, sys, time, urllib.request
from datetime import date

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
BASE = "https://www.studentbeans.com/student-discount/uk/"
CATEGORY_WORDS = [
    (("takeaway", "fast food", "delivery"), "Takeaway/Delivery"),
    (("coffee",), "Coffee"),
    (("food", "drink", "restaurants?", "eating"), "Eating out"),
    (("grocer(y|ies)", "supermarkets?"), "Groceries"),
    (("tech", "computers?", "laptops?", "tablets?", "electronics?", "gaming", "audio"), "Tech"),
    (("phones?", "sim", "broadband", "internet", "utilities", "energy"), "Bills/Phone"),
    (("travel", "trains?", "rail", "coach(es)?", "bus", "car hire", "flights?", "hotels?", "hostels?"), "Transport"),
    (("music", "streaming", "subscriptions?", "software", "magazines?", "news"), "Subscriptions"),
    (("cinema", "entertainment", "experiences?", "tickets?", "events?", "fitness", "gyms?", "days out"), "Entertainment"),
]


def _category(name):
    low = name.casefold()
    for words, mapped in CATEGORY_WORDS:
        if any(re.search(rf"\b{w}\b", low) for w in words):
            return mapped
    return "Shopping/Clothes"


def _offers(page, slug):
    text = page.replace('\\"', '"').replace("\\u0026", "&")
    i = text.find('"offers":[{"node":')
    rows, seen = [], set()
    for m in re.finditer(r'\{"node":\{"id":"([^"]+)","title":"([^"]+)".*?"brand":\{"brandId":"[^"]+","name":"([^"]+)"[^}]*"slug":"([^"]+)".*?"primaryCategory":\{"name":"([^"]+)","slug":"([^"]+)".*?"expired":(true|false).*?"redemptionClass":"([^"]+)"', text[i:] if i >= 0 else text):
        oid, title, brand, bslug, cat, cslug, expired, where = m.groups()
        if bslug != slug or expired == "true" or oid in seen:
            continue
        seen.add(oid)
        pct = re.search(r"(\d{1,2})%", title)
        rows.append({
            "id": f"sb-{slug}-{oid[:8]}", "provider": "Student Beans", "brand": brand,
            "category": _category(cat), "sb_category": cat, "offer": title,
            "discount_pct": int(pct.group(1)) if pct else None, "url": BASE + slug,
            "tags": [slug.replace("-", " "), brand.casefold(), where.casefold()],
            "source": "studentbeans", "fetched_at": date.today().isoformat(),
        })
    return rows


def scrape(slugs, delay=1.5):
    out = []
    for slug in slugs:
        req = urllib.request.Request(BASE + slug, headers={"User-Agent": UA})
        try:
            page = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace")
            rows = _offers(page, slug)
            print(f"{slug}: {len(rows)} offers", file=sys.stderr)
            out += rows
        except Exception as exc:
            print(f"{slug}: failed {exc}", file=sys.stderr)
        time.sleep(delay)
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    dest = args[args.index("--out") + 1] if "--out" in args else None
    slugs = [a for a in args if not a.startswith("--") and a != dest]
    rows = scrape(slugs)
    if dest:
        json.dump(rows, open(dest, "w"), indent=1, ensure_ascii=False)
    print(json.dumps(rows[:5], indent=1, ensure_ascii=False))
