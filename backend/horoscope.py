"""Denný horoskop zo slovenských webov.

Weby nemajú API ani RSS, preto sa text vyberá priamo z HTML stránky znamenia.
Zdrojov je viac – v režime „auto“ sa použije prvý, z ktorého sa text podarí načítať.
Horoskop sa drží v pamäti do konca dňa, aby sme weby zbytočne nezaťažovali.
"""
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from bs4 import BeautifulSoup

TZ = ZoneInfo("Europe/Bratislava")

# kľúč: (názov, symbol, poradie vo zverokruhu)
SIGNS = {
    "baran": ("Baran", "♈", 1),
    "byk": ("Býk", "♉", 2),
    "blizenci": ("Blíženci", "♊", 3),
    "rak": ("Rak", "♋", 4),
    "lev": ("Lev", "♌", 5),
    "panna": ("Panna", "♍", 6),
    "vahy": ("Váhy", "♎", 7),
    "skorpion": ("Škorpión", "♏", 8),
    "strelec": ("Strelec", "♐", 9),
    "kozorozec": ("Kozorožec", "♑", 10),
    "vodnar": ("Vodnár", "♒", 11),
    "ryby": ("Ryby", "♓", 12),
}

# id: (názov, funkcia sign -> URL). Overené sú adresy pre Ryby, ostatné majú rovnaký tvar.
SOURCES = {
    "sita": ("SITA.sk", lambda s: f"https://sita.sk/horoskop/dnesny-horoskop/{s}/"),
    "sibyla": ("Sibyla – Zoznam.sk", lambda s: f"https://sibyla.zoznam.sk/horoskop/horoskop-denny/{SIGNS[s][2]}/{s}.php"),
    "moneo": ("Moneo.sk", lambda s: f"https://www.moneo.sk/horoskopy/denny-horoskop/{s}/"),
    "vsevedko": ("Vševedko.sk", lambda s: f"https://horoskop.vsevedko.sk/{s}/"),
}

# texty, ktoré nie sú samotný horoskop (reklamy, cookies, všeobecný úvod …)
_SKIP = re.compile(
    r"cookie|©|všetky práva|reklam|newsletter|prihlás|odoberajte|súhlas|čítajte aj|"
    r"čo dnes .* čaká|dnešný horoskop pre znamenie|charakteristika znamenia|zdroj:|"
    r"copyright|webdesign|s\.r\.o\.|naše horoskopy|horoskopy môžu byť|astrologickej interpretácii",
    re.I,
)
_HEADINGS = re.compile(r"^(láska|vzťahy|práca|kariéra|zdravie|peniaze|financie|rodina|tip dňa)\b", re.I)

_cache: dict = {}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Mobile Safari/537.36",
    "Accept-Language": "sk-SK,sk;q=0.9",
}


class HoroscopeError(Exception):
    pass


def _get(url: str) -> str:
    host = url.split("/")[2]
    try:
        r = httpx.get(url, headers=HEADERS, timeout=10, follow_redirects=True)
    except httpx.HTTPError as e:
        raise HoroscopeError(f"{host} je nedostupný: {e}") from e
    if r.status_code != 200:
        raise HoroscopeError(f"{host} vrátil chybu {r.status_code}")
    return r.text


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


_BLOCKS = {"div", "section", "article", "p", "ul", "ol", "li", "table", "h1", "h2", "h3", "h4", "h5", "h6"}
_SLOVAK = re.compile(r"[áäčďéíľĺňóôŕšťúýž]", re.I)


def _to_section(text: str, title):
    # nadpis v tvare „Láska: text…“ priamo v odseku
    m = re.match(r"^([A-ZÁČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ][a-záäčďéíľĺňóôŕšťúýž ]+?)\s*:\s*(.+)$", text)
    if m and _HEADINGS.match(m.group(1)):
        return {"title": m.group(1), "text": m.group(2)}
    # „Láska Úprimnosť…“ – nadpis bez dvojbodky (napr. dva spany vedľa seba)
    m = re.match(r"^(Láska|Vzťahy|Práca|Kariéra|Zdravie|Peniaze|Financie|Rodina|Tip dňa)\s+([A-ZÁČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ].+)$", text)
    if m:
        return {"title": m.group(1), "text": m.group(2)}
    return {"title": title, "text": text}


_SIGN_WORDS = re.compile(r"\b(baran|býk|blíženci|rak|lev|panna|váhy|škorpión|strelec|kozorožec|vodnár|ryby)\b", re.I)


def _good(text: str) -> bool:
    return (
        len(text) >= 50
        and not _SKIP.search(text)
        and bool(_SLOVAK.search(text))
        and len(_SIGN_WORDS.findall(text)) < 4  # menu so zoznamom znamení
    )


_HEAD_TAGS = ["h2", "h3", "h4", "h5", "strong", "b"]


def _from_html(root, tags):
    return _collect(root.find_all(_HEAD_TAGS + tags), tags)


def _from_anchor(body, sign_name: str, tags):
    """Nájde nadpis s názvom znamenia a zoberie text, ktorý nasleduje hneď za ním."""
    for h in body.find_all(["h1", "h2", "h3"]):
        if sign_name.lower() not in _clean(h.get_text(" ")).lower():
            continue
        sections = _collect(h.find_all_next(["h1"] + _HEAD_TAGS + tags, limit=300), tags, sign_name)
        if sections:
            return sections
    return []


def _collect(elements, tags, stop_sign=None):
    """Prejde prvky v poradí, nadpisy (Láska, Práca…) priradí k nasledujúcemu textu."""
    sections, seen, title = [], set(), None
    for el in elements:
        text = _clean(el.get_text(" "))
        if not text:
            continue
        # pri hľadaní od nadpisu skonči na ďalšom veľkom nadpise (iné znamenie, iný článok)
        if stop_sign and el.name in ("h1", "h2") and not _HEADINGS.match(text) and (
            sections or stop_sign.lower() not in text.lower()
        ):
            break
        if el.name == "h1":
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


def _extract(html: str, sign_name: str):
    """Vráti (časti horoskopu, použitá metóda, diagnostika)."""
    soup = BeautifulSoup(html, "html.parser")
    scripts = [s.string or s.get_text() for s in soup.find_all("script")]
    ld = [s.string or s.get_text() for s in soup.find_all("script", type="application/ld+json")]
    page_title = _clean(soup.title.get_text()) if soup.title else ""
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "aside", "form", "iframe", "svg"]):
        tag.decompose()
    body = soup.body or soup
    root = soup.find("article") or soup.find("main") or body
    blocks = ["p", "li", "div", "span", "section"]

    attempts = [
        ("za-nadpisom", lambda: _from_anchor(body, sign_name, ["p", "li"])),
        ("za-nadpisom-bloky", lambda: _from_anchor(body, sign_name, blocks)),
        ("odseky", lambda: _from_html(root, ["p"])),
        ("bloky", lambda: _from_html(root, blocks)),
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
        "paragraphs": [_clean(p.get_text(" "))[:150] for p in body.find_all("p")][:12],
        "body_text_start": _clean(body.get_text(" "))[:600],
    }
    return sections, method, diag


def _from_source(src: str, sign: str):
    url = SOURCES[src][1](sign)
    sections, method, diag = _extract(_get(url), SIGNS[sign][0])
    return url, sections, diag


def today(sign: str, source: str = "auto", debug: bool = False) -> dict:
    sign = (sign or "").lower()
    if sign not in SIGNS:
        raise ValueError("Neznáme znamenie")
    if source != "auto" and source not in SOURCES:
        raise ValueError("Neznámy zdroj horoskopu")
    order = list(SOURCES) if source == "auto" else [source]

    if debug:  # diagnostika: výsledok zo všetkých zdrojov
        out = {}
        for src in SOURCES:
            try:
                url, sections, diag = _from_source(src, sign)
                out[src] = {"url": url, "sections": [{**x, "text": x["text"][:300]} for x in sections[:3]], **diag}
            except HoroscopeError as e:
                out[src] = {"error": str(e)}
        return out

    day = datetime.now(TZ).date().isoformat()
    key = (sign, source, day)
    if key in _cache:
        return _cache[key]

    errors = []
    for src in order:
        try:
            url, sections, _ = _from_source(src, sign)
        except HoroscopeError as e:
            errors.append(str(e))
            continue
        if not sections:
            errors.append(f"{SOURCES[src][0]}: text sa nenašiel")
            continue
        name, symbol, _ = SIGNS[sign]
        result = {"sign": sign, "name": name, "symbol": symbol, "date": day, "sections": sections,
                  "source": url, "source_name": SOURCES[src][0]}
        if len(_cache) > 100:
            _cache.clear()
        _cache[key] = result
        return result
    raise HoroscopeError("Horoskop sa nepodarilo načítať – " + "; ".join(errors))
