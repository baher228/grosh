import asyncio
import json
import logging
import mimetypes
import queue
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

import gemini
import receipt
from agent import analyze
from store import (
    add_item,
    add_web_notifications,
    notifications,
    remove_item,
    scan,
    seed_demo,
    wishlist,
)

DATA = Path(__file__).parent / "data"
CACHE = DATA / "sample_cache.json"
RECEIPT_CACHE = DATA / "receipt_sample_cache.json"
RECEIPT_IMAGE = (
    Path(__file__).resolve().parent.parent
    / "frontend"
    / "public"
    / "sample-receipt.png"
)
ALLOWED = {".pdf", ".csv", ".png", ".jpg", ".jpeg", ".webp"}
_CACHE_LOCK = threading.Lock()
_RECEIPT_CACHE_LOCK = threading.Lock()
_WEB_SEARCH_LOCK = threading.Lock()
_WEB_SEARCH_RUNNING = False
_STREAM_END = object()
logger = logging.getLogger(__name__)

app = FastAPI(title="StudentSave API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class WishlistRequest(BaseModel):
    item: str = Field(min_length=1)
    max_price: float | None = None


def _sample_analysis():
    if CACHE.is_file():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    path = DATA / "sample_statement.csv"
    return analyze(path.read_bytes(), path.name, "text/csv", use_gemini=False)


def _warm_sample_cache():
    with _CACHE_LOCK:
        if CACHE.exists():
            return
        path = DATA / "sample_statement.csv"
        result = analyze(path.read_bytes(), path.name, "text/csv", use_gemini=True)
        if result.get("source") != "gemini":
            return
        temporary = CACHE.with_name(f".{CACHE.name}.tmp")
        temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        temporary.replace(CACHE)


def _warm_receipt_cache():
    with _RECEIPT_CACHE_LOCK:
        if RECEIPT_CACHE.exists() or not RECEIPT_IMAGE.is_file():
            return
        result = receipt.analyze_receipt(RECEIPT_IMAGE.read_bytes(), "image/png")
        if result.get("source") != "gemini":
            return
        temporary = RECEIPT_CACHE.with_name(f".{RECEIPT_CACHE.name}.tmp")
        temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        temporary.replace(RECEIPT_CACHE)


def _stream_response(events):
    def lines():
        while True:
            event = events.get()
            if event is _STREAM_END:
                break
            yield json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"

    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _analysis_stream(data, filename, mime_type, university, notes):
    events = queue.Queue()

    def run():
        try:
            result = analyze(
                data, filename, mime_type, university, notes, emit=events.put
            )
            events.put({"type": "result", "data": result})
        except Exception as error:
            events.put({"type": "error", "message": str(error)[:200]})
        finally:
            events.put(_STREAM_END)

    threading.Thread(target=run, daemon=True).start()
    return _stream_response(events)


@app.on_event("startup")
def start_sample_cache_warmup():
    if gemini.available():
        if not CACHE.exists():
            threading.Thread(target=_warm_sample_cache, daemon=True).start()
        if RECEIPT_IMAGE.is_file() and not RECEIPT_CACHE.exists():
            threading.Thread(target=_warm_receipt_cache, daemon=True).start()


def _web_search_status():
    with _WEB_SEARCH_LOCK:
        return "running" if _WEB_SEARCH_RUNNING else "idle"


def _start_wishlist_web_search():
    global _WEB_SEARCH_RUNNING
    if not gemini.available() or not wishlist:
        return False
    items = [
        {"item": item["item"], "max_price": item["max_price"]}
        for item in wishlist
    ]
    with _WEB_SEARCH_LOCK:
        if _WEB_SEARCH_RUNNING:
            return False
        _WEB_SEARCH_RUNNING = True

    def research():
        global _WEB_SEARCH_RUNNING
        try:
            deals = gemini.research_wishlist(items)
            added = add_web_notifications(deals)
            logger.info("Wishlist background search added %d notifications", len(added))
        except Exception as error:
            logger.info(
                "Wishlist background search skipped after %s",
                type(error).__name__,
            )
        finally:
            with _WEB_SEARCH_LOCK:
                _WEB_SEARCH_RUNNING = False

    try:
        threading.Thread(target=research, daemon=True).start()
    except Exception as error:
        with _WEB_SEARCH_LOCK:
            _WEB_SEARCH_RUNNING = False
        logger.info(
            "Wishlist background search could not start after %s",
            type(error).__name__,
        )
        return False
    return True


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "gemini": gemini.available(),
        "model": gemini.MODEL,
        "web_search": _web_search_status(),
    }


@app.get("/api/sample")
def sample():
    return _sample_analysis()


@app.get("/api/sample/stream")
async def sample_stream():
    result = _sample_analysis()

    async def lines():
        for step in result.get("trace", []):
            yield json.dumps(
                {
                    "type": "start",
                    "step": step["step"],
                    "label": {
                        "extract": "Reading your statement",
                        "categorise": "Sorting spending into categories",
                        "match": "Matching student deals",
                        "research": "Searching the web for live student offers",
                        "verify": "Checking every claim against your transactions",
                        "plan": "Writing your plan",
                    }.get(step["step"], step.get("label", "")),
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ) + "\n"
            await asyncio.sleep(0.45)
            yield json.dumps(
                {"type": "step", **step},
                ensure_ascii=False,
                separators=(",", ":"),
            ) + "\n"
        yield json.dumps(
            {"type": "result", "data": result},
            ensure_ascii=False,
            separators=(",", ":"),
        ) + "\n"

    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/analyze")
async def analyze_upload(
    file: UploadFile = File(...),
    university: str | None = Form(None),
    notes: str | None = Form(None),
):
    filename = Path(file.filename or "").name
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    data = await file.read()
    try:
        return analyze(data, filename, file.content_type or "application/octet-stream", university, notes)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/analyze/stream")
async def analyze_upload_stream(
    file: UploadFile = File(...),
    university: str | None = Form(None),
    notes: str | None = Form(None),
):
    filename = Path(file.filename or "").name
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    data = await file.read()
    return _analysis_stream(
        data, filename, file.content_type or "application/octet-stream",
        university, notes,
    )


@app.get("/api/wishlist")
def get_wishlist():
    return wishlist


@app.post("/api/wishlist")
def create_wishlist_item(body: WishlistRequest):
    return add_item(body.item.strip(), body.max_price)


@app.post("/api/wishlist/demo")
def wishlist_demo():
    return seed_demo()


@app.delete("/api/wishlist/{item_id}")
def delete_wishlist_item(item_id: str):
    deleted = remove_item(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Wishlist item not found")
    return deleted


@app.post("/api/wishlist/scan")
def scan_wishlist():
    added = scan()
    if gemini.available() and wishlist:
        if not _start_wishlist_web_search():
            logger.info("Skipping wishlist search because one is already running")
    return added


@app.get("/api/notifications")
def get_notifications():
    return notifications


@app.post("/api/receipt")
async def receipt_upload(file: UploadFile = File(...)):
    if not gemini.available():
        raise HTTPException(status_code=503, detail="Receipt reading needs Gemini")
    filename = Path(file.filename or "").name
    mime_type = (file.content_type or mimetypes.guess_type(filename)[0] or "").lower()
    if Path(filename).suffix.lower() == ".pdf":
        mime_type = "application/pdf"
    if not (mime_type == "application/pdf" or mime_type.startswith("image/")):
        raise HTTPException(status_code=400, detail="Unsupported receipt file type")
    data = await file.read()
    try:
        return await asyncio.to_thread(receipt.analyze_receipt, data, mime_type)
    except Exception as error:
        logger.info("Receipt analysis failed with %s", type(error).__name__)
        raise HTTPException(status_code=502, detail="Receipt analysis failed") from error


@app.get("/api/receipt/sample")
def receipt_sample():
    if RECEIPT_CACHE.is_file():
        try:
            return json.loads(RECEIPT_CACHE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    if not gemini.available():
        raise HTTPException(status_code=503, detail="Receipt reading needs Gemini")
    raise HTTPException(status_code=503, detail="Sample receipt analysis is warming")
