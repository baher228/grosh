import copy
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

RULES_PATH = Path(__file__).parent / "data" / "feedback.json"
_LOCK = threading.Lock()
_RULES = None
_KINDS = {"keep", "have", "not_relevant"}


def _load_rules():
    global _RULES
    if _RULES is None:
        try:
            data = json.loads(RULES_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = []
        _RULES = [rule for rule in data if isinstance(rule, dict)] if isinstance(data, list) else []
    return _RULES


def _save_rules():
    RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = RULES_PATH.with_name(f".{RULES_PATH.name}.tmp")
    temporary.write_text(
        json.dumps(_RULES, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(RULES_PATH)


def list_rules():
    with _LOCK:
        return copy.deepcopy(_load_rules())


def add_rule(kind, saving, merchants, note=None):
    if kind not in _KINDS:
        raise ValueError("kind must be keep, have, or not_relevant")
    if not isinstance(saving, dict):
        raise ValueError("saving must be an object")
    deal = saving.get("deal") if isinstance(saving.get("deal"), dict) else {}
    unique_merchants = []
    seen_merchants = set()
    for merchant in merchants if isinstance(merchants, list) else []:
        name = str(merchant or "").strip()
        folded = name.casefold()
        if name and folded not in seen_merchants:
            unique_merchants.append(name)
            seen_merchants.add(folded)
    cleaned_note = str(note or "").strip() or None
    rule = {
        "id": str(uuid4()),
        "kind": kind,
        "note": cleaned_note,
        "title": str(saving.get("title") or "Student saving").strip(),
        "category": str(saving.get("category") or "").strip(),
        "deal": {
            "id": str(deal.get("id") or "").strip(),
            "brand": str(deal.get("brand") or "").strip(),
            "provider": str(deal.get("provider") or "").strip(),
        },
        "merchants": unique_merchants,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with _LOCK:
        _load_rules().append(rule)
        _save_rules()
        return copy.deepcopy(rule)


def delete_rule(rule_id):
    with _LOCK:
        rules = _load_rules()
        for index, rule in enumerate(rules):
            if rule.get("id") == rule_id:
                removed = rules.pop(index)
                _save_rules()
                return copy.deepcopy(removed)
    return None


def _saving_merchants(saving, transactions):
    evidence = saving.get("evidence")
    evidence_lines = [
        str(line).casefold()
        for line in evidence
        if isinstance(line, str) and line
    ] if isinstance(evidence, list) else []
    merchants = []
    seen = set()
    for transaction in transactions if isinstance(transactions, list) else []:
        if not isinstance(transaction, dict):
            continue
        merchant = str(transaction.get("merchant") or "").strip()
        folded = merchant.casefold()
        if merchant and folded not in seen and any(folded in line for line in evidence_lines):
            merchants.append(merchant)
            seen.add(folded)
    return merchants


def _matches_rule(saving, merchants, rule):
    deal = saving.get("deal") if isinstance(saving.get("deal"), dict) else {}
    saved_id = str(deal.get("id") or "").casefold()
    rule_deal = rule.get("deal") if isinstance(rule.get("deal"), dict) else {}
    rule_id = str(rule_deal.get("id") or "").casefold()
    if saved_id and rule_id and saved_id == rule_id:
        return True
    kind = rule.get("kind")
    brand = str(deal.get("brand") or "").casefold()
    rule_brand = str(rule_deal.get("brand") or "").casefold()
    if kind == "have" and brand and rule_brand and brand == rule_brand:
        return True
    if kind in {"keep", "not_relevant"}:
        category = str(saving.get("category") or "").casefold()
        rule_category = str(rule.get("category") or "").casefold()
        rule_merchants = {
            str(merchant).casefold()
            for merchant in rule.get("merchants", [])
            if str(merchant).strip()
        }
        return (
            category == rule_category
            and bool({merchant.casefold() for merchant in merchants} & rule_merchants)
        )
    return False


def apply(analysis):
    if not isinstance(analysis, dict):
        raise ValueError("analysis must be an object")
    result = copy.deepcopy(analysis)
    rules = list_rules()
    result.pop("remembered", None)
    trace = result.get("trace")
    result["trace"] = [
        step for step in trace
        if not isinstance(step, dict) or step.get("step") != "memory"
    ] if isinstance(trace, list) else []
    savings = result.get("savings")
    savings = savings if isinstance(savings, list) else []
    transactions = result.get("transactions", [])
    kept = []
    dropped = []
    remembered = []
    remembered_ids = set()
    terms = []
    for saving in savings:
        if not isinstance(saving, dict):
            kept.append(saving)
            continue
        merchants = _saving_merchants(saving, transactions)
        matched_rules = [
            rule for rule in rules if _matches_rule(saving, merchants, rule)
        ]
        if not matched_rules:
            kept.append(saving)
            continue
        dropped.append(saving)
        for rule in matched_rules:
            rule_id = str(rule.get("id") or "")
            if rule_id and rule_id not in remembered_ids:
                remembered.append({
                    "rule_id": rule_id,
                    "kind": rule.get("kind"),
                    "title": rule.get("title", ""),
                })
                remembered_ids.add(rule_id)
        deal = saving.get("deal") if isinstance(saving.get("deal"), dict) else {}
        brand = str(deal.get("brand") or "").strip().casefold()
        provider = str(deal.get("provider") or "").strip()
        if brand:
            terms.append(brand)
        if provider and provider.casefold() != "direct":
            terms.append(provider.casefold())

    result["savings"] = kept
    plan = result.get("plan")
    if not isinstance(plan, dict):
        plan = {}
        result["plan"] = plan
    verified = []
    unconfirmed = []
    for saving in kept:
        if not isinstance(saving, dict):
            continue
        confidence = saving.get("confidence")
        if confidence is None:
            deal = saving.get("deal") if isinstance(saving.get("deal"), dict) else {}
            tags = deal.get("tags") if isinstance(deal.get("tags"), list) else []
            confidence = "unconfirmed" if "web" in tags else "verified"
        amount = float(saving.get("est_monthly_saving") or 0)
        if confidence == "unconfirmed":
            unconfirmed.append(amount)
        else:
            verified.append(amount)
    monthly = round(sum(verified), 2)
    plan["monthly_total"] = monthly
    plan["yearly_total"] = round(monthly * 12, 2)
    plan["unconfirmed_monthly"] = round(sum(unconfirmed), 2)
    if dropped:
        steps = plan.get("steps")
        if isinstance(steps, list):
            plan["steps"] = [
                step for step in steps
                if not any(
                    term in str(step).casefold()
                    for term in terms
                )
            ]
        plan["headline"] = f"You could save about £{monthly:.2f} a month with student deals."
    result["remembered"] = remembered
    if rules:
        count = len(dropped)
        noun = "suggestion" if count == 1 else "suggestions"
        result["trace"].append({
            "step": "memory",
            "label": "Applied your feedback",
            "status": "ok",
            "detail": f"Skipped {count} {noun} you told grosh about",
            "ms": 0,
        })
    return result


def prompt_block():
    rules = list_rules()
    if not rules:
        return ""
    lines = ["The user has told grosh about these — never suggest them again:"]
    for rule in rules:
        title = str(rule.get("title") or "Student saving").strip()
        merchants = ", ".join(
            str(merchant).strip()
            for merchant in rule.get("merchants", [])
            if str(merchant).strip()
        ) or "no listed merchants"
        note = str(rule.get("note") or "").strip()
        if rule.get("kind") == "keep":
            line = f"- Keeping {title} ({merchants})"
        elif rule.get("kind") == "have":
            deal = rule.get("deal") if isinstance(rule.get("deal"), dict) else {}
            brand = str(deal.get("brand") or title).strip()
            line = f"- Already has {brand} ({title}; {merchants})"
        else:
            line = f"- Not relevant: {title} ({merchants})"
        if note:
            line += f" — note: {note}"
        lines.append(line)
    return "\n".join(lines)
