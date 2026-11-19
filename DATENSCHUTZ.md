# Datenschutz: Umsetzung und offene Angaben

Stand: 19. November 2026. Interne Arbeitsunterlage für den Kalender. Kalenderseite und Discord-Anmeldung sind auf Cloudflare Workers veröffentlicht; eine private D1-Datenbank speichert die Kalender- und Kontodaten. Die technische Umsetzung ist keine Zusicherung umfassender Rechtskonformität und ersetzt keine Prüfung des konkreten Betriebs.

## Ausdrückliche Nutzerentscheidungen

- Teilnehmer melden sich über die offizielle Discord-Anmeldung an. Der Kalender fragt niemals nach einem Discord-Passwort.
- Von Discord wird dauerhaft ausschließlich die ID übernommen. Profilnamen, Profilbilder, E-Mail-Adressen, Nachrichten und Serverlisten werden nicht gespeichert. Eine frühere lokale Namensspalte wird entfernt.
- Die Anmeldung bleibt bis zu 30 Tage über ein technisch notwendiges Cookie bestehen. Darin steht nur ein zufälliger Sitzungsschlüssel, kein Fortschritt. Der Server speichert seinen Hash und das Ablaufdatum.
- Automatische Löschung der aktiven Teilnehmerdaten am 1. Februar 2027 ab 00:00 Uhr Berliner Zeit. Sitzungen werden auf dieses Datum begrenzt.
- Zweck der gespeicherten Kalenderdaten: geräteübergreifend geöffnete Türchen, eigener Lösungsstand und Satzteile sowie zehn Fehlversuche pro Türchen mit anschließender 15-Minuten-Pause. Für Öffnungen werden nur Konto-Zuordnung, Kalenderjahr und Türchennummer gespeichert, keine Besuchszeitpunkte. Kein Tracking, kein Teilnehmerverzeichnis und keine Weiterverwendung für Werbung.

## Technisch vorhanden

Produktiv verwendet der Kalender Cloudflare Workers und D1 mit Jurisdiction `eu`.
Diese Einstellung begrenzt Betrieb und Speicherung der Datenbank auf die EU;
sie ist keine Zusicherung für die regionale Verarbeitung aller HTTP-Anfragen.
Die Datenbank hat keinen öffentlichen Lesezugriff. Server-Secrets werden als
Cloudflare-Secrets hinterlegt; eigene Worker-Observability ist deaktiviert.
Die Node-/SQLite-Variante bleibt als lokale Alternative erhalten.

Die minütliche Cloudflare-Routine und Zugriffe nach Fristablauf löschen aktive
Kontodaten ab dem vereinbarten Stichtag. D1-Wiederherstellungskopien (Time Travel)
sind providerseitig automatisch aktiv und werden durch SQL-Löschungen nicht
sofort beseitigt. Dieser Punkt bleibt im Löschkonzept gesondert zu berücksichtigen;
eine Wiederherstellung darf keine gelöschten Teilnehmerdaten reaktivieren.

Die private SQLite-Datei und ihre Begleitdateien werden nicht über die Website ausgeliefert. Produktionsbetrieb verlangt HTTPS. API-Zugriffe werden aus dem Sitzungscookie einem Konto zugeordnet. Die Kenntnis einer Discord-ID allein ermöglicht keinen Zugriff. Kontodaten können ausschließlich für das angemeldete Konto heruntergeladen oder nach Bestätigung gelöscht werden. Kontolöschung widerruft alle seine Sitzungen. Änderungen am Browserzähler oder an einer übergebenen ID beeinflussen keine fremden Konten.

Discord liefert bei `identify` ein Basisprofil. Die Anwendung liest daraus die ID und verwirft die anderen Profilfelder. Während der Anmeldung ist vorübergehend ein Discord-Zugriffstoken im Arbeitsspeicher nötig. Es wird weder in Browsercookies noch in der Datenbank gespeichert. Der spätere Kalenderzugriff benötigt dieses Token nicht mehr. Die offizielle Beschreibung des [Discord-Code-Flow](https://docs.discord.com/developers/topics/oauth2#authorization-code-grant) erklärt die Trennung von Anmeldung und Passwort.

Die Löschroutine läuft beim aktiven Server jede Minute sowie bei Start und Zugriff nach dem Stichtag. Sie bereinigt die aktive Datenbank und ihren WAL. Bei einem ausgeschalteten Server ist eine externe Löschung beziehungsweise eine rechtzeitige Wiederinbetriebnahme nötig. Backups, Hostersnapshots, Protokolle und Discords eigene Verarbeitung werden dadurch nicht gelöscht. Ein gelöschtes Kalenderkonto lässt sich vor dem Stichtag neu anlegen und erhält dann neue Versuchszähler. Derzeit ist kein zusätzlicher Anti-Missbrauchsdatensatz nach einer Kontolöschung vorgesehen.

Teilnehmerfortschritt wird ausschließlich im angemeldeten Konto gespeichert und in allen Browsersitzungen desselben Kontos wiederhergestellt. Ohne Anmeldung können Türchen angesehen werden; Öffnungen, Lösungen und Fehlversuche werden dabei weder im lokalen Browserspeicher noch in zusätzlichen Cookies gespeichert. Alte lokale Fortschrittsdaten werden beim Laden der jeweiligen Kalenderadresse entfernt. Das Zurücksetzen im Konto entfernt seine Öffnungen für das aktuelle Kalenderjahr, ohne gelöste Rätsel und Sperren zu verändern. Auskunft, Kontolöschung und Stichtagslöschung umfassen die servergespeicherten Öffnungen. Vorschau- und Editorwerte bleiben getrennt von Teilnehmerdaten.

## Vor dem Livebetrieb konkret zu ergänzen

| Gegenstand | Noch offen |
| --- | --- |
| Verantwortlicher und Kontakt | Vollständige verantwortliche Person/Stelle, geeignete Kontaktdaten und erreichbarer Datenschutzkontakt. Der Alias M4sterCree ist dafür noch keine vollständige Betreiberangabe. |
| Zwecke und Rechtsgrundlage | Rechtsgrundlage für Konto, Fortschritt, Missbrauchsschutz und lokale Speicherung anhand der tatsächlichen Teilnahmebedingungen prüfen und dokumentieren. Discord-Autorisierung ist keine pauschale Einwilligung in alle Kalenderverarbeitungen. |
| Vollständige Informationen | Betreiber, Zwecke, Rechtsgrundlage, Empfänger, Speicherdauer, Rechte, Beschwerdemöglichkeit und gegebenenfalls Drittlandübermittlungen ergänzen. Der derzeitige Infodialog beschreibt technische Abläufe und ist noch keine vollständige, individuell geprüfte Datenschutzerklärung. |
| Hosting | Cloudflare Workers und D1, Datenbank mit EU-Jurisdiction. Vereinbarung zur Auftragsverarbeitung, Zugriffsrechte, übrige Anbieterprozesse und Aktualisierungskonzept prüfen. |
| Discord | Anbieterrolle, einschlägige Bedingungen und mögliche Drittlandübermittlungen der tatsächlichen Einbindung prüfen. Maßgeblich ist auch [Discords Datenschutzerklärung](https://discord.com/privacy). |
| Protokolle und Backups | Keine Anfragekörper, Lösungseingaben, Sitzungscookies oder OAuth-Codes protokollieren. Einstellungen des Hosters prüfen. Gesicherte Kopien, Snapshots und gegebenenfalls Protokolle in Lösch- und Wiederherstellungsverfahren einbeziehen. |
| Daten nach dem Stichtag | Sicherstellen, dass die Löschung trotz Wartung/Ausfall läuft und alte Backups keine gelöschten Konten wiederherstellen. Neue Kalenderjahre benötigen eine neu abgestimmte Frist. |
| Ausübung von Rechten | Kontaktweg und Verfahren auch für nicht mehr eingeloggte Teilnehmer festlegen. Eigenexport und Löschknopf ersetzen nicht sämtliche gesetzlichen Rechte. Bei Gewinnspielen zusätzliche Datenverarbeitungen gesondert beurteilen. |

Eine öffentliche oder auffindbare Online-Kennung kann personenbezogen bleiben. Für den Betrieb sind unter anderem Datenminimierung, Zweckbindung und Speicherbegrenzung, eine geeignete Rechtsgrundlage, Informationen für Betroffene und angemessene Schutzmaßnahmen relevant. Grundlage sind [Art. 4, 5, 6, 12–22, 25, 28 und 32 sowie Kapitel V DSGVO](https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX%3A32016R0679). Welche Rechtsgrundlage und ergänzenden Regeln im konkreten Fall tragen, ist mit den tatsächlichen Betreiber- und Hostingangaben zu prüfen.
