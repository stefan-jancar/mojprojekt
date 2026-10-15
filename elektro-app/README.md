# Elektro – samostatná aplikácia (APK pre kolegov)

Offline Android aplikácia s časťou **Elektro** z aplikácie Môj priestor:
príprava na skúšku do 1000 V (kvíz, ostrý test, kartičky), kalkulačky,
Beckhoff svorky a rozvádzač so simuláciou zapojenia a exportom do PDF.

- Kód modulov sa berie z `public/js` a `public/css` (zdieľaný s Môj priestor),
  testy z `backend/elektro_data`, katalóg svoriek z `public/data/beckhoff.json`.
- Všetko je zabalené v APK – nepotrebuje server, internet ani prihlásenie.
- Výsledky kvízov a rozvádzače sa ukladajú len v telefóne (localStorage).

## Zostavenie

APK zostavuje GitHub Actions (`.github/workflows/elektro-apk.yml`) pri každej zmene
v `main` a zverejní ho ako vydanie **„Elektro – APK N“** v Releases.

Lokálne:

```bash
cd elektro-app
npm install
node build.mjs          # poskladá www/
npm run build:apk       # potrebuje Android SDK
```

Ikony: `python tools/make_elektro_icons.py`.

## Podpis

Obe APK (Môj priestor aj Elektro) sa podpisujú stálym kľúčom zo súboru
`.github/signing/debug.keystore.enc`, ktorý sa v Actions dešifruje heslom z tajného
údaju `KEYSTORE_PASSWORD`. Vďaka tomu sa nové verzie inštalujú cez staré bez odinštalovania.
