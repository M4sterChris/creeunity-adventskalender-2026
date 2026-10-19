# CreeUnity Adventskalender

Responsive Single-Page-App für M4sterCree & die CreeUnity, vollständig mit HTML, CSS und Vanilla JavaScript. Keine Installation, kein Build und kein Backend für GitHub Pages nötig. Startjahr: **2026**.

## Lokal starten

Mit installiertem Node.js ab Version 20 im Projektordner:

```sh
node tools/serve.mjs
```

Öffne danach <http://127.0.0.1:4173>. Für den Editor: <http://127.0.0.1:4173/?admin=true>. Falls npm vorhanden ist, funktioniert auch `npm start`. `npm install` ist nicht erforderlich. Alternativ funktioniert jeder statische Webserver. Ein Doppelklick auf `index.html` reicht wegen der nachgeladenen JSON-Datei nicht aus.

## Auf GitHub Pages veröffentlichen

1. Alle Dateien einschließlich `assets/` und `.nojekyll` in ein GitHub-Repository hochladen bzw. committen.
2. Im Repository unter **Settings → Pages → Build and deployment** die Quelle **Deploy from a branch** wählen.
3. Den gewünschten Branch, z. B. `main`, und **/ (root)** auswählen und speichern.
4. Nach der Bereitstellung die von GitHub angezeigte Pages-URL öffnen.

Alle Ressourcen verwenden relative Pfade. Die App funktioniert sowohl auf einer eigenen Domain als auch unter `https://BENUTZER.github.io/REPOSITORY/`. Details: [GitHub Pages – Veröffentlichungsquelle konfigurieren](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Inhalte bearbeiten

1. An die Kalender-URL `?admin=true` anhängen.
2. Kalenderjahr, Twitch-Link und optional die tatsächliche Discord-Einladung eintragen. Ohne Einladung wird kein Discord-Link angezeigt.
3. Türchen 1–24 auswählen und Überschrift, Bildpfad, Bildbeschreibung und optionalen Text eintragen.
4. **Entwurf lokal speichern** sichert den Entwurf in diesem Browser. Nur im Admin-Modus wird er beim Laden verwendet; die normale Ansicht lädt die veröffentlichte JSON-Datei.
5. **JSON herunterladen** exportiert den gesamten aktuellen, validierten Stand, auch ohne vorheriges lokales Speichern.
6. Die heruntergeladene `doors-data.json` im Repository ersetzen und committen. Neue Bilder ebenfalls hochladen. Nach dem Pages-Deployment sind die Änderungen öffentlich.

**Wichtig:** Die 24 mitgelieferten Tagesgrafiken sind ausdrücklich Beispielgrafiken, keine echten Gewinne oder Gewinnversprechen. Vor dem Community-Start durch eure Inhalte ersetzen. Die Winterlandschaft und die Chibis sind lokale SVG-Illustrationen.

Beispiel für ein Türchen in `doors-data.json`:

```json
{
  "day": 5,
  "title": "Türchen 5 – Tagesgewinn",
  "image": "./assets/tuerchen5.png",
  "alt": "Beschreibung des Tagesgewinns und der Teilnahmeinfos",
  "text": "Hier steht dein Begleittext.\nZum Stream: https://www.twitch.tv/m4stercree"
}
```

Das JSON-Gesamtdokument enthält `version: 1`, `year`, `links` mit `twitch` und `discord` sowie genau 24 Einträge unter `doors`. Jeder Tag von 1 bis 24 darf genau einmal vorkommen. Optionaler Text kann leer sein. Keine HTML-Eingaben; vollständige HTTPS-Links werden automatisch verlinkt.

Relative Bildpfade wie `./assets/tuerchen5.png` eignen sich für GitHub-Pages-Projekte. Ein führender Slash (`/assets/…`) verweist auf den Domain-Stamm und kann bei Projekt-Repositories zum falschen Ort führen. Externe Bilder brauchen eine direkte, dauerhaft erreichbare HTTPS-Bild-URL. Temporäre Discord-CDN-Links können ablaufen. Große Grafiken möglichst als komprimiertes WebP, PNG oder JPG hochladen. Bildbeschreibungen sollten die wichtigen Informationen auch als Text zugänglich machen.

## Vorschau & Datum

Im Admin-Bereich **Vorschaumodus aktivieren**, dann ein Türchen direkt ansehen oder den Editor schließen. Alle Tage sind freigeschaltet. Der Modus gilt nur für diesen Browser-Tab mit `?admin=true` und wird in `sessionStorage` gespeichert. Er wird niemals in die JSON-Datei exportiert. **Beenden** schaltet die Datumsprüfung wieder ein. Vorschauöffnungen ändern den persönlichen Fortschritt nicht.

Die App ermittelt Datum und Jahr mit `Intl.DateTimeFormat` in **Europe/Berlin**, einschließlich Sommer-/Winterzeit. Ein Türchen öffnet im konfigurierten Kalenderjahr am jeweiligen Dezembertag um 00:00 Uhr. Vorherige Türchen bleiben verfügbar; nach dem Kalenderjahr ist der gesamte Kalender weiterhin erreichbar. Eine laufende Seite prüft den Tageswechsel automatisch. Für einen neuen Advent das Jahr in der Konfiguration ändern; Fortschritt wird pro Jahr gespeichert.

## Große Bilder & Bedienung

Die Tagesgrafik wird vollständig und unverzerrt im Dialog dargestellt. Ein Klick öffnet eine bildschirmfüllende Lightbox. **+ / −** zoomen bis auf das Fünffache der eingepassten Größe; anschließend kann gescrollt oder gewischt werden. **Einpassen / Reset** stellt die Gesamtansicht wieder her. Normaler Browser-Pinch-Zoom bleibt ebenfalls möglich. **Esc** schließt jeweils den obersten Dialog. Native Dialoge begrenzen den Tastaturfokus; reduzierte Bewegung wird berücksichtigt.

## Speicherung, Öffentlichkeit & Grenzen

- Geöffnete Türchen liegen unter `creeunity:opened:JAHR` in `localStorage`. Sie sind keine Teilnahmebestätigung für Gewinnspiele.
- Unter **Infos & Datenschutz** lässt sich der persönliche Fortschritt des aktiven Kalenderjahres mit einer zweiten Bestätigung zurücksetzen.
- Bei blockiertem Speicher funktioniert die Seite weiter; der Fortschritt bleibt dann nur während des Besuchs erhalten.
- Die App selbst setzt keine Cookies, lädt keine externen Schriftarten und verwendet kein Tracking. Fremdgehostete Bilder können beim Laden Verbindungsdaten an deren Anbieter übertragen.
- `?admin=true` ist ein lokaler Editor, **kein geschützter Admin-Login**. Besucher können ihn ebenfalls aufrufen, aber damit weder das Repository noch die Inhalte für andere Besucher verändern.
- Sämtliche Dateien auf einer statischen Website sind öffentlich abrufbar. Vertrauliche Gewinne, Zugangsdaten oder persönliche Daten gehören nicht in die JSON-Datei. Eine manipulationssichere Freigabe bzw. Serverzeit erfordert ein Backend; der Kalender nutzt die Gerätezeit, umgerechnet nach Berlin.
- Für echte Gewinnspiele Teilnahmebedingungen und die erforderlichen Betreiber-/Datenschutzhinweise ergänzen. Ohne konkrete Angaben werden hier keine erfundenen Betreiberinformationen eingesetzt.

## Struktur & Prüfung

```text
index.html            Seitenstruktur und zugängliche Dialoge
styles.css            Responsive Gestaltung, Grid und Lightbox
script.js             Kalender, Berliner Datum, Fortschritt, Admin und Zoom
doors-data.json       Veröffentlichte Kalenderinhalte
assets/
  favicon.svg         CreeUnity-Maskottchen
  winter-scene.svg    Lokale Winterlandschaft
  winter-scene-mobile.svg
  lights.svg          Festliche Lichterketten
  doors/day-01.svg … day-24.svg
tools/serve.mjs       Optionaler lokaler Entwicklungsserver
tests/calendar.test.mjs
.nojekyll             Statische Auslieferung auf GitHub Pages
```

Mit `node --test tests/calendar.test.mjs` (alternativ `npm test`) werden unter anderem Berliner Mitternacht, Sommerzeit, Jahresgrenzen, Datenvalidierung, Bilddateien und unsichere URL-Schemas geprüft. Für GitHub Pages sind weder `package.json` noch `tools/` oder `tests/` zur Laufzeit nötig.
