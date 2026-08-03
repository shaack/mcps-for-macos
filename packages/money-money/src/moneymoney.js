import { runAppleScript, asStr } from "@mcps/common";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Exportiert die Kontenliste als plist. Zeigt die exakten Kontonamen, die
 * `export_transactions` im account-Parameter braucht.
 * MoneyMoney muss entsperrt sein.
 * @returns {Promise<string>}
 */
export function exportAccounts() {
  const script = `tell application "MoneyMoney" to export accounts`;
  return runAppleScript(script);
}

/**
 * Exportiert die Umsätze eines Kontos in einem Zeitraum. Das Ergebnis (bei
 * Format plist mit bookingDate, amount, name, purpose) ist die Soll-Liste der
 * Abbuchungen, gegen die die gesammelten Rechnungen abgeglichen werden.
 * MoneyMoney muss entsperrt sein.
 *
 * @param {object} opts
 * @param {string} opts.account Exakter Kontoname (siehe export_accounts)
 * @param {string} opts.fromDate Startdatum YYYY-MM-DD (inklusive)
 * @param {string} opts.toDate Enddatum YYYY-MM-DD (inklusive)
 * @param {"plist"|"csv"} [opts.format="plist"] Exportformat
 * @returns {Promise<string>}
 */
export function exportTransactions({ account, fromDate, toDate, format = "plist" }) {
  if (!account) throw new Error("account darf nicht leer sein");
  if (!ISO_DATE.test(fromDate)) throw new Error(`fromDate erwartet YYYY-MM-DD: ${fromDate}`);
  if (!ISO_DATE.test(toDate)) throw new Error(`toDate erwartet YYYY-MM-DD: ${toDate}`);
  if (format !== "plist" && format !== "csv") {
    throw new Error(`format muss "plist" oder "csv" sein: ${format}`);
  }
  const script =
    `tell application "MoneyMoney" to export transactions ` +
    `from account ${asStr(account)} ` +
    `from date ${asStr(fromDate)} to date ${asStr(toDate)} ` +
    `as ${asStr(format)}`;
  return runAppleScript(script);
}
