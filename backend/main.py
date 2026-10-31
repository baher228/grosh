import asyncio
import json
import queue
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

import gemini
from agent import analyze
from store import add_item, notifications, remove_item, scan, wishlist

DATA = Path(__file__).parent / "data"
CACHE = DATA / "sample_cache.json"
ALLOWED = {".pdf", ".csv", ".png", ".jpg", ".jpeg", ".webp"}
_CACHE_LOCK = threading.Lock()
_STREAM_END = object()

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
    if gemini.available() and not CACHE.exists():
        threading.Thread(target=_warm_sample_cache, daemon=True).start()


@app.get("/api/health")
def health():
    return {"ok": True, "gemini": gemini.available(), "model": gemini.MODEL}


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


@app.delete("/api/wishlist/{item_id}")
def delete_wishlist_item(item_id: str):
    deleted = remove_item(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Wishlist item not found")
    return deleted


@app.post("/api/wishlist/scan")
def scan_wishlist():
    return scan()


@app.get("/api/notifications")
def get_notifications():
    return notifications
