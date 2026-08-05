#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listMailboxes,
  searchMessages,
  saveAttachment,
  getMessageBody,
  flagMessage,
  createDraft,
  replyDraft,
  DEFAULT_MAILBOXES,
} from "./mail.js";

const server = new McpServer({
  name: "apple-mail",
  version: "0.1.0",
});

// Kleiner Wrapper: Ergebnis als Text zurückgeben, Fehler als isError-Antwort.
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
  "list_mailboxes",
  {
    title: "Mailboxen auflisten",
    description:
      "Listet alle Apple-Mail-Konten und Mailboxen als \"<Konto>:<Mailbox>\"-Zeilen. " +
      "Damit findet man die exakten Namen für den mailboxes-Parameter der anderen Tools.",
    inputSchema: {},
  },
  () => run(() => listMailboxes())
);

server.registerTool(
  "search_messages",
  {
    title: "Nachrichten suchen",
    description:
      "Sucht Nachrichten in einem Zeitfenster und listet Treffer samt Anhangnamen " +
      "(ATT{...}) und Flaggen-Markierung (⚑ plus Farbname). So sieht man sofort, was als " +
      "PDF vorliegt. Filtert nach Absender-Stichworten, nur geflaggten Nachrichten und/oder " +
      "einer bestimmten Fahnenfarbe (flagColor); ohne einen dieser Filter käme alles zurück. " +
      "Dedupliziert über die message id.",
    inputSchema: {
      vendors: z
        .array(z.string())
        .optional()
        .describe('Absender-Stichworte, z. B. ["hosting", "software-vendor"]. Weglassen, um nur nach flaggedOnly zu filtern.'),
      fromDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("Startdatum des Zeitfensters, YYYY-MM-DD (inklusive)"),
      days: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Länge des Zeitfensters in Tagen (Vorgabe 91, gut ein Quartal)"),
      flaggedOnly: z
        .boolean()
        .optional()
        .describe("Nur geflaggte Nachrichten (flagged status is true). Ohne vendors nutzbar."),
      flagColor: z
        .number()
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe(
          "Nur Nachrichten mit dieser Fahnenfarbe (0=rot, 1=orange, 2=gelb, 3=grün, " +
            "4=blau, 5=lila, 6=grau). Impliziert geflaggt und ist allein nutzbar."
        ),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe(
          'Zu durchsuchende Mailboxen als "<Konto>:<Mailbox>". Vorgabe: ' +
            DEFAULT_MAILBOXES.join(", ")
        ),
    },
  },
  (args) => run(() => searchMessages(args))
);

server.registerTool(
  "save_attachment",
  {
    title: "Anhang speichern",
    description:
      "Speichert den ersten passenden PDF-Anhang einer über den Betreff gefundenen " +
      "Nachricht. Ein Anhang passt nur, wenn sein Name attKey enthält und auf .pdf endet " +
      "(sortiert AGB, Werbe-PDFs, XML und Bilder aus). Der Zielordner wird angelegt.",
    inputSchema: {
      subjKey: z.string().describe("Teilstring, der im Betreff vorkommen muss"),
      attKey: z.string().describe("Teilstring, der im Anhangnamen vorkommen muss"),
      destPath: z
        .string()
        .describe("Absoluter Zielpfad, z. B. /path/to/2026-04/2026-04-14 Anbieter Rechnung.pdf"),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe("Zu durchsuchende Mailboxen. Vorgabe wie bei search_messages."),
    },
  },
  (args) => run(() => saveAttachment(args))
);

server.registerTool(
  "get_message_body",
  {
    title: "Mailtext lesen",
    description:
      "Liefert den Klartext-Inhalt der ersten passenden Nachricht samt Kopf (From, " +
      "Subject, Date). Für Belege, die nur im Mailtext stehen und kein PDF anhängen. " +
      "Mindestens subjKey oder senderKey angeben.",
    inputSchema: {
      subjKey: z.string().optional().describe("Teilstring, der im Betreff vorkommen muss"),
      senderKey: z.string().optional().describe("Teilstring, der im Absender vorkommen muss"),
      maxChars: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Ausgabe auf so viele Zeichen kürzen (Vorgabe 20000)"),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe("Zu durchsuchende Mailboxen. Vorgabe wie bei search_messages."),
    },
  },
  (args) => run(() => getMessageBody(args))
);

server.registerTool(
  "flag_message",
  {
    title: "Nachricht flaggen",
    description:
      "Setzt oder entfernt die Fahne an GENAU EINER Nachricht, optional mit Farbe " +
      "(flagIndex 0-6: rot, orange, gelb, grün, blau, lila, grau). Passt der Schlüssel " +
      "auf mehrere Nachrichten, wird nichts geändert und die Mehrdeutigkeit gemeldet " +
      "(Schlüssel verengen). Praktisch, um eine verarbeitete Rechnung zu markieren. " +
      "Mindestens subjKey oder senderKey angeben. Verändert die Nachricht.",
    inputSchema: {
      subjKey: z.string().optional().describe("Teilstring, der im Betreff vorkommen muss"),
      senderKey: z.string().optional().describe("Teilstring, der im Absender vorkommen muss"),
      flagged: z
        .boolean()
        .optional()
        .describe("true = flaggen (Vorgabe), false = Fahne entfernen"),
      flagIndex: z
        .number()
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe("Fahnenfarbe 0-6 (nur bei flagged=true)"),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe("Zu durchsuchende Mailboxen. Vorgabe wie bei search_messages."),
    },
  },
  (args) => run(() => flagMessage(args))
);

server.registerTool(
  "create_draft",
  {
    title: "Entwurf anlegen",
    description:
      "Legt einen E-Mail-ENTWURF an und öffnet ihn sichtbar in Mail. Sendet bewusst " +
      "NICHT: Empfänger, Betreff und Text sind ausgefüllt, das Abschicken macht der " +
      "Nutzer selbst im Mail-Fenster. Mindestens eine to-Adresse angeben.",
    inputSchema: {
      to: z.array(z.string()).min(1).describe("Empfängeradressen (mindestens eine)"),
      cc: z.array(z.string()).optional().describe("CC-Adressen"),
      bcc: z.array(z.string()).optional().describe("BCC-Adressen"),
      subject: z.string().optional().describe("Betreff"),
      body: z.string().optional().describe("Nachrichtentext (Klartext)"),
      from: z
        .string()
        .optional()
        .describe('Absender, z. B. "Name <a@b.de>" (sonst Standardkonto)'),
    },
  },
  (args) => run(() => createDraft(args))
);

server.registerTool(
  "reply_draft",
  {
    title: "Antwort-Entwurf anlegen",
    description:
      "Legt einen ANTWORT-Entwurf auf genau eine per subjKey/senderKey gefundene " +
      "Nachricht an und öffnet ihn sichtbar in Mail. Nutzt Mails natives Reply " +
      "(Empfänger, \"Re:\"-Betreff, Threading), der Inhalt wird durch body plus das " +
      "Original als \">\"-Zitat mit Attributionszeile ersetzt. Mail fügt dabei KEINE " +
      "Konto-Signatur an, die Signatur gehört mit in body. Sendet bewusst NICHT. " +
      "Bei mehreren Treffern wird ohne pickLatest abgelehnt. " +
      "Mindestens subjKey oder senderKey angeben.",
    inputSchema: {
      subjKey: z.string().optional().describe("Teilstring im Betreff der Original-Mail"),
      senderKey: z.string().optional().describe("Teilstring im Absender der Original-Mail"),
      body: z
        .string()
        .optional()
        .describe("Antworttext (Klartext, inkl. Grußformel und Signatur)"),
      replyAll: z.boolean().optional().describe("Allen antworten statt nur dem Absender"),
      pickLatest: z
        .boolean()
        .optional()
        .describe("Bei mehreren Treffern die neueste Nachricht nehmen statt abzulehnen"),
      from: z
        .string()
        .optional()
        .describe('Absender erzwingen, z. B. "Name <a@b.de>" (sonst wählt Mail das Empfängerkonto)'),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe("Zu durchsuchende Mailboxen. Vorgabe wie bei search_messages."),
    },
  },
  (args) => run(() => replyDraft(args))
);

const transport = new StdioServerTransport();
await server.connect(transport);
