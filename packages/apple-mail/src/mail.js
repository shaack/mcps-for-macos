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
 * Filtert nach Absender-Stichworten (`senderKeys`), nur geflaggten Nachrichten
 * (`flaggedOnly`) und/oder einer Fahnenfarbe (`flagColor`). Ohne einen dieser
 * Filter käme alles zurück, das wird abgelehnt.
 *
 * @param {object} opts
 * @param {string[]} [opts.senderKeys] Absender-Stichworte, z. B. ["example.com", "Meier"]
 * @param {string[]} [opts.vendors] veralteter Name für `senderKeys`; greift nur, wenn `senderKeys` leer ist
 * @param {string} opts.fromDate Startdatum YYYY-MM-DD (inklusive)
 * @param {number} [opts.days=91] Länge des Zeitfensters in Tagen
 * @param {boolean} [opts.flaggedOnly=false] nur geflaggte Nachrichten
 * @param {number|null} [opts.flagColor=null] nur Nachrichten mit dieser Fahnenfarbe (flagIndex 0-6: rot, orange, gelb, grün, blau, lila, grau); impliziert geflaggt
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>}
 */
export function searchMessages({ senderKeys = [], vendors = [], fromDate, days = 91, flaggedOnly = false, flagColor = null, mailboxes = DEFAULT_MAILBOXES }) {
  // `vendors` ist der alte, auf Rechnungen gemünzte Name. Weiter akzeptiert,
  // damit bestehende Aufrufe nicht brechen.
  const keys = (Array.isArray(senderKeys) && senderKeys.length > 0) ? senderKeys : vendors;
  const hasKeys = Array.isArray(keys) && keys.length > 0;
  const hasColor = flagColor !== null;
  if (hasColor && (!Number.isInteger(flagColor) || flagColor < 0 || flagColor > 6)) {
    throw new Error("flagColor muss eine ganze Zahl 0-6 sein (0=rot, 1=orange, 2=gelb, 3=grün, 4=blau, 5=lila, 6=grau).");
  }
  if (!hasKeys && !flaggedOnly && !hasColor) {
    throw new Error("Mindestens senderKeys, flaggedOnly oder flagColor angeben, sonst käme alles zurück.");
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

  // Mit Stichworten: je Stichwort eine whose-Abfrage. Ohne: eine Abfrage
  // nur mit Zeitfenster (und ggf. flagged), Label "flagged".
  const inner = hasKeys
    ? `        repeat with v in senderKeys
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

set senderKeys to ${asList(hasKeys ? keys : [])}
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
 * Speichert den ersten passenden Anhang unter einem festen Zielpfad. Ein Anhang
 * passt, wenn sein Name `attKey` enthält und auf `endsWith` endet. Die
 * Nachricht wird über `subjKey` im Betreff gefunden.
 *
 * `endsWith` steht auf ".pdf", weil das der häufigste Fall ist und so Bilder,
 * XML-Beiwerk und Signaturdateien nicht versehentlich mitkommen. Leer setzen
 * hebt die Einschränkung auf. Für alle Anhänge einer eindeutig bestimmten
 * Nachricht ist saveAttachmentsById der direktere Weg.
 *
 * @param {object} opts
 * @param {string} opts.subjKey Teilstring, der im Betreff vorkommen muss
 * @param {string} opts.attKey Teilstring, der im Anhangnamen vorkommen muss
 * @param {string} opts.destPath Zielpfad (POSIX, absolut). Elternordner wird angelegt.
 * @param {string} [opts.endsWith=".pdf"] Endung, auf die der Anhangname enden muss; "" für beliebige
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>} "saved: <pfad>" oder "not found"
 */
export async function saveAttachment({ subjKey, attKey, destPath, endsWith = ".pdf", mailboxes = DEFAULT_MAILBOXES }) {
  await mkdir(dirname(destPath), { recursive: true });
  const extCond = endsWith ? ` and ((name of a) ends with ${asStr(endsWith)})` : "";
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
                if ((name of a) contains attKey)${extCond} then
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
 * AppleScript-Zeilen, die aus der Nachricht `m` die Kopfzeilen "To:" und
 * (falls belegt) "Cc:" aufbauen. Ergebnis liegt in `toLine` und `ccLine`.
 * In try-Bloecken, weil einzelne Mailboxen den Zugriff verweigern koennen.
 */
const RECIPIENT_LINES = `          set toStr to ""
          try
            repeat with rcp in (to recipients of m)
              if toStr is not "" then set toStr to toStr & ", "
              set toStr to toStr & (address of rcp)
            end repeat
          end try
          set ccStr to ""
          try
            repeat with rcp in (cc recipients of m)
              if ccStr is not "" then set ccStr to ccStr & ", "
              set ccStr to ccStr & (address of rcp)
            end repeat
          end try
          set toLine to "To: " & toStr & linefeed
          set ccLine to ""
          if ccStr is not "" then set ccLine to "Cc: " & ccStr & linefeed`;

/**
 * Listet Nachrichten eines Zeitfensters, eine Zeile pro Nachricht:
 * "YYYY-MM-DD HH:MM | Status | Absender | Betreff | message:%3Cid%3E".
 * Status ist "•" für ungelesen und "⚑ farbe" für geflaggt (beides kombinierbar).
 * Die message:-URL ist in macOS klickbar und die eindeutige Referenz für
 * get_message_by_id, flag_message, mark_read und move_message.
 *
 * Bewusst ohne Pflichtfilter, gedacht für kleine Postfächer oder kurze
 * Zeiträume; dedupliziert über die message id, neueste zuerst. `unreadOnly`
 * schränkt auf Ungelesenes ein.
 *
 * @param {object} opts
 * @param {string} [opts.fromDate] Startdatum YYYY-MM-DD (inklusive); ohne
 *   Angabe zählt das Fenster von heute um `days` zurück
 * @param {number} [opts.days=7] Länge des Zeitfensters in Tagen
 * @param {boolean} [opts.unreadOnly=false] nur ungelesene Nachrichten
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>}
 */
export async function listMessages({ fromDate = "", days = 7, unreadOnly = false, mailboxes = DEFAULT_MAILBOXES }) {
  const window = fromDate
    ? `${dateSetter("d1", fromDate)}
set d2 to d1 + (${Number(days)} * days)`
    : `set d2 to (current date) + (1 * days)
set d1 to (current date) - (${Number(days)} * days)`;
  const unreadCond = unreadOnly ? " and (read status is false)" : "";
  const script = `
${window}
set wanted to ${asList(mailboxes)}
set flagNames to {"rot", "orange", "gelb", "grün", "blau", "lila", "grau"}

tell application "Mail"
  set seen to {}
  set outLines to {}
  repeat with acc in accounts
    repeat with mb in (every mailbox of acc)
      if wanted contains ((name of acc) & ":" & (name of mb)) then
        set hits to {}
        try
          set hits to (messages of mb whose (date received ≥ d1) and (date received < d2)${unreadCond})
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
            set stat to ""
            if (read status of m) is false then set stat to "•"
            if (flagged status of m) then
              set fi to (flag index of m)
              if fi ≥ 0 and fi ≤ 6 then
                set stat to stat & " ⚑ " & (item (fi + 1) of flagNames)
              else
                set stat to stat & " ⚑"
              end if
            end if
            set end of outLines to (dateStr & " | " & stat & " | " & (sender of m) & " | " ¬
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
  const raw = await runAppleScript(script);
  // Sortierung in JS statt AppleScript: die Zeilen beginnen mit
  // "YYYY-MM-DD HH:MM" und sind damit lexikografisch sortierbar.
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  lines.sort((a, b) => b.localeCompare(a));
  return lines.join("\n");
}

/**
 * Setzt Nachrichten auf gelesen oder ungelesen. Adressiert entweder genau eine
 * Nachricht über die message id oder, mit `allInWindow`, alle Nachrichten
 * eines Zeitfensters.
 *
 * @param {object} opts
 * @param {string} [opts.messageId] message id (rohe id, "<id>" oder message:-URL)
 * @param {boolean} [opts.read=true] true = gelesen, false = ungelesen
 * @param {boolean} [opts.allInWindow=false] statt einer id: alle Nachrichten im Zeitfenster
 * @param {string} [opts.fromDate] Startdatum YYYY-MM-DD (nur mit allInWindow)
 * @param {number} [opts.days=7] Länge des Zeitfensters in Tagen (nur mit allInWindow)
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>} "marked read/unread: <n>" oder "not found"
 */
export function markRead({ messageId = "", read = true, allInWindow = false, fromDate = "", days = 7, mailboxes = DEFAULT_MAILBOXES }) {
  const id = normalizeMessageId(messageId);
  if (!id && !allInWindow) {
    throw new Error("messageId angeben oder allInWindow setzen.");
  }
  const verb = read ? "read" : "unread";
  const window = allInWindow
    ? (fromDate
        ? `${dateSetter("d1", fromDate)}
set d2 to d1 + (${Number(days)} * days)`
        : `set d2 to (current date) + (1 * days)
set d1 to (current date) - (${Number(days)} * days)`)
    : "";
  const cond = allInWindow
    ? `(date received ≥ d1) and (date received < d2)`
    : `(message id is theId)`;
  const script = `
${window}
${id ? `set theId to ${asStr(id)}` : ""}
set wanted to ${asList(mailboxes)}

tell application "Mail"
  set n to 0
  repeat with acc in accounts
    repeat with mb in (every mailbox of acc)
      if wanted contains ((name of acc) & ":" & (name of mb)) then
        set hits to {}
        try
          set hits to (messages of mb whose ${cond})
        end try
        repeat with m in hits
          set read status of m to ${read}
          set n to n + 1
        end repeat
      end if
    end repeat
  end repeat
  if n is 0 then return "not found"
  return ("marked ${verb}: " & n)
end tell`;
  return runAppleScript(script);
}

/**
 * Speichert die Anhänge einer über die message id bestimmten Nachricht in
 * einen Ordner, unabhängig vom Dateityp. Mit `nameKey` lässt sich auf bestimmte
 * Anhänge einschränken. Anders als saveAttachment adressiert das die Nachricht
 * eindeutig und speichert alle Treffer statt nur den ersten.
 *
 * @param {object} opts
 * @param {string} opts.messageId message id (rohe id, "<id>" oder message:-URL)
 * @param {string} opts.destDir Zielordner (POSIX, absolut). Wird angelegt.
 * @param {string} [opts.nameKey] nur Anhänge, deren Name diesen Teilstring enthält
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>} gespeicherte Pfade, einer pro Zeile
 */
export async function saveAttachmentsById({ messageId, destDir, nameKey = "", mailboxes = DEFAULT_MAILBOXES }) {
  const id = normalizeMessageId(messageId);
  if (!id) throw new Error("messageId angeben.");
  if (!destDir) throw new Error("destDir angeben.");
  await mkdir(destDir, { recursive: true });
  const dir = destDir.endsWith("/") ? destDir : destDir + "/";
  const nameCond = nameKey ? `if (name of a) contains ${asStr(nameKey)} then` : "if true then";
  const script = `
set theId to ${asStr(id)}
set destDir to ${asStr(dir)}
set wanted to ${asList(mailboxes)}

tell application "Mail"
  set savedLines to {}
  repeat with acc in accounts
    repeat with mb in (every mailbox of acc)
      if wanted contains ((name of acc) & ":" & (name of mb)) then
        set hits to {}
        try
          set hits to (messages of mb whose message id is theId)
        end try
        repeat with m in hits
          repeat with a in (every mail attachment of m)
            ${nameCond}
              set p to destDir & (name of a)
              try
                save a in (POSIX file p)
                set end of savedLines to p
              on error errMsg
                set end of savedLines to "FEHLER bei " & (name of a) & ": " & errMsg
              end try
            end if
          end repeat
          set oldTid to AppleScript's text item delimiters
          set AppleScript's text item delimiters to linefeed
          set out to savedLines as string
          set AppleScript's text item delimiters to oldTid
          if out is "" then return "keine passenden Anhänge"
          return out
        end repeat
      end if
    end repeat
  end repeat
  return "not found"
end tell`;
  return runAppleScript(script);
}

/**
 * Listet die gesamte Korrespondenz mit einer Adresse chronologisch (älteste
 * zuerst), eingegangene und selbst gesendete Nachrichten gemeinsam:
 * "YYYY-MM-DD HH:MM | ← bzw. → | Betreff | message:%3Cid%3E".
 *
 * Die Richtung ergibt sich daraus, ob der Absender eine der eigenen
 * Konto-Adressen ist. Damit sieht man den ganzen Verlauf, ohne Posteingang und
 * Gesendet einzeln abzufragen.
 *
 * @param {object} opts
 * @param {string} opts.addressKey Adresse oder Teilstring, z. B. "jokaste@t-online.de"
 * @param {number} [opts.days=365] wie weit zurück gesucht wird
 * @param {string[]} [opts.mailboxes] Mailboxen "<Konto>:<Mailbox>" — hier
 *   sinnvollerweise INBOX, Archiv UND die Gesendet-Ordner
 * @returns {Promise<string>}
 */
export async function listCorrespondence({ addressKey, days = 365, mailboxes = DEFAULT_MAILBOXES }) {
  if (!addressKey) throw new Error("addressKey angeben.");
  const script = `
set d1 to (current date) - (${Number(days)} * days)
set theKey to ${asStr(addressKey)}
set wanted to ${asList(mailboxes)}

tell application "Mail"
  set seen to {}
  set outLines to {}
  repeat with acc in accounts
    set myAddrs to {}
    try
      set myAddrs to (email addresses of acc)
    end try
    repeat with mb in (every mailbox of acc)
      if wanted contains ((name of acc) & ":" & (name of mb)) then
        -- Eingang: Absender passt. Ausgang: irgendein Empfaenger passt.
        set hits to {}
        try
          set hits to (messages of mb whose (date received ≥ d1) and (sender contains theKey))
        end try
        set hits2 to {}
        try
          set hits2 to (messages of mb whose (date received ≥ d1) and (address of to recipients contains theKey))
        end try
        repeat with lst in {hits, hits2}
          repeat with m in lst
            set mid to (message id of m)
            if seen does not contain mid then
              set end of seen to mid
              set dr to (date received of m)
              set dateStr to ((year of dr) as string) & "-" ¬
                & (text -2 thru -1 of ("0" & ((month of dr) as integer))) & "-" ¬
                & (text -2 thru -1 of ("0" & (day of dr))) & " " ¬
                & (text -2 thru -1 of ("0" & (hours of dr))) & ":" ¬
                & (text -2 thru -1 of ("0" & (minutes of dr)))
              set dirStr to "←"
              set snd to (sender of m)
              repeat with a in myAddrs
                if snd contains (a as string) then set dirStr to "→"
              end repeat
              set end of outLines to (dateStr & " | " & dirStr & " | " ¬
                & (subject of m) & " | message:%3C" & mid & "%3E")
            end if
          end repeat
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
  const raw = await runAppleScript(script);
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  lines.sort(); // chronologisch: die Zeilen beginnen mit YYYY-MM-DD HH:MM
  return lines.join("\n");
}

/**
 * Verschiebt eine über die message id bestimmte Nachricht in eine andere
 * Mailbox, etwa in einen Ablage- oder Archivordner. Fehlt der Zielordner, wird
 * er im selben Konto angelegt (abschaltbar über `createIfMissing`).
 *
 * `targetMailbox` ist entweder ein blosser Name (dann im Konto der Nachricht)
 * oder vollqualifiziert "<Konto>:<Mailbox>". Verschieben über
 * Kontogrenzen hinweg macht Mail selbst, kann bei IMAP aber dauern.
 *
 * @param {object} opts
 * @param {string} opts.messageId message id (rohe id, "<id>" oder message:-URL)
 * @param {string} opts.targetMailbox Zielmailbox, blosser Name oder "<Konto>:<Mailbox>"
 * @param {boolean} [opts.createIfMissing=true] Zielmailbox anlegen, wenn sie fehlt
 * @param {string[]} [opts.mailboxes] zu durchsuchende Mailboxen "<Konto>:<Mailbox>"
 * @returns {Promise<string>} "moved: <Betreff> -> <Konto>:<Mailbox>" oder "not found"
 */
export function moveMessage({ messageId, targetMailbox, createIfMissing = true, mailboxes = DEFAULT_MAILBOXES }) {
  const id = normalizeMessageId(messageId);
  if (!id) throw new Error("messageId angeben.");
  if (!targetMailbox) throw new Error("targetMailbox angeben.");
  const idx = targetMailbox.indexOf(":");
  const targetAccount = idx > 0 ? targetMailbox.slice(0, idx) : "";
  const targetName = idx > 0 ? targetMailbox.slice(idx + 1) : targetMailbox;
  const script = `
set theId to ${asStr(id)}
set targetAcc to ${asStr(targetAccount)}
set targetName to ${asStr(targetName)}
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
          set subj to (subject of m)
          -- Zielkonto bestimmen: explizit angegeben oder das der Nachricht
          set destAcc to acc
          if targetAcc is not "" then
            set destAcc to (first account whose name is targetAcc)
          end if
          set destMb to missing value
          repeat with cand in (every mailbox of destAcc)
            if (name of cand) is targetName then set destMb to cand
          end repeat
          if destMb is missing value then
            ${createIfMissing
              ? `set destMb to (make new mailbox at end of mailboxes of destAcc with properties {name:targetName})`
              : `return ("Zielmailbox " & targetName & " existiert nicht in " & (name of destAcc))`}
          end if
          set mailbox of m to destMb
          return ("moved: " & subj & " -> " & (name of destAcc) & ":" & targetName)
        end repeat
      end if
    end repeat
  end repeat
  return "not found"
end tell`;
  return runAppleScript(script);
}

/**
 * Liefert Kopf (inkl. Empfänger), Fundort und Klartext-Inhalt der Nachricht mit genau dieser
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
  const id = normalizeMessageId(messageId);
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
${RECIPIENT_LINES}
          return "From: " & (sender of m) & linefeed ¬
            & toLine & ccLine ¬
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
 * Normalisiert eine message id: akzeptiert die rohe id, "<id>" und die
 * klickbare "message:%3Cid%3E"-URL, liefert die nackte id ohne Klammern.
 * @param {string} raw
 * @returns {string}
 */
function normalizeMessageId(raw) {
  let id = String(raw ?? "").trim();
  id = id.replace(/^message:(\/\/)?/i, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // schon dekodiert (z. B. nacktes "<id>" mit %-fremden Zeichen) — so lassen
  }
  return id.replace(/^</, "").replace(/>$/, "");
}

/**
 * Baut eine AppleScript-whose-Bedingung: entweder exakt über die message id
 * (hat Vorrang) oder aus Betreff- und/oder Absender-Schlüssel. Mindestens
 * eines von messageId, subjKey, senderKey muss gesetzt sein.
 * @param {string} subjKey
 * @param {string} senderKey
 * @param {string} [messageId]
 * @returns {string} AppleScript-Bedingung (Code, kein String-Literal)
 */
function subjectSenderCond(subjKey, senderKey, messageId = "") {
  const id = normalizeMessageId(messageId);
  if (id) return `(message id is ${asStr(id)})`;
  const parts = [];
  if (subjKey) parts.push(`(subject contains ${asStr(subjKey)})`);
  if (senderKey) parts.push(`(sender contains ${asStr(senderKey)})`);
  if (parts.length === 0) throw new Error("messageId, subjKey oder senderKey angeben.");
  return parts.join(" and ");
}

/**
 * Liefert den Klartext-Inhalt der ersten passenden Nachricht samt Kopf (From,
 * To, Cc, Subject, Date). Für Inhalte, die im Mailtext selbst stehen und nicht als
 * Anhang.
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
${RECIPIENT_LINES}
          return "From: " & (sender of m) & linefeed ¬
            & toLine & ccLine ¬
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
export function flagMessage({ messageId = "", subjKey = "", senderKey = "", flagged = true, flagIndex = null, mailboxes = DEFAULT_MAILBOXES }) {
  const cond = subjectSenderCond(subjKey, senderKey, messageId);
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
 * Legt einen **Entwurf** an. Sendet bewusst NICHT: Empfänger, Betreff und Text
 * sind ausgefüllt, das Abschicken machst du selbst in Mail. So kann keine Mail
 * versehentlich rausgehen.
 *
 * Vorgabe ist ein stiller Entwurf im Entwurfsordner, ohne Fenster. Das ist bei
 * mehreren Entwürfen am Stück angenehmer und vermeidet Dubletten aus
 * Fenster-Autosicherungen. `visible: true` öffnet ihn stattdessen sichtbar.
 *
 * @param {object} opts
 * @param {string[]} opts.to Empfängeradressen (mindestens eine)
 * @param {string[]} [opts.cc] CC-Adressen
 * @param {string[]} [opts.bcc] BCC-Adressen
 * @param {string} [opts.subject] Betreff
 * @param {string} [opts.body] Nachrichtentext (Klartext)
 * @param {boolean} [opts.visible=false] Entwurf sichtbar in einem Fenster öffnen statt still ablegen
 * @param {string} [opts.from] Absender, z. B. "Name <a@b.de>" (sonst Standardkonto)
 * @returns {Promise<string>} "draft created: <Betreff>"
 */
export function createDraft({ to = [], cc = [], bcc = [], subject = "", body = "", visible = false, from = "" }) {
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
  set m to make new outgoing message with properties {subject:subj, content:bod, visible:${visible}}
  tell m
${recipLines}
  end tell
${senderLine}${visible ? "  activate" : "  save m"}
  return ("draft created: " & subj)
end tell`;
  return runAppleScript(script);
}
