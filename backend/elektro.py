"""Elektro – príprava na skúšky: testy, kartičky s odpoveďami a štatistiky."""
import json
import re
import time
from functools import lru_cache
from pathlib import Path

from .storage import mutate

DATA = Path(__file__).resolve().parent / "elektro_data"
STATS_PATH = "elektro/stats.json"
MAX_ATTEMPTS = 60


@lru_cache(maxsize=None)
def _load(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def catalog():
    out = []
    for f in sorted(DATA.glob("test-*.json")):
        d = _load(f.name)
        qs = d["questions"]
        out.append({
            "kind": "quiz", "id": d["id"], "title": d["title"], "count": len(qs),
            "topics": list(dict.fromkeys(q["topic"] for q in qs)),
        })
    for f in sorted(DATA.glob("cards-*.json")):
        d = _load(f.name)
        out.append({"kind": "cards", "id": d["id"], "title": d["title"], "count": len(d["cards"])})
    return out


def _find(kind: str, sid: str):
    prefix = "test-" if kind == "quiz" else "cards-"
    for f in DATA.glob(prefix + "*.json"):
        d = _load(f.name)
        if d["id"] == sid:
            return d
    raise KeyError("Neznámy test")


def quiz(sid: str):
    return _find("quiz", sid)


def cards(sid: str):
    return _find("cards", sid)


def image(name: str) -> bytes:
    if not re.fullmatch(r"[\w-]+\.webp", name):
        raise ValueError("Neplatný názov")
    p = DATA / "img" / name
    if not p.exists():
        raise KeyError("Obrázok neexistuje")
    return p.read_bytes()


def _empty():
    return {"attempts": [], "questions": {}, "cards": {}}


def stats(store):
    data, _ = store.read_json(STATS_PATH, _empty())
    return {**_empty(), **data}


def add_attempt(store, body: dict):
    """body: {quiz, mode, score, total, seconds, results: {qid: true/false}}"""
    results = body.get("results") or {}
    if not isinstance(results, dict):
        raise ValueError("Neplatné výsledky")
    attempt = {
        "t": int(time.time()),
        "quiz": str(body.get("quiz", ""))[:40],
        "mode": str(body.get("mode", ""))[:40],
        "score": int(body.get("score", 0)),
        "total": int(body.get("total", 0)),
        "seconds": int(body.get("seconds", 0)),
    }

    def fn(data):
        for k, v in _empty().items():
            data.setdefault(k, v)
        data["attempts"] = (data["attempts"] + [attempt])[-MAX_ATTEMPTS:]
        qs = data["questions"].setdefault(attempt["quiz"], {})
        for qid, ok in results.items():
            s = qs.setdefault(str(qid)[:10], {"ok": 0, "bad": 0, "last": None})
            s["ok" if ok else "bad"] += 1
            s["last"] = bool(ok)
        return data

    return mutate(store, STATS_PATH, _empty(), fn, "Elektro: výsledok testu")


def rate_card(store, body: dict):
    """body: {set, card, known: bool}"""
    sid, cid, known = str(body.get("set", ""))[:40], str(body.get("card", ""))[:10], bool(body.get("known"))

    def fn(data):
        for k, v in _empty().items():
            data.setdefault(k, v)
        data["cards"].setdefault(sid, {})[cid] = {"known": known, "t": int(time.time())}
        return data

    return mutate(store, STATS_PATH, _empty(), fn, "Elektro: kartička")


def reset(store):
    def fn(data):
        data.clear()
        data.update(_empty())
        return data

    return mutate(store, STATS_PATH, _empty(), fn, "Elektro: vynulovanie štatistík")


# ---------- rozvádzače (skrine s kartami a snímačmi) ----------
CABINETS_PATH = "elektro/cabinets.json"
MAX_CABINETS_BYTES = 300_000


def cabinets(store):
    data, _ = store.read_json(CABINETS_PATH, [])
    return data if isinstance(data, list) else []


def save_cabinets(store, body):
    if not isinstance(body, list):
        raise ValueError("Očakávam zoznam rozvádzačov")
    if len(json.dumps(body)) > MAX_CABINETS_BYTES:
        raise ValueError("Rozvádzače sú príliš veľké na uloženie")

    def fn(data):
        data.clear()
        data.extend(body)
        return body

    return mutate(store, CABINETS_PATH, [], fn, "Elektro: rozvádzače")
