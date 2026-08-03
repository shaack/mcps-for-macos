import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(here, "..", "config.json");

/**
 * Lädt die lokale, nicht eingecheckte config.json (Kopie von
 * config.example.json). Fehlt sie oder ist sie unlesbar, wird ein leeres
 * Objekt zurückgegeben und die Tools greifen auf ihre Platzhalter zurück.
 * @returns {{ mailboxes?: string[] }}
 */
export function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}
