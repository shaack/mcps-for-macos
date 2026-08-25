# mcps-for-macos

Eine Sammlung MCP-Server (Model Context Protocol) für die
macOS-Automatisierung. Jeder Server kapselt eine App bzw. Systemfunktion per
AppleScript oder Kommandozeile und stellt sie als Tools bereit, die eine
KI-Anwendung (Claude Desktop, Claude Code) aufrufen kann.

| Server | Paket | Zweck |
|--------|-------|-------|
| Apple Kalender | [`packages/apple-calendar`](packages/apple-calendar) | Termine lesen und anlegen (Calendar.app) |
| Apple Mail | [`packages/apple-mail`](packages/apple-mail) | Mail suchen und lesen, Anhänge speichern, flaggen, verschieben, Antwort-Entwürfe schreiben |
| MoneyMoney | [`packages/money-money`](packages/money-money) | Konten und Umsätze exportieren |
| Spotlight | [`packages/spotlight`](packages/spotlight) | Systemweite Dateisuche (mdfind/mdls) |

Gemeinsame Helfer (AppleScript-Ausführung samt Escaping, Kommando-Ausführung)
liegen in [`packages/common`](packages/common) und werden von den Servern als
`@mcps/common` genutzt.

## Was ist ein MCP-Server?

MCP ist ein offener Standard, über den KI-Anwendungen (der Host) mit externen
Werkzeugen und Daten sprechen. Ein Server stellt Fähigkeiten (Tools) bereit und
weiß selbst nichts von KI. Kommunikation über JSON-RPC 2.0, hier per stdio
(lokaler Prozess). Registrieren heißt: dem Host hinterlegen, wie der Server zu
starten ist. Der Host startet ihn bei jedem Sitzungsstart als Unterprozess,
fragt seine Tools ab und stellt sie der KI bereit.

## Installation

```bash
npm install
```

Ein `npm install` im Wurzelverzeichnis genügt für alle Server (npm workspaces).
Kein Build-Schritt: reines ESM-JavaScript, Node >= 18.

## Registrieren

Jeder Server wird einzeln registriert, weil jeder ein eigener Prozess ist. Die
Pfade sind absolut anzugeben; `<REPO>` steht für den Pfad zu diesem Repo.

### Claude Code

```bash
# global in allen Projekten (empfohlen für Systemwerkzeuge)
claude mcp add apple-calendar --scope user -- node <REPO>/packages/apple-calendar/src/index.js
claude mcp add apple-mail  --scope user -- node <REPO>/packages/apple-mail/src/index.js
claude mcp add money-money --scope user -- node <REPO>/packages/money-money/src/index.js
claude mcp add spotlight   --scope user -- node <REPO>/packages/spotlight/src/index.js
```

Ohne `--scope user` gilt die Registrierung nur im aktuellen Projekt. Prüfen und
entfernen:

```bash
claude mcp list
claude mcp remove spotlight
```

### Claude Desktop

In `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-calendar": { "command": "node", "args": ["<REPO>/packages/apple-calendar/src/index.js"] },
    "apple-mail":  { "command": "node", "args": ["<REPO>/packages/apple-mail/src/index.js"] },
    "money-money": { "command": "node", "args": ["<REPO>/packages/money-money/src/index.js"] },
    "spotlight":   { "command": "node", "args": ["<REPO>/packages/spotlight/src/index.js"] }
  }
}
```

## macOS-Berechtigungen

- **Automatisierung.** Beim ersten Zugriff fragt macOS nach Automatisierungs-Zugriff
  auf Mail, Kalender bzw. MoneyMoney. Einmal erlauben.
- **Full Disk Access.** Geschützte Orte (z. B. `~/Library/Mail`) liefern nur mit
  Full Disk Access für den ausführenden Prozess Treffer
  (Systemeinstellungen → Datenschutz & Sicherheit → Festplattenvollzugriff).

## Lokal testen

Jeden Server einzeln mit dem MCP Inspector durchklicken:

```bash
npm run inspect -w @mcps/spotlight
```

## Lizenz

MIT
