# @mcps/apple-mail

MCP-Server, der Apple Mail per AppleScript kapselt: Rechnungs-PDFs im Posteingang
finden und ablegen, Mailtext lesen, Nachrichten flaggen, Support-Anfragen
beantworten. Ohne Zugangsdaten, weil Apple Mail eine vollständige
AppleScript-Schnittstelle hat und die Konten bereits eingerichtet sind.

Installation und Registrierung: siehe [Wurzel-README](../../README.md).

## Tools

| Tool | Zweck |
|------|-------|
| `list_mailboxes` | Alle Konten und Mailboxen als `<Konto>:<Mailbox>` auflisten |
| `list_messages` | Zeitfenster auflisten, neueste zuerst, mit Status (`•` ungelesen, `⚑` geflaggt) und `message:`-URL je Zeile. Mit `unreadOnly` die Liste der offenen Vorgänge |
| `search_messages` | Im Zeitfenster nach Absender-Stichworten, nur geflaggten Nachrichten oder einer bestimmten Fahnenfarbe (`flagColor`) suchen, mit Anhangnamen und Flaggen-Markierung (⚑) |
| `list_correspondence` | Gesamten Schriftwechsel mit einer Adresse chronologisch zeigen, eingegangen und gesendet gemeinsam (`←` / `→`). Braucht die Gesendet-Ordner in `mailboxes`, sonst fehlt die eigene Hälfte |
| `get_message_by_id` | Eine Nachricht über ihre message id lesen, samt Fundort `Konto:Mailbox` |
| `get_message_body` | Klartext-Inhalt der ersten passenden Nachricht lesen (für Belege ohne PDF) |
| `save_attachment` | Ersten passenden PDF-Anhang (Name enthält Schlüssel, endet auf .pdf) speichern |
| `save_attachments_by_id` | Anhänge einer Nachricht speichern, beliebige Dateitypen. Für Screenshots aus Support-Anfragen |
| `reply_draft` | Antwort-Entwurf auf eine Nachricht anlegen, mit nativem Reply (Empfänger, `Re:`, Threading) und dem Original als `>`-Zitat |
| `create_draft` | Neuen E-Mail-Entwurf anlegen und sichtbar in Mail öffnen |
| `flag_message` | Fahne an genau einer Nachricht setzen/entfernen, optional mit Farbe; bei mehrdeutigem Schlüssel passiert nichts |
| `mark_read` | Nachrichten auf gelesen/ungelesen setzen, einzeln oder für ein ganzes Zeitfenster |
| `move_message` | Nachricht in eine andere Mailbox verschieben, etwa nach `Erledigt`; fehlende Zielordner werden angelegt |

Kein Tool sendet eine Mail. Antworten entstehen immer als Entwurf, das
Abschicken machst du selbst im Mail-Fenster.

### Nachrichten referenzieren

Nachrichten werden am besten über ihre **message id** adressiert, nicht über
Betreffs. `list_messages`, `list_correspondence` und `get_message_by_id` geben
sie als klickbare `message:%3Cid%3E`-URL aus. Diese URL nehmen
`get_message_by_id`, `reply_draft`, `flag_message`, `mark_read`,
`save_attachments_by_id` und `move_message` entgegen, ebenso die rohe id und die
Form `<id>`. Wo `messageId` gesetzt ist, hat sie Vorrang vor `subjKey` und
`senderKey`.

## Konfiguration

Die Vorgabe-Mailboxen stehen in einer lokalen `config.json`, die nicht
eingecheckt wird. Vorlage kopieren und die eigenen Konten eintragen:

```bash
cp config.example.json config.json
```

Format je Eintrag `<Konto>:<Mailbox>`; die exakten Namen liefert `list_mailboxes`.
Fehlt die Datei, greifen generische Platzhalter. Alternativ übergibt der Aufrufer
die Mailboxen je Tool direkt im `mailboxes`-Parameter.

Zwei Fallstricke bei den Vorgaben:

- **Gesendet-Ordner fehlen** in der Regel, weil sie für die Rechnungssuche nur
  stören. `list_correspondence` braucht sie aber, sonst zeigt es nur die
  eingegangene Hälfte. Dort also `mailboxes` explizit mit Gesendet übergeben.
- **Support-Postfächer** stehen nicht zwingend in der Vorgabe. Für Support-Läufe
  die passenden Postfächer je Aufruf mitgeben oder eine eigene `config.json`
  pflegen. Je mehr Mailboxen in der Vorgabe stehen, desto langsamer wird jede
  Suche.

## Beispielablauf Rechnungen

1. `list_mailboxes` für die exakten Namen.
2. `search_messages` mit `vendors` und `fromDate`, um zu sehen, was als PDF vorliegt
   (Anhangnamen in `ATT{...}`).
3. Pro Treffer `save_attachment` mit `subjKey`, `attKey` und `destPath`.
4. Verarbeitete Rechnung mit `flag_message` markieren; der nächste Lauf findet sie
   über `search_messages` mit `flaggedOnly`.

## Beispielablauf Support

1. `list_messages` mit `unreadOnly`, um die offenen Anfragen zu sehen.
2. Pro Anfrage `get_message_by_id`; hängt ein Screenshot dran,
   `save_attachments_by_id` in einen Arbeitsordner und das Bild ansehen.
3. Bei bekannten Absendern `list_correspondence`, um den bisherigen Verlauf zu
   kennen, bevor man antwortet.
4. `reply_draft` mit der message id schreibt die Antwort samt Zitat als Entwurf.
   Die Signatur gehört mit in `body`, weil Mail beim Ersetzen des Inhalts keine
   Konto-Signatur anfügt.
5. Nach dem Absenden `flag_message` (grün = beantwortet) und `move_message` nach
   `Erledigt`, damit der Posteingang nur offene Vorgänge enthält.
