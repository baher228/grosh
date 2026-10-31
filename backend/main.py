from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import gemini
from agent import analyze
from store import add_item, notifications, remove_item, scan, wishlist

DATA = Path(__file__).parent / "data"
ALLOWED = {".pdf", ".csv", ".png", ".jpg", ".jpeg", ".webp"}

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


@app.get("/api/health")
def health():
    return {"ok": True, "gemini": gemini.available(), "model": gemini.MODEL}


@app.get("/api/sample")
def sample():
    path = DATA / "sample_statement.csv"
    return analyze(path.read_bytes(), path.name, "text/csv")


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
