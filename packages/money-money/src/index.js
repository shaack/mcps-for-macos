#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exportAccounts, exportTransactions } from "./moneymoney.js";

const server = new McpServer({
  name: "money-money",
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
  "export_accounts",
  {
    title: "Konten auflisten",
    description:
      "Exportiert die Kontenliste aus MoneyMoney als plist. Zeigt die exakten " +
      "Kontonamen für den account-Parameter von export_transactions. " +
      "MoneyMoney muss entsperrt sein.",
    inputSchema: {},
  },
  () => run(() => exportAccounts())
);

server.registerTool(
  "export_transactions",
  {
    title: "Umsätze exportieren",
    description:
      "Exportiert die Umsätze eines Kontos in einem Zeitraum. Das plist enthält " +
      "bookingDate, amount, name und purpose je Buchung, in Buchungsreihenfolge je " +
      "Tag. Grundlage für Auswertungen, Abgleiche oder Weiterverarbeitung. " +
      "MoneyMoney muss entsperrt sein.",
    inputSchema: {
      account: z.string().describe('Exakter Kontoname, z. B. "My Checking Account" (siehe export_accounts)'),
      fromDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("Startdatum YYYY-MM-DD (inklusive)"),
      toDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("Enddatum YYYY-MM-DD (inklusive)"),
      format: z
        .enum(["plist", "csv"])
        .optional()
        .describe("Exportformat, Vorgabe plist"),
    },
  },
  (args) => run(() => exportTransactions(args))
);

const transport = new StdioServerTransport();
await server.connect(transport);
