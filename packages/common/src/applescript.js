import { execFile } from "node:child_process";

/**
 * Führt ein AppleScript per osascript aus und liefert stdout als String.
 * Bei einem Fehler wird stderr (die AppleScript-Fehlermeldung) durchgereicht.
 * @param {string} source AppleScript-Quelltext
 * @returns {Promise<string>}
 */
export function runAppleScript(source) {
  // Test-/Debug-Haken: mit MCP_APPLESCRIPT_DRYRUN=1 wird nur der generierte
  // Quelltext zurückgegeben, statt ihn auszuführen (kein Mail-Zugriff).
  if (process.env.MCP_APPLESCRIPT_DRYRUN === "1") {
    return Promise.resolve(source);
  }
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", source],
      { maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr && stderr.trim()) || err.message;
          reject(new Error(msg));
          return;
        }
        resolve(stdout.toString());
      }
    );
  });
}

/**
 * Escaped einen String für die Einbettung in ein doppelt gequotetes
 * AppleScript-Literal. Verhindert Skript-Injection über Suchbegriffe/Pfade.
 * @param {string} value
 * @returns {string} das fertige Literal inklusive Anführungszeichen
 */
export function asStr(value) {
  return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * Baut ein AppleScript-Listenliteral, z. B. {"a", "b"}.
 * @param {string[]} values
 * @returns {string}
 */
export function asList(values) {
  return "{" + values.map(asStr).join(", ") + "}";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Erzeugt AppleScript-Zeilen, die eine Datumsvariable auf Mitternacht des
 * angegebenen Tages setzen. Nutzt bewusst `current date` plus Einzelfelder
 * statt `date "..."`, weil Klartext-Datumsangaben locale-abhängig sind.
 * @param {string} varName Name der AppleScript-Variablen
 * @param {string} isoDate Datum als YYYY-MM-DD
 * @returns {string}
 */
export function dateSetter(varName, isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`Ungültiges Datum (erwartet YYYY-MM-DD): ${isoDate}`);
  const [, year, month, day] = m;
  const monthConst = MONTHS[Number(month) - 1];
  if (!monthConst) throw new Error(`Ungültiger Monat: ${month}`);
  return [
    `set ${varName} to (current date)`,
    `set year of ${varName} to ${Number(year)}`,
    `set month of ${varName} to ${monthConst}`,
    `set day of ${varName} to ${Number(day)}`,
    `set time of ${varName} to 0`,
  ].join("\n");
}
