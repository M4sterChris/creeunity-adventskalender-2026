# Serverprüfung und Discord-Anmeldung

Für den kostenlosen Onlinebetrieb gibt es zusätzlich die
[Cloudflare-Anleitung](cloudflare/SETUP.md). Die nachfolgende Anleitung beschreibt
die weiterhin unterstützte Node-/SQLite-Variante.

Die neue Prüfung erlaubt pro Discord-Konto, Kalenderjahr und Türchen zehn Fehlversuche. Der zehnte Fehlversuch startet eine Pause von genau 15 Minuten. Weitere Eingaben verlängern diese Pause nicht. Danach stehen wieder zehn Versuche bereit. Andere Türchen bleiben zugänglich. Ungültige Eingabeformate, fehlende Anmeldung und Serverfehler verbrauchen keine Versuche.

Der Server speichert die Grenzen und gelösten Rätsel in SQLite. Reload, Logout, das Zurücksetzen lokaler Öffnungen und ein anderes Gerät setzen die Grenzen nicht zurück. Gleichzeitige Anfragen werden in einer Datenbanktransaktion gezählt. Ein neues Discord-Konto hat einen eigenen Zähler. Weitergegebene Lösungen lassen sich damit nicht verhindern.

## Stand und Hosting

Die Implementierung ist lokal vorbereitet. Sie wurde nicht veröffentlicht. GitHub Pages führt keinen Anwendungsserver aus und kann diese Sperre nicht durchsetzen. Für die Online-Aktivierung muss die vollständige Kalenderseite mit diesem Node-Server unter einer HTTPS-Adresse laufen. Website und API verwenden dieselbe Origin, beispielsweise `https://advent.example.org`. Ein zusätzlicher API-Server unter einer fremden Domain ist in dieser Umsetzung nicht vorgesehen.

Voraussetzungen: Node.js 24, ein dauerhaft gespeichertes Datenverzeichnis und die private Kalenderdatei samt Bildern. Der Server benötigt keine npm-Pakete. Hinter einem HTTPS-Reverse-Proxy bleibt der Node-Port intern. Nur eine Instanz pro lokalem Datenbankverzeichnis betreiben. Mehrere Server mit getrennten Datenbanken würden getrennte Zähler erzeugen. SQLite-Datei, WAL- und SHM-Dateien gehören zusammen und dürfen niemals öffentlich ausgeliefert werden. Für Backups das SQLite-Backup-Verfahren nutzen oder den Server sauber stoppen und das vollständige Datenverzeichnis sichern.

## Discord-App einrichten

1. Im [Discord Developer Portal](https://discord.com/developers/applications) eine Anwendung für den Kalender anlegen.
2. Unter OAuth2 die Client-ID und das Client-Secret verwenden. Kein Bot, keine E-Mail-Berechtigung und keine Servermitgliedschaft sind nötig. Der Kalender fordert ausschließlich `identify` an.
3. Als Redirect exakt `https://DEINE-KALENDERADRESSE/api/auth/discord/callback` eintragen. Für lokale Tests zusätzlich `http://127.0.0.1:4173/api/auth/discord/callback` eintragen.
4. Die Werte ausschließlich auf dem Server hinterlegen. Das Client-Secret weder in den Chat noch ins öffentliche Repository oder in den Browser-Editor schreiben.

Der Anmeldefluss prüft einen an das Browsercookie gebundenen, einmaligen State mit zehn Minuten Laufzeit. Das Sitzungscookie ist HttpOnly und SameSite=Lax, unter HTTPS zusätzlich Secure und an den Host gebunden. Sitzungen bleiben auf Nutzerwunsch bis zu **14 Tage** gültig, auch nach einem normalen Browserneustart. Im Cookie steht ausschließlich ein zufälliger Sitzungsschlüssel, keine Discord-ID und kein Passwort. In der Datenbank liegt nur der Hash dieses Schlüssels. Discord-Zugriffstokens werden nur während der Anmeldung verwendet und nicht dauerhaft gespeichert. Kalenderfortschritt und Pausen bleiben unabhängig von der Sitzungsdauer erhalten. Alle Sitzungen enden spätestens mit der Löschfrist am 1. Februar 2027.

Offizielle Grundlage: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [OWASP zu Versuchsbegrenzungen](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#login-throttling), [OWASP zu Sitzungscookies](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies).

## Lokal starten

`server/config.example.env` als `.env` im Projektordner kopieren und dort die Discord-Werte eintragen. `PRIVATE_CALENDAR_DIR` zeigt auf eine private Arbeitskopie mit vollständiger `doors-data.json`, `images/` und optional `audio/`. Wenn noch keine Arbeitskopie existiert, legt `node tools/prepare-private-repository.mjs` eine mit fiktiven Beispielen an. Bestehende echte Inhalte nicht durch Beispiele überschreiben.

Audios verwenden denselben Berliner Freigabetag wie die Grafiken. Der direkte `/audio/`-Endpunkt prüft den Termin vor jedem Download und jeder Teilbereichsanfrage. Richtiger MIME-Typ, Content-Length und Byte-Ranges unterstützen die nativen Browserplayer und das Vorspulen. Auf GitHub Pages übernimmt die tägliche private Action das Kopieren erst nach Freigabe.

```sh
npm run start:server
```

Danach `http://127.0.0.1:4173/` öffnen. Die echte Datumsprüfung bleibt aktiv. `?preview=puzzle` enthält ausschließlich die vorhandenen erfundenen Beispielrätsel. Diese Vorschau prüft lokal, berührt weder Serverfortschritt noch Versuche und zeigt keine echten zukünftigen Rätsel. Die automatisierten Tests verwenden künstliche Kalenderdateien und eine kontrollierte Uhr. Es gibt keinen öffentlich erreichbaren Datums- oder Zählerreset für echte Inhalte.

## Produktiv konfigurieren

| Variable | Bedeutung |
| --- | --- |
| `NODE_ENV=production` | Verlangt Origin und beide Discord-Zugangsdaten beim Start. |
| `PUBLIC_ORIGIN` | Exakte HTTPS-Origin ohne Pfad oder abschließenden Schrägstrich. |
| `DISCORD_CLIENT_ID` | ID der Discord-Anwendung. |
| `DISCORD_CLIENT_SECRET` | Privates Client-Secret. |
| `PRIVATE_CALENDAR_DIR` | Privates Verzeichnis mit vollständiger Kalenderdatei und Bildern. |
| `CALENDAR_DATA_DIR` | Dauerhaftes, nicht öffentliches SQLite-Verzeichnis. Standard `.calendar-data`. |
| `PORT` | Interner Serverport, Standard 4173. |
| `HOST` | Standard 127.0.0.1. Im Container 0.0.0.0 verwenden. |
| `PARTICIPANT_DELETE_AT` | Vereinbarte Löschfrist: `2027-02-01T00:00:00+01:00`. Für Folgekalender ausdrücklich neu abstimmen. |

Beispiel mit Docker, mit echten Werten in einer lokalen `.env` und vorhandenen privaten Verzeichnissen:

```sh
docker build -t creeunity-calendar .
docker run --rm --name creeunity-calendar --env-file .env -p 127.0.0.1:4173:8080 --mount type=bind,source=/ABSOLUTER/PRIVATER/KALENDER,target=/content,readonly --mount type=bind,source=/ABSOLUTE/DAUERHAFTE/DATEN,target=/data creeunity-calendar
```

Für den Container `NODE_ENV=production`, `PUBLIC_ORIGIN=https://DEINE-KALENDERADRESSE`, `HOST=0.0.0.0`, `PORT=8080`, `PRIVATE_CALENDAR_DIR=/content` und `CALENDAR_DATA_DIR=/data` setzen. Das Datenverzeichnis muss für den Containerbenutzer `node` schreibbar sein. HTTPS und Weiterleitung zum internen Port richtet der gewählte Hoster oder Reverse-Proxy ein. `/healthz` liefert einen einfachen Erreichbarkeitscheck.

## Inhalte und Veröffentlichungen

Die zentrale Excel-Datei unter `output/Finale Türchen/` bleibt das Planungsdokument. Dieser Auftrag verändert keine Türchentitel oder Lösungscodes. Die für den Betrieb benötigte private `doors-data.json` separat aus dem freigegebenen Planungsstand pflegen. Den `output/`-Ordner nicht als öffentliche Website ausliefern.

Die neue öffentliche Auswahl enthält bei Rätseln nur Antworttyp und `serverOnly: true`, weder Antwort, Prüfwert noch Satzteil. Der Server prüft den Berliner Freigabetag unabhängig von der Browseruhr. Satzteile kommen erst nach richtiger Lösung aus der API. Korrigierte private Antworten oder Belohnungen entwerten frühere Erfolge dieses Rätsels, ohne andere Türchen zu verändern. Bei einer Änderung die private Datei atomar ersetzen, damit keine halb geschriebene Datei gelesen wird.

Der Web-Editor speichert weiterhin im privaten GitHub-Repository. Beim Einrichten des Hostings muss auch die Aktualisierung der privaten Serverkopie aus diesem Repository eingerichtet werden, beispielsweise über den Deployment-Prozess des Hosters. Die bisherige Action aktualisiert nur die öffentliche Pages-Datei und überträgt keine geheimen Lösungen an einen neuen Server.

Das bisherige GitHub-Pages-Publishing bleibt für öffentliche Grafiken und redaktionelle Vorschauen erhalten. Es ersetzt die neue Serverprüfung nicht. Früher veröffentlichte Antworten, Prüfwerte oder Satzteile verschwinden durch die neue Ausgabe nicht aus einer alten Git-Historie.

## Daten und Betrieb

Gespeichert werden ausschließlich die Discord-ID als Zuordnung sowie geöffnete Türchen, gehashte Sitzungsschlüssel, Ablaufzeiten, Fehlversuche/Sperrzeiten und interne Prüfdaten gelöster Türchen. Die Öffnungstabelle enthält nur Konto-Zuordnung, Kalenderjahr und Türchennummer, keine Besuchszeitpunkte. Keine Discord-Passwörter, Profilnamen, Profilbilder, E-Mail-Adressen, Nachrichten oder Serverlisten werden gespeichert. Discord liefert bei `identify` technisch ein Basisprofil; die Anwendung übernimmt daraus nur die ID. Ein früher gespeicherter Anzeigename wird beim Öffnen einer alten lokalen Datenbank aus dem Schema entfernt. Die eingegebenen Lösungen und Discord-Zugriffstokens werden nicht dauerhaft gespeichert. Die Serveranwendung führt kein Zugriffsprotokoll. Protokolle des Hosters oder Reverse-Proxys müssen separat geprüft werden.

Unter **Infos & Datenschutz** können angemeldete Teilnehmer ihre gespeicherten Daten als JSON herunterladen und nach zweiter Bestätigung löschen. Beide API-Aktionen verwenden ausschließlich die durch das Sitzungscookie nachgewiesene Identität. Eine übergebene fremde Discord-ID ändert das Zielkonto nicht. Löschen entfernt Fortschritt, Fehlversuche und sämtliche Sitzungen dieses Kontos. Die Anwendung hält keinen versteckten Datensatz zur Wiedererkennung gelöschter Konten zurück. Dadurch lässt sich mit Löschen und erneuter Teilnahme auch der Versuchszähler neu beginnen. Dies ist eine bekannte Grenze des vereinbarten Schutzes; keine Löschsperre eigenständig einführen.

**Vereinbarte Frist:** 1. Februar 2027, 00:00 Uhr Berlin, entsprechend 31. Januar 2027, 23:00 Uhr UTC. Beim laufenden Server prüft eine Routine jede Minute die Frist. Jede Anfrage ab Fristablauf und jeder spätere Serverstart führen die Löschung ebenfalls vor dem Zugriff aus. Danach ist keine erneute Teilnehmeranmeldung für diesen Kalender möglich. Ist der Server ausgeschaltet, kann er keine Datei löschen: Der Betrieb beziehungsweise eine externe Löschroutine muss zum Stichtag gewährleistet sein. Der Serverlöscher bearbeitet die aktive Datenbank einschließlich Tabellen mit Konten, Sitzungen, OAuth-States, Öffnungen, Erfolgen und Fehlversuchen. Nach der Löschung werden SQLite-Freiplatz und WAL bereinigt. Backups und Hostersnapshots sind davon nicht erfasst und benötigen dieselbe abgestimmte Löschregel beim Hoster. Lokale Gastöffnungen und Vorschauwerte bleiben im Browser, bis der Nutzer sie zurücksetzt oder seinen Browserspeicher löscht. Die Kontolöschung setzt zusätzlich lokale Gastöffnungen des aktuellen Kalenderjahrs im ausführenden Browser zurück.

## Geräteübergreifende Öffnungen

Angemeldete Teilnehmer speichern echte Öffnungen im Konto. Alle 24 Tagesarten werden unterstützt, auch Türchen ohne Rätsel. Wiederholtes Öffnen erzeugt keinen zweiten Datensatz. Andere Browser laden denselben Stand nach Anmeldung oder Reload, bei Rückkehr zum Tab und etwa jede Minute. Es gibt keine sofortige Push-Verbindung. Die Browseransicht kann eine Öffnung bereits zeigen, während die Speicherung läuft. Ein Speicherfehler wird gemeldet und der Serverstand anschließend neu geladen.

Gastöffnungen bleiben getrennt lokal. Anmeldung übernimmt keine Gastdaten automatisch; Abmelden stellt den lokalen Gaststand wieder her. Kontostände werden nicht im gemeinsamen lokalen Gastschlüssel zwischengespeichert. Das schützt vor Vermischung verschiedener Discord-Konten auf einem Gerät und verhindert, dass ein alter lokaler Cache einen auf einem anderen Gerät vorgenommenen Reset rückgängig macht. Das bestätigte Zurücksetzen betrifft nur Öffnungen des eigenen Kontos im aktuellen Kalenderjahr. Lösungen und Rätselsperren bleiben erhalten. Editor- und Designvorschau schreiben niemals in die Öffnungstabelle.

Die technische Umsetzung ist keine pauschale DSGVO-Freigabe. Betreiberangaben, Rechtsgrundlage, Datenschutzinformationen, Hostervertrag, Protokolle, Backups und die Discord-Einbindung sind vor dem Livebetrieb zu klären. Der konkrete offene Stand ist in [DATENSCHUTZ.md](../DATENSCHUTZ.md) festgehalten.

Tests: `node --test tests/*.test.mjs`. Der echte Discord-Austausch ist in den automatisierten Tests simuliert. Vor Online-Aktivierung die echte Discord-Anmeldung mit der eingerichteten Anwendung und der endgültigen HTTPS-Adresse prüfen.
