"""Sekcie a položky. Dáta sú uložené ako JSON:

  data/sections.json            – zoznam sekcií
  data/items/<sekcia>.json      – položky v sekcii
  files/<sekcia>/<polozka>/...  – priložené súbory (PDF, obrázky)
"""
import re
import secrets
import time
import unicodedata
from datetime import datetime, timezone

from .storage import mutate

SECTIONS_PATH = "data/sections.json"

# Typy sekcií určujú, aké polia má položka (frontend podľa nich kreslí formulár).
SECTION_TYPES = {
    "projects": "Projekty",
    "documents": "Dokumenty",
    "checklist": "Zoznam úloh",
    "tasks": "Práca / úlohy",
    "bills": "Účty a platby",
    "progress": "Pokroky",
    "notes": "Poznámky",
}

DEFAULT_SECTIONS = [
    {"id": "elektronika", "name": "Elektronika", "type": "projects", "icon": "chip", "color": "#22d3ee"},
    {"id": "3d", "name": "3D projekty", "type": "projects", "icon": "cube", "color": "#a78bfa"},
    {"id": "web", "name": "Tvorba webov", "type": "projects", "icon": "globe", "color": "#34d399"},
    {"id": "dokumenty", "name": "Dokumenty", "type": "documents", "icon": "file", "color": "#f87171"},
    {"id": "pokroky", "name": "Moje pokroky", "type": "progress", "icon": "trend", "color": "#fbbf24"},
    {"id": "praca", "name": "Práca", "type": "tasks", "icon": "briefcase", "color": "#60a5fa"},
    {"id": "skola", "name": "Škola", "type": "checklist", "icon": "backpack", "color": "#fb923c"},
    {"id": "ucty", "name": "Účty", "type": "bills", "icon": "wallet", "color": "#f472b6"},
]

ITEM_FIELDS = {
    "title": str, "note": str, "status": str, "tags": list, "date": str, "due": str,
    "amount": (int, float), "currency": str, "done": bool, "progress": (int, float),
    "links": list, "person": str, "priority": str, "recurring": str, "pinned": bool,
}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id():
    return f"{int(time.time()):x}{secrets.token_hex(3)}"


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text[:40] or new_id()


def items_path(section_id: str) -> str:
    if not re.fullmatch(r"[a-z0-9-]{1,40}", section_id):
        raise ValueError("Neplatné ID sekcie")
    return f"data/items/{section_id}.json"


def clean_item(fields: dict, partial=False) -> dict:
    out = {}
    for key, typ in ITEM_FIELDS.items():
        if key not in fields:
            continue
        val = fields[key]
        if val is None:
            out[key] = None
            continue
        if typ is bool:
            val = bool(val)
        elif typ is list:
            val = [str(v).strip() for v in (val if isinstance(val, list) else str(val).split(",")) if str(v).strip()]
        elif typ == (int, float):
            if val == "":
                val = None
            else:
                try:
                    val = float(str(val).replace(",", "."))
                except ValueError:
                    raise ValueError(f"Pole {key} musí byť číslo")
        else:
            val = str(val)
        out[key] = val
    if not partial and not (out.get("title") or "").strip():
        raise ValueError("Položka musí mať názov")
    return out


class Repo:
    def __init__(self, store):
        self.store = store

    # --- sekcie ---
    def sections(self):
        data, _ = self.store.read_json(SECTIONS_PATH, None)
        return data if data is not None else DEFAULT_SECTIONS

    def save_sections(self, sections):
        clean, seen = [], set()
        for s in sections:
            name = str(s.get("name", "")).strip()
            if not name:
                raise ValueError("Sekcia musí mať názov")
            sid = s.get("id") or slugify(name)
            while sid in seen:
                sid = f"{sid}-{secrets.token_hex(2)}"
            items_path(sid)
            seen.add(sid)
            typ = s.get("type") if s.get("type") in SECTION_TYPES else "notes"
            clean.append({
                "id": sid, "name": name[:60], "type": typ,
                "icon": str(s.get("icon") or "folder")[:300],
                "color": str(s.get("color") or "#8b5cf6")[:20],
            })
        self.store.write_json(SECTIONS_PATH, clean, self.store.read_json(SECTIONS_PATH, None)[1], "Úprava sekcií")
        return clean

    def section(self, sid):
        for s in self.sections():
            if s["id"] == sid:
                return s
        raise KeyError("Sekcia neexistuje")

    # --- položky ---
    def items(self, sid):
        data, _ = self.store.read_json(items_path(sid), [])
        return data

    def add_item(self, sid, fields):
        sec = self.section(sid)
        item = clean_item(fields)
        item.update({"id": new_id(), "created": now_iso(), "updated": now_iso(), "files": []})

        def fn(data):
            data.insert(0, item)
            return item

        return mutate(self.store, items_path(sid), [], fn, f"[{sec['name']}] Pridané: {item['title'][:60]}")

    def update_item(self, sid, iid, fields):
        sec = self.section(sid)
        changes = clean_item(fields, partial=True)

        def fn(data):
            for it in data:
                if it["id"] == iid:
                    it.update(changes)
                    it["updated"] = now_iso()
                    return it
            raise KeyError("Položka neexistuje")

        return mutate(self.store, items_path(sid), [], fn, f"[{sec['name']}] Upravené: {iid}")

    def delete_item(self, sid, iid):
        sec = self.section(sid)

        def fn(data):
            for i, it in enumerate(data):
                if it["id"] == iid:
                    return data.pop(i)
            raise KeyError("Položka neexistuje")

        item = mutate(self.store, items_path(sid), [], fn, f"[{sec['name']}] Zmazané: {iid}")
        for f in item.get("files", []):
            try:
                self.store.delete(f["path"], f"Zmazaný súbor {f['name']}")
            except Exception:
                pass
        return item

    def add_file(self, sid, iid, filename, content: bytes, content_type: str):
        sec = self.section(sid)
        base, dot, ext = filename.rpartition(".")
        safe = slugify(base or filename) + (("." + slugify(ext)) if dot else "")
        path = f"files/{sid}/{iid}/{safe}"
        # najprv over, že položka existuje
        if not any(it["id"] == iid for it in self.items(sid)):
            raise KeyError("Položka neexistuje")
        self.store.write_bytes(path, content, f"[{sec['name']}] Súbor: {filename[:60]}")
        meta = {"name": filename, "path": path, "size": len(content), "type": content_type, "added": now_iso()}

        def fn(data):
            for it in data:
                if it["id"] == iid:
                    files = [f for f in it.get("files", []) if f["path"] != path]
                    files.append(meta)
                    it["files"] = files
                    it["updated"] = now_iso()
                    return it
            raise KeyError("Položka neexistuje")

        return mutate(self.store, items_path(sid), [], fn, f"[{sec['name']}] Priložený súbor k {iid}")

    def remove_file(self, sid, iid, path):
        sec = self.section(sid)

        def fn(data):
            for it in data:
                if it["id"] == iid:
                    it["files"] = [f for f in it.get("files", []) if f["path"] != path]
                    it["updated"] = now_iso()
                    return it
            raise KeyError("Položka neexistuje")

        item = mutate(self.store, items_path(sid), [], fn, f"[{sec['name']}] Odobratý súbor")
        self.store.delete(path, "Zmazaný súbor")
        return item
