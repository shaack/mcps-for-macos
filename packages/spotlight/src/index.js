#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spotlightSearch, spotlightMetadata } from "./spotlight.js";

const server = new McpServer({
  name: "spotlight",
  version: "0.1.0",
});

function textResult(text) {
  return { content: [{ type: "text", text: text || "(leer)" }] };
}
async function run(fn) {
  try {
    return textResult(await fn());
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Fehler: ${err.message}` }] };
  }
}

server.registerTool(
  "spotlight_search",
  {
    title: "Spotlight-Suche",
    description:
      "Durchsucht den macOS-Spotlight-Index (mdfind) nach Dateien: Volltext und " +
      "Metadaten. Genau eine Suchart angeben: text (Freitext), name (Dateiname) oder " +
      "query (rohe Spotlight-Abfrage). Liefert Dateipfade. Hinweis: geschützte Orte wie " +
      "~/Library/Mail liefern nur mit Full Disk Access Treffer.",
    inputSchema: {
      text: z.string().optional().describe('Freitext (Volltext + Metadaten), z. B. "Quartalsbericht"'),
      name: z.string().optional().describe("Teilstring im Dateinamen"),
      query: z
        .string()
        .optional()
        .describe('Rohe Spotlight-Abfrage, z. B. kMDItemContentType == "com.adobe.pdf"'),
      onlyIn: z.string().optional().describe("Suche auf ein Verzeichnis begrenzen (absoluter Pfad)"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Ausgabe auf so viele Pfade begrenzen (Vorgabe 50)"),
    },
  },
  (args) => run(() => spotlightSearch(args))
);

server.registerTool(
  "spotlight_metadata",
  {
    title: "Datei-Metadaten",
    description:
      "Liest die von Spotlight indexierten Metadaten einer Datei (mdls). Ohne " +
      "attributes alle, sonst nur die genannten (z. B. kMDItemContentType, " +
      "kMDItemContentCreationDate).",
    inputSchema: {
      path: z.string().describe("Absoluter Dateipfad"),
      attributes: z
        .array(z.string())
        .optional()
        .describe('Attributnamen, z. B. ["kMDItemContentType", "kMDItemPixelHeight"]'),
    },
  },
  (args) => run(() => spotlightMetadata(args))
);

const transport = new StdioServerTransport();
await server.connect(transport);
