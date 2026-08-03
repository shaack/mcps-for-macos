import { run } from "@mcps/common";

/**
 * Durchsucht den Spotlight-Index per mdfind. Genau eine Suchart wählen:
 *   - text:  Freitext (Volltext + Metadaten), z. B. "Quartalsbericht"
 *   - name:  Teilstring im Dateinamen (mdfind -name)
 *   - query: rohe Spotlight-Abfrage, z. B.
 *            'kMDItemContentType == "com.adobe.pdf" && kMDItemFSName == "*Rechnung*"c'
 *
 * @param {object} opts
 * @param {string} [opts.text]
 * @param {string} [opts.name]
 * @param {string} [opts.query]
 * @param {string} [opts.onlyIn] Suche auf ein Verzeichnis begrenzen (-onlyin)
 * @param {number} [opts.limit=50] Ausgabe auf so viele Pfade begrenzen
 * @returns {Promise<string>}
 */
export async function spotlightSearch({ text = "", name = "", query = "", onlyIn = "", limit = 50 }) {
  const modes = [text, name, query].filter(Boolean).length;
  if (modes === 0) throw new Error("Mindestens text, name oder query angeben.");
  if (modes > 1) throw new Error("Nur eine Suchart angeben (text, name oder query).");

  const args = [];
  if (onlyIn) args.push("-onlyin", onlyIn);
  if (query) args.push(query);
  else if (name) args.push("-name", name);
  else args.push(text);

  const out = await run("mdfind", args);
  const lines = out.split("\n").filter(Boolean);
  const total = lines.length;
  if (total === 0) return "Keine Treffer.";
  const shown = lines.slice(0, limit);
  const head = total > limit ? `${total} Treffer (zeige ${limit}):` : `${total} Treffer:`;
  return head + "\n" + shown.join("\n");
}

/**
 * Liest die von Spotlight indexierten Metadaten einer Datei per mdls.
 * Ohne attributes alle, sonst nur die genannten (z. B. kMDItemContentType).
 *
 * @param {object} opts
 * @param {string} opts.path Absoluter Dateipfad
 * @param {string[]} [opts.attributes] Attributnamen, z. B. ["kMDItemContentType"]
 * @returns {Promise<string>}
 */
export async function spotlightMetadata({ path, attributes = [] }) {
  if (!path) throw new Error("path angeben.");
  const args = [];
  for (const a of attributes) args.push("-name", a);
  args.push(path);
  return run("mdls", args);
}
