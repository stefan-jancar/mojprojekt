import base64
import hashlib
import hmac
import logging
import mimetypes
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import anthropic
from fastapi import Body, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from . import assistant, horoscope
from .data import SECTION_TYPES, Repo
from .storage import StorageError, make_store

MAX_UPLOAD = 4 * 1024 * 1024  # Vercel povoľuje telo požiadavky max ~4,5 MB
TOKEN_DAYS = 180

log = logging.getLogger("moj-priestor")
app = FastAPI(title="Môj priestor")
repo = Repo(make_store())

ON_VERCEL = bool(os.environ.get("VERCEL"))


def _secret() -> bytes:
    s = os.environ.get("APP_SECRET") or ("pw:" + os.environ.get("APP_PASSWORD", ""))
    return hashlib.sha256(s.encode()).digest()


def _make_token() -> str:
    exp = str(int(time.time()) + TOKEN_DAYS * 86400)
    sig = hmac.new(_secret(), exp.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{exp}.{sig}".encode()).decode()


def _valid_token(token: str) -> bool:
    try:
        exp, sig = base64.urlsafe_b64decode(token.encode()).decode().split(".")
    except Exception:
        return False
    good = hmac.new(_secret(), exp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, good) and int(exp) > time.time()


def auth(request: Request):
    if not os.environ.get("APP_PASSWORD"):
        if ON_VERCEL:
            raise HTTPException(503, "Na Verceli nastav premennú APP_PASSWORD.")
        return  # lokálny vývoj bez hesla
    header = request.headers.get("authorization", "")
    if not (header.startswith("Bearer ") and _valid_token(header[7:])):
        raise HTTPException(401, "Neprihlásený")


@app.exception_handler(KeyError)
async def _not_found(_, exc):
    return JSONResponse({"detail": str(exc.args[0] if exc.args else exc)}, 404)


@app.exception_handler(ValueError)
async def _bad(_, exc):
    return JSONResponse({"detail": str(exc)}, 400)


@app.exception_handler(StorageError)
async def _storage(_, exc):
    return JSONResponse({"detail": f"Chyba úložiska: {exc}"}, 502)


@app.exception_handler(Exception)
async def _unexpected(_, exc):
    log.exception("Neočakávaná chyba")
    return JSONResponse({"detail": f"Neočakávaná chyba servera: {type(exc).__name__}: {exc}"}, 500)


# ---------- verejné ----------

@app.get("/api/status")
def status():
    return {
        "storage": repo.store.kind,
        "assistant": assistant.enabled(),
        "auth_required": bool(os.environ.get("APP_PASSWORD")) or ON_VERCEL,
        "section_types": SECTION_TYPES,
    }


@app.post("/api/login")
def login(body: dict = Body(...)):
    pw = os.environ.get("APP_PASSWORD")
    if not pw:
        if ON_VERCEL:
            raise HTTPException(503, "Na Verceli nastav premennú APP_PASSWORD.")
        return {"token": _make_token()}
    if not hmac.compare_digest(str(body.get("password", "")).encode(), pw.encode()):
        time.sleep(1)
        raise HTTPException(401, "Nesprávne heslo")
    return {"token": _make_token()}


# ---------- sekcie ----------

@app.get("/api/sections", dependencies=[Depends(auth)])
def get_sections():
    return repo.sections()


@app.put("/api/sections", dependencies=[Depends(auth)])
def put_sections(body: list = Body(...)):
    return repo.save_sections(body)


@app.get("/api/overview", dependencies=[Depends(auth)])
def overview():
    sections = repo.sections()
    with ThreadPoolExecutor(max_workers=8) as ex:
        all_items = list(ex.map(lambda s: repo.items(s["id"]), sections))
    return {s["id"]: items for s, items in zip(sections, all_items)}


# ---------- položky ----------

@app.get("/api/sections/{sid}/items", dependencies=[Depends(auth)])
def list_items(sid: str):
    return repo.items(sid)


@app.post("/api/sections/{sid}/items", dependencies=[Depends(auth)])
def add_item(sid: str, body: dict = Body(...)):
    return repo.add_item(sid, body)


@app.patch("/api/sections/{sid}/items/{iid}", dependencies=[Depends(auth)])
def update_item(sid: str, iid: str, body: dict = Body(...)):
    return repo.update_item(sid, iid, body)


@app.delete("/api/sections/{sid}/items/{iid}", dependencies=[Depends(auth)])
def delete_item(sid: str, iid: str):
    repo.delete_item(sid, iid)
    return {"ok": True}


@app.post("/api/sections/{sid}/items/{iid}/files", dependencies=[Depends(auth)])
async def upload_file(sid: str, iid: str, file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_UPLOAD:
        raise ValueError("Súbor je väčší ako 4 MB")
    return repo.add_file(sid, iid, file.filename or "subor", content, file.content_type or "")


@app.delete("/api/sections/{sid}/items/{iid}/files", dependencies=[Depends(auth)])
def remove_file(sid: str, iid: str, path: str):
    if not path.startswith(f"files/{sid}/{iid}/"):
        raise ValueError("Neplatná cesta")
    return repo.remove_file(sid, iid, path)


@app.get("/api/file", dependencies=[Depends(auth)])
def get_file(path: str):
    if not path.startswith("files/") or ".." in path:
        raise ValueError("Neplatná cesta")
    data = repo.store.read_bytes(path)
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return Response(data, media_type=ctype, headers={"Cache-Control": "private, max-age=3600"})


# ---------- nastavenia a horoskop ----------

@app.get("/api/settings", dependencies=[Depends(auth)])
def get_settings():
    return repo.settings()


@app.patch("/api/settings", dependencies=[Depends(auth)])
def patch_settings(body: dict = Body(...)):
    if "zodiac" in body and body["zodiac"] not in horoscope.SIGNS:
        raise ValueError("Neznáme znamenie")
    if "horo_source" in body and body["horo_source"] != "auto" and body["horo_source"] not in horoscope.SOURCES:
        raise ValueError("Neznámy zdroj horoskopu")
    if "horoscope" in body:
        body["horoscope"] = bool(body["horoscope"])
    return repo.save_settings(body)


@app.get("/api/horoscope", dependencies=[Depends(auth)])
def get_horoscope(sign: str = "", source: str = "", debug: bool = False):
    if not sign or not source:
        st = repo.settings()
        sign, source = sign or st["zodiac"], source or st["horo_source"]
    try:
        return horoscope.today(sign, source, debug=debug)
    except horoscope.HoroscopeError as e:
        raise HTTPException(502, str(e))


@app.get("/api/zodiac")
def zodiac_signs():
    return [{"id": k, "name": v[0], "symbol": v[1]} for k, v in horoscope.SIGNS.items()]


# ---------- asistent ----------

@app.post("/api/assistant", dependencies=[Depends(auth)])
def ask_assistant(body: dict = Body(...)):
    if not assistant.enabled():
        raise HTTPException(503, "Asistent nie je nastavený – pridaj ANTHROPIC_API_KEY.")
    try:
        return assistant.chat(repo, body.get("messages") or [])
    except anthropic.RateLimitError:
        raise HTTPException(429, "Asistent je preťažený, skús o chvíľu.")
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"Chyba asistenta: {e.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(502, "Asistent je nedostupný.")


# Lokálne (uvicorn) servíruje aj frontend. Na Verceli ho servíruje CDN z priečinka public/.
_public = Path(__file__).resolve().parent.parent / "public"
if not ON_VERCEL and _public.exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_public, html=True), name="public")
