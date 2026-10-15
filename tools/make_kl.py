"""Doplní samostatné karty KL (K-bus) a spojky BK/BC do public/data/beckhoff.json.

Zdroj zapojenia: tools/kl_source.json (rešerš dokumentácie Beckhoff – stránky „Contact assignment“).
Slovenské texty: pri karte s rovnakým EL ekvivalentom sa preberú z EL, inak sú tu nižšie.
Skript je opakovateľný – vygenerované položky (gen = "kl") pri ďalšom spustení nahradí.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/data/beckhoff.json"
SRC = json.loads((ROOT / "tools/kl_source.json").read_text())
KEEP = {"KL9010", "BK9100"}  # už sú v katalógu, ručne spísané

DATA = [x for x in json.loads(OUT.read_text()) if x.get("gen") != "kl"]
BY = {x["id"]: x for x in DATA}

# ---------- texty kariet bez EL ekvivalentu (alebo s iným zapojením) ----------
CARD = {
    "KL1104": ("4-kanálová digitálna vstupná svorka 24 V DC",
               "Štyri vstupy 24 V s bodmi +24 V a 0 V na napájanie snímačov – pre tlačidlá, koncáky aj 3-vodičové snímače.",
               ["Filter 3 ms", "Typ 1/3 (EN 61131-2)", "2- a 3-vodičové pripojenie", "Pozitívne spínanie"]),
    "KL1114": ("4-kanálová rýchla digitálna vstupná svorka 24 V DC",
               "Ako KL1104, ale s krátkym filtrom 0,2 ms – pre rýchle signály (štrbinové závory, impulzy).",
               ["Filter 0,2 ms", "Typ 1/3 (EN 61131-2)", "2- a 3-vodičové pripojenie", "Pozitívne spínanie"]),
    "KL2134": ("4-kanálová digitálna výstupná svorka 24 V DC, 0,5 A",
               "Štyri výstupy 24 V / 0,5 A s bodmi +24 V a 0 V – na cievky relé, ventily a kontrolky.",
               ["0,5 A na kanál, odolné voči skratu", "Ochrana proti prepólovaniu", "Výstupy napájané z +24 V kontaktu", "2- a 3-vodičové pripojenie"]),
    "KL2602": ("2-kanálová reléová výstupná svorka 230 V AC, spínacie kontakty",
               "Dve relé so spínacím kontaktom, ktoré spínajú napätie privedené na napájacie kontakty (230 V AC alebo 24 V DC).",
               ["2× spínací kontakt (NO)", "Do 230 V AC / 30 V DC", "Spína napätie z napájacích kontaktov", "Pred svorku oddeľovaciu svorku (iné napätie)"]),
    "KL2531": ("Svorka pre krokový motor 24 V, 1,5 A",
               "Priamo napája a riadi dvojfázový krokový motor do 1,5 A z napájacích kontaktov; má dva vstupy pre koncové spínače.",
               ["Prúd motora max. 1,5 A na fázu", "Napájanie motora 24 V z napájacích kontaktov", "Body 3 a 7 = snímanie vinutí (Sense), nie napájanie", "2 digitálne vstupy 24 V"]),
    "KL2541": ("Svorka pre krokový motor 48 V, 5 A s rozhraním snímača",
               "Riadi dvojfázový krokový motor do 5 A (8…48 V) a číta inkrementálny snímač. Pre výkonnejšie polohovacie osi so spätnou väzbou.",
               ["Prúd motora max. 5 A na fázu", "Napájanie motora 8…48 V DC (body 4'/8')", "Vstup inkrementálneho snímača A, B, C (24 V)", "2 digitálne vstupy 24 V"]),
    "KL2634": ("4-kanálová reléová výstupná svorka, spínacie kontakty",
               "Štyri relé s bezpotenciálovým spínacím kontaktom do 250 V AC / 30 V DC – na spínanie cudzích obvodov.",
               ["4× spínací kontakt (NO)", "Do 250 V AC / 30 V DC", "4 A odporová / 2 A induktívna záťaž", "Napájacie kontakty neprechádzajú ďalej"]),
    "KL3062": ("2-kanálová analógová vstupná svorka 0…10 V",
               "Dva napäťové vstupy 0…10 V so spoločnou zemou GND a tienením. Snímače napájaj z iných svoriek (napr. KL9186/KL9187).",
               ["Rozlíšenie 12 bit", "Jednopólové (single-ended)", "Rozsah 0…10 V", "Body 2 a 6 sa nepoužívajú"]),
    "KL3312": ("2-kanálová vstupná svorka pre termočlánky",
               "Meria teplotu dvoma termočlánkami (typ J, K, L, …) s kompenzáciou studeného konca; každý kanál má +TC, −TC, GND a tienenie.",
               ["Rozlíšenie 0,1 °C", "Termočlánky J, K, L, B, E, N, R, S, T, U; aj mV", "2-vodičové pripojenie", "Detekcia prerušenia vodiča"]),
    "KL9110": ("Napájacia svorka 24 V DC s poistkou a diagnostikou",
               "Preruší napájacie kontakty zľava a privedie nové 24 V / 0 V / PE pre svorky vpravo; má poistku a hlási prítomnosť napätia.",
               ["Max. 24 V DC / 10 A", "Integrovaná poistka", "Stav napätia v procesnom obraze", "Nová skupina potenciálov"]),
    "KL9188": ("Rozdeľovacia svorka potenciálu 16× 24 V",
               "16 bodov spojených s +24 V napájacím kontaktom – na rozvod +24 V pre snímače a 1-vodičové HD karty.",
               ["16 bodov +24 V", "Bez procesného obrazu", "Max. 10 A", "Napájacie kontakty prechádzajú ďalej"]),
    "KL9189": ("Rozdeľovacia svorka potenciálu 16× 0 V",
               "16 bodov spojených s 0 V napájacím kontaktom – na rozvod 0 V pre snímače a záťaže.",
               ["16 bodov 0 V", "Bez procesného obrazu", "Max. 10 A", "Napájacie kontakty prechádzajú ďalej"]),
    "KL9400": ("Napájacia svorka K-bus + napájacie kontakty",
               "Dopĺňa napájanie K-busu pri dlhých radoch svoriek a zároveň privádza nové 24 V / 0 V / PE na napájacie kontakty.",
               ["Napája K-bus (Us)", "Napájacie kontakty max. 24 V / 10 A", "Pri dlhých radoch KL svoriek", "Zapojenie odvodené – over potlač"]),
    "BK9000": ("Ethernet TCP/IP Bus Coupler pre K-bus",
               "Pripája rad svoriek KL k sieti Ethernet (Modbus TCP / ADS) – jeden port RJ45.",
               ["1× RJ45", "Us 24 V DC", "Napájacie kontakty max. 24 V / 10 A", "Až 64 svoriek KL"]),
    "BK9050": ("Kompaktný Ethernet TCP/IP Bus Coupler",
               "Úsporná spojka Ethernet (Modbus TCP / ADS) pre rad svoriek KL s dvoma portmi.",
               ["2× RJ45 (switch)", "Us 24 V DC", "Napájacie kontakty max. 24 V / 10 A", "Kompaktná verzia (44 mm)"]),
    "BK3150": ("PROFIBUS Bus Coupler pre K-bus",
               "Pripája rad svoriek KL k zbernici PROFIBUS DP – adresa sa nastavuje otočnými prepínačmi.",
               ["PROFIBUS DP, D-Sub 9", "Us 24 V DC", "Napájacie kontakty max. 24 V / 10 A", "Až 64 svoriek KL"]),
    "BC9000": ("Ethernet Bus Terminal Controller (s PLC)",
               "Spojka Ethernet so zabudovaným PLC (TwinCAT) – rad svoriek KL vie riadiť aj samostatne.",
               ["Ethernet, Modbus TCP / ADS", "Zabudované PLC (IEC 61131-3)", "Us 24 V DC", "Napájacie kontakty max. 24 V / 10 A"]),
    "BK1120": ("EtherCAT Bus Coupler pre K-bus",
               "Pripojí rad starších svoriek KL do siete EtherCAT – hodí sa pri modernizácii.",
               ["2× RJ45 (EtherCAT IN/OUT)", "Us 24 V DC", "Napájacie kontakty max. 24 V / 10 A", "Až 64 svoriek KL"]),
}

# ---------- preklad popisov vývodov ----------
def points(s):
    return re.findall(r"\d+'?", s)


def conn(en):
    """„internally connected to point 6 and the + power contact“ → „; spojené s bodom 6 a + napájacím kontaktom“"""
    m = re.search(r"(?:connected|bridged|tied) to (?:terminal )?(?:points? )?([\d' ,/and]+)", en)
    out = []
    if m:
        pts = points(m.group(1))
        if pts:
            out.append(("s bodom " if len(pts) == 1 else "s bodmi ") + ", ".join(pts))
    if re.search(r"\+ power contact", en):
        out.append("+ napájacím kontaktom")
    elif re.search(r"[−-] power contact", en):
        out.append("− napájacím kontaktom")
    elif re.search(r"PE power contact", en):
        out.append("PE kontaktom")
    return ("; spojené " + " a ".join(out)) if out else ""


def pin_sk(label, kind, en):
    L, e = label, en
    if re.fullmatch(r"n\.c\.|—", L) or e.lower().startswith(("not used", "not connected")):
        return "Nepoužíva sa (nezapájať)."
    if "all points same potential" in e:
        return f"{'+24 V' if '+24' in L else '0 V'} z napájacieho kontaktu – všetky body majú rovnaký potenciál."
    if L.startswith("Us +24") or L == "Us 24 V":
        return "+24 V napájanie spojky / K-busu (Us)."
    if L == "Us 0 V":
        return "0 V napájania spojky / K-busu (Us)."
    if L in ("Up +",):
        return "+24 V pre napájacie kontakty (Up)" + conn(e) + "."
    if L in ("Up −", "Up -"):
        return "0 V pre napájacie kontakty (Up)" + conn(e) + "."
    if e.startswith("Infeed"):
        return f"Prívod {'+24 V' if '+24' in L else '0 V'} pre nové napájacie kontakty" + conn(e) + "."
    if e.startswith("Ground for output"):
        n = re.search(r"output (\d+)", e).group(1)
        return f"0 V pre záťaž výstupu {n} (spojené s 0 V napájacím kontaktom)."
    if L == "+24 V":
        return ("+24 V napájanie snímača" if "sensor" in e else "+24 V") + conn(e) + "."
    if L == "0 V":
        return ("0 V snímača" if "sensor" in e else "0 V") + conn(e) + "."
    if L == "PE":
        return "PE (ochranný vodič / uzemnenie)" + conn(e) + "."
    if L == "Shield":
        return "Tienenie kábla / PE" + conn(e) + "."
    if L == "GND":
        t = "Spoločná zem (GND) analógových vstupov" + conn(e)
        if "non-earthed" in e:
            t += "; pri neuzemnenom termočlánku prepoj GND, tienenie a −TC"
        return t + "."
    m = re.fullmatch(r"\+?Input (\d+)", L)
    if m and kind == "ain":
        return f"{'Prúdový' if 'Current' in e else 'Napäťový'} vstup kanála {m.group(1)}."
    if m:
        return f"Vstup {m.group(1)} – signál zo snímača alebo kontaktu (24 V)."
    m = re.fullmatch(r"Output (\d+) \(0 V switching\)", L)
    if m:
        return f"Výstup {m.group(1)} spína na 0 V – záťaž zapoj medzi tento bod a +24 V."
    m = re.fullmatch(r"Output (\d+)'?", L)
    if m and "Relay" in e:
        side = "druhá strana kontaktu" if "other" in e else "spínaný výstup"
        return f"Relé {m.group(1)} – {side} (poloha odvodená, over potlač)."
    if m:
        return f"Výstup {m.group(1)} – spína +24 V na záťaž."
    m = re.fullmatch(r"([+-])TC(\d)", L)
    if m:
        return f"Termočlánok kanál {m.group(2)}, {'+' if m.group(1) == '+' else '−'} vodič."
    m = re.fullmatch(r"RL(\d)", L)
    if m:
        return f"Kompenzácia vedenia RL{m.group(1)} (3-vodičové PT100); pri 2-vodičovom prepoj s +R{m.group(1)}."
    m = re.fullmatch(r"Relay (\d) (NO|COM|NC)", L)
    if m:
        k, t = m.groups()
        return {"NO": f"Spínací kontakt relé {k} – spojí sa so stredom, keď LED svieti.",
                "COM": f"Stredný (spoločný) kontakt relé {k}.",
                "NC": f"Rozpínací kontakt relé {k} – spojený so stredom, keď LED nesvieti."}[t]
    m = re.fullmatch(r"(\d)(\d)", L)
    if m and kind == "relay":
        return f"Relé {m.group(1)}, kontakt {L}{' (poloha odvodená, over potlač)' if 'assumed' in e else ''}."
    if L == "L / +":
        return "Prívod L / + pre kontakt relé z napájacieho kontaktu (poloha odvodená)."
    if L == "N":
        return "N / 0 V (poloha odvodená, over potlač)."
    m = re.fullmatch(r"I_(L\d|N)", L)
    if m:
        return "Spoločný bod (hviezda) prúdových transformátorov; spojené s N." if m.group(1) == "N" else f"Vstup prúdového transformátora fázy {m.group(1)} (sekundár 1 A)."
    fixed = {
        "Clock": "Počítací vstup (Clock).",
        "Up/Down / Gate / Clock1": "Podľa režimu: smer hore/dole, gate alebo druhý počítací vstup (Clock1).",
        "Enc +": "Napájanie snímača + (24 V z napájacieho kontaktu).",
        "Enc 0 V": "Napájanie snímača 0 V (z − napájacieho kontaktu).",
        "Motor supply +": "Napájanie výkonového stupňa motora + (max. 48 V DC).",
        "Motor supply 0 V": "Napájanie výkonového stupňa motora 0 V.",
        "Sense A": "Snímanie vinutia A (bez externej záťaže).",
        "Sense B": "Snímanie vinutia B (bez externej záťaže).",
        "Status": "Stavový vstup 5 V (chybový výstup snímača, aktívny v nule).",
    }
    if L in fixed:
        return fixed[L]
    return None  # použije sa popis z EL alebo anglický text


KIND = {"relay": "contact", "gnd": "0V", "rtd": "sensor", "tc": "sensor", "enc": "sensor", "com": "comm", "motor": "out", "none": "nc"}


def kind_of(p):
    if p["label"] == "Shield":
        return "shield"
    return KIND.get(p["kind"], p["kind"])


# ---------- LED ----------
def led_sk(name, en):
    m = re.match(r"On: normal operation of channel (\d)", en)
    if m:
        return f"Svieti: kanál {m.group(1)} pracuje; nesvieti: watchdog – 100 ms bez dát z Bus Couplera."
    m = re.match(r"Channel (\d): (.*)", en)
    if m:
        k, t = m.groups()
        if "wire break" in t and "thermocouple" in t:
            return f"Kanál {k}: svieti pri prerušení termočlánku."
        if "short circuit or wire break" in t:
            return f"Kanál {k}: svieti pri skrate alebo prerušení vodiča snímača."
        if "20.8" in t:
            return f"Kanál {k}: svieti pri prúde nad 20,8 mA (preťaženie); prerušenie vodiča hlási stavový bajt."
        if "21.5" in t:
            return f"Kanál {k}: svieti pri prekročení rozsahu (> 21,5 mA), preťažení alebo prerušení vodiča."
        if "> 20 mA" in t:
            return f"Kanál {k}: svieti, keď je prúd mimo rozsahu (> 20 mA)."
    if en.startswith("One LED per channel") or en.startswith("On = "):
        if "input pulled to 0 V" in en:
            return "Jedna LED na kanál; svieti: vstup je stiahnutý na 0 V (signál „1“)."
        if "relay contact closed" in en:
            return "Jedna LED na kanál; svieti: kontakt relé zopnutý."
        if "output switched on" in en:
            return "Svieti: výstup je zapnutý."
        if "input signal" in en or "input/output" in en:
            return "Svieti: na vstupe je signál „1“ (24 V)."
    if "contact 2–1" in en:
        return "Svieti: zopnutý kontakt 2–1 (6–5); nesvieti: zopnutý 2–3 (6–7). Pri výpadku K-busu na 100 ms zhasne."
    T = {
        "Up/down, gate or CLOCK1 input active (by mode)": "Aktívny vstup hore/dole, gate alebo CLOCK1 (podľa režimu).",
        "Clock input active": "Aktívny počítací vstup.", "Output 1 on": "Výstup 1 zapnutý.", "Output 2 on": "Výstup 2 zapnutý.",
        "Output 1 state; brightness follows duty cycle": "Stav výstupu 1; jas zodpovedá striede PWM.",
        "Output 2 state; brightness follows duty cycle": "Stav výstupu 2; jas zodpovedá striede PWM.",
        "Input A active": "Aktívny vstup A.", "Input B active": "Aktívny vstup B.", "Input C active": "Aktívny vstup C (nulová značka).",
        "24 V at latch input": "24 V na vstupe Latch.", "24 V at gate input": "24 V na vstupe Gate.", "Status input state": "Stav vstupu Status.",
        "5 V encoder supply present": "Napájanie snímača 5 V je prítomné.",
        "Transmitting": "Vysielanie dát.", "Receiving": "Príjem dát.", "Operation": "Prevádzka.",
        "Communication/operation": "Komunikácia / prevádzka.",
        "K-bus data exchange active": "Prebieha výmena dát po K-buse.", "K-bus data exchange": "Prebieha výmena dát po K-buse.",
        "24 V supply present and motor control enabled": "24 V je prítomné a riadenie motora povolené.",
        "48 V motor supply present, control enabled": "Napájanie motora prítomné, riadenie povolené.",
        "Motor control enabled, ready": "Riadenie motora povolené, pripravené.", "Motor control enabled": "Riadenie motora povolené.",
        "Motor turning clockwise": "Motor sa točí v smere hodín.", "Clockwise": "Otáčanie v smere hodín.",
        "Motor turning counter-clockwise": "Motor sa točí proti smeru hodín.", "Counter-clockwise": "Otáčanie proti smeru hodín.",
        "On: control disabled; 1 Hz: load angle above threshold": "Svieti: riadenie vypnuté; bliká 1 Hz: záťažový uhol nad prahom (hrozí strata krokov).",
        "On: disabled; 1 Hz: load angle above threshold": "Svieti: riadenie vypnuté; bliká 1 Hz: záťažový uhol nad prahom (hrozí strata krokov).",
        "1 Hz: configuration error": "Bliká 1 Hz: chyba konfigurácie.", "Configuration error": "Chyba konfigurácie.",
        "1 Hz: supply too low, open load or overcurrent": "Bliká 1 Hz: nízke napájanie, odpojený motor alebo nadprúd.",
        "Supply/open load/overcurrent": "Nízke napájanie, odpojený motor alebo nadprúd.",
        "Signal at input 1": "Signál na vstupe 1.", "Signal at input 2": "Signál na vstupe 2.",
        "24 V present at infeed": "Na prívode je 24 V.",
        "K-bus supply present (presumed)": "Napájanie K-busu prítomné.", "Power-contact supply present (presumed)": "Napätie na napájacích kontaktoch prítomné.",
        "Physical Ethernet link": "Fyzické spojenie Ethernet.", "Bus traffic": "Komunikácia na zbernici.",
        "Flashes slowly: DHCP/BootP active without IP; on: DIP settings invalid": "Pomaly bliká: čaká na IP z DHCP/BootP; svieti: neplatné nastavenie DIP.",
        "Watchdog state": "Stav watchdogu.", "K-bus running without error": "K-bus beží bez chyby.",
        "K-bus/terminal error; blink code = error type and terminal position": "Chyba K-busu alebo svorky; počet bliknutí = typ chyby a poloha svorky.",
        "24 V supply of coupler electronics present": "Napájanie elektroniky spojky (Us) je prítomné.",
        "24 V supply of power contacts present": "24 V na napájacích kontaktoch (Up) je prítomné.",
        "Link / traffic": "Spojenie / komunikácia.", "Network/config error": "Chyba siete alebo konfigurácie.",
        "Port 1 link/traffic": "Port 1 – spojenie / komunikácia.", "Port 2 link/traffic": "Port 2 – spojenie / komunikácia.",
        "Data received from controller": "Prijímajú sa dáta z riadiaceho systému.", "PROFIBUS data exchange": "Prebieha výmena dát PROFIBUS.",
        "Bus fault / no bus activity": "Chyba zbernice / žiadna komunikácia.", "Parameter/config error (blinks)": "Bliká: chyba parametrov alebo konfigurácie.",
        "K-bus error blink code": "Chyba K-busu (kód bliknutí).", "PLC state / watchdog (exact naming unconfirmed)": "Stav PLC / watchdog.",
        "EtherCAT state machine": "Stav EtherCAT.", "EtherCAT error": "Chyba EtherCAT.",
        "Link/activity input port": "Vstupný port – spojenie / komunikácia.", "Link/activity output port": "Výstupný port – spojenie / komunikácia.",
    }
    if en in T:
        return T[en]
    if re.match(r"(Cyclic data exchange|On in normal operation)", en):
        return "Svieti: normálna prevádzka; zhasne, ak 100 ms neprídu dáta."
    raise SystemExit(f"Chýba preklad LED: {name}: {en}")


def color(c):
    return c if c in ("green", "red", "yellow", "orange", "blue") else "green"


def power_sk(en, fam):
    if en.startswith("Lower six points"):
        return "Body 2/3 (+24 V), 6/7 (0 V) a 4/8 (PE) napájajú napájacie kontakty pre svorky vpravo (max. 24 V DC / 10 A); Up je oddelené od Us."
    if "NOT looped" in en or "not looped through" in en or "No +24 V" in en:
        return "Napájacie kontakty +24 V / 0 V sa ďalej neposielajú – za svorkou treba znova priviesť napájanie (napr. KL9100)."
    if "Relay contacts are connected to the power contacts" in en:
        return "Kontakty relé spínajú napätie z napájacích kontaktov (230 V AC / 24 V DC, N, PE) – oddeľ od 24 V svoriek oddeľovacou svorkou."
    if en.startswith("Breaks the power contacts") or en.startswith("New potential group") or en.startswith("Feeds new"):
        return "Preruší napájacie kontakty zľava a privádza nové +24 V / 0 V / PE pre svorky vpravo (max. 10 A)."
    if en.startswith("Points connected to the +24 V"):
        return "Všetky body sú spojené s +24 V napájacím kontaktom; kontakty prechádzajú ďalej."
    if en.startswith("Points connected to the 0 V"):
        return "Všetky body sú spojené s 0 V napájacím kontaktom; kontakty prechádzajú ďalej."
    if "isolated" in en and "reference ground" in en:
        return "Napájacie kontakty prechádzajú ďalej; zem vstupov je galvanicky oddelená od 0 V kontaktu."
    if "reference" in en and "0 V power contact" in en:
        return "Používa a posiela ďalej +24 V a 0 V; 0 V napájací kontakt je referenčná zem kanálov."
    if "+24 V power contact is the reference" in en:
        return "Používa a posiela ďalej +24 V a 0 V; vstupy spínajú proti +24 V kontaktu (negatívna logika)."
    if "outputs supplied via the 0 V" in en:
        return "Používa a posiela ďalej +24 V a 0 V; výstupy spínajú na 0 V kontakt."
    if "feed terminal points 2/6 and 3/7" in en or "available at points 2/6, 3/7" in en:
        return "Používa a posiela ďalej +24 V a 0 V; sú vyvedené na body 2/6 a 3/7."
    if "Outputs are fed from the +24 V" in en or "outputs fed from the +24 V" in en or "outputs supplied from power contacts" in en:
        return "Používa a posiela ďalej +24 V, 0 V a PE; výstupy sa napájajú z +24 V kontaktu."
    if "Electronics supplied from K-bus" in en or "no power contacts used" in en:
        return "Elektronika sa napája z K-busu, signály sú galvanicky oddelené (500 V)."
    if "encoder" in en.lower():
        return "24 V z napájacích kontaktov napája snímač a svorku; kontakty prechádzajú ďalej."
    if "output stage" in en or "motor stage" in en:
        return "24 V z napájacích kontaktov napája svorku a vstupy; kontakty prechádzajú ďalej."
    if en.startswith("Not documented"):
        return "Meria sieťové napätie – signálová strana je nezávislá od 24 V napájacích kontaktov."
    if "looped through" in en or "passed through" in en:
        return "Napájacie kontakty +24 V, 0 V a PE len prechádzajú ďalej."
    raise SystemExit(f"Chýba preklad napájacích kontaktov: {en}")


def fam_of(kid, el):
    if el:
        return el["family"]
    if kid.startswith(("BK", "BC", "KL9")):
        return "system"
    return {"1": "di", "2": "do", "3": "ai", "4": "ao"}.get(kid[2], "special")


norm = lambda s: re.sub(r"[\s−–-]+", "-", str(s)).lower()
gen = []
for s in SRC:
    kid = s["id"]
    if kid in KEEP:
        continue
    el_id = (s.get("matches_el") or "").split(" ")[0] or None
    el = BY.get(el_id)
    elp = {str(p["n"]): p for p in el["pins"]} if el else {}
    pins, same = [], bool(el) and len(el["pins"]) == len(s["pins"])
    for p in s["pins"]:
        q = elp.get(str(p["n"]))
        match = q is not None and norm(q["label"]) == norm(p["label"])
        same = same and match
        d = pin_sk(p["label"], p["kind"], p["desc_en"])
        if d is None and match:
            d = q["desc"].replace("E-bus", "K-bus").replace("EtherCAT", "K-bus")
        if d is None:
            raise SystemExit(f"Chýba preklad vývodu {kid} {p['label']}: {p['desc_en']}")
        label = "+RL" + p["label"][2:] if re.fullmatch(r"RL\d", p["label"]) else p["label"]
        label = re.sub(r"^-(?=(R|TC|Input))", "−", label)
        pins.append({"n": p["n"], "label": label, "kind": kind_of(p), "desc": d})
    name, desc, specs = CARD.get(kid) or (el["name"], el["desc"], [x for x in el["specs"] if not re.search(r"E-bus|EtherCAT", x)])
    desc = desc.replace("E-busu", "K-busu").replace("E-bus", "K-bus")
    pts = len(pins)
    cols = 4 if any(str(p["n"]).endswith("'") for p in pins) else 2
    rows = 8 if pts == 16 and cols == 2 else 4
    layout = {"cols": cols, "rows": rows,
              "numbering": ("ľavý stĺpec 1–4 zhora nadol, pravý 5–8" if pts == 8 else
                            "ľavý stĺpec 1–8, pravý 9–16" if rows == 8 else "ľavý konektor 1–8, pravý 1'–8'")}
    if el and el.get("layout", {}).get("rows") == rows and el.get("layout", {}).get("cols") == cols and same:
        layout = el["layout"]
    conf = s["confidence"] if s["confidence"] in ("high", "medium", "low") else "low"
    entry = {
        "id": kid, "gen": "kl", "el": [el_id] if el else [], "same_pins": same if el else None,
        "family": fam_of(kid, el), "name": name, "desc": desc, "specs": specs,
        "width_mm": s.get("width_mm") or 12, "layout": layout, "pins": pins,
        "leds": [{"name": l["name"], "color": color(l["color"]), "desc": led_sk(l["name"], l["desc_en"])} for l in s["leds"]],
        "power_contacts": power_sk(s["power_contacts_en"], None), "source": s["source"].split(" ;")[0].split("; ")[0], "confidence": conf,
    }
    gen.append(entry)
    # EL karta odkazuje na KL náhradu
    if el and kid not in el.get("kl", []):
        el.setdefault("kl", []).append(kid)

# poradie: za EL kartami, zoradené podľa čísla
DATA = [x for x in DATA if x["id"] not in {g["id"] for g in gen}] + sorted(gen, key=lambda g: (g["id"][:2] != "BK" and g["id"][:2] != "BC", g["id"]))
for x in DATA:
    if x["id"] in KEEP and x["id"] == "BK9100":
        x["el"] = ["EK1100"]
OUT.write_text(json.dumps(DATA, ensure_ascii=False, separators=(",", ":")))
print(f"{len(gen)} kariet KL/BK → {OUT} (spolu {len(DATA)})")
