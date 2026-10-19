# CreeUnity Adventskalender 2026

Responsive HTML/CSS/Vanilla-JavaScript-App für M4sterCree und die CreeUnity. Die Website läuft auf GitHub Pages. Noch nicht veröffentlichte Inhalte liegen getrennt in einem privaten GitHub-Repository.

- [Öffentliche Website-Quellen](https://github.com/M4sterChris/creeunity-adventskalender-2026)
- [Private Tagesinhalte](https://github.com/M4sterChris/creeunity-adventskalender-2026-inhalte) – nur für berechtigte Personen
- Geplante Website: <https://m4sterchris.github.io/creeunity-adventskalender-2026/>

## Wie die Freigabe funktioniert

Das private Inhalte-Repository enthält die vollständige `doors-data.json` und die Tagesgrafiken unter `images/`. Seine GitHub Action prüft die Runner-Zeit in **Europe/Berlin** und überträgt ausschließlich bereits freigegebene Tage ins öffentliche Repository. Künftige Titel, Texte, Bildbeschreibungen und Bildpfade werden durch neutrale Platzhalter ersetzt. Nur freigegebene lokale Bilddateien werden kopiert. Die öffentliche Website wird danach automatisch neu bereitgestellt.

Im November/Dezember ist der erste geplante Lauf um **23:03 UTC = 00:03 Uhr Berlin am Folgetag**. Weitere Läufe um 00:18, 00:43 und 01:13 Uhr Berlin holen Verzögerungen oder ausgefallene Läufe nach. Jeder Lauf veröffentlicht alle bis dahin fälligen Tage. Ein Push mit geänderten Inhalten oder ein manueller Start der Action führt ebenfalls zu einer Prüfung – ohne künftige Türchen vorzeitig freizugeben.

GitHub kann geplante Actions und Pages-Deployments verzögern; eine sekundengenaue Veröffentlichung wird ausdrücklich nicht garantiert. Die Browseransicht prüft zusätzlich das Berliner Datum. Eine falsche Gerätezeit kann keine Inhalte sichtbar machen, die noch gar nicht auf der Website liegen. Bereits veröffentlichte Inhalte bleiben öffentlich, einschließlich der Git-Historie.

Eine geöffnete Website prüft etwa jede Minute auf neue Veröffentlichungen und erneut beim Zurückkehren zum Tab. Sobald die Action und Pages fertig sind, werden neue Inhalte ohne manuelles Neuladen verfügbar.

## Inhalte bearbeiten

1. Die Kalender-URL mit `?admin=true` öffnen. Dieser Editor ist lokal, kein geschützter Online-Login.
2. Für alle vollständigen Inhalte die JSON aus dem **privaten Inhalte-Repository** importieren. Die öffentliche Version kennt die noch geheimen Inhalte nicht.
3. Kalenderjahr, Twitch-/Discord-Link und die 24 Tagesinhalte bearbeiten. Ohne Discord-Einladung wird kein Link angezeigt.
4. Bilder im privaten Repository unter `images/` ablegen und in der JSON z. B. `./images/tuerchen5.png` eintragen. Bilder vor der Freigabe nicht ins öffentliche Repository hochladen.
5. Optional den Entwurf lokal speichern und mit dem Vorschaumodus prüfen. Vorschauöffnungen ändern den Fortschritt nicht. Lokale private Bilder werden über den privaten Vorschau-Server sichtbar (siehe unten).
6. **JSON herunterladen** und ausschließlich `doors-data.json` im **privaten** Repository ersetzen. Die Action übernimmt die tägliche Veröffentlichung.

Die 24 mitgelieferten Grafiken sind klar gekennzeichnete Beispiele, keine echten Gewinne. Vor dem Start die Beispiele im privaten Inhalte-Repository durch eure Tagesinhalte ersetzen. Die öffentliche Datei `doors-data.json` wird automatisch erzeugt und sollte nicht direkt gepflegt werden.

Beispiel eines Eintrags im privaten Repository:

```json
{
  "day": 5,
  "title": "Türchen 5 – Tagesgewinn",
  "image": "./images/tuerchen5.png",
  "alt": "Beschreibung des Tagesgewinns und der Teilnahmeinfos",
  "text": "Dein Begleittext.\nZum Stream: https://www.twitch.tv/m4stercree"
}
```

Das Gesamtdokument enthält `version: 1`, `year`, `links` mit `twitch` und `discord` sowie genau 24 Einträge unter `doors`. Jeder Tag von 1 bis 24 kommt genau einmal vor. Text kann leer sein; HTML wird nicht ausgeführt. Vollständige HTTPS-Links werden automatisch verlinkt.

Externe HTTPS-Bildlinks sind möglich und werden erst nach Freigabe im öffentlichen JSON sichtbar. Das externe Bild selbst kann jedoch bereits vorher öffentlich abrufbar sein. Für geheim zu haltende Grafiken deshalb lokale Dateien im privaten `images/`-Ordner verwenden. Signierte Discord-CDN-Links können ablaufen.

## Lokal ansehen

Node.js ab Version 20 genügt; keine Installation von npm-Paketen nötig.

Öffentlicher Website-Stand:

```sh
node tools/serve.mjs
```

Danach <http://127.0.0.1:4173/> öffnen. Vor Dezember sind alle Produktionsinhalte gesperrt.

Eine getrennte private Arbeitskopie mit Beispieldaten anlegen (vorhandene Inhalte werden nicht überschrieben):

```sh
node tools/prepare-private-repository.mjs
node tools/serve.mjs --private
```

Danach <http://127.0.0.1:4173/?admin=true> öffnen und den Vorschaumodus aktivieren. `--private` liefert die vollständigen Daten und Bilder aus `.private-repository/` ausschließlich über den an `127.0.0.1` gebundenen lokalen Server aus. Für echte Inhalte dort das private Repository verwenden. Den privaten Vorschau-Server nicht öffentlich freigeben.

Die private Arbeitskopie ist im öffentlichen Git durch `.gitignore` ausgeschlossen. Sie besitzt ein eigenes Git-Repository. Wenn beide Vorschauen gleichzeitig laufen sollen, dem zweiten Prozess eine andere `PORT`-Umgebungsvariable geben.

## GitHub-Einrichtung

Die öffentliche Website verwendet `.github/workflows/pages.yml`. Unter **Settings → Pages → Source** muss **GitHub Actions** ausgewählt sein. Die Action prüft den Code, baut ein Artefakt mit ausschließlich den öffentlichen Website-Dateien und stellt es auf Pages bereit.

Im privaten Repository liegt `.github/workflows/publish-calendar.yml`. Die Vorlage steht auch unter `templates/private-repository/`. Die Action nutzt einen eigenen SSH-Deploy-Key mit Schreibzugriff ausschließlich auf das öffentliche Website-Repository. Der private Schlüssel liegt verschlüsselt als Actions-Secret `WEBSITE_DEPLOY_KEY` im privaten Inhalte-Repository. Zugangsdaten gehören niemals in Dateien, Commits oder den Browser-Editor.

Bei einem Umzug den Repository-Namen im privaten Workflow anpassen und den Deploy-Key sowie das Secret neu einrichten. Das private Inhalte-Repository muss privat bleiben. Unter Actions prüfen, ob geplante Workflows aktiviert sind und ausreichend Runner-Kontingent vorhanden ist. Ein manueller Start von **Tagesinhalte freigeben** prüft die aktuelle Zeit und veröffentlicht nur fällige Tage.

[GitHub: Pages mit Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) · [GitHub: geplante Workflows und Verzögerungen](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Bilder, Bedienung und Fortschritt

Die Tagesgrafik wird vollständig mit `object-fit: contain` angezeigt. Ein Klick öffnet die bildschirmfüllende Lightbox. **+ / −** zoomen bis auf das Fünffache der eingepassten Größe; anschließend scrollen oder wischen. **Einpassen / Reset** stellt die Gesamtansicht wieder her. **Esc** schließt den obersten Dialog. Tastaturfokus, Bildbeschreibungen und reduzierte Bewegung werden berücksichtigt.

Geöffnete Tage werden pro Kalenderjahr unter `creeunity:opened:JAHR` in `localStorage` gespeichert. Unter **Infos & Datenschutz** lässt sich der Fortschritt zurücksetzen. Bei blockiertem Speicher funktioniert die App weiter, behält den Fortschritt aber nur während des Besuchs. Die App setzt keine Cookies und verwendet kein Tracking oder externe Schriftarten. Fremdgehostete Bilder können Verbindungsdaten an deren Anbieter übertragen.

Für echte Gewinnspiele Teilnahmebedingungen und erforderliche Betreiber-/Datenschutzhinweise ergänzen. Personenbezogene Teilnehmerdaten oder Zugangsdaten gehören auch nach der Freigabe nicht in öffentliche Tagesinhalte.

## Dateien und Tests

```text
index.html, styles.css, script.js   Responsive Website und lokaler Editor
doors-data.json                    Automatisch erzeugte öffentliche Tagesinhalte
assets/                           Winterillustration, Beispiele und freigegebene Bilder
examples/doors-data.example.json   Öffentliche, ausdrücklich fiktive Beispieldaten
tools/publish-doors.mjs            Zeitprüfung und sichere Inhaltsauswahl
tools/build-pages.mjs              Pages-Artefakt ohne private Quellen
tools/prepare-private-repository.mjs
tools/serve.mjs                    Lokale öffentliche/private Vorschau
templates/private-repository/     Vorlage des privaten Freigabe-Workflows
tests/                            Datums-, Validierungs- und Veröffentlichungstests
.private-repository/              Getrennte private Arbeitskopie; nicht im öffentlichen Git
```

```sh
node --test tests/*.test.mjs
```

Die Tests prüfen Berliner Mitternacht, Sommerzeit, Jahresgrenzen, Schema und URLs sowie insbesondere die Geheimhaltung künftiger Inhalte, Pfadgrenzen, Auswahl ausschließlich freigegebener Bilder und wiederholbare Veröffentlichungen. Das öffentliche Pages-Artefakt wird mit `node tools/build-pages.mjs` in ein zuvor leeres `_site/` erzeugt.
