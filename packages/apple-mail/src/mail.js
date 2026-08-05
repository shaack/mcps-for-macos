import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { runAppleScript, asStr, asList, dateSetter } from "@mcps/common";
import { loadConfig } from "./config.js";

/**
 * Vorgabe-Mailboxen, in denen gesucht wird. Format je Eintrag:
 * "<Kontoname>:<Mailboxname>". Die exakten Namen liefert list_mailboxes.
 *
 * Herkunft: die lokale, nicht eingecheckte config.json (Kopie von
 * config.example.json). Fehlt sie, greifen generische Platzhalter, damit im Repo
 * keine echten Konten stehen.
 */
export const DEFAULT_MAILBOXES = loadConfig().mailboxes ?? [
  "you@gmail.com:All Mail",
  "you@icloud.com:INBOX",
  "you@icloud.com:Archive",
];

/**
 * Listet alle Konten und ihre Mailboxen als "<Konto>:<Mailbox>"-Zeilen.
 * Nützlich, um die exakten Namen für `mailboxes` herauszufinden.
 * @returns {Promise<string>}
 */
export function listMailboxes() {
  const script = `
tell application "Mail"
  set out to ""
  repeat with acc in accounts
    repeat with mb in (every mailbox of acc)
      set out to out & (name of acc) & ":" & (name of mb) & linefeed
    end repeat
  end repeat
  return out
end tell`;
  return runAppleScript(script);
}

/**
 * Sucht Nachrichten in einem Zeitfenster und listet Treffer samt Anhangnamen
 * (ATT{...}) und Flaggen-Markierung (⚑). Dedupliziert über die message id (Gmail
 * zeigt dieselbe Mail in INBOX und All Mail).
 *
 * Filtert nach Absender-Stichworten (`vendors`) und/oder nur geflaggten
 * Nachrichten (`flaggedOnly`). Ohne einen der beiden Filter käme alles zurück,
 * das wird abgelehnt.
 *
 * @param {object} opts
 * @param {string[]} [opts.vendors] Absender-Stichworte (z. B. ["hosting", "software-vendor"])
 * @param {string} opts.fromDate Startdatum YYYY-MM-DD (inklusive)
 * @param {number} [opts.days=91] Länge des Zeitfensters in Tagen
 * @param {boolean} [opts.flaggedOnly=false] nur geflaggte Nachrichten
 * @param {number|null} [opts.flagColor=null] nur Nachrichten mit dieser Fahnenfarbe (flagIndex 0-6: rot, orange, gelb, grün, blau, lila, grau); impliziert geflaggt
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>}
 */
export function searchMessages({ vendors = [], fromDate, days = 91, flaggedOnly = false, flagColor = null, mailboxes = DEFAULT_MAILBOXES }) {
  const hasVendors = Array.isArray(vendors) && vendors.length > 0;
  const hasColor = flagColor !== null;
  if (hasColor && (!Number.isInteger(flagColor) || flagColor < 0 || flagColor > 6)) {
    throw new Error("flagColor muss eine ganze Zahl 0-6 sein (0=rot, 1=orange, 2=gelb, 3=grün, 4=blau, 5=lila, 6=grau).");
  }
  if (!hasVendors && !flaggedOnly && !hasColor) {
    throw new Error("Mindestens vendors, flaggedOnly oder flagColor angeben, sonst käme alles zurück.");
  }
  // flagColor filtert bereits auf eine konkrete Farbe (und damit auf geflaggt);
  // flaggedOnly ist dann redundant, schadet aber nicht.
  const flaggedCond = flaggedOnly ? " and (flagged status is true)" : "";
  const colorCond = hasColor ? ` and (flag index is ${flagColor})` : "";

  // Ausgabezeile je Treffer, in beiden Zweigen identisch.
  const emit = `            set mid to (message id of m)
            if seen does not contain mid then
              set end of seen to mid
              set atts to (name of every mail attachment of m)
              set attStr to ""
              if (count of atts) > 0 then set attStr to "  ATT{" & (atts as string) & "}"
              set flagStr to ""
              if (flagged status of m) then
                set fi to (flag index of m)
                if fi ≥ 0 and fi ≤ 6 then
                  set flagStr to "  ⚑ " & (item (fi + 1) of flagNames)
                else
                  set flagStr to "  ⚑"
                end if
              end if
              set dr to (date received of m)
              set out to out & ((year of dr) as string) & "-" ¬
                & (text -2 thru -1 of ("0" & ((month of dr as integer)))) & "-" ¬
                & (text -2 thru -1 of ("0" & (day of dr))) ¬
                & " | " & lbl & " | " & (subject of m) & attStr & flagStr & linefeed
            end if`;

  // Mit vendors: je Stichwort eine whose-Abfrage. Ohne vendors: eine Abfrage
  // nur mit Zeitfenster (und ggf. flagged), Label "flagged".
  const inner = hasVendors
    ? `        repeat with v in vendors
          set vv to (v as string)
          set lbl to vv
          set msgs to {}
          try
            set msgs to (messages of mb whose (date received ≥ d1) ¬
              and (date received < d2)${flaggedCond}${colorCond} and (sender contains vv))
          end try
          repeat with m in msgs
${emit}
          end repeat
        end repeat`
    : `        set lbl to "flagged"
        set msgs to {}
        try
          set msgs to (messages of mb whose (date received ≥ d1) ¬
            and (date received < d2)${flaggedCond}${colorCond})
        end try
        repeat with m in msgs
${emit}
        end repeat`;

  const script = `
${dateSetter("d1", fromDate)}
set d2 to d1 + (${Number(days)} * days)

set vendors to ${asList(hasVendors ? vendors : [])}
set wanted to ${asList(mailboxes)}

set flagNames to {"rot", "orange", "gelb", "grün", "blau", "lila", "grau"}

tell application "Mail"
  set seen to {}
  set out to ""
  repeat with acc in accounts
    repeat with mb in (every mailbox of acc)
      if wanted contains ((name of acc) & ":" & (name of mb)) then
${inner}
      end if
    end repeat
  end repeat
  return out
end tell`;
  return runAppleScript(script);
}

/**
 * Speichert den ersten passenden PDF-Anhang. Ein Anhang passt, wenn sein Name
 * `attKey` enthält und auf .pdf endet (so werden AGB, Werbe-PDFs, XML und Bilder
 * aussortiert). Die Nachricht wird über `subjKey` im Betreff gefunden.
 *
 * @param {object} opts
 * @param {string} opts.subjKey Teilstring, der im Betreff vorkommen muss
 * @param {string} opts.attKey Teilstring, der im Anhangnamen vorkommen muss
 * @param {string} opts.destPath Zielpfad (POSIX, absolut). Elternordner wird angelegt.
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>} "saved: <pfad>" oder "not found"
 */
export async function saveAttachment({ subjKey, attKey, destPath, mailboxes = DEFAULT_MAILBOXES }) {
  await mkdir(dirname(destPath), { recursive: true });
  const script = `
set subjKey to ${asStr(subjKey)}
set attKey to ${asStr(attKey)}
set destPath to ${asStr(destPath)}
set wanted to ${asList(mailboxes)}

tell application "Mail"
  set done to false
  repeat with acc in accounts
    if not done then
      repeat with mb in (every mailbox of acc)
        if (wanted contains ((name of acc) & ":" & (name of mb))) and (not done) then
          set hits to {}
          try
            set hits to (messages of mb whose (subject contains subjKey))
          end try
          repeat with m in hits
            if not done then
              repeat with a in (every mail attachment of m)
                if ((name of a) contains attKey) and ((name of a) ends with ".pdf") then
                  save a in (POSIX file destPath)
                  set done to true
                  exit repeat
                end if
              end repeat
            end if
          end repeat
        end if
      end repeat
    end if
  end repeat
  if done then
    return "saved: " & destPath
  else
    return "not found"
  end if
end tell`;
  return runAppleScript(script);
}

/**
 * Listet alle Nachrichten eines Zeitfensters, eine Zeile pro Nachricht:
 * "YYYY-MM-DD HH:MM | Absender | Betreff | message:%3Cid%3E". Die message:-URL
 * ist in macOS klickbar und dient als eindeutige Referenz für
 * get_message_by_id. Bewusst ohne Pflichtfilter, gedacht für kleine Postfächer
 * oder kurze Zeiträume; dedupliziert über die message id.
 *
 * @param {object} opts
 * @param {string} [opts.fromDate] Startdatum YYYY-MM-DD (inklusive); ohne
 *   Angabe zählt das Fenster von heute um `days` zurück
 * @param {number} [opts.days=7] Länge des Zeitfensters in Tagen
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>}
 */
export function listMessages({ fromDate = "", days = 7, mailboxes = DEFAULT_MAILBOXES }) {
  const window = fromDate
    ? `${dateSetter("d1", fromDate)}
set d2 to d1 + (${Number(days)} * days)`
    : `set d2 to (current date) + (1 * days)
set d1 to (current date) - (${Number(days)} * days)`;
  const script = `
${window}
set wanted to ${asList(mailboxes)}

tell application "Mail"
  set seen to {}
  set outLines to {}
  repeat with acc in accounts
    repeat with mb in (every mailbox of acc)
      if wanted contains ((name of acc) & ":" & (name of mb)) then
        set hits to {}
        try
          set hits to (messages of mb whose (date received ≥ d1) and (date received < d2))
        end try
        repeat with m in hits
          set mid to (message id of m)
          if seen does not contain mid then
            set end of seen to mid
            set dr to (date received of m)
            set dateStr to ((year of dr) as string) & "-" ¬
              & (text -2 thru -1 of ("0" & ((month of dr) as integer))) & "-" ¬
              & (text -2 thru -1 of ("0" & (day of dr))) & " " ¬
              & (text -2 thru -1 of ("0" & (hours of dr))) & ":" ¬
              & (text -2 thru -1 of ("0" & (minutes of dr)))
            set end of outLines to (dateStr & " | " & (sender of m) & " | " ¬
              & (subject of m) & " | message:%3C" & mid & "%3E")
          end if
        end repeat
      end if
    end repeat
  end repeat
  set oldTid to AppleScript's text item delimiters
  set AppleScript's text item delimiters to linefeed
  set out to outLines as string
  set AppleScript's text item delimiters to oldTid
  return out
end tell`;
  return runAppleScript(script);
}

/**
 * Liefert Kopf, Fundort und Klartext-Inhalt der Nachricht mit genau dieser
 * message id. Akzeptiert die rohe id, "<id>" und die klickbare
 * "message:%3Cid%3E"-URL aus list_messages/macOS Mail.
 *
 * @param {object} opts
 * @param {string} opts.messageId message id in beliebiger der drei Formen
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @param {number} [opts.maxChars=20000] Ausgabe auf so viele Zeichen kürzen
 * @returns {Promise<string>}
 */
export async function getMessageById({ messageId, mailboxes = DEFAULT_MAILBOXES, maxChars = 20000 }) {
  let id = String(messageId ?? "").trim();
  id = id.replace(/^message:(\/\/)?/i, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // schon dekodiert (z. B. nacktes "<id>" mit %-fremden Zeichen) — so lassen
  }
  id = id.replace(/^</, "").replace(/>$/, "");
  if (!id) throw new Error("messageId angeben.");
  const script = `
set theId to ${asStr(id)}
set wanted to ${asList(mailboxes)}

tell application "Mail"
  repeat with acc in accounts
    repeat with mb in (every mailbox of acc)
      if wanted contains ((name of acc) & ":" & (name of mb)) then
        set hits to {}
        try
          set hits to (messages of mb whose message id is theId)
        end try
        repeat with m in hits
          set dr to (date received of m)
          return "From: " & (sender of m) & linefeed ¬
            & "Subject: " & (subject of m) & linefeed ¬
            & "Date: " & (dr as string) & linefeed ¬
            & "Mailbox: " & (name of acc) & ":" & (name of mb) & linefeed ¬
            & "Message-Id: message:%3C" & theId & "%3E" & linefeed & linefeed ¬
            & (content of m as text)
        end repeat
      end if
    end repeat
  end repeat
  return "not found"
end tell`;
  const body = await runAppleScript(script);
  if (body.length > maxChars) {
    return body.slice(0, maxChars) + `\n\n… (gekürzt auf ${maxChars} Zeichen)`;
  }
  return body;
}

/**
 * Baut eine AppleScript-whose-Bedingung aus Betreff- und/oder Absender-Schlüssel.
 * Mindestens einer muss gesetzt sein.
 * @param {string} subjKey
 * @param {string} senderKey
 * @returns {string} AppleScript-Bedingung (Code, kein String-Literal)
 */
function subjectSenderCond(subjKey, senderKey) {
  const parts = [];
  if (subjKey) parts.push(`(subject contains ${asStr(subjKey)})`);
  if (senderKey) parts.push(`(sender contains ${asStr(senderKey)})`);
  if (parts.length === 0) throw new Error("subjKey oder senderKey angeben.");
  return parts.join(" and ");
}

/**
 * Liefert den Klartext-Inhalt der ersten passenden Nachricht samt Kopf (From,
 * Subject, Date). Für Belege, die nur im Mailtext stehen und kein PDF anhängen.
 *
 * @param {object} opts
 * @param {string} [opts.subjKey] Teilstring im Betreff
 * @param {string} [opts.senderKey] Teilstring im Absender
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @param {number} [opts.maxChars=20000] Ausgabe auf so viele Zeichen kürzen
 * @returns {Promise<string>}
 */
export async function getMessageBody({ subjKey = "", senderKey = "", mailboxes = DEFAULT_MAILBOXES, maxChars = 20000 }) {
  const cond = subjectSenderCond(subjKey, senderKey);
  const script = `
set wanted to ${asList(mailboxes)}

tell application "Mail"
  repeat with acc in accounts
    repeat with mb in (every mailbox of acc)
      if wanted contains ((name of acc) & ":" & (name of mb)) then
        set hits to {}
        try
          set hits to (messages of mb whose ${cond})
        end try
        repeat with m in hits
          set dr to (date received of m)
          return "From: " & (sender of m) & linefeed ¬
            & "Subject: " & (subject of m) & linefeed ¬
            & "Date: " & (dr as string) & linefeed & linefeed ¬
            & (content of m as text)
        end repeat
      end if
    end repeat
  end repeat
  return "not found"
end tell`;
  const body = await runAppleScript(script);
  if (body.length > maxChars) {
    return body.slice(0, maxChars) + `\n\n… (gekürzt auf ${maxChars} Zeichen)`;
  }
  return body;
}

/**
 * Setzt oder entfernt die Fahne (flagged status) an **genau einer** Nachricht.
 * Passt der Schlüssel auf mehrere (über die message id deduplizierte)
 * Nachrichten, wird nichts geändert, sondern gemeldet, dass er mehrdeutig ist,
 * samt Betreffzeilen zum Verengen. So kann kein zu weiter Schlüssel versehentlich
 * viele Mails flaggen. Optional mit Fahnenfarbe (flagIndex 0-6: rot, orange, gelb,
 * grün, blau, lila, grau).
 *
 * @param {object} opts
 * @param {string} [opts.subjKey] Teilstring im Betreff
 * @param {string} [opts.senderKey] Teilstring im Absender
 * @param {boolean} [opts.flagged=true] true = flaggen, false = Fahne entfernen
 * @param {number|null} [opts.flagIndex=null] Fahnenfarbe 0-6 (nur bei flagged=true)
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>} "flagged: <Betreff>", "not found" oder "ambiguous: ..."
 */
export function flagMessage({ subjKey = "", senderKey = "", flagged = true, flagIndex = null, mailboxes = DEFAULT_MAILBOXES }) {
  const cond = subjectSenderCond(subjKey, senderKey);
  if (flagIndex !== null && (!Number.isInteger(flagIndex) || flagIndex < 0 || flagIndex > 6)) {
    throw new Error("flagIndex muss eine ganze Zahl 0-6 sein.");
  }
  const verb = flagged ? "flagged" : "unflagged";
  const setFlag = flagged
    ? `    set flagged status of theMsg to true
${flagIndex !== null ? `    set flag index of theMsg to ${flagIndex}\n` : ""}`
    : `    set flagged status of theMsg to false\n`;
  const script = `
set wanted to ${asList(mailboxes)}

tell application "Mail"
  set foundIds to {}
  set foundSubjects to {}
  set theMsg to missing value
  repeat with acc in accounts
    repeat with mb in (every mailbox of acc)
      if wanted contains ((name of acc) & ":" & (name of mb)) then
        set hits to {}
        try
          set hits to (messages of mb whose ${cond})
        end try
        repeat with m in hits
          set mid to (message id of m)
          if foundIds does not contain mid then
            set end of foundIds to mid
            set end of foundSubjects to (subject of m)
            if theMsg is missing value then set theMsg to m
          end if
        end repeat
      end if
    end repeat
  end repeat
  set c to (count of foundIds)
  if c is 0 then return "not found"
  if c > 1 then return ("ambiguous: " & c & " messages match, refusing to ${verb}. Subjects: " & (foundSubjects as string))
${setFlag}  return ("${verb}: " & (item 1 of foundSubjects))
end tell`;
  return runAppleScript(script);
}

/**
 * Legt einen **Antwort-Entwurf** auf genau eine Nachricht an und öffnet ihn
 * sichtbar in Mail. Nutzt Mails natives reply (Empfänger, "Re:"-Betreff,
 * Threading-Header), ersetzt aber den Inhalt durch `body` plus den
 * Original-Text als klassisches ">"-Zitat mit Attributionszeile. Sendet
 * bewusst NICHT, das Abschicken machst du selbst im Mail-Fenster.
 *
 * Passt der Schlüssel auf mehrere (per message id deduplizierte) Nachrichten,
 * wird ohne `pickLatest` nichts angelegt, sondern die Mehrdeutigkeit gemeldet.
 *
 * Hinweis: Da der Inhalt ersetzt wird, fügt Mail KEINE Konto-Signatur an;
 * die Signatur gehört mit in `body`.
 *
 * @param {object} opts
 * @param {string} [opts.subjKey] Teilstring im Betreff der Original-Mail
 * @param {string} [opts.senderKey] Teilstring im Absender der Original-Mail
 * @param {string} [opts.body] Antworttext (Klartext, inkl. Grußformel/Signatur)
 * @param {boolean} [opts.replyAll=false] Allen antworten statt nur dem Absender
 * @param {boolean} [opts.pickLatest=false] bei mehreren Treffern die neueste nehmen
 * @param {string} [opts.from] Absender erzwingen, z. B. "Name <a@b.de>" (sonst wählt Mail das Empfängerkonto)
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>} "reply draft created: <Betreff>", "not found" oder "ambiguous: ..."
 */
export function replyDraft({ subjKey = "", senderKey = "", body = "", replyAll = false, pickLatest = false, from = "", mailboxes = DEFAULT_MAILBOXES }) {
  const cond = subjectSenderCond(subjKey, senderKey);
  const script = `
set bod to ${asStr(body)}
set wanted to ${asList(mailboxes)}

tell application "Mail"
  set foundIds to {}
  set foundSubjects to {}
  set theMsg to missing value
  set latestDate to missing value
  repeat with acc in accounts
    repeat with mb in (every mailbox of acc)
      if wanted contains ((name of acc) & ":" & (name of mb)) then
        set hits to {}
        try
          set hits to (messages of mb whose ${cond})
        end try
        repeat with m in hits
          set mid to (message id of m)
          if foundIds does not contain mid then
            set end of foundIds to mid
            set end of foundSubjects to (subject of m)
            set dr to (date received of m)
            if (theMsg is missing value) or (${pickLatest ? "dr > latestDate" : "false"}) then
              set theMsg to m
              set latestDate to dr
            end if
          end if
        end repeat
      end if
    end repeat
  end repeat
  set c to (count of foundIds)
  if c is 0 then return "not found"
  if c > 1 and ${pickLatest ? "false" : "true"} then ¬
    return ("ambiguous: " & c & " messages match, refusing to reply. Subjects: " & (foundSubjects as string) & " — pickLatest nutzen oder Schlüssel verengen")

  -- Zitat aus dem Original bauen: Attributionszeile plus "> " vor jeder Zeile.
  -- Datum numerisch (TT.MM.JJJJ um HH:MM), damit keine Systemsprache reinmischt.
  set origText to (content of theMsg as text)
  set dr to (date received of theMsg)
  set dd to text -2 thru -1 of ("0" & (day of dr))
  set mm to text -2 thru -1 of ("0" & ((month of dr) as integer))
  set hh to text -2 thru -1 of ("0" & (hours of dr))
  set mi to text -2 thru -1 of ("0" & (minutes of dr))
  set attribution to "Am " & dd & "." & mm & "." & ((year of dr) as string) ¬
    & " um " & hh & ":" & mi & " schrieb " & (sender of theMsg) & ":"
  set oldTid to AppleScript's text item delimiters
  set AppleScript's text item delimiters to linefeed
  set origLines to text items of origText
  set AppleScript's text item delimiters to oldTid
  set quoted to ""
  repeat with l in origLines
    set quoted to quoted & "> " & (l as string) & linefeed
  end repeat

  set theReply to reply theMsg with opening window${replyAll ? " and reply to all" : ""}
  delay 0.3
  set content of theReply to bod & linefeed & linefeed & attribution & linefeed & quoted
${from ? `  set sender of theReply to ${asStr(from)}\n` : ""}  activate
  return ("reply draft created: " & (subject of theReply))
end tell`;
  return runAppleScript(script);
}

/**
 * Legt einen **Entwurf** an und öffnet ihn sichtbar in Mail. Sendet bewusst
 * NICHT: Empfänger, Betreff und Text sind ausgefüllt, das Abschicken machst du
 * selbst im Mail-Fenster. So kann keine Mail versehentlich rausgehen.
 *
 * @param {object} opts
 * @param {string[]} opts.to Empfängeradressen (mindestens eine)
 * @param {string[]} [opts.cc] CC-Adressen
 * @param {string[]} [opts.bcc] BCC-Adressen
 * @param {string} [opts.subject] Betreff
 * @param {string} [opts.body] Nachrichtentext (Klartext)
 * @param {string} [opts.from] Absender, z. B. "Name <a@b.de>" (sonst Standardkonto)
 * @returns {Promise<string>} "draft created: <Betreff>"
 */
export function createDraft({ to = [], cc = [], bcc = [], subject = "", body = "", from = "" }) {
  if (!Array.isArray(to) || to.length === 0) {
    throw new Error("Mindestens eine to-Adresse angeben.");
  }
  const recipients = (kind, list) =>
    (Array.isArray(list) ? list : [])
      .map((a) => `    make new ${kind} at end of ${kind}s with properties {address:${asStr(a)}}`)
      .join("\n");
  const recipLines = [
    recipients("to recipient", to),
    recipients("cc recipient", cc),
    recipients("bcc recipient", bcc),
  ].filter(Boolean).join("\n");
  const senderLine = from ? `  set sender of m to ${asStr(from)}\n` : "";
  const script = `
set subj to ${asStr(subject)}
set bod to ${asStr(body)}

tell application "Mail"
  set m to make new outgoing message with properties {subject:subj, content:bod, visible:true}
  tell m
${recipLines}
  end tell
${senderLine}  activate
  return ("draft created: " & subj)
end tell`;
  return runAppleScript(script);
}
