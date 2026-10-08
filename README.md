# Môj priestor

Osobná aplikácia na projekty a veci zo života – **elektronika, 3D projekty, tvorba webov, dokumenty (PDF),
pokroky, práca, škola (čo treba deťom do školy) a účty**. Sekcie si pridávaš sám priamo v aplikácii.
Má vstavaného **AI asistenta** (Claude), ktorý vie čítať aj zapisovať do sekcií
(„zapíš do školy: v piatok výkres“, „ktoré účty nie sú zaplatené?“).

Všetky dáta aj súbory sa ukladajú ako commity do **tvojho GitHub repozitára**.

| Časť | Technológia |
|---|---|
| Backend | Python – FastAPI (`backend/`), Vercel serverless funkcia (`api/index.py`) |
| Frontend | PWA bez buildu – HTML/CSS/JS (`public/`) |
| Úložisko | GitHub repozitár (JSON + súbory), lokálne `.data/` |
| Asistent | Claude API (`backend/assistant.py`) |
| Android | Capacitor → APK, buildí GitHub Actions (`mobile/`, `.github/workflows/android.yml`) |

---

## 1. Repozitár na dáta

1. Na GitHube vytvor **nový súkromný repozitár**, napr. `mojprojekt-data` (zaškrtni *Add a README*).
   > Dáta nedávaj do tohto repozitára s kódom – každé uloženie by spustilo nový deploy na Verceli.
2. Vytvor token: GitHub → Settings → Developer settings → **Fine-grained tokens** → *Generate new token*
   - Repository access: *Only select repositories* → `mojprojekt-data`
   - Permissions → Repository → **Contents: Read and write**

## 2. Nasadenie na Vercel

1. [vercel.com/new](https://vercel.com/new) → importuj repozitár `mojprojekt` (Framework preset: *Other*).
2. V **Environment Variables** nastav:

| Premenná | Hodnota |
|---|---|
| `APP_PASSWORD` | heslo do aplikácie (povinné) |
| `GITHUB_TOKEN` | token z kroku 1 |
| `GITHUB_DATA_REPO` | `tvoje-meno/mojprojekt-data` |
| `ANTHROPIC_API_KEY` | kľúč z [console.anthropic.com](https://console.anthropic.com) – zapne asistenta |
| `GITHUB_DATA_BRANCH` | *(voliteľné)* vetva, predvolene `main` |
| `ANTHROPIC_MODEL` | *(voliteľné)* model asistenta, predvolene `claude-opus-5-5` |
| `APP_SECRET` | *(voliteľné)* tajomstvo na podpis prihlásenia; inak sa odvodí z hesla |

3. Deploy. Aplikácia beží na `https://<nazov>.vercel.app`.

## 3. Android APK

1. V tomto repozitári: **Settings → Secrets and variables → Actions → Variables → New variable**
   `APP_URL` = `https://<nazov>.vercel.app`
2. **Actions → Android APK → Run workflow.**
3. Po ~5 minútach je APK v **Releases** (`MojPriestor.apk`) – otvor to v mobile, stiahni a nainštaluj
   (povoľ „inštalácia z neznámych zdrojov“).

APK načítava aplikáciu z Vercelu, takže každá zmena vzhľadu či funkcií sa prejaví aj v mobile bez novej inštalácie.
Alternatíva bez APK: otvor stránku v Chrome → ⋮ → **Pridať na plochu** (PWA).

## Vlastný vzhľad

- **Farby, písmo, zaoblenie, pozadie** – `public/css/theme.css` (všetko sú CSS premenné).
  Vlastné pozadie: `--bg-image: url("/assets/custom/pozadie.jpg");`
- **Vlastné ikony a grafika** – nahraj do `public/assets/custom/` a v Nastaveniach → sekcia → Ikona
  zadaj `/assets/custom/moja-ikona.png` (alebo emoji 🔧).
- **Nové vektorové ikony** – doplň do `public/js/icons.js` (objekt `ICONS`, ikona 24×24).
- **Ikona aplikácie** – nahraď PNG v `public/assets/icons/` a `mobile/assets/`
  (alebo uprav a spusti `python tools/make_icons.py`).

## Typy sekcií

| Typ | Na čo | Polia |
|---|---|---|
| Projekty | elektronika, 3D, weby | stav, % hotovo, štítky, odkazy, prílohy |
| Dokumenty | PDF, skeny | dátum, štítky, súbory (PDF sa zobrazí priamo v appke) |
| Zoznam úloh | škola – čo treba pripraviť | na kedy, pre koho, odškrtávanie |
| Práca / úlohy | pracovné úlohy | priorita, termín |
| Účty a platby | faktúry, nájom, energie | suma, splatnosť, opakovanie (po zaplatení sa vytvorí ďalšia platba) |
| Pokroky | denník pokrokov | dátum, hodnotenie |
| Poznámky | čokoľvek iné | text, štítky |

## Ako sú uložené dáta (v dátovom repozitári)

```
data/sections.json           – zoznam sekcií
data/items/<sekcia>.json     – položky
files/<sekcia>/<položka>/…   – prílohy
```
Každá zmena = jeden commit, takže máš celú históriu a zálohu.

## Lokálne spustenie

```bash
pip install -r requirements.txt uvicorn
uvicorn api.index:app --reload     # http://localhost:8000
```
Bez `GITHUB_TOKEN` sa dáta ukladajú do `.data/`, bez `APP_PASSWORD` sa lokálne nepýta heslo.

## Obmedzenia

- Max veľkosť jedného súboru je **4 MB** (limit Vercelu).
- Pôvodná Django aplikácia na rozpočet je presunutá v `legacy_django/`.
