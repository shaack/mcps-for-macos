# @mcps/apple-mail

MCP-Server, der Apple Mail per AppleScript kapselt: Rechnungs-PDFs im Posteingang
finden und ablegen, Mailtext lesen, Nachrichten flaggen. Ohne Zugangsdaten, weil
Apple Mail eine vollständige AppleScript-Schnittstelle hat und die Konten bereits
eingerichtet sind.

Installation und Registrierung: siehe [Wurzel-README](../../README.md).

## Tools

| Tool | Zweck |
|------|-------|
| `list_mailboxes` | Alle Konten und Mailboxen als `<Konto>:<Mailbox>` auflisten |
| `search_messages` | Nach Absender-Stichworten und/oder nur geflaggten Nachrichten im Zeitfenster suchen, mit Anhangnamen und Flaggen-Markierung (⚑) |
| `save_attachment` | Ersten passenden PDF-Anhang (Name enthält Schlüssel, endet auf .pdf) speichern |
| `get_message_body` | Klartext-Inhalt der ersten passenden Nachricht lesen (für Belege ohne PDF) |
| `flag_message` | Fahne an genau einer Nachricht setzen/entfernen, optional mit Farbe; bei mehrdeutigem Schlüssel passiert nichts |

## Konfiguration

Die Vorgabe-Mailboxen stehen in einer lokalen `config.json`, die nicht
eingecheckt wird. Vorlage kopieren und die eigenen Konten eintragen:

```bash
cp config.example.json config.json
```

Format je Eintrag `<Konto>:<Mailbox>`; die exakten Namen liefert `list_mailboxes`.
Fehlt die Datei, greifen generische Platzhalter. Alternativ übergibt der Aufrufer
die Mailboxen je Tool direkt im `mailboxes`-Parameter.

## Beispielablauf

1. `list_mailboxes` für die exakten Namen.
2. `search_messages` mit `vendors` und `fromDate`, um zu sehen, was als PDF vorliegt
   (Anhangnamen in `ATT{...}`).
3. Pro Treffer `save_attachment` mit `subjKey`, `attKey` und `destPath`.
4. Verarbeitete Rechnung mit `flag_message` markieren; der nächste Lauf findet sie
   über `search_messages` mit `flaggedOnly`.
