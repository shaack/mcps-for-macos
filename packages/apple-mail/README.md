# @mcps/apple-mail

MCP-Server, der Apple Mail per AppleScript kapselt: Nachrichten finden und lesen,
Anhänge ablegen, flaggen, verschieben, Antwort-Entwürfe schreiben. Ohne
Zugangsdaten, weil Apple Mail eine vollständige AppleScript-Schnittstelle hat und
die Konten bereits eingerichtet sind.

Die Tools sind absichtlich workflow-neutral. Was ein Postfach bedeutet, welche
Fahnenfarbe wofür steht und wohin abgelegt wird, entscheidet der Aufrufer über
Parameter, nicht der Server.

Installation und Registrierung: siehe [Wurzel-README](../../README.md).

## Tools

| Tool | Zweck |
|------|-------|
| `list_mailboxes` | Alle Konten und Mailboxen als `<Konto>:<Mailbox>` auflisten |
| `list_messages` | Zeitfenster auflisten, neueste zuerst, mit Status (`•` ungelesen, `⚑` geflaggt) und `message:`-URL je Zeile; `unreadOnly` schränkt auf Ungelesenes ein |
| `search_messages` | Im Zeitfenster nach Absender-Stichworten (`senderKeys`), nur geflaggten Nachrichten oder einer Fahnenfarbe (`flagColor`) suchen, mit Anhangnamen und Flaggen-Markierung (⚑) |
| `list_correspondence` | Gesamten Schriftwechsel mit einer Adresse chronologisch zeigen, eingegangen und gesendet gemeinsam (`←` / `→`). Braucht die Gesendet-Ordner in `mailboxes`, sonst fehlt die eigene Hälfte |
| `get_message_by_id` | Eine Nachricht über ihre message id lesen, samt Fundort `Konto:Mailbox` |
| `get_message_body` | Klartext-Inhalt der ersten passenden Nachricht lesen, gefunden über Betreff oder Absender |
| `save_attachment` | Ersten passenden Anhang unter festem Zielpfad speichern; Endungsfilter `endsWith` (Vorgabe `.pdf`) |
| `save_attachments_by_id` | Alle Anhänge einer per message id bestimmten Nachricht speichern, beliebige Dateitypen |
| `reply_draft` | Antwort-Entwurf auf eine Nachricht anlegen, mit nativem Reply (Empfänger, `Re:`, Threading) und dem Original als `>`-Zitat |
| `create_draft` | Neuen E-Mail-Entwurf anlegen und sichtbar in Mail öffnen |
| `flag_message` | Fahne an genau einer Nachricht setzen/entfernen, optional mit Farbe; bei mehrdeutigem Schlüssel passiert nichts |
| `mark_read` | Nachrichten auf gelesen/ungelesen setzen, einzeln oder für ein ganzes Zeitfenster |
| `move_message` | Nachricht in eine andere Mailbox verschieben, etwa in eine Ablage; fehlende Zielordner werden angelegt |

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

- **Gesendet-Ordner** stehen meist nicht in der Vorgabe, weil sie die meisten
  Suchen nur aufblähen. `list_correspondence` braucht sie aber, sonst zeigt es
  nur die eingegangene Hälfte. Dort `mailboxes` explizit mit Gesendet übergeben.
- **Postfächer je Aufgabe.** Die Vorgabe deckt selten alle Konten ab. Entweder
  je Aufruf die passenden Postfächer mitgeben oder die `config.json` erweitern.
  Je mehr Mailboxen in der Vorgabe stehen, desto langsamer wird jede Suche.

## Beispielabläufe

Zwei Muster, wie sich die Tools kombinieren lassen. Beides sind Beispiele, keine
eingebauten Abläufe; Fahnenfarben und Ordnernamen legt der Aufrufer fest.

**Dokumente aus Anhängen sammeln**

1. `list_mailboxes` für die exakten Namen.
2. `search_messages` mit `senderKeys` und `fromDate`, um zu sehen, was mit Anhang
   vorliegt (Anhangnamen in `ATT{...}`).
3. Pro Treffer `save_attachment` mit `subjKey`, `attKey` und `destPath`.
4. Erledigte Nachricht mit `flag_message` markieren; der nächste Lauf findet sie
   über `search_messages` mit `flaggedOnly` oder `flagColor` wieder.

**Anfragen beantworten**

1. `list_messages` mit `unreadOnly` für das noch Unbearbeitete.
2. Pro Nachricht `get_message_by_id`; hängen Bilder dran,
   `save_attachments_by_id` in einen Arbeitsordner und ansehen.
3. Bei bekannten Gegenübern `list_correspondence` für den bisherigen Verlauf.
4. `reply_draft` mit der message id schreibt die Antwort samt Zitat als Entwurf.
   Eine Signatur gehört mit in `body`, weil Mail beim Ersetzen des Inhalts keine
   Konto-Signatur anfügt.
5. Nach dem Absenden `flag_message` und `move_message` in eine Ablage, damit der
   Posteingang nur Unerledigtes enthält.
