# @mcps/money-money

MCP-Server, der MoneyMoney per AppleScript kapselt. Liefert Kontenliste und
Umsätze als plist oder CSV, als Rohdaten für Auswertungen, Abgleiche oder
Weiterverarbeitung.

Installation und Registrierung: siehe [Wurzel-README](../../README.md).

## Tools

| Tool | Zweck |
|------|-------|
| `export_accounts` | Kontenliste als plist, zeigt die exakten Kontonamen |
| `export_transactions` | Umsätze eines Kontos im Zeitraum (bookingDate, amount, name, purpose) |

## Voraussetzung

MoneyMoney muss laufen und **entsperrt** sein. Ist die Datenbank gesperrt,
schlägt der Export mit einer AppleScript-Fehlermeldung fehl (der Server reicht
sie durch).

## Beispielablauf

1. `export_accounts` für den exakten Kontonamen.
2. `export_transactions` mit `account`, `fromDate`, `toDate`. Das plist enthält je
   Buchung bookingDate, amount, name und purpose, in Buchungsreihenfolge je Tag.
3. Die Buchungen weiterverarbeiten, etwa gegen Belege abgleichen, die
   [`@mcps/apple-mail`](../apple-mail) aus dem Postfach holt. Bei einem solchen
   Abgleich zählt der Abbuchungstag, nicht das Datum auf dem Dokument.
