# @mcps/spotlight

MCP-Server, der die macOS-Spotlight-Suche als Tools bereitstellt: `mdfind`
(Volltext- und Metadatensuche über den Spotlight-Index) und `mdls` (Metadaten
einer Datei). Systemweite Dateisuche, nicht auf eine App beschränkt.

Installation und Registrierung: siehe [Wurzel-README](../../README.md).

## Warum Spotlight statt `locate` oder AppleScript

- **Spotlight (`mdfind`)** indexiert Datei-Inhalt **und** Metadaten und wird live
  aktualisiert. Der richtige Index für Inhaltssuche.
- **`locate`** kennt nur Datei-Pfade/-Namen, keinen Inhalt, und ist oft veraltet.
- **AppleScript-`whose`** ist ein linearer Scan ohne Index.

Hinweis: app-eigene oder verschlüsselte Formate (z. B. Safve-Notizen, KeePass)
stehen nicht als Klartext im Index. Solche Dateien über den **Namen** suchen.

## Tools

| Tool | Zweck |
|------|-------|
| `spotlight_search` | Dateien per `mdfind` finden: Freitext, Dateiname oder rohe Spotlight-Abfrage |
| `spotlight_metadata` | Spotlight-Metadaten einer Datei per `mdls` lesen |

`spotlight_search` erwartet genau eine Suchart:

- `text` — Freitext (Volltext + Metadaten)
- `name` — Teilstring im Dateinamen
- `query` — rohe Spotlight-Abfrage, z. B.
  `kMDItemContentType == "com.adobe.pdf" && kMDItemFSName == "*Rechnung*"c`

Optional `onlyIn` (auf ein Verzeichnis begrenzen) und `limit` (Vorgabe 50).
Geschützte Orte brauchen Full Disk Access (siehe Wurzel-README).
