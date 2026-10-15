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
Počet „?“ znamená, že používateľ počet neuviedol – predpokladaj bežné množstvo (pri pasívnych súčiastkach dosť kusov, pri moduloch 1 ks). \
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
        raw = _gemini(prompt, SCHEMA)
    else:
        raw = _claude(prompt)
    return {"projects": _parse(raw)}


def _gemini(prompt, schema):
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    config = types.GenerateContentConfig(
        thinking_config=assistant._gemini_thinking(types),
        response_mime_type="application/json",
        response_json_schema=schema,
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


# ---------- schéma zapojenia (netlist) pre uložený projekt ----------

KINDS = {
    "resistor": "rezistor (vývody 1, 2)", "pot": "potenciometer (A, W = bežec, B)", "ldr": "fotorezistor (1, 2)",
    "thermistor": "termistor (1, 2)", "capacitor": "kondenzátor nepolarizovaný (1, 2)",
    "electrolytic": "elektrolytický kondenzátor (+, -)", "inductor": "cievka / tlmivka (1, 2)",
    "diode": "dióda (A = anóda, K = katóda)", "zener": "Zenerova dióda (A, K)", "led": "LED (A, K)",
    "npn": "NPN tranzistor (B, C, E)", "pnp": "PNP tranzistor (B, C, E)",
    "nmos": "N-MOSFET (G, D, S)", "pmos": "P-MOSFET (G, D, S)",
    "switch": "spínač (1, 2)", "button": "tlačidlo (1, 2)", "battery": "batéria / zdroj (+, -)",
    "buzzer": "bzučiak (+, -)", "speaker": "reproduktor (1, 2)", "motor": "motor (1, 2)", "fuse": "poistka (1, 2)",
    "crystal": "kryštál (1, 2)",
    "ic": "integrovaný obvod, stabilizátor, optočlen … – MUSÍ mať pole pins (názvy vývodov v poradí čísel 1..N)",
    "module": "hotový modul / doska (Arduino, senzorový modul, displej …) – MUSÍ mať pole pins",
    "connector": "konektor / svorkovnica / kolíková lišta – MUSÍ mať pole pins",
}
PKGS = "AXIAL, RAD2, RAD5, LED, POT, TO92, TO126, TO220, DIP, HDR, TERM2, BTN, RELAY"

CIRCUIT_PROMPT = """Si skúsený elektronik. Navrhni presnú schému zapojenia (netlist) pre tento hobby projekt:

Projekt: {name}
{details}

{known}

Pravidlá:
- parts: každá súčiastka obvodu vrátane napájania (batéria alebo napájací konektor) – aj tie, ktoré treba dokúpiť.
  ref ako v schémach (R1, C1, D1, LED1, Q1, U1, J1, BT1, SW1, M1 …), kind z tohto zoznamu:
{kinds}
- pkg = puzdro pre plošný spoj, jedno z: {pkgs}. Hotové moduly (Arduino, senzory na doske, displeje) = HDR \
(na doske budú ako kolíková lišta), IO v DIP = DIP, tranzistory TO92/TO220.
- pins: pri kind ic / module / connector povinne zoznam názvov vývodov v poradí čísel (1..N). \
Pri tranzistoroch v TO92/TO220 uveď pins v poradí vývodov puzdra (napr. BC547: ["C","B","E"]).
- nets: každý spoj (uzol) má názov a zoznam vývodov vo formáte "REF.VÝVOD", napr. "R1.1", "LED1.A", "U1.VCC" alebo "U1.8". \
Zem pomenuj "GND", napájanie podľa napätia ("+5V", "+9V", "+3V3", "VCC"). Každý spoj musí mať aspoň 2 vývody, \
každý vývod je najviac v jednom spoji. Nepoužité vývody vynechaj.
- Hodnoty súčiastok počítaj správne (predradné odpory LED, deliče, časovanie 555 …).
- notes: 1–3 vety po slovensky – na čo si dať pozor pri zapájaní.

Vráť IBA JSON:
{{"parts":[{{"ref":"R1","kind":"resistor","name":"Rezistor","value":"220 Ω","pkg":"AXIAL"}},
  {{"ref":"U1","kind":"ic","name":"NE555","value":"","pkg":"DIP","pins":["GND","TRIG","OUT","RESET","CTRL","THR","DIS","VCC"]}}],
 "nets":[{{"name":"GND","nodes":["U1.GND","BT1.-"]}}],
 "notes":"…"}}"""

CIRCUIT_SCHEMA = {
    "type": "object",
    "properties": {
        "parts": {"type": "array", "items": {"type": "object", "properties": {
            "ref": {"type": "string"}, "kind": {"type": "string", "enum": list(KINDS)},
            "name": {"type": "string"}, "value": {"type": "string"}, "pkg": {"type": "string"},
            "pins": {"type": "array", "items": {"type": "string"}}}, "required": ["ref", "kind", "name"]}},
        "nets": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "nodes": {"type": "array", "items": {"type": "string"}}},
            "required": ["name", "nodes"]}},
        "notes": {"type": "string"},
    },
    "required": ["parts", "nets"],
}


def _clip(s, n=200):
    return str(s or "").strip()[:n]


def circuit(project, known=None):
    name = _clip(project.get("name") or project.get("title"), 120)
    if not name:
        raise ValueError("Chýba názov projektu.")
    det = []
    for key, label in (("summary", "Popis"), ("note", "Poznámky")):
        if project.get(key):
            det.append(f"{label}: {_clip(project[key], 3000)}")
    for key, label in (("uses", "Súčiastky, ktoré má"), ("missing", "Treba dokúpiť")):
        rows = [f"- {_fmt_qty(x.get('qty')) if x.get('qty') else ''}× {_clip(x.get('name'), 120)}"
                for x in (project.get(key) or []) if isinstance(x, dict) and x.get("name")]
        if rows:
            det.append(label + ":\n" + "\n".join(rows[:60]))
    steps = [f"{i + 1}. {_clip(s, 400)}" for i, s in enumerate(project.get("steps") or [])][:20]
    if steps:
        det.append("Postup:\n" + "\n".join(steps))
    kn = []
    for k in (known or [])[:80]:
        if isinstance(k, dict) and k.get("name") and k.get("kind"):
            row = f"- {_clip(k['name'], 120)}: kind={k['kind']}, pkg={k.get('pkg') or '?'}"
            if k.get("pins"):
                row += ", pins=" + json.dumps([_clip(p, 20) for p in k["pins"][:64]], ensure_ascii=False)
            kn.append(row)
    known_txt = ("Ak použiješ tieto súčiastky, ber ich kind/pkg/pins presne takto:\n" + "\n".join(kn)) if kn else ""
    prompt = CIRCUIT_PROMPT.format(name=name, details="\n".join(det), known=known_txt, pkgs=PKGS,
                                   kinds="\n".join(f"  {k}: {v}" for k, v in KINDS.items()))
    if assistant.provider() == "gemini":
        raw = _gemini(prompt, CIRCUIT_SCHEMA)
    else:
        raw = _claude(prompt)
    return _clean_circuit(raw)


def _clean_circuit(text):
    m = re.search(r"\{.*\}", (text or "").strip(), re.S)
    if not m:
        raise ValueError("Asistent nevrátil schému, skús to znova.")
    data = json.loads(m.group(0))
    parts, refs = [], set()
    for p in data.get("parts") or []:
        if not isinstance(p, dict):
            continue
        ref = re.sub(r"[^A-Za-z0-9_]", "", str(p.get("ref") or ""))[:12]
        if not ref or ref in refs:
            continue
        refs.add(ref)
        kind = p.get("kind") if p.get("kind") in KINDS else "ic"
        part = {"ref": ref, "kind": kind, "name": _clip(p.get("name"), 80), "value": _clip(p.get("value"), 40),
                "pkg": _clip(p.get("pkg"), 12).upper()}
        pins = [_clip(x, 16) for x in (p.get("pins") or []) if str(x).strip()][:64]
        if pins:
            part["pins"] = pins
        parts.append(part)
    nets = []
    for n in data.get("nets") or []:
        if not isinstance(n, dict):
            continue
        nodes = [_clip(x, 40) for x in (n.get("nodes") or []) if "." in str(x) and str(x).split(".")[0] in refs]
        if len(nodes) >= 2:
            nets.append({"name": _clip(n.get("name"), 24) or f"N{len(nets) + 1}", "nodes": nodes})
    if not parts or not nets:
        raise ValueError("Asistent nevrátil použiteľnú schému, skús to znova.")
    return {"parts": parts, "nets": nets, "notes": _clip(data.get("notes"), 1000)}
