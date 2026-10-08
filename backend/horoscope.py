"""Denný horoskop z noviny.sk.

noviny.sk nemá API ani RSS, preto sa text vyberá priamo z HTML stránky znamenia.
Ak noviny.sk zmenia vzhľad stránky, treba upraviť funkciu _extract().
Horoskop sa drží v pamäti do konca dňa, aby sme ich zbytočne nezaťažovali.
"""
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


def _extract(html: str):
    """Vráti zoznam častí [{"title": str|None, "text": str}] a kandidátov na ladenie."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "aside", "form", "iframe"]):
        tag.decompose()
    root = soup.find("article") or soup.find("main") or soup.body or soup

    sections, candidates, title = [], [], None
    for el in root.find_all(["h2", "h3", "h4", "strong", "b", "p"]):
        text = _clean(el.get_text(" "))
        if not text:
            continue
        if el.name in ("h2", "h3", "h4", "strong", "b") and len(text) < 40:
            title = text.rstrip(":") if _HEADINGS.match(text) else None
            continue
        if el.name != "p":
            continue
        candidates.append(text[:200])
        if len(text) < 50 or _SKIP.search(text):
            continue
        # nadpis v tvare „Láska: text…“ priamo v odseku
        m = re.match(r"^([A-ZÁČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ][a-záäčďéíľĺňóôŕšťúýž]+)\s*:\s*(.+)$", text)
        if m and _HEADINGS.match(m.group(1)):
            sections.append({"title": m.group(1), "text": m.group(2)})
        else:
            sections.append({"title": title, "text": text})
        title = None
        if len(sections) >= 6:
            break
    return sections, candidates


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
    sections, candidates = _extract(html)
    name, symbol, _ = SIGNS[sign]
    if debug:
        return {"url": url, "sections": sections, "candidates": candidates[:40]}
    if not sections:
        raise HoroscopeError("Na stránke sa nenašiel text horoskopu (noviny.sk asi zmenili vzhľad).")

    result = {"sign": sign, "name": name, "symbol": symbol, "date": day, "sections": sections, "source": url}
    if len(_cache) > 50:
        _cache.clear()
    _cache[key] = result
    return result
