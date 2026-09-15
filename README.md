# Gauge Flex Card

Eine Lovelace-Custom-Card nach dem Vorbild der Original-Gauge-Karte von Home Assistant –
aber mit **dynamischen Ober-/Untergrenzen** und **dynamischen Farbabschnitten**.

Kein `config-template-card`-Wrapper mehr nötig: Jeder Wert (`min`, `max`, `segments[].from`,
`segments[].color`, `value`, `name`, `unit`) darf statt einer Zahl auch eine Entity, ein
Template oder ein kleines Rechenobjekt sein.

## Installation

### Manuell
1. `gauge-flex-card.js` nach `<config>/www/` kopieren, z. B. nach
   `<config>/www/gauge-flex-card.js`.
2. **Falls der Ordner `www/` neu angelegt wurde: Home Assistant neu starten.**
   Der Pfad `/local/` wird nur beim Start registriert – sonst liefert er 404.
3. In Home Assistant: **Einstellungen → Dashboards → ⋮ → Ressourcen → Ressource hinzufügen**
   - URL: `/local/gauge-flex-card.js` (der Ordner `www` heißt in der URL `local`)
   - Typ: **JavaScript-Modul**
4. Browser-Cache leeren (Strg/Cmd + Shift + R).

Das Menü *Ressourcen* erscheint nur, wenn im eigenen Profil **Erweiterter Modus**
aktiviert ist. Läuft das Dashboard im YAML-Modus, gibt es das Menü gar nicht – dann
gehört die Ressource in die `configuration.yaml`:

```yaml
lovelace:
  mode: yaml
  resources:
    - url: /local/gauge-flex-card.js
      type: module
```

### Fehlersuche

| Symptom | Ursache |
|---|---|
| Karte taucht in der Auswahl nicht auf | Ressource fehlt oder URL stimmt nicht |
| `Custom element doesn't exist: gauge-flex-card` | dito – die Datei wurde nie geladen |
| URL im Browser direkt aufgerufen ergibt 404 | falscher Pfad, oder HA wurde nach dem Anlegen von `www/` nicht neu gestartet |
| Änderungen an der Datei wirken nicht | Browser-Cache – `?v=1.1.0` an die Ressourcen-URL hängen und hart neu laden |

Schneller Test: Die Datei muss unter
`http://<dein-ha>:8123/local/<pfad>/gauge-flex-card.js` im Browser als Quelltext erscheinen.
Ist sie geladen, steht in der Browser-Konsole der Hinweis `GAUGE-FLEX-CARD 1.1.0`.

Liegt die Datei – wie bei HACS üblich – unter
`<config>/www/community/gauge-flex-card/gauge-flex-card.js`, lautet die Ressourcen-URL
entsprechend `/local/community/gauge-flex-card/gauge-flex-card.js`.

### HACS (empfohlen)
1. HACS öffnen → ⋮ → **Benutzerdefinierte Repositories**
   - Repository: `https://github.com/luc-ass/gauge-flex-card`
   - Typ: **Dashboard**
2. In HACS nach *Gauge Flex Card* suchen und herunterladen.
3. Browser-Cache leeren (Strg/Cmd + Shift + R).

HACS legt die Datei unter `<config>/www/community/gauge-flex-card/` ab und trägt die
Ressource automatisch ein – der Schritt entfällt also.

> Vorher eine eventuell manuell kopierte Datei **und** deren Ressourcen-Eintrag entfernen.
> Wird die Karte zweimal geladen, bricht der zweite Ladevorgang mit
> `already defined` ab.

## Dein Anwendungsfall

Vorher (mit `config-template-card`) – nachher:

```yaml
type: custom:gauge-flex-card
entity: sensor.heizungskeller_auromatic_solar_kollektor
name: Kollektor
needle: true
show_limits: true
min: sensor.heizungskeller_auromatic_solar_speicherfuhler_2_unten
max:
  entity: sensor.heizungskeller_auromatic_solar_speicherfuhler_2_unten
  offset: 17
segments:
  - from: 0
    color: lightgrey
  - from:
      entity: sensor.heizungskeller_auromatic_solar_speicherfuhler_2_unten
      offset:
        entity: binary_sensor.heizungskeller_auromatic_solar_kollektorpumpe
        map:
          "on": 5
          "off": 12
    color: rgb(139, 195, 74)
grid_options:
  columns: 4
  rows: 2
```

Die Entities müssen **nicht** mehr separat aufgelistet werden – die Karte aktualisiert sich
automatisch, sobald sich einer der referenzierten Zustände ändert.

## UI-Editor

Die Karte bringt einen visuellen Editor mit – „Karte hinzufügen → Gauge Flex Card" oder das
Stift-Symbol an einer bestehenden Karte. Der Editor deckt ab:

* Entity, Name, Einheit, Attribut, Nachkommastellen, Nadel, Grenzen anzeigen, Tap-Aktion
* **Min/Max** jeweils mit Typ-Umschalter: *Fester Wert*, *Entity* (optional mit Attribut,
  Offset und Faktor), *Template* oder *YAML*
* **Farbabschnitte** als Liste mit Farbfeld, Farbvorschau, Von-Wert und Hinzufügen/Entfernen

Werte, die für die Oberfläche zu verschachtelt sind – etwa ein `offset` mit `map` –
werden im Editor als YAML-Feld angezeigt und beim Bearbeiten anderer Felder **nicht**
verändert. Zwischen Editor und YAML-Modus kann man also beliebig wechseln.

## Vorschau ohne Home Assistant

```bash
npm run preview      # baut preview.html aus der aktuellen Kartenquelle
open preview.html
```

`preview.html` führt die unveränderte Karte mit simulierten Sensorwerten aus: Regler für
Kollektor- und Speichertemperatur, Schalter für die Kollektorpumpe, dazu die aufgelösten
Werte (Skalenanfang, Skalenende, Schwelle) und das passende YAML.

## Optionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `type` | string | – | `custom:gauge-flex-card` |
| `entity` | string | – | Entity, deren Zustand angezeigt wird (Pflicht, außer `value` ist gesetzt) |
| `attribute` | string | – | Attribut statt Zustand anzeigen |
| `value` | *dynamisch* | – | Messwert komplett frei berechnen (überschreibt `entity`/`attribute`) |
| `name` | *dynamisch* | Anzeigename | Beschriftung unter dem Zeiger, `""` blendet sie aus |
| `unit` | *dynamisch* | `unit_of_measurement` | Einheit hinter dem Wert |
| `min` | *dynamisch* | `0` | Untergrenze |
| `max` | *dynamisch* | `100` | Obergrenze |
| `needle` | bool | `false` | Nadel-Modus (sonst füllender Wertbogen) |
| `segments` | Liste | – | Farbabschnitte, je mit `from` (*dynamisch*), optional `to` (*dynamisch*), `color` (*dynamisch*) und `label` (*dynamisch*) |
| `show_limits` | bool | `false` | Min-/Max-Werte an den Bogenenden einblenden |
| `precision` | number | – | Nachkommastellen des Messwerts |
| `limits_precision` | number | `0` | Nachkommastellen der Min-/Max-Beschriftung |
| `tap_action` | object | `more-info` | `more-info`, `toggle`, `navigate`, `url` oder `none` |

Segmente werden automatisch nach `from` sortiert; ein Segment reicht bis zum `from` des
nächsten bzw. bis `max`. Bereiche außerhalb von `min`/`max` werden abgeschnitten.

Das Verhalten der Segmente entspricht dem Original:

* **mit `needle: true`** werden sie als Farbbänder auf dem Bogen gezeichnet
* **ohne `needle`** zeichnet auch das Original keine Bänder – dann bestimmt der Abschnitt,
  in dem der Wert liegt, die Farbe des gefüllten Wertbogens
* beginnt der erste Abschnitt oberhalb von `min`, füllt `var(--info-color)` den Anfang
* `label` ersetzt im Nadelmodus den Zahlenwert durch einen Text, solange der Wert im
  Abschnitt liegt

## Verhältnis zum Original

Die Darstellung ist aus `src/components/ha-gauge.ts` des HA-Frontends übernommen und stimmt
bis auf die Geometrie überein: `viewBox="-50 -50 100 55"`, Bogenradius 40 um den Ursprung,
Strichstärke 12, `stroke-linecap: butt`, die gefüllte Tropfenform der Nadel, das
aufsteigende Übereinandermalen der Abschnitte samt 0,5°-Kantenglättung am rechten Ende,
der per `getBBox()` automatisch skalierte Wert im Bogen und die 1-Sekunden-Übergänge von
Nadel und Wertbogen. Auch das Verhalten ist übernommen: nicht gefundene, nicht verfügbare
oder nicht numerische Entities zeigen eine Warnung statt eines Zeigers, und die Zahl wird
über `hass.formatEntityState()` formatiert, respektiert also die in Home Assistant
eingestellte Anzeigegenauigkeit.

Bewusste Abweichungen:

| Abweichung | Grund |
|---|---|
| `min`, `max`, `segments` dürfen dynamisch sein | der eigentliche Zweck dieser Karte |
| `show_limits` beschriftet die Skalenenden | bei mitwandernden Grenzen sieht man sonst nicht, worauf sich die Nadel bezieht |
| Die Breite wird zusätzlich durch die Kachelhöhe begrenzt | das Original skaliert nur über die Breite und wird in `rows: 2` abgeschnitten |
| `precision`/`unit` überschreiben die HA-Formatierung | nur wenn gesetzt |

## Dynamische Werte

Überall dort, wo oben *dynamisch* steht, ist erlaubt:

| Schreibweise | Beispiel |
|---|---|
| Zahl / Text | `min: 10`, `color: lightgrey` |
| Entity-ID | `min: sensor.speicher_unten` |
| Jinja-Template | `min: "{{ states('sensor.speicher_unten') \| float - 2 }}"` |
| JS-Ausdruck | `min: "${parseFloat(states['sensor.speicher_unten'].state)}"` |
| Rechenobjekt | siehe unten |

### Rechenobjekt

```yaml
min:
  entity: sensor.speicher_unten   # Quelle (alternativ: value: oder template:)
  attribute: temperature          # optional: Attribut statt Zustand
  map:                            # optional: Zustand -> Wert
    "on": 5
    "off": 12
    default: 0
  factor: 1.8                     # optional: Multiplikator
  offset: 32                      # optional: Summand (selbst wieder dynamisch!)
  round: 1                        # optional: Nachkommastellen
  default: 20                     # optional: Fallback, wenn nicht auflösbar
```

Reihenfolge der Auswertung: Quelle → `map` → `factor` → `offset` → `round` → `default`.
`offset` und `factor` dürfen selbst wieder Entities, Templates oder Rechenobjekte sein –
damit lassen sich Ausdrücke wie „Speichertemperatur + (Pumpe an ? 5 : 12)" ohne
Template-Sprache abbilden.

### Jinja vs. JavaScript

* **Jinja** (`{{ ... }}`) wird vom Home-Assistant-Server gerendert und per WebSocket
  abonniert – identisch zu Template-Sensoren, also mit vollem Zugriff auf alle
  Template-Funktionen. Minimal höhere Latenz.
* **JavaScript** (`${ ... }`) wird lokal im Browser ausgewertet (wie bei der
  `config-template-card`). Verfügbare Variablen: `states`, `hass`, `user`, `entity`
  (Zustandsobjekt der Haupt-Entity), `value` (numerischer Messwert).

## Weitere Beispiele

Siehe [`examples.yaml`](examples.yaml).

## Entwicklung

```bash
npm install
npm test        # jsdom-Tests: 19x gerenderte SVG-Ausgabe, 29x Editor-Logik
npm run preview # preview.html neu bauen
```

| Datei | Zweck |
|---|---|
| `gauge-flex-card.js` | Karte **und** Editor – die einzige Datei, die HA braucht |
| `tools/preview.template.html` | Vorlage der Vorschauseite (Platzhalter für die Kartenquelle) |
| `tools/build-preview.mjs` | bettet die Kartenquelle ein und schreibt `preview.html` |
| `test/` | jsdom-Tests für Karte und Editor |

Die Karte ist bewusst eine einzelne, abhängigkeitsfreie JS-Datei – kein Build-Schritt nötig.

## Lizenz

MIT
