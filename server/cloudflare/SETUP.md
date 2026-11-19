# Kostenloser Cloudflare-Betrieb

Die Kalenderseite und ihre API laufen unter derselben workers.dev-Adresse.
Cloudflare Workers führt den Prüfserver aus; eine private D1-Datenbank enthält
Kalenderkonfiguration, Lösungen und Kontofortschritt. Die Datenbank wird mit
Jurisdiction `eu` angelegt. Statische Dateien enthalten keine Konfiguration mit
Lösungen. `run_worker_first: true` ist zwingend: Auch direkte Bild-/Audioaufrufe
und HEAD-/Range-Anfragen durchlaufen die Datumsfreigabe.

## Einrichtung

1. `npm ci`, danach `npm run cloudflare:login`. Ein kostenloses Cloudflare-Konto
   genügt innerhalb der Free-Grenzen; kein Upgrade und keine eigene Domain nötig.
2. `wrangler d1 create creeunity-calendar-2026 --jurisdiction eu`.
3. Lokal `wrangler.local.json` mit `accountId`, `databaseId` und der endgültigen
   HTTPS-`origin` erstellen. Diese Datei bleibt von Git ausgeschlossen.
4. Discord-Anwendung anlegen. Unter OAuth2 exakt
   `https://DEINE-ADRESSE/api/auth/discord/callback` als Redirect speichern.
   Ausschließlich `identify`; kein Bot, keine E-Mail-Berechtigung erforderlich.
5. Client-ID und Client-Secret lokal in `.env` als `DISCORD_CLIENT_ID` und
   `DISCORD_CLIENT_SECRET` eintragen. Keine echten Werte in Git, Chat oder Screenshots.
6. `node tools/deploy-cloudflare.mjs --require-discord`. Der Helfer erstellt den
   lokalen Build, wendet Schema-Migrationen an, überträgt die private Konfiguration
   in D1 und hinterlegt die Discord-Werte als Cloudflare-Secrets. Seine generierten
   Dateien liegen unter dem ebenfalls ausgeschlossenen `.cloudflare-build/`.
7. Echte Anmeldung im Browser testen. `/healthz` zeigt nur Betriebsstatus;
   es veröffentlicht keine Datenbankinhalte oder Schlüssel.

## Änderungen und Betrieb

Die bestehende private Git-Datei bleibt die Inhaltsquelle. Nach Änderungen den
privaten Stand laden und den Deployment-Helfer erneut ausführen. Er ersetzt nur
die Konfiguration und Medienmetadaten; Teilnehmerfortschritte bleiben erhalten.
Bereits in Cloudflare gespeicherte Secrets bleiben bei weiteren Deployments
erhalten. Für eine GitHub-Automatisierung einen separaten, minimal berechtigten
Cloudflare-Token als Actions-Secret verwenden; niemals das persönliche
Wrangler-OAuth-Token aus dem lokalen Anmeldespeicher übernehmen.

Datumsfreigaben erfolgen automatisch anhand der Berliner Serverzeit, ohne tägliche
Neuveröffentlichung. `releaseMonth: 11` ist der ausdrücklich genehmigte November-Test;
`12` oder kein Feld aktiviert Dezember. Der Benutzereditor bleibt an das private
GitHub-Repository gebunden. Ohne eingerichteten Deployment-Workflow werden seine
Git-Änderungen erst nach erneutem Deployment auf Cloudflare wirksam.

Zehn Fehlversuche sperren ein Konto/Tag/Jahr für 15 Minuten. D1-Transaktionen
erzwingen das auch bei parallelen Anfragen. Cookie-Laufzeit: bis zu 30 Tage,
Secure/HttpOnly/SameSite=Lax. Discord-Klartexttokens und Profilfelder werden nicht
gespeichert; Sitzungen enthalten ausschließlich Hashes. Kontolöschung erfolgt
atomar mit zugehörigen Öffnungen, Lösungen, Versuchen und Sitzungen.

Ein minütlicher Cron und alle Zugriffe nach Fristablauf löschen die aktiven
Teilnehmerdaten ab **1. Februar 2027, 00:00 Berlin**. Kalenderinhalte bleiben erhalten.
Das ersetzt keine Löschregel für providerseitige Wiederherstellungskopien: D1
Time Travel ist automatisch aktiv. Historische Kopien beim Anbieter sind getrennt
zu berücksichtigen; die Anwendung darf daraus keine gelöschten Konten wiederherstellen.
Worker-Observability und eigene Anfrage-/Inhaltsprotokolle sind deaktiviert.

## Prüfung

`node --test tests/*.test.mjs` prüft Node- und D1-Verhalten, parallele Versuche,
Kontolöschung, Frist, OAuth, Medienfreigabe und Audio-Teilbereiche.
Vor der Veröffentlichung zusätzlich gegen die echte lokale Wrangler-Laufzeit
prüfen. OAuth-Mocktests ersetzen die Anmeldung mit der tatsächlichen Discord-App nicht.
