# Nástenný stojan na mydlo Dettol Soft on Skin 250 ml

![náhľad](nahlad.png)

| Súbor | Popis |
|---|---|
| `dettol_stojan.stl` | hotový model na slicovanie (93,6 × 49,8 × 100 mm) |
| `dettol_stojan.scad` | parametrický zdroj pre OpenSCAD – rozmery fľaše sa dajú upraviť |
| `generate_stl.py` | to isté v Pythone (`pip install manifold3d trimesh`) |

## Pred tlačou
Model počíta s pôdorysom fľaše **85 × 40 mm** (odmerané) a vôľou 1,5 mm na stranu.
Fľašu odmerajte posuvkou v spodnej časti; ak sa líši, upravte `flasa_sirka` /
`flasa_hlbka` v `.scad` (alebo v `generate_stl.py`) a vyexportujte STL znova.

## Nastavenia tlače (Ender 3 Pro, Cura)
- **Orientácia:** vzpriamene, ako na náhľade – dno košíka na podložke. Bez podpier.
- **Materiál:** PETG (do kúpeľne, odolá vlhkosti); PLA tiež pôjde.
- Rýchly profil (~3 h, PLA): vrstva 0,28 mm, 3 steny, výplň 15 % grid, rýchlosť 65 mm/s (vonkajšia stena 35), 210 °C / 60 °C.
- Brim 5 mm odporúčaný (vysoká tenká doska).

## Montáž
- 2 skrutky Ø 4 mm so zápustnou hlavou + hmoždinky 6 mm (rozostup 56 mm).
- Alebo bez vŕtania: obojstranná montážna páska (napr. 3M VHB) na celú zadnú dosku.
- Otvory na dne odvádzajú vodu, predný výrez nechá vidieť etiketu a uľahčí vyberanie.

## Hotový profil pre Curu
`cura/Ender3Pro_Rychly_3h_PLA.curaprofile` – v Cure: **Preferences → Configure Cura → Profiles → Import**,
vyber súbor a potom ho zvoľ v paneli Print Settings (tlačiareň musí byť pridaná ako *Creality Ender-3 Pro*).

`cura/Ender3Pro_Bezpecny_PLA.curaprofile` – ak sa model odlepuje (špagety): vrstva 0,24 mm, 50 mm/s,
prvá vrstva 15 mm/s a 220 °C, podložka 65 °C, brim 10 mm, Z hop, ventilátor od 4. vrstvy. Cca 3,5–4 h.

## Odľahčená verzia do ~2 h – `dettol_stojan_lite.stl`

![náhľad lite](nahlad_lite.png)

92 × 48 × 75 mm, objem 38,7 cm³ (plná verzia 72,7 cm³). Košík 35 mm, steny 2 mm, doska 3 mm × 75 mm,
fľaša stojí na 7 mm okraji – v dne je veľký otvor (lepší odtok, menej plastu). Tlačiť s profilom
`Ender3Pro_Bezpecny_PLA` (brim 10 mm je kvôli menšej ploche dna dôležitý). Zdroj: `dettol_stojan_lite.scad`,
alebo `python generate_stl.py --lite`.
