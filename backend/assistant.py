"""AI asistent (Claude). Vie čítať a pridávať/upravovať položky v sekciách."""
import json
import os
from datetime import date

import anthropic

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-5-5")
MAX_TOOL_ROUNDS = 8

SYSTEM = """Si osobný asistent v aplikácii „Môj priestor“, kde si používateľ ukladá \
elektronické projekty, 3D projekty, tvorbu webov, dokumenty, pokroky, prácu, veci do školy pre deti, \
účty a ďalšie sekcie. Odpovedaj po slovensky, stručne a prakticky.

Máš nástroje na prácu s dátami. Keď sa používateľ pýta na svoje veci, najprv si ich načítaj. \
Keď ťa požiada niečo zapísať (napr. „zajtra treba do školy fixky“), pridaj položku do správnej sekcie \
a potvrď, čo si uložil. Dátumy zapisuj vo formáte RRRR-MM-DD. Nikdy nič nemaž, len pridávaj alebo upravuj."""

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
                "fields": {"type": "object", "description": "Polia položky, title je povinný."},
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
                "fields": {"type": "object"},
            },
            "required": ["section_id", "item_id", "fields"],
        },
    },
]


def enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _slim(item):
    return {k: v for k, v in item.items() if k not in ("created",) and v not in (None, "", [])}


def _run_tool(repo, name, args):
    if name == "list_sections":
        return [{"id": s["id"], "name": s["name"], "type": s["type"]} for s in repo.sections()]
    if name == "list_items":
        return [_slim(i) for i in repo.items(args["section_id"])]
    if name == "add_item":
        return _slim(repo.add_item(args["section_id"], args.get("fields") or {}))
    if name == "update_item":
        return _slim(repo.update_item(args["section_id"], args["item_id"], args.get("fields") or {}))
    raise ValueError(f"Neznámy nástroj {name}")


def chat(repo, history):
    """history: [{"role": "user"|"assistant", "content": str}, ...]"""
    client = anthropic.Anthropic()
    messages = [
        {"role": m["role"], "content": str(m["content"])}
        for m in history[-30:]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    if not messages:
        return {"reply": "Napíš mi, s čím pomôcť.", "changed": False}

    system = SYSTEM + f"\n\nDnešný dátum: {date.today().isoformat()}."
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
                if block.name in ("add_item", "update_item"):
                    changed = True
                results.append({"type": "tool_result", "tool_use_id": block.id,
                                "content": json.dumps(out, ensure_ascii=False)})
            except Exception as e:  # chyba nástroja ide späť modelu
                results.append({"type": "tool_result", "tool_use_id": block.id,
                                "content": f"Chyba: {e}", "is_error": True})
        messages.append({"role": "user", "content": results})

    return {"reply": "Úloha bola príliš zložitá, skús ju rozdeliť na menšie kroky.", "changed": changed}
