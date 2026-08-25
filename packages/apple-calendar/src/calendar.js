import { runAppleScript, asStr, asList, dateTimeSetter } from "@mcps/common";
import { loadConfig } from "./config.js";

/**
 * Vorgabe-Kalender für list_events, aus der lokalen, nicht eingecheckten
 * config.json (Kopie von config.example.json). Fehlt sie, ist die Liste leer
 * und es werden alle Kalender durchsucht; das kann bei Geburtstags- und
 * abonnierten Kalendern spürbar langsam sein.
 */
export const DEFAULT_CALENDARS = loadConfig().calendars ?? [];

/**
 * AppleScript-Zeilen, die eine Datumsvariable `src` als "YYYY-MM-DD HH:MM" in
 * die Textvariable `dest` schreiben. Bewusst selbst gebaut statt `as string`,
 * weil die AppleScript-Textform locale-abhängig ist.
 * @param {string} src Name der Datumsvariablen
 * @param {string} dest Name der Zielvariablen (Text)
 * @returns {string}
 */
function dateTimeStr(src, dest) {
  return `set ${dest} to ((year of ${src}) as string) & "-" ¬
  & (text -2 thru -1 of ("0" & ((month of ${src}) as integer))) & "-" ¬
  & (text -2 thru -1 of ("0" & (day of ${src}))) & " " ¬
  & (text -2 thru -1 of ("0" & (hours of ${src}))) & ":" ¬
  & (text -2 thru -1 of ("0" & (minutes of ${src})))`;
}

/**
 * Heutiges Datum (lokale Zeit) als YYYY-MM-DD.
 * @returns {string}
 */
function todayIso() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * Verschiebt einen ISO-Tag um `delta` Tage. Mittags gerechnet, damit die
 * UTC-Umrechnung von toISOString den Tag nicht kippt.
 * @param {string} isoDay YYYY-MM-DD
 * @param {number} delta
 * @returns {string}
 */
function shiftDay(isoDay, delta) {
  const d = new Date(isoDay + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Prüft am RRULE-Text, ob eine Serie sicher vor dem Tag endet (UNTIL=...).
 * Serien mit COUNT lassen sich ohne Expansion nicht bewerten und bleiben drin.
 * @param {string} rec RRULE, z. B. "FREQ=WEEKLY;UNTIL=20240101T000000Z"
 * @param {string} isoDay YYYY-MM-DD
 * @returns {boolean}
 */
function seriesEndsBefore(rec, isoDay) {
  const m = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(rec);
  if (!m) return false;
  return `${m[1]}-${m[2]}-${m[3]}` < isoDay;
}

/**
 * Listet alle Kalender aus Calendar.app, ein Name pro Zeile. Nützlich, um die
 * exakten Namen für `calendars` bzw. `calendar` der anderen Tools zu finden.
 * @returns {Promise<string>}
 */
export function listCalendars() {
  const script = `
tell application "Calendar"
  set out to ""
  repeat with cal in calendars
    set out to out & (name of cal) & linefeed
  end repeat
  return out
end tell`;
  return runAppleScript(script);
}

/**
 * Listet Termine eines Zeitfensters, chronologisch, eine Zeile pro Termin:
 * "YYYY-MM-DD HH:MM-HH:MM | Kalender | Titel | Ort". Ganztägige Termine werden
 * als "(ganztägig)" markiert, mehrtägige mit Von- und Bis-Tag.
 *
 * Fallstrick Serientermine: Calendar.app liefert per AppleScript nur den
 * Serien-Stamm mit seinem urspruenglichen Startdatum, keine expandierten
 * Wiederholungen. Serien, die vor dem Fenster begonnen haben, erscheinen darum
 * in einem eigenen Abschnitt mit ihrer Wiederholungsregel (RRULE); ob eine
 * Wiederholung ins Fenster fällt, muss der Aufrufer aus der Regel ableiten.
 * Serien mit UNTIL vor dem Fensterbeginn werden herausgefiltert.
 *
 * @param {object} opts
 * @param {string} [opts.fromDate] Startdatum YYYY-MM-DD (inklusive), Vorgabe heute
 * @param {number} [opts.days=7] Länge des Zeitfensters in Tagen
 * @param {string[]} [opts.calendars] nur diese Kalender (exakte Namen); Vorgabe
 *   aus der config.json, ohne sie alle Kalender
 * @param {string} [opts.searchKey] nur Termine, deren Titel diesen Teilstring enthält
 * @param {boolean} [opts.includeRecurring=true] Abschnitt mit älteren Serien anhängen
 * @returns {Promise<string>}
 */
export async function listEvents({ fromDate = "", days = 7, calendars = DEFAULT_CALENDARS, searchKey = "", includeRecurring = true }) {
  const from = fromDate || todayIso();
  const calFilter = Array.isArray(calendars) ? calendars : [];
  const searchCond = searchKey ? ` and (summary contains ${asStr(searchKey)})` : "";

  // Ausgabe je Termin als Tab-getrennte Felder; hübsch formatiert wird in JS.
  const emit = `        repeat with e in hits
          set sd to (start date of e)
          set ed to (end date of e)
${dateTimeStr("sd", "sdStr").replace(/^/gm, "          ")}
${dateTimeStr("ed", "edStr").replace(/^/gm, "          ")}
          set ad to "0"
          if (allday event of e) then set ad to "1"
          set loc to ""
          try
            if (location of e) is not missing value then set loc to (location of e)
          end try
          set rec to ""
          try
            if (recurrence of e) is not missing value then set rec to (recurrence of e)
          end try
          set end of outLines to (lineKind & tab & sdStr & tab & edStr & tab & ad & tab ¬
            & calName & tab & (summary of e) & tab & loc & tab & rec)
        end repeat`;

  // Serien, die vor dem Fenster begonnen haben: nur mit Wiederholungsregel.
  const recurringPart = includeRecurring
    ? `        set lineKind to "R"
        set hits to {}
        try
          set hits to (events of cal whose (start date < d1) and (recurrence contains "FREQ")${searchCond})
        end try
${emit}`
    : "";

  const script = `
${dateTimeSetter("d1", from)}
set d2 to d1 + (${Number(days)} * days)
set wanted to ${asList(calFilter)}

tell application "Calendar"
  set outLines to {}
  repeat with cal in calendars
    set calName to (name of cal)
    if ((count of wanted) is 0) or (wanted contains calName) then
      set lineKind to "E"
      set hits to {}
      try
        set hits to (events of cal whose (start date ≥ d1) and (start date < d2)${searchCond})
      end try
${emit}
${recurringPart}
    end if
  end repeat
  set oldTid to AppleScript's text item delimiters
  set AppleScript's text item delimiters to linefeed
  set out to outLines as string
  set AppleScript's text item delimiters to oldTid
  return out
end tell`;
  const raw = await runAppleScript(script);

  const events = [];
  const series = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [kind, sd, ed, ad, cal, summary, loc, rec] = line.split("\t");
    if (kind === "R") {
      if (rec && !seriesEndsBefore(rec, from)) series.push({ sd, cal, summary, loc, rec });
    } else if (kind === "E") {
      events.push({ sd, ed, allday: ad === "1", cal, summary, loc, rec });
    }
  }

  events.sort((a, b) => a.sd.localeCompare(b.sd));
  series.sort((a, b) => a.sd.localeCompare(b.sd));

  const lines = events.map((e) => {
    const range = formatRange(e.sd, e.ed, e.allday);
    const locPart = e.loc ? ` | ${e.loc}` : "";
    const recPart = e.rec ? `  (Serie: ${e.rec})` : "";
    return `${range} | ${e.cal} | ${e.summary}${locPart}${recPart}`;
  });
  if (series.length > 0) {
    lines.push("");
    lines.push("Serien mit Beginn vor dem Zeitfenster (Wiederholungen ggf. im Fenster, Regel selbst auswerten):");
    for (const s of series) {
      const locPart = s.loc ? ` | ${s.loc}` : "";
      lines.push(`Serie seit ${s.sd.slice(0, 10)} | ${s.cal} | ${s.summary} | ${s.rec}${locPart}`);
    }
  }
  return lines.join("\n");
}

/**
 * Formatiert Beginn und Ende eines Termins kompakt. Bei ganztägigen Terminen
 * ist das AppleScript-Ende exklusiv (Mitternacht des Folgetags) und wird für
 * die Anzeige um einen Tag zurückgenommen.
 * @param {string} sd "YYYY-MM-DD HH:MM"
 * @param {string} ed "YYYY-MM-DD HH:MM"
 * @param {boolean} allday
 * @returns {string}
 */
function formatRange(sd, ed, allday) {
  const [sDay, sTime] = sd.split(" ");
  let [eDay, eTime] = ed.split(" ");
  if (allday) {
    if (eTime === "00:00") eDay = shiftDay(eDay, -1);
    return eDay > sDay ? `${sDay} - ${eDay} (ganztägig)` : `${sDay} (ganztägig)`;
  }
  if (eDay === sDay) return `${sDay} ${sTime}-${eTime}`;
  return `${sDay} ${sTime} - ${eDay} ${eTime}`;
}

/**
 * Legt einen neuen Termin in einem Kalender an. Der Kalender muss existieren
 * und beschreibbar sein (abonnierte Kalender wie Feiertage sind es nicht).
 *
 * Zeitlogik: `start` ist "YYYY-MM-DD HH:MM" (bzw. nur der Tag bei allday).
 * Ohne `end` dauert ein Termin `durationMinutes` (Vorgabe 60), ein ganztägiger
 * einen Tag. Bei allday ist `end` der letzte Tag INKLUSIVE; intern wird das
 * exklusive Ende (Folgetag) gesetzt, wie Calendar.app es erwartet.
 *
 * @param {object} opts
 * @param {string} opts.calendar exakter Kalendername (siehe list_calendars)
 * @param {string} opts.summary Titel des Termins
 * @param {string} opts.start Beginn "YYYY-MM-DD HH:MM", bei allday "YYYY-MM-DD"
 * @param {string} [opts.end] Ende "YYYY-MM-DD HH:MM", bei allday letzter Tag "YYYY-MM-DD"
 * @param {boolean} [opts.allday=false] ganztägiger Termin
 * @param {number} [opts.durationMinutes=60] Dauer, wenn `end` fehlt (nicht bei allday)
 * @param {string} [opts.location] Ort
 * @param {string} [opts.description] Notizen zum Termin
 * @returns {Promise<string>} "created: ..." mit uid des neuen Termins
 */
export function createEvent({ calendar, summary, start, end = "", allday = false, durationMinutes = 60, location = "", description = "" }) {
  if (!calendar) throw new Error("calendar angeben (exakter Name, siehe list_calendars).");
  if (!summary) throw new Error("summary angeben.");
  if (!start) throw new Error("start angeben.");

  let startLines;
  let endLines;
  if (allday) {
    startLines = dateTimeSetter("d1", start.slice(0, 10));
    endLines = end
      ? `${dateTimeSetter("d2", end.slice(0, 10))}
set d2 to d2 + (1 * days)`
      : "set d2 to d1 + (1 * days)";
  } else {
    startLines = dateTimeSetter("d1", start);
    if (end) {
      const norm = (s) => (s.length === 10 ? s + " 00:00" : s);
      if (norm(end) <= norm(start)) throw new Error(`end (${end}) muss nach start (${start}) liegen.`);
      endLines = dateTimeSetter("d2", end);
    } else {
      if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
        throw new Error("durationMinutes muss eine positive ganze Zahl sein.");
      }
      endLines = `set d2 to d1 + (${durationMinutes} * minutes)`;
    }
  }

  const extraProps =
    (allday ? ", allday event:true" : "") +
    (location ? `, location:${asStr(location)}` : "") +
    (description ? `, description:${asStr(description)}` : "");
  // Anzeige des Zeitraums in der Bestätigung: bei allday inklusive Tage (wie
  // list_events), nicht das intern gesetzte exklusive Ende. Bei Terminen mit
  // Uhrzeit rechnet AppleScript das Ende aus, weil es aus der Dauer stammen kann.
  const alldayRange = allday
    ? (end && end.slice(0, 10) !== start.slice(0, 10)
        ? `${start.slice(0, 10)} - ${end.slice(0, 10)} (ganztägig)`
        : `${start.slice(0, 10)} (ganztägig)`)
    : "";
  const rangeLines = allday
    ? `set rangeStr to ${asStr(alldayRange)}`
    : `${dateTimeStr("d1", "sdStr")}
${dateTimeStr("d2", "edStr")}
  set rangeStr to sdStr & " - " & edStr`;
  const script = `
${startLines}
${endLines}
set calName to ${asStr(calendar)}

tell application "Calendar"
  set targetCal to missing value
  repeat with cal in calendars
    if (name of cal) is calName then
      set targetCal to cal
      exit repeat
    end if
  end repeat
  if targetCal is missing value then ¬
    return ("Kalender nicht gefunden: " & calName & " (exakte Namen liefert list_calendars)")
  tell targetCal
    set e to make new event with properties ¬
      {summary:${asStr(summary)}, start date:d1, end date:d2${extraProps}}
  end tell
${rangeLines}
  return ("created: " & ${asStr(summary)} & " | " & calName & " | " & rangeStr & " | uid " & (uid of e))
end tell`;
  return runAppleScript(script);
}
