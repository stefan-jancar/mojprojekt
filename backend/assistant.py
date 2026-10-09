"""AI asistent. Vie čítať a pridávať/upravovať položky v sekciách.

Poskytovateľ sa vyberá podľa premenných prostredia:
  GEMINI_API_KEY     → Google Gemini (model GEMINI_MODEL, predvolene gemini-flash-latest)
  ANTHROPIC_API_KEY  → Claude (model ANTHROPIC_MODEL)
Ak sú nastavené obe, použije sa Gemini (prípadne vynúť AI_PROVIDER=gemini / claude).
"""
import json
import os
from datetime import date

import anthropic

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-5-5")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
# Ako dlho Gemini „premýšľa“ pred odpoveďou: minimal / low / medium / high / off (= predvolené modelu)
GEMINI_THINKING = (os.environ.get("GEMINI_THINKING") or "low").lower()
MAX_TOOL_ROUNDS = 8

SYSTEM = """Si osobný asistent v aplikácii „Môj priestor“, kde si používateľ ukladá \
elektronické projekty, 3D projekty, tvorbu webov, dokumenty, pokroky, prácu, veci do školy pre deti, \
účty a ďalšie sekcie. Odpovedaj po slovensky, stručne a prakticky.

Máš nástroje na prácu s dátami. Keď sa používateľ pýta na svoje veci, najprv si ich načítaj. \
Keď ťa požiada niečo zapísať (napr. „zajtra treba do školy fixky“), pridaj položku do správnej sekcie \
a potvrď, čo si uložil. Dátumy zapisuj vo formáte RRRR-MM-DD. Nikdy nič nemaž, len pridávaj alebo upravuj.

Vzhľad sekcie (ikonu, farbu, názov) meníš nástrojom update_section. Keď si používateľ pýta ikonu, rovno ju nastav – buď vstavanú ikonu, emoji, alebo nakresli vlastnú SVG ikonu – a krátko povedz, čo si nastavil. Neposielaj používateľovi SVG kód, ten sa zobrazí v aplikácii sám.
Odpovede formátuj jednoducho: krátke odseky, odrážky „- “, **tučné** písmo."""

FIELDS_SCHEMA = {
    "type": "object",
    "description": "Polia položky.",
    "properties": {
        "title": {"type": "string", "description": "Názov (povinný pri pridaní)"},
        "note": {"type": "string"},
        "date": {"type": "string", "description": "RRRR-MM-DD"},
        "due": {"type": "string", "description": "termín / splatnosť RRRR-MM-DD"},
        "amount": {"type": "number"},
        "currency": {"type": "string"},
        "done": {"type": "boolean"},
        "progress": {"type": "number", "description": "0-100"},
        "status": {"type": "string"},
        "priority": {"type": "string"},
        "person": {"type": "string"},
        "kind": {"type": "string", "description": "v účtoch: expense = výdavok, income = príjem"},
        "category": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
    },
}

BUILTIN_ICONS = ("chip, cube, globe, file, trend, briefcase, backpack, wallet, folder, star, note, bolt, heart, "
                 "camera, book, code, wrench, car, music, printer, target, cart, image, home, sparkles, calendar, lock")

TOOLS = [
    {
        "name": "list_sections",
        "description": "Vráti zoznam sekcií (id, názov, typ).",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_items",
        "description": "Vráti položky v sekcii.",
        "input_schema": {
            "type": "object",
            "properties": {"section_id": {"type": "string"}},
            "required": ["section_id"],
        },
    },
    {
        "name": "add_item",
        "description": (
            "Pridá položku do sekcie. Polia: title (povinné), note, status, tags (zoznam), date, due, "
            "amount (číslo), currency, done (bool), progress (0-100), links (zoznam URL), person, priority, "
            "kind (v sekcii účtov: 'expense' = výdavok, 'income' = príjem), category (kategória, napr. Energie, Výplata)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "section_id": {"type": "string"},
                "fields": FIELDS_SCHEMA,
            },
            "required": ["section_id", "fields"],
        },
    },
    {
        "name": "update_item",
        "description": "Upraví existujúcu položku (napr. done=true, keď je hotová alebo zaplatená).",
        "input_schema": {
            "type": "object",
            "properties": {
                "section_id": {"type": "string"},
                "item_id": {"type": "string"},
                "fields": FIELDS_SCHEMA,
            },
            "required": ["section_id", "item_id", "fields"],
        },
    },
]


def provider():
    forced = (os.environ.get("AI_PROVIDER") or "").lower()
    if forced in ("gemini", "claude"):
        return forced
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude"
    return None


def enabled() -> bool:
    return provider() is not None


def _slim(item):
    return {k: v for k, v in item.items() if k not in ("created",) and v not in (None, "", [])}


TOOLS.append({
    "name": "update_section",
    "description": (
        "Zmení vzhľad sekcie: ikonu, farbu alebo názov. Ikona môže byť: (a) vstavaná – jedno z: "
        + BUILTIN_ICONS + "; (b) emoji, napr. 🚗; (c) vlastná SVG ikona v parametri svg. "
        "Pravidlá pre SVG: <svg viewBox=\"0 0 64 64\">…</svg>, jednoduchá plochá ikona, výrazné farby uvedené priamo "
        "(fill/stroke ako #RRGGBB, nie currentColor), priehľadné pozadie, bez textu, skriptov a odkazov, do 4000 znakov."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "section_id": {"type": "string"},
            "icon": {"type": "string", "description": "vstavaná ikona alebo emoji"},
            "svg": {"type": "string", "description": "kompletný SVG kód vlastnej ikony"},
            "color": {"type": "string", "description": "farba sekcie #RRGGBB"},
            "name": {"type": "string", "description": "nový názov sekcie"},
        },
        "required": ["section_id"],
    },
})


def _run_tool(repo, name, args):
    if name == "update_section":
        sec = repo.update_section(args["section_id"], name=args.get("name"), icon=args.get("icon"),
                                  svg=args.get("svg"), color=args.get("color"))
        return {"id": sec["id"], "name": sec["name"], "color": sec["color"],
                "icon": "vlastná SVG ikona" if sec["icon"].startswith("data:") else sec["icon"]}
    if name == "list_sections":
        return [{"id": s["id"], "name": s["name"], "type": s["type"]} for s in repo.sections()]
    if name == "list_items":
        return [_slim(i) for i in repo.items(args["section_id"])]
    if name == "add_item":
        return _slim(repo.add_item(args["section_id"], args.get("fields") or {}))
    if name == "update_item":
        return _slim(repo.update_item(args["section_id"], args["item_id"], args.get("fields") or {}))
    raise ValueError(f"Neznámy nástroj {name}")


def _history(history):
    messages = [
        {"role": m["role"], "content": str(m["content"])}
        for m in history[-30:]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    return messages


def _system(repo=None):
    text = SYSTEM + f"\n\nDnešný dátum: {date.today().isoformat()}."
    if repo is not None:
        # zoznam sekcií rovno v zadaní ušetrí jedno kolo volania nástroja
        try:
            secs = repo.sections()
            lines = [f"- {s['id']}: {s['name']} (typ {s['type']})" for s in secs]
            text += "\n\nSekcie používateľa (id: názov):\n" + "\n".join(lines)
            text += "\nNa položky v sekcii použi list_items s jej id; list_sections už volať netreba."
        except Exception:
            pass
    return text


def chat(repo, history):
    """history: [{"role": "user"|"assistant", "content": str}, ...]"""
    messages = _history(history)
    if not messages:
        return {"reply": "Napíš mi, s čím pomôcť.", "changed": False}
    if provider() == "gemini":
        return _chat_gemini(repo, messages)
    return _chat_claude(repo, messages)


def _chat_gemini(repo, messages):
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    thinking = None
    if GEMINI_THINKING in ("minimal", "low", "medium", "high"):
        thinking = types.ThinkingConfig(thinking_level=GEMINI_THINKING.upper())
    config = types.GenerateContentConfig(
        system_instruction=_system(repo),
        thinking_config=thinking,
        tools=[types.Tool(function_declarations=[
            types.FunctionDeclaration(name=t["name"], description=t["description"],
                                      parameters_json_schema=t["input_schema"])
            for t in TOOLS
        ])],
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    contents = [
        types.Content(role="user" if m["role"] == "user" else "model", parts=[types.Part(text=m["content"])])
        for m in messages
    ]
    changed = False

    for _ in range(MAX_TOOL_ROUNDS):
        try:
            response = client.models.generate_content(model=GEMINI_MODEL, contents=contents, config=config)
        except genai.errors.ClientError as e:
            # model nepozná nastavenie premýšľania (napr. starší model) → skús bez neho
            if config.thinking_config is not None and e.code == 400 and "think" in str(e).lower():
                config.thinking_config = None
                response = client.models.generate_content(model=GEMINI_MODEL, contents=contents, config=config)
            else:
                raise
        calls = response.function_calls or []
        if not calls:
            text = (response.text or "").strip()
            return {"reply": text or "Na toto ti neviem odpovedať.", "changed": changed}

        # odpoveď modelu vrátime celú (obsahuje aj podpisy „premýšľania“, ktoré Gemini vyžaduje)
        contents.append(response.candidates[0].content)
        parts = []
        for fc in calls:
            try:
                out = _run_tool(repo, fc.name, dict(fc.args or {}))
                if fc.name in ("add_item", "update_item", "update_section"):
                    changed = True
                result = {"result": out}
            except Exception as e:  # chyba nástroja ide späť modelu
                result = {"error": str(e)}
            parts.append(types.Part(function_response=types.FunctionResponse(id=fc.id, name=fc.name, response=result)))
        contents.append(types.Content(role="user", parts=parts))

    return {"reply": "Úloha bola príliš zložitá, skús ju rozdeliť na menšie kroky.", "changed": changed}


def _chat_claude(repo, messages):
    client = anthropic.Anthropic()
    system = _system(repo)
    changed = False

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=system,
            tools=TOOLS,
            messages=messages,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if response.stop_reason == "refusal":
            return {"reply": "Na toto ti, žiaľ, nemôžem odpovedať.", "changed": changed}

        if response.stop_reason != "tool_use":
            text = "\n".join(b.text for b in response.content if b.type == "text").strip()
            return {"reply": text or "Hotovo.", "changed": changed}

        messages.append({"role": "assistant", "content": response.content})
        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            try:
                out = _run_tool(repo, block.name, block.input or {})
                if block.name in ("add_item", "update_item", "update_section"):
                    changed = True
                results.append({"type": "tool_result", "tool_use_id": block.id,
                                "content": json.dumps(out, ensure_ascii=False)})
            except Exception as e:  # chyba nástroja ide späť modelu
                results.append({"type": "tool_result", "tool_use_id": block.id,
                                "content": f"Chyba: {e}", "is_error": True})
        messages.append({"role": "user", "content": results})

    return {"reply": "Úloha bola príliš zložitá, skús ju rozdeliť na menšie kroky.", "changed": changed}
