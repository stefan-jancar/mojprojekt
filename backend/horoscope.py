"""Denný horoskop z noviny.sk.

noviny.sk nemá API ani RSS, preto sa text vyberá priamo z HTML stránky znamenia.
Ak noviny.sk zmenia vzhľad stránky, treba upraviť funkciu _extract().
Horoskop sa drží v pamäti do konca dňa, aby sme ich zbytočne nezaťažovali.
"""
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from bs4 import BeautifulSoup

BASE = "https://www.noviny.sk"
TZ = ZoneInfo("Europe/Bratislava")

# kľúč: (názov, symbol, overená cesta na noviny.sk alebo None → dohľadá sa z prehľadu)
SIGNS = {
    "baran": ("Baran", "♈", None),
    "byk": ("Býk", "♉", "10-byk"),
    "blizenci": ("Blíženci", "♊", None),
    "rak": ("Rak", "♋", "6-rak"),
    "lev": ("Lev", "♌", "8-lev"),
    "panna": ("Panna", "♍", "7-panna"),
    "vahy": ("Váhy", "♎", "2-vahy"),
    "skorpion": ("Škorpión", "♏", "4-skorpion"),
    "strelec": ("Strelec", "♐", None),
    "kozorozec": ("Kozorožec", "♑", "9-kozorozec"),
    "vodnar": ("Vodnár", "♒", "1-vodnar"),
    "ryby": ("Ryby", "♓", "5-ryby"),
}

# texty, ktoré nie sú samotný horoskop (reklamy, cookies, všeobecný úvod …)
_SKIP = re.compile(
    r"cookie|©|všetky práva|reklam|newsletter|prihlás|odoberajte|súhlas|čítajte aj|"
    r"čo dnes .* čaká|dnešný horoskop pre znamenie|charakteristika znamenia|zdroj:",
    re.I,
)
_HEADINGS = re.compile(r"^(láska|vzťahy|práca|kariéra|zdravie|peniaze|financie|rodina|tip dňa)\b", re.I)

_cache: dict = {}
_paths: dict = {}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Mobile Safari/537.36",
    "Accept-Language": "sk-SK,sk;q=0.9",
}


class HoroscopeError(Exception):
    pass


def _get(url: str) -> str:
    try:
        r = httpx.get(url, headers=HEADERS, timeout=12, follow_redirects=True)
    except httpx.HTTPError as e:
        raise HoroscopeError(f"noviny.sk sú nedostupné: {e}") from e
    if r.status_code != 200:
        raise HoroscopeError(f"noviny.sk vrátili chybu {r.status_code}")
    return r.text


def _path_for(sign: str) -> str:
    known = SIGNS[sign][2]
    if known:
        return known
    if sign not in _paths:
        html = _get(f"{BASE}/horoskopy")
        for m in re.finditer(r"/horoskopy/(?:denny/)?(\d+-[a-z]+)", html):
            _paths[m.group(1).split("-", 1)[1]] = m.group(1)
    if sign not in _paths:
        raise HoroscopeError(f"Na noviny.sk sa nenašla stránka pre znamenie {SIGNS[sign][0]}")
    return _paths[sign]


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


_BLOCKS = {"div", "section", "article", "p", "ul", "ol", "li", "table", "h1", "h2", "h3", "h4", "h5", "h6"}
_SLOVAK = re.compile(r"[áäčďéíľĺňóôŕšťúýž]", re.I)


def _to_section(text: str, title):
    # nadpis v tvare „Láska: text…“ priamo v odseku
    m = re.match(r"^([A-ZÁČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ][a-záäčďéíľĺňóôŕšťúýž ]+?)\s*:\s*(.+)$", text)
    if m and _HEADINGS.match(m.group(1)):
        return {"title": m.group(1), "text": m.group(2)}
    return {"title": title, "text": text}


def _good(text: str) -> bool:
    return len(text) >= 50 and not _SKIP.search(text) and bool(_SLOVAK.search(text))


def _from_html(root, tags):
    """Prejde prvky v poradí, nadpisy (Láska, Práca…) priradí k nasledujúcemu textu."""
    sections, seen, title = [], set(), None
    for el in root.find_all(["h2", "h3", "h4", "h5", "strong", "b"] + tags):
        text = _clean(el.get_text(" "))
        if not text:
            continue
        if el.name in ("h2", "h3", "h4", "h5", "strong", "b") and len(text) < 40:
            title = text.rstrip(":") if _HEADINGS.match(text) else None
            continue
        if el.name not in tags:
            continue
        if len(text) < 40 and _HEADINGS.match(text):
            title = text.rstrip(":")
            continue
        if el.name in ("div", "span", "section"):
            # len „listové“ bloky bez ďalších blokov vo vnútri, inak by sa text opakoval
            if el.find(lambda t: t.name in _BLOCKS) or (el.parent and el.parent.name in ("p", "li")):
                continue
        if not _good(text) or text in seen or any(text in x for x in seen):
            continue
        seen.add(text)
        sections.append(_to_section(text, title))
        title = None
        if len(sections) >= 6:
            break
    return sections


def _walk_json(obj, keys=("articleBody", "description", "text")):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in keys and isinstance(v, str):
                yield v
            else:
                yield from _walk_json(v, keys)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_json(v, keys)


def _from_scripts(scripts):
    """Text horoskopu môže byť aj v JSON dátach vložených do stránky (JSON-LD, Next.js, …)."""
    out = []
    for raw in scripts:
        texts = []
        try:
            texts = list(_walk_json(json.loads(raw)))
        except (ValueError, TypeError):
            for m in re.finditer(r'"(?:text|content|body|description|perex|horoscope|articleBody)"\s*:\s*"((?:[^"\\]|\\.){80,})"', raw):
                try:
                    texts.append(json.loads('"' + m.group(1) + '"'))
                except ValueError:
                    pass
        for t in texts:
            t = _clean(BeautifulSoup(t, "html.parser").get_text(" "))
            for part in re.split(r"(?<=[.!?])\s+(?=(?:Láska|Práca|Zdravie|Peniaze|Financie|Vzťahy|Kariéra)\s*:)", t):
                if _good(part) and part not in [o["text"] for o in out]:
                    out.append(_to_section(part, None))
    return out[:6]


def _extract(html: str):
    """Vráti (časti horoskopu, použitá metóda, diagnostika)."""
    soup = BeautifulSoup(html, "html.parser")
    scripts = [s.string or s.get_text() for s in soup.find_all("script")]
    ld = [s.string or s.get_text() for s in soup.find_all("script", type="application/ld+json")]
    meta = soup.find("meta", attrs={"property": "og:description"}) or soup.find("meta", attrs={"name": "description"})
    page_title = _clean(soup.title.get_text()) if soup.title else ""
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "aside", "form", "iframe", "svg"]):
        tag.decompose()
    body = soup.body or soup
    root = soup.find("article") or soup.find("main") or body

    attempts = [
        ("odseky", lambda: _from_html(root, ["p"])),
        ("odseky-celá-stránka", lambda: _from_html(body, ["p", "li"])),
        ("bloky", lambda: _from_html(root, ["p", "li", "div", "span", "section"])),
        ("bloky-celá-stránka", lambda: _from_html(body, ["p", "li", "div", "span", "section"])),
        ("json-ld", lambda: _from_scripts(ld)),
        ("skripty", lambda: _from_scripts(scripts)),
    ]
    sections, method = [], None
    for name, fn in attempts:
        sections = fn()
        if sections:
            method = name
            break

    diag = {
        "title": page_title,
        "html_length": len(html),
        "method": method,
        "meta_description": meta.get("content") if meta else None,
        "paragraphs": [_clean(p.get_text(" "))[:200] for p in body.find_all("p")][:30],
        "body_text_start": _clean(body.get_text(" "))[:1500],
        "script_texts": [x["text"][:200] for x in _from_scripts(scripts)][:10],
    }
    return sections, method, diag


def today(sign: str, debug: bool = False) -> dict:
    sign = (sign or "").lower()
    if sign not in SIGNS:
        raise ValueError("Neznáme znamenie")
    day = datetime.now(TZ).date().isoformat()
    key = (sign, day)
    if key in _cache and not debug:
        return _cache[key]

    url = f"{BASE}/horoskopy/denny/{_path_for(sign)}"
    html = _get(url)
    sections, method, diag = _extract(html)
    name, symbol, _ = SIGNS[sign]
    if debug:
        return {"url": url, "sections": sections, **diag}
    if not sections:
        raise HoroscopeError("Na stránke sa nenašiel text horoskopu (noviny.sk asi zmenili vzhľad).")

    result = {"sign": sign, "name": name, "symbol": symbol, "date": day, "sections": sections, "source": url}
    if len(_cache) > 50:
        _cache.clear()
    _cache[key] = result
    return result
