"""Návrhy elektro projektov zo súčiastok, ktoré má používateľ doma.

Asistent dostane zoznam súčiastok (a voliteľne prianie) a vráti JSON s projektmi:
čo z toho použije, čo chýba (s odhadom ceny) a postup.
"""
import json
import os
import re

from . import assistant

MAX_PARTS = 300

PROMPT = """Si skúsený elektronik a mentor pre hobby projekty. Používateľ má doma tieto súčiastky \
(názov | kategória | hodnota/typ | puzdro | počet kusov):

{parts}

{wish}

Navrhni {count} rôznorodých, reálne postaviteľných projektov, ktoré čo najviac využijú tieto súčiastky. \
Zoraď ich tak, aby prvé boli tie, na ktoré treba dokúpiť najmenej (ideálne nič). Môžu byť rôznej náročnosti \
(aspoň jeden jednoduchý). Používaj iba súčiastky, ktoré používateľ naozaj má, v množstve, ktoré má – \
ak treba viac kusov alebo niečo iné, daj to do „missing“ s množstvom a orientačnou cenou v EUR \
(bežné ceny v slovenských/českých e-shopoch, napr. GM electronic, TME, Laskarduino). \
Drobnosti ako vodiče, nepájivé pole či spájka uveď v „missing“ len ak sú pre projekt nevyhnutné \
a používateľ ich nemá. Pri napájaní zo siete upozorni na bezpečnosť. Píš po slovensky, stručne a prakticky.

Vráť IBA JSON v tomto tvare (bez ďalšieho textu):
{{"projects": [{{
  "name": "krátky názov",
  "summary": "1–2 vety, čo projekt robí",
  "difficulty": "Ľahké" | "Stredné" | "Náročné",
  "time": "odhad času, napr. 1–2 hodiny",
  "uses": [{{"name": "súčiastka zo zoznamu", "qty": 1}}],
  "missing": [{{"name": "čo dokúpiť", "qty": 1, "price": 0.5, "note": "voliteľne prečo / alternatíva"}}],
  "steps": ["krok 1", "krok 2"],
  "tips": "voliteľne tip alebo upozornenie"
}}]}}"""

SCHEMA = {
    "type": "object",
    "properties": {
        "projects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "summary": {"type": "string"},
                    "difficulty": {"type": "string", "enum": ["Ľahké", "Stredné", "Náročné"]},
                    "time": {"type": "string"},
                    "uses": {"type": "array", "items": {"type": "object", "properties": {
                        "name": {"type": "string"}, "qty": {"type": "number"}}, "required": ["name"]}},
                    "missing": {"type": "array", "items": {"type": "object", "properties": {
                        "name": {"type": "string"}, "qty": {"type": "number"}, "price": {"type": "number"},
                        "note": {"type": "string"}}, "required": ["name"]}},
                    "steps": {"type": "array", "items": {"type": "string"}},
                    "tips": {"type": "string"},
                },
                "required": ["name", "summary", "difficulty", "uses", "missing", "steps"],
            },
        },
    },
    "required": ["projects"],
}


def _fmt_qty(q):
    try:
        q = float(q)
    except (TypeError, ValueError):
        return "?"
    return str(int(q)) if q == int(q) else str(q)


def _parts_text(parts):
    lines = []
    for p in parts[:MAX_PARTS]:
        if not isinstance(p, dict):
            continue
        name = str(p.get("title") or "").strip()[:120]
        if not name:
            continue
        cols = [name] + [str(p.get(k) or "-").strip()[:60] for k in ("category", "value", "package")]
        cols.append(_fmt_qty(p.get("qty")) if p.get("qty") not in (None, "") else "?")
        lines.append("- " + " | ".join(cols))
    return "\n".join(lines)


def _parse(text):
    text = (text or "").strip()
    m = re.search(r"\{.*\}", text, re.S)  # odstráni prípadné ```json obaly
    if not m:
        raise ValueError("Asistent nevrátil návrhy, skús to znova.")
    data = json.loads(m.group(0))
    projects = data.get("projects") if isinstance(data, dict) else None
    if not isinstance(projects, list):
        raise ValueError("Asistent nevrátil návrhy, skús to znova.")
    out = []
    for p in projects:
        if not isinstance(p, dict) or not p.get("name"):
            continue

        def items(key, fields):
            return [{k: x.get(k) for k in fields if x.get(k) not in (None, "")}
                    for x in (p.get(key) or []) if isinstance(x, dict) and x.get("name")]

        out.append({
            "name": str(p["name"]),
            "summary": str(p.get("summary") or ""),
            "difficulty": str(p.get("difficulty") or ""),
            "time": str(p.get("time") or ""),
            "uses": items("uses", ("name", "qty")),
            "missing": items("missing", ("name", "qty", "price", "note")),
            "steps": [str(s) for s in (p.get("steps") or []) if str(s).strip()],
            "tips": str(p.get("tips") or ""),
        })
    return out


def suggest(parts, wish="", count=4):
    text = _parts_text(parts or [])
    if not text:
        raise ValueError("Vyber aspoň jednu súčiastku.")
    count = max(1, min(int(count or 4), 6))
    wish = str(wish or "").strip()[:500]
    prompt = PROMPT.format(parts=text, count=count,
                           wish=f"Prianie používateľa: {wish}" if wish else "Používateľ nemá konkrétne prianie.")
    if assistant.provider() == "gemini":
        raw = _gemini(prompt)
    else:
        raw = _claude(prompt)
    return {"projects": _parse(raw)}


def _gemini(prompt):
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    config = types.GenerateContentConfig(
        thinking_config=assistant._gemini_thinking(types),
        response_mime_type="application/json",
        response_json_schema=SCHEMA,
    )
    contents = [types.Content(role="user", parts=[types.Part(text=prompt)])]
    resp = assistant._gemini_generate(client, contents, config, {"model": assistant.GEMINI_MODEL})
    return resp.text


def _claude(prompt):
    import anthropic

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=assistant.MODEL,
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}],
    )
    return "\n".join(b.text for b in resp.content if b.type == "text")
