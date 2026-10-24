# Moja plocha

Vlastná domovská obrazovka (launcher) pre Android v štýle Môjho priestoru. Je to natívna aplikácia v Kotline
bez ďalších knižníc. Je určená pre Android 8 a novší a odladená pre Xiaomi 14 s HyperOS 3 (Android 16).

## Čo vie

- **Dve plochy vedľa seba.** Prepínač hore má polohy *Plocha 1 | Obe | Plocha 2*. Pri polohe *Obe* je aktívna
  plocha zvýraznená a o trochu širšia. Medzi plochami sa prepínaš tlačidlom **⇄**, ťuknutím na plochu
  alebo potiahnutím prsta doľava či doprava.
- **Sekcie (priečinky).** Každá plocha má vlastné sekcie. Ťuknutím na hlavičku sekciu zbalíš do priečinka
  s náhľadom ikon. Cez **⋯** pri sekcii vyberieš aplikácie, sekciu premenuješ, posunieš, presunieš na druhú
  plochu, zoradíš podľa abecedy alebo vymažeš.
- **Vlastné poradie ikon.** Podrž ikonu a vyber *Posunúť dopredu/dozadu*, *Na začiatok sekcie*,
  *Presunúť do sekcie…*, prípadne *Informácie o aplikácii* alebo *Odinštalovať*.
- **Minimalizovanie plochy.** Tlačidlo **—** schová plochy a ostanú len veľké hodiny. Plochu vrátiš tlačidlom
  *Zobraziť plochu*.
- **Všetky aplikácie** s hľadaním, ktoré ignoruje diakritiku. Pri každej aplikácii vidíš, v ktorej sekcii je,
  alebo že je *nezaradená*.
- **Prvé spustenie** roztriedi aplikácie automaticky. Plocha 1 dostane Obľúbené, Komunikáciu, Sociálne, Prácu,
  Financie a Nákupy. Plocha 2 dostane Médiá, Hry, Správy, Cestovanie, Nástroje a Ostatné. Novo nainštalované
  aplikácie sa objavia v sekcii *Nové*.
- Pozadie môže byť tapeta alebo tmavé ako v Mojom priestore (⋮ → Pozadie).

Usporiadanie sa ukladá v telefóne (SharedPreferences).

## Zostavenie

APK zostavuje workflow `.github/workflows/launcher-apk.yml` pri každej zmene v `launcher/`. Je to súkromná
aplikácia, preto sa APK nezverejňuje ako vydanie (release). Stiahneš ho ako artefakt **MojaPlocha-apk**
z posledného behu workflow v záložke Actions. Musíš byť prihlásený na GitHube, artefakt sa drží 90 dní a
stiahne sa ako zip, v ktorom je APK. Ďalší beh spustíš ručne cez *Run workflow*. APK je podpísané rovnakým
kľúčom ako ostatné, takže aktualizácie sa dajú inštalovať cez starú verziu.

Lokálne (Android Studio alebo príkazový riadok s Android SDK):

```bash
cd launcher
./gradlew assembleDebug
```
