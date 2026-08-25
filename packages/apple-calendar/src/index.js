#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listCalendars, listEvents, createEvent, DEFAULT_CALENDARS } from "./calendar.js";

const server = new McpServer({
  name: "apple-calendar",
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
  "list_calendars",
  {
    title: "Kalender auflisten",
    description:
      "Listet alle Kalender aus Calendar.app, ein Name pro Zeile. Damit findet man " +
      "die exakten Namen für den calendars-Parameter von list_events und den " +
      "calendar-Parameter von create_event.",
    inputSchema: {},
  },
  () => run(() => listCalendars())
);

server.registerTool(
  "list_events",
  {
    title: "Termine auflisten",
    description:
      "Listet Termine eines Zeitfensters chronologisch, eine Zeile pro Termin: " +
      '"YYYY-MM-DD HH:MM-HH:MM | Kalender | Titel | Ort", ganztägige als ' +
      '"(ganztägig)". Fallstrick Serientermine: Calendar.app liefert nur den ' +
      "Serien-Stamm mit seinem ursprünglichen Startdatum. Serien mit Beginn vor dem " +
      "Fenster stehen darum in einem eigenen Abschnitt mit ihrer Wiederholungsregel " +
      "(RRULE); ob eine Wiederholung ins Fenster fällt, aus der Regel ableiten.",
    inputSchema: {
      fromDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Startdatum YYYY-MM-DD (inklusive), Vorgabe heute"),
      days: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Länge des Zeitfensters in Tagen (Vorgabe 7)"),
      calendars: z
        .array(z.string())
        .optional()
        .describe(
          "Nur diese Kalender durchsuchen (exakte Namen aus list_calendars). Vorgabe: " +
            (DEFAULT_CALENDARS.length > 0 ? DEFAULT_CALENDARS.join(", ") : "alle (langsam, besser eingrenzen)")
        ),
      searchKey: z
        .string()
        .optional()
        .describe("Nur Termine, deren Titel diesen Teilstring enthält"),
      includeRecurring: z
        .boolean()
        .optional()
        .describe("Abschnitt mit Serien anhängen, die vor dem Fenster begonnen haben (Vorgabe true)"),
    },
  },
  (args) => run(() => listEvents(args))
);

server.registerTool(
  "create_event",
  {
    title: "Termin anlegen",
    description:
      "Legt einen neuen Termin in einem Kalender an; der Kalender muss existieren " +
      "und beschreibbar sein (abonnierte wie Feiertage sind es nicht). Ohne end " +
      "dauert der Termin durationMinutes (Vorgabe 60), ein ganztägiger einen Tag. " +
      "Bei allday ist end der letzte Tag INKLUSIVE. Verändert den Kalender.",
    inputSchema: {
      calendar: z.string().describe("Exakter Kalendername (siehe list_calendars)"),
      summary: z.string().describe("Titel des Termins"),
      start: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/)
        .describe('Beginn "YYYY-MM-DD HH:MM", bei allday reicht "YYYY-MM-DD"'),
      end: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/)
        .optional()
        .describe('Ende "YYYY-MM-DD HH:MM"; bei allday letzter Tag "YYYY-MM-DD" (inklusive)'),
      allday: z.boolean().optional().describe("Ganztägiger Termin (Vorgabe false)"),
      durationMinutes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Dauer in Minuten, wenn end fehlt (Vorgabe 60, nicht bei allday)"),
      location: z.string().optional().describe("Ort"),
      description: z.string().optional().describe("Notizen zum Termin"),
    },
  },
  (args) => run(() => createEvent(args))
);

const transport = new StdioServerTransport();
await server.connect(transport);
