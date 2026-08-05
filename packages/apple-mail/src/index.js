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
  listMessages,
  getMessageById,
  markRead,
  saveAttachmentsById,
  listCorrespondence,
  moveMessage,
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
      "(ATT{...}) und Flaggen-Markierung (⚑ plus Farbname). Filtert nach " +
      "Absender-Stichworten, nur geflaggten Nachrichten und/oder einer bestimmten " +
      "Fahnenfarbe (flagColor); ohne einen dieser Filter käme alles zurück. " +
      "Dedupliziert über die message id. Für ein Zeitfenster ohne Filter, mit " +
      "Lesestatus und message id je Zeile, ist list_messages der passendere Weg.",
    inputSchema: {
      senderKeys: z
        .array(z.string())
        .optional()
        .describe('Absender-Stichworte, z. B. ["example.com", "Meier"]. Weglassen, um nur nach flaggedOnly oder flagColor zu filtern.'),
      vendors: z
        .array(z.string())
        .optional()
        .describe("Veralteter Name für senderKeys; greift nur, wenn senderKeys leer ist."),
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
        .describe("Nur geflaggte Nachrichten (flagged status is true). Ohne senderKeys nutzbar."),
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
      "Speichert den ersten passenden Anhang einer über den Betreff gefundenen " +
      "Nachricht unter einem festen Zielpfad. Ein Anhang passt, wenn sein Name attKey " +
      "enthält und auf endsWith endet (Vorgabe \".pdf\", damit Bilder und Beiwerk nicht " +
      "mitkommen; leer setzen hebt das auf). Der Zielordner wird angelegt. Für alle " +
      "Anhänge einer eindeutig bestimmten Nachricht: save_attachments_by_id.",
    inputSchema: {
      subjKey: z.string().describe("Teilstring, der im Betreff vorkommen muss"),
      attKey: z.string().describe("Teilstring, der im Anhangnamen vorkommen muss"),
      destPath: z
        .string()
        .describe("Absoluter Zielpfad inklusive Dateiname, z. B. /pfad/zum/ordner/2026-04-14 Dokument.pdf"),
      endsWith: z
        .string()
        .optional()
        .describe('Endung, auf die der Anhangname enden muss (Vorgabe ".pdf"); "" erlaubt jeden Dateityp'),
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
      "To, Cc, Subject, Date). Für Inhalte, die im Mailtext selbst stehen und nicht als Anhang. " +
      "Mindestens subjKey oder senderKey angeben; über die message id geht get_message_by_id.",
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
      "(Schlüssel verengen). Praktisch, um bearbeitete Nachrichten zu markieren. " +
      "Mindestens messageId, subjKey oder senderKey angeben; messageId hat Vorrang. " +
      "Verändert die Nachricht.",
    inputSchema: {
      messageId: z
        .string()
        .optional()
        .describe('message id (rohe id, "<id>" oder "message:%3Cid%3E"-URL); eindeutigste Referenz'),
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
      "Legt einen E-Mail-ENTWURF an, per Vorgabe still im Entwurfsordner ohne " +
      "Fenster (visible: true öffnet ihn sichtbar). Sendet bewusst NICHT: Empfänger, " +
      "Betreff und Text sind ausgefüllt, das Abschicken macht der Nutzer selbst in " +
      "Mail. Mindestens eine to-Adresse angeben.",
    inputSchema: {
      to: z.array(z.string()).min(1).describe("Empfängeradressen (mindestens eine)"),
      cc: z.array(z.string()).optional().describe("CC-Adressen"),
      bcc: z.array(z.string()).optional().describe("BCC-Adressen"),
      subject: z.string().optional().describe("Betreff"),
      body: z.string().optional().describe("Nachrichtentext (Klartext)"),
      visible: z
        .boolean()
        .optional()
        .describe("Entwurf sichtbar in einem Fenster öffnen statt still im Entwurfsordner ablegen (Vorgabe false)"),
      from: z
        .string()
        .optional()
        .describe('Absender, z. B. "Name <a@b.de>" (sonst Standardkonto)'),
    },
  },
  (args) => run(() => createDraft(args))
);

server.registerTool(
  "list_messages",
  {
    title: "Nachrichten auflisten",
    description:
      "Listet Nachrichten eines Zeitfensters, neueste zuerst, eine Zeile pro Nachricht: " +
      "\"YYYY-MM-DD HH:MM | Status | Absender | Betreff | message:%3Cid%3E\". Status ist " +
      "\"•\" für ungelesen und \"⚑ farbe\" für geflaggt. Die message:-URL ist die eindeutige " +
      "Referenz für get_message_by_id, flag_message, mark_read und move_message. " +
      "Bewusst ohne Pflichtfilter — für kleine Postfächer oder kurze Zeiträume " +
      "(für breite Suchen search_messages nehmen). unreadOnly schränkt auf Ungelesenes ein.",
    inputSchema: {
      fromDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Startdatum YYYY-MM-DD (inklusive); ohne Angabe zählt das Fenster von heute zurück"),
      days: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Länge des Zeitfensters in Tagen (Vorgabe 7)"),
      unreadOnly: z
        .boolean()
        .optional()
        .describe("Nur ungelesene Nachrichten"),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe("Zu durchsuchende Mailboxen. Vorgabe wie bei search_messages."),
    },
  },
  (args) => run(() => listMessages(args))
);

server.registerTool(
  "get_message_by_id",
  {
    title: "Nachricht per message id lesen",
    description:
      "Liefert Kopf (From, To, Cc, Subject, Date), Fundort (Konto:Mailbox) und " +
      "Klartext-Inhalt der Nachricht mit genau dieser message id. Akzeptiert die rohe id, \"<id>\" und die klickbare " +
      "\"message:%3Cid%3E\"-URL aus list_messages bzw. macOS Mail.",
    inputSchema: {
      messageId: z.string().describe('message id, z. B. "message:%3Cabc@mail.example%3E" oder "abc@mail.example"'),
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
  (args) => run(() => getMessageById(args))
);

server.registerTool(
  "mark_read",
  {
    title: "Als gelesen/ungelesen markieren",
    description:
      "Setzt Nachrichten auf gelesen (Vorgabe) oder ungelesen. Entweder genau eine " +
      "Nachricht per messageId oder — mit allInWindow — alle Nachrichten eines " +
      "Zeitfensters. Verändert die Nachricht.",
    inputSchema: {
      messageId: z
        .string()
        .optional()
        .describe('message id (rohe id, "<id>" oder "message:%3Cid%3E"-URL)'),
      read: z.boolean().optional().describe("true = gelesen (Vorgabe), false = ungelesen"),
      allInWindow: z
        .boolean()
        .optional()
        .describe("Statt einer messageId: alle Nachrichten im Zeitfenster markieren"),
      fromDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Startdatum YYYY-MM-DD (nur mit allInWindow)"),
      days: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Länge des Zeitfensters in Tagen (nur mit allInWindow, Vorgabe 7)"),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe("Zu durchsuchende Mailboxen. Vorgabe wie bei search_messages."),
    },
  },
  (args) => run(() => markRead(args))
);

server.registerTool(
  "save_attachments_by_id",
  {
    title: "Anhänge einer Nachricht speichern",
    description:
      "Speichert die Anhänge der über die message id bestimmten Nachricht in einen " +
      "Ordner, unabhängig vom Dateityp (Bilder danach mit dem Read-Tool ansehbar). " +
      "Mit nameKey lässt sich auf bestimmte Anhänge einschränken. Anders als " +
      "save_attachment adressiert das die Nachricht eindeutig und speichert alle Treffer.",
    inputSchema: {
      messageId: z.string().describe('message id (rohe id, "<id>" oder "message:%3Cid%3E"-URL)'),
      destDir: z.string().describe("Zielordner (POSIX, absolut). Wird angelegt."),
      nameKey: z
        .string()
        .optional()
        .describe("Nur Anhänge, deren Name diesen Teilstring enthält"),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe("Zu durchsuchende Mailboxen. Vorgabe wie bei search_messages."),
    },
  },
  (args) => run(() => saveAttachmentsById(args))
);

server.registerTool(
  "list_correspondence",
  {
    title: "Korrespondenz mit einer Adresse",
    description:
      "Listet den gesamten Schriftwechsel mit einer Adresse chronologisch (älteste " +
      "zuerst), eingegangene und selbst gesendete Nachrichten gemeinsam: " +
      "\"YYYY-MM-DD HH:MM | ← bzw. → | Betreff | message:%3Cid%3E\". Damit sieht man den " +
      "ganzen Verlauf mit einem Gegenüber auf einen Blick. In mailboxes gehören dafür " +
      "Posteingang, Archiv UND die Gesendet-Ordner.",
    inputSchema: {
      addressKey: z
        .string()
        .describe('Adresse oder Teilstring, z. B. "person@example.com"'),
      days: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Wie weit zurück gesucht wird (Vorgabe 365)"),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe("Zu durchsuchende Mailboxen, inkl. Gesendet. Vorgabe wie bei search_messages."),
    },
  },
  (args) => run(() => listCorrespondence(args))
);

server.registerTool(
  "move_message",
  {
    title: "Nachricht verschieben",
    description:
      "Verschiebt die über die message id bestimmte Nachricht in eine andere Mailbox, " +
      "etwa in einen Ablage- oder Archivordner. targetMailbox ist ein blosser Name " +
      "(dann im Konto der Nachricht) oder \"<Konto>:<Mailbox>\". Fehlt der Ordner, wird " +
      "er angelegt (createIfMissing). Verändert das Postfach.",
    inputSchema: {
      messageId: z.string().describe('message id (rohe id, "<id>" oder "message:%3Cid%3E"-URL)'),
      targetMailbox: z
        .string()
        .describe('Zielmailbox, z. B. "Archiv" oder "person@example.com:Archiv"'),
      createIfMissing: z
        .boolean()
        .optional()
        .describe("Zielmailbox anlegen, wenn sie fehlt (Vorgabe true)"),
      mailboxes: z
        .array(z.string())
        .optional()
        .describe("Zu durchsuchende Mailboxen. Vorgabe wie bei search_messages."),
    },
  },
  (args) => run(() => moveMessage(args))
);

const transport = new StdioServerTransport();
await server.connect(transport);
