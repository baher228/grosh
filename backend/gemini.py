import json
import logging
import os
import re
from urllib.parse import urlparse

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)
API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=API_KEY) if API_KEY else None
_EXCLUDED = ("tts", "image", "vision", "embedding", "live", "audio", "native")


def _version(name):
    return tuple(int(part) for part in re.findall(r"\d+", name))


def _supported(model):
    actions = []
    for attribute in ("supported_actions", "supported_generation_methods"):
        values = getattr(model, attribute, None) or []
        actions.extend([values] if isinstance(values, str) else values)
    return any(
        re.sub(r"[^a-z]", "", str(action).lower()).find("generatecontent") >= 0
        for action in actions
    )


def _model_name(model):
    return getattr(model, "name", "").removeprefix("models/")


def _eligible_models():
    if not client:
        return []
    try:
        return [
            _model_name(model)
            for model in client.models.list()
            if _supported(model)
            and _model_name(model)
            and not any(word in _model_name(model).lower() for word in _EXCLUDED)
        ]
    except Exception as error:
        logger.warning("Gemini model discovery failed: %s", str(error)[:160])
        return []


AVAILABLE_MODELS = _eligible_models()


def _newest_matching(pattern):
    choices = [name for name in AVAILABLE_MODELS if re.search(pattern, name, re.I)]
    return max(choices, key=_version) if choices else None


def choose_model():
    configured = os.getenv("GEMINI_MODEL")
    if configured:
        return configured.removeprefix("models/")
    argon = next((name for name in AVAILABLE_MODELS if "argon" in name.lower()), None)
    return argon or _newest_matching(r"gemini-.*-pro") or _newest_matching(r"gemini-.*-flash") or "gemini-2.5-flash"


MODEL = choose_model()
FAST_MODEL = (
    os.getenv("GEMINI_FAST_MODEL", "").removeprefix("models/")
    or _newest_matching(r"gemini-.*-flash")
    or "gemini-2.5-flash"
)
logger.info("Using Gemini model %s (fast model %s)", MODEL, FAST_MODEL)


def available():
    return client is not None


def _thinking_config(model, budget=False):
    if budget:
        thinking = 0 if "flash" in model.lower() else 512
        return types.ThinkingConfig(thinking_budget=thinking)
    return types.ThinkingConfig(thinking_level="low")


def _thinking_rejected(error):
    message = str(error).lower()
    return "thinking" in message and any(
        phrase in message
        for phrase in ("unsupported", "not supported", "invalid", "unknown", "not allowed")
    )


def _generate_content(model, contents, response_mime_type=None, tools=None):
    if not client:
        raise RuntimeError("Gemini API key is not configured")
    config = {}
    if response_mime_type:
        config["response_mime_type"] = response_mime_type
    if tools:
        config["tools"] = tools
    try:
        config["thinking_config"] = _thinking_config(model)
    except (AttributeError, TypeError, ValueError):
        config["thinking_config"] = _thinking_config(model, budget=True)
    try:
        return client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(**config),
        )
    except Exception as error:
        if not _thinking_rejected(error):
            raise
        logger.warning("Gemini model %s rejected low thinking; retrying with budget", model)
        config["thinking_config"] = _thinking_config(model, budget=True)
        return client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(**config),
        )


def ask_json(prompt, parts=None, model=None):
    contents = ([*parts, prompt] if parts else prompt)
    response = _generate_content(
        model=model or MODEL,
        contents=contents,
        response_mime_type="application/json",
    )
    return json.loads(response.text or "{}")


def extract_statement(file_bytes, mime_type, categories):
    part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
    return ask_json(
        'Extract bank transactions from this statement. Return JSON only: '
        '{"transactions":[{"date":"YYYY-MM-DD","merchant":"short merchant",'
        '"description":"original description","amount":12.34,"category":"Other"}]}. '
        "Assign each transaction exactly one category from: "
        + ", ".join(categories)
        + ". Amounts must be positive numeric values. Preserve dates and do not invent transactions.",
        [part],
    )


def categorise_transactions(transactions, categories):
    return ask_json(
        "Assign each numbered transaction exactly one category from this list: "
        + ", ".join(categories)
        + '. Return JSON only as {"categories":["..."]}, one category per input transaction, '
        "in input order. Do not change or omit entries. Transactions: "
        + json.dumps(transactions, ensure_ascii=False),
        model=FAST_MODEL,
    )


def choose_savings(transactions, categories, deals):
    numbered = [
        {"i": index, "date": row["date"], "merchant": row["merchant"],
         "amount": row["amount"], "category": row["category"]}
        for index, row in enumerate(transactions)
    ]
    return ask_json(
        "Choose up to 8 realistic student savings from the supplied transactions and deals. "
        "Only use supplied deal ids. Do not claim a saving unsupported by the transactions. "
        "Return JSON only as {\"savings\":[{\"deal_id\":\"...\",\"title\":\"...\","
        "\"category\":\"...\",\"current_spend\":0,\"est_monthly_saving\":0,"
        "\"evidence_ids\":[0],\"why\":\"one sentence\"}]}. "
        "evidence_ids must be transaction indices copied from the numbered input. "
        "Amounts are GBP per month. Transactions: "
        + json.dumps(numbered, ensure_ascii=False)
        + " Category totals: "
        + json.dumps(categories)
        + " Deals: "
        + json.dumps(deals, ensure_ascii=False)
    )


def research_discounts(merchants):
    if not client:
        raise RuntimeError("Gemini API key is not configured")
    prompt = (
        "Use Google Search to find currently live UK student discounts for these merchants. "
        "Only return offers supported by a current provider page; do not invent discounts. "
        "Return a JSON block in your answer: {\"deals\":[{\"merchant\":\"exact input merchant\","
        "\"brand\":\"brand\",\"provider\":\"UNiDAYS, Student Beans, TOTUM, Direct, or other\","
        "\"offer\":\"offer wording\",\"url\":\"provider page URL\",\"est_discount_pct\":10,"
        "\"evidence_ids\":[0]}]}. Include one result per merchant only when a student offer "
        "is verified. evidence_ids must be copied from the supplied transactions. "
        "Transactions: "
        + json.dumps(merchants, ensure_ascii=False)
    )
    response = _generate_content(
        model=MODEL,
        contents=prompt,
        tools=[types.Tool(google_search=types.GoogleSearch())],
    )
    text = response.text or ""
    text = re.sub(r"```(?:json)?", "", text, flags=re.I).replace("```", "")
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("Search response did not contain a JSON object")
    result = json.loads(text[start:end + 1])
    candidates = getattr(response, "candidates", None) or []
    metadata = getattr(candidates[0], "grounding_metadata", None) if candidates else None
    domains = []
    for chunk in getattr(metadata, "grounding_chunks", []) or []:
        web = getattr(chunk, "web", None)
        uri = getattr(web, "uri", None)
        if uri:
            domain = urlparse(uri).netloc.lower()
            if domain and domain not in domains:
                domains.append(domain)
    return result, domains


def critique_savings(transactions, savings):
    return ask_json(
        "Critique these proposed savings against the transactions. Return JSON only as "
        '{"flags":["short explanation for each overclaim"]}. Return an empty flags list '
        "if all claims are supported. Transactions: "
        + json.dumps(transactions, ensure_ascii=False)
        + " Proposed savings: "
        + json.dumps(savings, ensure_ascii=False),
        model=FAST_MODEL,
    )


def build_plan(savings, categories, university):
    return ask_json(
        "Write a personalised student savings plan using only these verified savings and "
        "category totals. Return JSON only as {\"headline\":\"one sentence\","
        "\"steps\":[\"3 to 5 concrete personal steps\"]}. Steps should name actual merchants "
        "and amounts wherever available. Mention the university if supplied; do not invent "
        "deals. Verified savings: "
        + json.dumps(savings, ensure_ascii=False)
        + " Category totals: "
        + json.dumps(categories, ensure_ascii=False)
        + " University: "
        + json.dumps(university),
    )
