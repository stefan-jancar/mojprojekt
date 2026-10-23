"""AI asistent. Vie čítať a pridávať/upravovať položky v sekciách.

Poskytovateľ sa vyberá podľa premenných prostredia:
  GEMINI_API_KEY     → Google Gemini (model GEMINI_MODEL, predvolene gemini-flash-latest)
  ANTHROPIC_API_KEY  → Claude (model ANTHROPIC_MODEL)
Ak sú nastavené obe, použije sa Gemini (prípadne vynúť AI_PROVIDER=gemini / claude).
"""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
import logging
from datetime import date

import anthropic

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-5-5")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
# Ako dlho Gemini „premýšľa“ pred odpoveďou: minimal / low / medium / high / off (= predvolené modelu)
GEMINI_THINKING = (os.environ.get("GEMINI_THINKING") or "low").lower()
# Záložný model pri preťažení hlavného (503) alebo vyčerpanom limite (429); "off" = bez zálohy
GEMINI_FALLBACK_MODEL = os.environ.get("GEMINI_FALLBACK_MODEL", "gemini-flash-lite-latest")
GEMINI_RETRY_WAIT = (1.5, 3.0)  # sekundy medzi pokusmi pri preťažení
MAX_TOOL_ROUNDS = 8
# Vercel funkciu po časovom limite zruší (odpoveď 504) – asistent musí skončiť skôr
DEADLINE_S = float(os.environ.get("ASSISTANT_DEADLINE_S") or 95)
GEMINI_TIMEOUT_MS = int(os.environ.get("GEMINI_TIMEOUT_MS") or 45000)
_POOL = ThreadPoolExecutor(max_workers=4)
log = logging.getLogger("moj-priestor")
HISTORY_MAX = 20          # posledných N správ rozhovoru
MESSAGE_MAX_CHARS = 4000  # dlhé správy sa skrátia

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
        "value": {"type": "string", "description": "v súčiastkach: hodnota alebo typ, napr. 220 Ω, BC547"},
        "qty": {"type": "number", "description": "v súčiastkach: počet kusov"},
        "package": {"type": "string", "description": "v súčiastkach: puzdro, napr. THT, SMD 0805, TO-92"},
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
            "kind (v sekcii účtov: 'expense' = výdavok, 'income' = príjem), category (kategória, napr. Energie, Výplata; v súčiastkach napr. Rezistor, LED, Senzor), "
            "value, qty, package (v sekcii súčiastok: hodnota/typ, počet kusov, puzdro)."
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
    return {k: v for k, v in item.items() if k not in ("created", "circuit", "idea") and v not in (None, "", [])}


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


def _clip(text):
    return text if len(text) <= MESSAGE_MAX_CHARS else text[:MESSAGE_MAX_CHARS] + " …(skrátené)"


def _history(history):
    messages = [
        {"role": m["role"], "content": _clip(str(m["content"]))}
        for m in history[-HISTORY_MAX:]
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


def _gemini_generate(client, contents, config, state):
    """Volanie Gemini s opakovaním pri preťažení a prepnutím na záložný model."""
    from google import genai

    models = [state["model"]]
    if GEMINI_FALLBACK_MODEL.lower() not in ("", "off", "none") and GEMINI_FALLBACK_MODEL != state["model"]:
        models.append(GEMINI_FALLBACK_MODEL)
    last = None
    for m_index, model in enumerate(models):
        waits = GEMINI_RETRY_WAIT if m_index == 0 else (2.0,)
        for attempt in range(len(waits) + 1):
            remaining = state.get("deadline", float("inf")) - time.monotonic() - 3
            if remaining < 4:
                raise TimeoutError("Vypršal čas na odpoveď asistenta")
            t0 = time.monotonic()
            note = lambda what: state.setdefault("trace", []).append(f"{model} {time.monotonic() - t0:.1f} s {what}")
            try:
                # čas strážime len u nás (vlákno) – požiadavka do Gemini je bez hlavičky X-Server-Timeout
                fut = _POOL.submit(client.models.generate_content, model=model, contents=contents, config=config)
                resp = fut.result(timeout=min(GEMINI_TIMEOUT_MS / 1000, remaining))
                note("ok")
                state["model"] = model  # v tejto konverzácii už ostaň na modeli, ktorý odpovedal
                return resp
            except FuturesTimeout as e:  # model neodpovedal včas – skús záložný model
                note("neodpovedal")
                last = e
                break
            except genai.errors.ClientError as e:
                note(f"chyba {e.code}")
                # model nepozná nastavenie premýšľania (napr. starší model) → skús bez neho
                if config.thinking_config is not None and e.code == 400 and "think" in str(e).lower():
                    config.thinking_config = None
                    continue
                if e.code == 429:  # vyčerpaný limit – opakovanie nepomôže, skús záložný model
                    last = e
                    break
                raise
            except genai.errors.ServerError as e:  # 500/503 – preťaženie, chvíľu počkaj
                note(f"chyba {e.code}")
                last = e
                if attempt < len(waits) and time.monotonic() + waits[attempt] < state.get("deadline", float("inf")) - 10:
                    time.sleep(waits[attempt])
                else:
                    break
    raise last


def _late_reply(changed, state=None):
    if changed:
        text = ("Zmeny som už uložil, ale Gemini odpovedal príliš pomaly a nestihol som to dopísať. "
                "Pozri sa do sekcie, či je všetko správne.")
    else:
        text = "Gemini teraz odpovedá príliš pomaly (preťaženie u Google). Skús to o chvíľu znova, prípadne kratšou správou."
    trace = (state or {}).get("trace")
    if trace:
        log.warning("Asistent nestihol odpovedať: %s", " | ".join(trace))
        text += "\n\n*Priebeh: " + " · ".join(trace) + "*"
    return text


def _gemini_thinking(types):
    if GEMINI_THINKING in ("minimal", "low", "medium", "high"):
        return types.ThinkingConfig(thinking_level=GEMINI_THINKING.upper())
    return None


def _chat_gemini(repo, messages):
    from google import genai
    from google.genai import types

    started = time.monotonic()
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    config = types.GenerateContentConfig(
        system_instruction=_system(repo),
        thinking_config=_gemini_thinking(types),
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
    state = {"model": GEMINI_MODEL, "deadline": started + DEADLINE_S}

    for _ in range(MAX_TOOL_ROUNDS):
        if time.monotonic() > state["deadline"] - 5:
            return {"reply": _late_reply(changed, state), "changed": changed}
        try:
            response = _gemini_generate(client, contents, config, state)
        except Exception as e:
            # pomalá odpoveď Gemini (časový limit) – radšej zrozumiteľná správa ako 504
            if changed or "timeout" in type(e).__name__.lower() or "timed out" in str(e).lower():
                return {"reply": _late_reply(changed, state), "changed": changed}
            raise
        calls = response.function_calls or []
        if not calls:
            text = (response.text or "").strip()
            return {"reply": text or "Na toto ti neviem odpovedať.", "changed": changed}

        # odpoveď modelu vrátime celú (obsahuje aj podpisy „premýšľania“, ktoré Gemini vyžaduje)
        contents.append(response.candidates[0].content)
        parts = []
        for fc in calls:
            t0 = time.monotonic()
            try:
                out = _run_tool(repo, fc.name, dict(fc.args or {}))
                state.setdefault("trace", []).append(f"{fc.name} {time.monotonic() - t0:.1f} s")
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
