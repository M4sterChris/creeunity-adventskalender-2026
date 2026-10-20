# CreeUnity Adventskalender 2026

Responsive HTML/CSS/Vanilla-JavaScript-App für M4sterCree und die CreeUnity, mit modernem Dark Mode als Standard, umschaltbarem Hellmodus und gemischten Türchen. Die Website läuft auf GitHub Pages. Noch nicht veröffentlichte Inhalte liegen getrennt in einem privaten GitHub-Repository.

- [Öffentliche Website-Quellen](https://github.com/M4sterChris/creeunity-adventskalender-2026)
- [Private Tagesinhalte](https://github.com/M4sterChris/creeunity-adventskalender-2026-inhalte) – nur für berechtigte Personen
- Geplante Website: <https://m4sterchris.github.io/creeunity-adventskalender-2026/>

## Wie die Freigabe funktioniert

Das private Inhalte-Repository enthält die vollständige `doors-data.json` und die Tagesgrafiken unter `images/`. Seine GitHub Action prüft die Runner-Zeit in **Europe/Berlin** und überträgt ausschließlich bereits freigegebene Tage ins öffentliche Repository. Künftige Titel, Texte, Bildbeschreibungen und Bildpfade werden durch neutrale Platzhalter ersetzt. Nur freigegebene lokale Bilddateien werden kopiert. Die öffentliche Website wird danach automatisch neu bereitgestellt.

Im November/Dezember ist der erste geplante Lauf um **23:03 UTC = 00:03 Uhr Berlin am Folgetag**. Weitere Läufe um 00:18, 00:43 und 01:13 Uhr Berlin holen Verzögerungen oder ausgefallene Läufe nach. Jeder Lauf veröffentlicht alle bis dahin fälligen Tage. Ein Push mit geänderten Inhalten oder ein manueller Start der Action führt ebenfalls zu einer Prüfung – ohne künftige Türchen vorzeitig freizugeben.

GitHub kann geplante Actions und Pages-Deployments verzögern; eine sekundengenaue Veröffentlichung wird ausdrücklich nicht garantiert. Die Browseransicht prüft zusätzlich das Berliner Datum. Eine falsche Gerätezeit kann keine Inhalte sichtbar machen, die noch gar nicht auf der Website liegen. Bereits veröffentlichte Inhalte bleiben öffentlich, einschließlich der Git-Historie.

Eine geöffnete Website prüft etwa jede Minute auf neue Veröffentlichungen und erneut beim Zurückkehren zum Tab. Sobald die Action und Pages fertig sind, werden neue Inhalte ohne manuelles Neuladen verfügbar.

## Inhalte bearbeiten

1. [Web-Editor öffnen](https://m4sterchris.github.io/creeunity-adventskalender-2026/?admin=true) oder unten auf der Website **Türchen verwalten** anklicken.
2. Einen [GitHub-Zugriffsschlüssel erstellen](https://github.com/settings/personal-access-tokens/new?name=CreeUnity%20Editor&target_name=M4sterChris&contents=write&expires_in=90). Unter **Only select repositories** ausschließlich `creeunity-adventskalender-2026-inhalte` wählen. Unter Repository permissions **Contents: Read and write** erlauben. Keine weiteren Rechte sind erforderlich. Den Schlüssel nicht in den Chat, URLs oder Repository-Dateien kopieren.
3. Den Schlüssel im Editor einfügen und **Privaten Kalender laden** wählen. Alle 24 vollständigen Inhalte werden direkt aus dem privaten Repository geladen. Der Vorschaumodus ist dabei automatisch aktiv.
4. Ein Türchen auswählen, Überschrift und Text bearbeiten und mit **Bild vom Gerät auswählen** eine Grafik hochladen. Unterstützt werden PNG, JPG, WebP, GIF und AVIF bis 10 MB. Eine Bildbeschreibung hilft bei der Barrierefreiheit. Ohne Discord-Einladung wird kein Discord-Link angezeigt.
5. Mit **Dieses Türchen ansehen** das Ergebnis prüfen, inklusive großer Grafik und Lightbox.
6. **Privat auf GitHub speichern** sichert alle aktuellen Texte und neu ausgewählten Bilder gemeinsam in einem Commit im privaten Repository. Die tägliche Action veröffentlicht weiterhin nur bereits fällige Tage.

Der Schlüssel liegt zunächst nur im Arbeitsspeicher. Mit der ausdrücklich aktivierten Option **„Zugang in diesem Tab merken“** bleibt er zusätzlich in `sessionStorage`: Nach F5 verbindet sich der Editor automatisch wieder. **Abmelden** oder das Abwählen der Option entfernt den gemerkten Schlüssel. Browser können Tab-Sitzungen beim Wiederherstellen erhalten; auf gemeinsam genutzten Geräten deshalb abmelden. Der Schlüssel wird nie in `localStorage`, URLs oder Repository-Dateien geschrieben und ausschließlich im Authorization-Header an die GitHub-API geschickt. Die öffentliche Kalenderansicht verbindet sich niemals automatisch mit dem privaten Repository. Das öffentlich erreichbare Editor-Formular allein gewährt keinen Zugriff auf private Inhalte.

Beim Speichern prüft der Editor, ob die Kalenderdatei inzwischen von jemand anderem geändert wurde. In diesem Fall wird nichts überschrieben. Den eigenen Stand als JSON sichern und danach **Aktuellen Stand laden** wählen. Ein ausdrücklich lokal gespeicherter Entwurf enthält private Inhalte und bleibt auf diesem Gerät; neu ausgewählte, noch nicht hochgeladene Bilder bleiben nur im Arbeitsspeicher.

### Zugang für weitere Bearbeiter

Der Repository-Inhaber kann pro Person einen separaten, zeitlich begrenzten Schlüssel ausschließlich für das private Inhalte-Repository anlegen, vertraulich weitergeben und jederzeit unter den GitHub-Token-Einstellungen widerrufen. Ein solcher Schlüssel erlaubt Lesen und Schreiben dieses gesamten privaten Repositorys; keine Beschränkung auf einzelne Türchen. Private Inhalte sind für diese Bearbeiter sichtbar. Ein zusätzlicher Webserver wird nicht benötigt.

Alternativ können Mitarbeitende unter [Repository-Zugriff](https://github.com/M4sterChris/creeunity-adventskalender-2026-inhalte/settings/access) direkt zu GitHub eingeladen werden. GitHub kann fine-grained Tokens für persönliche Repositories, bei denen man nur externer Mitarbeiter ist, einschränken; für den Web-Editor im Zweifel einen vom Repository-Inhaber erstellten, separat widerrufbaren Schlüssel verwenden. [GitHub-Dokumentation zu Zugriffsschlüsseln](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

### Optional: Offline-/JSON-Workflow

Der bisherige lokale Editor, JSON-Import und JSON-Export bleiben verfügbar. Exportierte vollständige `doors-data.json` und lokale Bilder ausschließlich ins **private Inhalte-Repository** übernehmen. Bilder unter `images/` ablegen und z. B. als `./images/tuerchen5.png` referenzieren. Die öffentliche `doors-data.json` wird automatisch erzeugt.

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

Das Gesamtdokument enthält `version: 1`, `year`, `links` mit `twitch` und `discord` sowie genau 24 Einträge unter `doors`. Jeder Tag von 1 bis 24 kommt genau einmal vor. Text kann leer sein und die unten beschriebenen Formatierungen enthalten. HTML wird nicht ausgeführt. Vollständige HTTPS-Links werden automatisch verlinkt.

Externe HTTPS-Bildlinks sind möglich und werden erst nach Freigabe im öffentlichen JSON sichtbar. Das externe Bild selbst kann jedoch bereits vorher öffentlich abrufbar sein. Für geheim zu haltende Grafiken deshalb lokale Dateien im privaten `images/`-Ordner verwenden. Signierte Discord-CDN-Links können ablaufen.

## Tagesrätsel und Lösungssatz

Im Web-Editor pro Türchen unter **Tagesrätsel (optional)** den Antworttyp wählen:

- **Zahl → Buchstabenfolge freigeben:** richtige Zahl und die zugehörige Buchstabenfolge eintragen. Beispiel: Antwort `42`, Buchstabenfolge `FRO`. Nach korrekter Eingabe erscheint „Richtig! Die heutige Buchstabenfolge ist FRO“.
- **Buchstabenfolge prüfen:** die richtige Folge eintragen. Die Rückmeldung lautet „Richtig!“.
- **Kein Rätsel:** zeigt für dieses Türchen keine Eingabe an.

Die Frage selbst steht in deiner Tagesgrafik oder im Feld **Text & Links**. Änderungen mit **Privat auf GitHub speichern** sichern. Die vollständigen Lösungen liegen im privaten Inhalte-Repository. Groß-/Kleinschreibung und Leerzeichen werden bei Buchstabenfolgen ignoriert. Zahlen akzeptieren führende Nullen und Dezimalpunkt oder -komma ohne Rundungsfehler. Unbegrenzt viele Versuche sind möglich.

[Erfundene Rätsel-Demo öffnen](https://m4sterchris.github.io/creeunity-adventskalender-2026/?preview=puzzle#kalender): Türchen 1 erwartet **24** und gibt **FRO** aus; Türchen 5 erwartet **HE**. Testlösungen und Testöffnungen bleiben in der Tab-Sitzung bei F5 erhalten. Sie sind nach Modus und Kalenderjahr getrennt und verändern den echten Fortschritt nicht.

Richtig gelöste Rätsel bekommen einen eigenen Haken auf der Kachel. Die Buchstaben sammeln sich unter dem Kalender in Tagesreihenfolge. Öffnungen und richtige Lösungen sind getrennt. Lösungen werden pro Kalenderjahr im Browser unter `creeunity:solved:JAHR` gespeichert; ein geändertes Rätsel macht den alten Haken ungültig. **Infos & Datenschutz → Meinen Fortschritt zurücksetzen** entfernt Öffnungen und gelöste Rätsel. Es gibt keine automatische Nachricht oder Einreichung: Den fertigen Lösungssatz senden die Teilnehmenden selbst privat an M4sterCree.

Die tägliche Veröffentlichung enthält nur Rätsel bereits freigegebener Tage. Die Klartext-Antwort wird durch einen an Jahr, Tag und Antworttyp gebundenen SHA-256-Prüfwert ersetzt; beim Zahlenrätsel wird zusätzlich die Buchstabenbelohnung veröffentlicht. Zukünftige Rätsel enthalten öffentlich weder Prüfwert noch Antwort noch Belohnung. Die Prüfung läuft im Browser, keine Antwort wird an einen Server geschickt. Das ist eine Spielhilfe: Am freigegebenen Tag können versierte Besucher kurze Antworten durchprobieren und die Zahlen-Belohnung technisch auslesen. Lokale Haken sind kein manipulationssicherer Teilnahmenachweis. Andere Browser/Geräte haben eine eigene Sammlung.

## Text formatieren

Im Feld **Text & Links** Text markieren und die Schaltflächen **B / I / U / S**, Link oder Code anklicken. Unter **Weitere …** stehen Überschriften, Listen, Checklisten, Zitate, Tabellen, Codeblöcke, Trennlinien, Markierung, Spoiler, Hoch-/Tiefstellung, Ausrichtung und fünf Textfarben bereit. Die **Live-Vorschau** zeigt sofort dieselbe Darstellung wie im geöffneten Türchen. Strg/Cmd+B, I, U und K funktionieren direkt im Textfeld.

Die CreeUnity-Kurzschrift ist an Markdown und Chat-Formatierungen angelehnt, hat aber bewusst `*Text*` als **Fett**. Die Zeichen lassen sich auch direkt schreiben:

```text
*fett* oder **fett**
_kursiv_
__unterstrichen__
~~durchgestrichen~~
***fett und kursiv***
==markiert==
||Spoiler – per Klick oder Enter aufdecken||
`Code`
~tiefgestellt~ und ^hochgestellt^
[Zum Stream](https://www.twitch.tv/m4stercree)

# Große Überschrift
## Mittlere Überschrift
### Kleine Überschrift

- Aufzählung
  - Unterpunkt
- [x] Erledigt
- [ ] Noch offen

1. Erster Schritt
2. Zweiter Schritt

> Ein Zitat

---

[color=gold]Goldener Text[/color]

[center]
Zentrierter Text
[/center]

| Name | Zahl |
| --- | ---: |
| CreeUnity | 24 |
```

Codeblöcke beginnen und enden jeweils mit drei Backticks in einer eigenen Zeile. Verfügbare Farben: `green`, `gold`, `red`, `blue`, `purple`. Ausrichtung: `[left]`, `[center]`, `[right]` mit entsprechender Abschlusszeile. Eine Leerzeile beginnt einen Absatz; normale Zeilenumbrüche bleiben sichtbar. Ein Backslash schützt ein Zeichen vor Formatierung, z. B. `\*Text\*` für sichtbare Sternchen. Im Editor lässt sich die vollständige Übersicht unter **Alle Formatierungen & Schreibweisen** aufklappen.

Die Kurzschrift wird unverändert als normaler Text im privaten Repository gespeichert. Erst die Anzeige erzeugt daraus erlaubte DOM-Elemente; eingegebenes HTML, Skripte und aktive Link-Schemas werden nicht ausgeführt. Formatierungen gelten für den Türchentext, nicht für Überschrift oder Bildbeschreibung.

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

Mit der [Designvorschau](https://m4sterchris.github.io/creeunity-adventskalender-2026/?preview=design#kalender) lassen sich geöffnete Türchen schon vor Dezember ansehen. Die Tage 1, 5 und 12 starten als Beispielöffnungen. Hinter dem am linken Rahmen angeschlagenen, nach innen aufgeklappten Türblatt füllt die jeweilige Tagesgrafik die gesamte Kachel als mittig zugeschnittene Bildvorschau (`object-fit: cover`); die Nummer bleibt auf dem Türblatt. Dialog und Lightbox zeigen weiterhin die vollständige Grafik. Ohne verfügbare Grafik oder bei einem Ladefehler erscheint ein kleines Weihnachtsmotiv. Geschlossene und gesperrte Türchen laden keine Miniaturen. Im verbundenen Editor funktionieren auch private Bilder und neu ausgewählte Uploads. „Vorschau zurücksetzen“ setzt nur Testöffnungen und Testlösungen zurück; auch dieser Reset bleibt bei F5 erhalten. „Beenden“ stellt den echten Fortschritt und die Datumsprüfung wieder her. Die Designvorschau lädt ausschließlich öffentliche Inhalte, künftige Türchen zeigen das neutrale Weihnachtsmotiv. Auch der Editor-Vorschaumodus markiert Testöffnungen sichtbar. Testöffnungen und Testlösungen bleiben in `sessionStorage` bei F5 erhalten und verändern keine echten gespeicherten Öffnungen. Noch nicht gespeicherte Änderungen und Bild-Uploads müssen weiterhin mit **„Privat auf GitHub speichern“** gesichert werden.

Dark Mode ist beim ersten Besuch der Standard. Der Sonnenschalter im Header aktiviert den Hellmodus. Die gewählte Darstellung wird unter `creeunity:theme` im Browser gespeichert. Die Türchen sind pro Kalenderjahr in einer festen, gemischten Reihenfolge angeordnet und ändern ihre Position nicht bei einem Reload.

Die Tagesgrafik wird vollständig mit `object-fit: contain` angezeigt. Ein Klick öffnet die bildschirmfüllende Lightbox. **+ / −** zoomen bis auf das Fünffache der eingepassten Größe; anschließend scrollen oder wischen. **Einpassen / Reset** stellt die Gesamtansicht wieder her. **Esc** schließt den obersten Dialog. Tastaturfokus, Bildbeschreibungen und reduzierte Bewegung werden berücksichtigt.

Geöffnete Tage werden pro Kalenderjahr unter `creeunity:opened:JAHR` in `localStorage` gespeichert. Unter **Infos & Datenschutz** lässt sich der Fortschritt zurücksetzen. Bei blockiertem Speicher funktioniert die App weiter, behält den Fortschritt aber nur während des Besuchs. Die App setzt keine Cookies und verwendet kein Tracking oder externe Schriftarten. Fremdgehostete Bilder können Verbindungsdaten an deren Anbieter übertragen.

Für echte Gewinnspiele Teilnahmebedingungen und erforderliche Betreiber-/Datenschutzhinweise ergänzen. Personenbezogene Teilnehmerdaten oder Zugangsdaten gehören auch nach der Freigabe nicht in öffentliche Tagesinhalte.

## Dateien und Tests

### Freigabe selbst prüfen

Unter [GitHub Actions → Freigabe testen](https://github.com/M4sterChris/creeunity-adventskalender-2026/actions/workflows/check-release.yml) **Run workflow → Run workflow** wählen. Der Test verwendet künstliche Inhalte, simuliert alle 24 Berliner Tageswechsel und prüft zusätzlich die aktuell öffentliche Website. Er hat ausschließlich Leserechte und veröffentlicht keine echten Türchen. Ein grüner Lauf bedeutet: Die geprüften Fälle und der zu diesem Zeitpunkt öffentliche Stand sind in Ordnung; spätere Änderungen und die frühere Git-Historie werden dadurch nicht garantiert.

Die Live-Prüfung kontrolliert zukünftige Metadaten und Tagesgrafiken, die öffentliche Dateiliste und den Zugriff auf private Dateien ohne Anmeldung. Netzwerkfehler oder GitHub-Anfragelimits führen zu einem fehlgeschlagenen beziehungsweise nicht prüfbaren Lauf. Künftige Tage werden anhand der tatsächlichen Zeit bestimmt, niemals anhand einer im Editor eingestellten Vorschauzeit. Die eigene Geräteuhr sollte bei lokalem Start stimmen.

Lokal lassen sich dieselben Prüfungen ohne zusätzliche Pakete mit `node --test tests/*.test.mjs` und `node tools/check-public-release.mjs` starten. Wenn npm installiert ist, funktionieren auch `npm test` und `npm run test:live`. **Das Kalenderjahr echter Inhalte zum Testen nicht zurückstellen und keinen Testlauf mit künstlichem Dezemberdatum gegen das echte öffentliche Repository ausführen.** Die Datumssimulation arbeitet ausschließlich in temporären Testverzeichnissen mit künstlichen Dateien. Die normale Designvorschau prüft das Aussehen; der Freigabetest prüft die Veröffentlichungslogik.

```text
index.html, styles.css, script.js   Moderne Website und Web-Editor
theme.js                          Dunkel-/Hellmodus ohne helles Aufblitzen
github-editor.js                  Privater GitHub-Zugriff und atomare Speicherung
text-format.js                    Sichere Textauszeichnung und Editor-Schaltflächen
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
