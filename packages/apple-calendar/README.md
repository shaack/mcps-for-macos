# @mcps/apple-calendar

MCP-Server, der den macOS-Kalender (Calendar.app) per AppleScript kapselt. Termine eines Zeitfensters lesen und neue Termine anlegen. Ohne Zugangsdaten, weil Calendar.app die eingerichteten Konten (iCloud, Google, Exchange) bereits synchronisiert.

Die Tools sind workflow-neutral. Welcher Kalender wofür da ist und was ein Termin bedeutet, entscheidet der Aufrufer über Parameter, nicht der Server.

Installation und Registrierung: siehe [Wurzel-README](../../README.md).

## Tools

| Tool | Zweck |
|------|-------|
| `list_calendars` | Alle Kalender auflisten, ein Name pro Zeile. Liefert die exakten Namen für die anderen Tools |
| `list_events` | Termine eines Zeitfensters chronologisch auflisten, mit Kalender, Titel, Ort und Ganztägig-Markierung. `searchKey` filtert auf Titel, `calendars` auf bestimmte Kalender |
| `create_event` | Neuen Termin anlegen, mit Titel, Beginn, Ende bzw. Dauer, Ort und Notizen; auch ganztägig und mehrtägig. Verändert den Kalender |

Kein Tool löscht oder ändert bestehende Termine.

## Fallstricke

- **Serientermine.** Calendar.app liefert per AppleScript nur den Serien-Stamm mit seinem ursprünglichen Startdatum, keine expandierten Wiederholungen. Ein wöchentliches Meeting, das vor einem Jahr angelegt wurde, taucht im Fenster der nächsten Woche also nicht als Termin auf. `list_events` listet solche Serien darum in einem eigenen Abschnitt mit ihrer Wiederholungsregel (RRULE); ob eine Wiederholung ins Fenster fällt, muss der Aufrufer aus der Regel ableiten. Serien, deren `UNTIL` vor dem Fenster liegt, werden herausgefiltert; Serien mit `COUNT` lassen sich so nicht bewerten und bleiben in der Liste.
- **Geschwindigkeit.** Ohne `calendars`-Parameter werden alle Kalender durchsucht, auch Geburtstage und abonnierte Feiertagskalender. Bei vielen oder großen Kalendern lohnt es, die Suche auf die relevanten Kalender einzugrenzen.
- **Ganztägige Termine.** Intern speichert Calendar.app das Ende exklusiv (Mitternacht des Folgetags). Die Tools rechnen das um; in `create_event` ist `end` bei `allday` der letzte Tag inklusive, und `list_events` zeigt den letzten Tag inklusive an.
- **Beschreibbarkeit.** `create_event` braucht einen beschreibbaren Kalender. In abonnierten Kalendern (Feiertage, geteilte Nur-Lesen-Kalender) schlägt das Anlegen mit einer AppleScript-Fehlermeldung fehl.

## Berechtigungen

Beim ersten Zugriff fragt macOS nach Automatisierungs-Zugriff auf den Kalender für den ausführenden Prozess (Terminal bzw. die Host-App). Einmal erlauben; nachträglich steuerbar unter Systemeinstellungen → Datenschutz & Sicherheit → Automation.
