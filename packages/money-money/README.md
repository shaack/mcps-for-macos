# @mcps/money-money

MCP-Server, der MoneyMoney per AppleScript kapselt. Liefert die Soll-Liste der
Abbuchungen für den Rechnungsabgleich: MoneyMoney gibt die Buchungstage,
[`@mcps/apple-mail`](../apple-mail) die PDFs.

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
3. Danach mit `@mcps/apple-mail` die passenden PDF-Rechnungen sammeln und gegen
   diese Liste abhaken. Maßgeblich ist der Abbuchungstag, nicht das Rechnungsdatum.
