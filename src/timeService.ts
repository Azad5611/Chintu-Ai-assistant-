export type TimePeriodKey = "morning" | "noon" | "afternoon" | "night" | "late_night";

export interface TimeSnapshot {
  epochMs: number;
  timeZone: string;
  year: number;
  month: number;
  day: number;
  hour24: number;
  minute: number;
  second: number;
  hour12: number;
  ampm: "AM" | "PM";
  formatted24h: string;
  formatted24hWithSec: string;
  formatted12hEn: string;
  localIsoWithOffset: string;
  periodKey: TimePeriodKey;
  periodBn: "সকাল" | "দুপুর" | "বিকেল" | "রাত" | "গভীর রাত";
  spokenPeriodBn: "সকাল" | "দুপুর" | "বিকেল" | "রাত";
  dayNightBn: "দিন" | "রাত";
  greetingBn: string;
  greetingEn: string;
  spokenTimeBn: string;
  spokenTimeEn: string;
}

export interface LocalTimeAnswer {
  handled: boolean;
  queryType?: "time" | "day_night" | "period_check" | "greeting";
  reply: string;
  snapshot: TimeSnapshot;
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
const BN_HOUR_WORDS: Record<number, string> = {
  1: "একটা",
  2: "দুইটা",
  3: "তিনটা",
  4: "চারটা",
  5: "পাঁচটা",
  6: "ছয়টা",
  7: "সাতটা",
  8: "আটটা",
  9: "নয়টা",
  10: "দশটা",
  11: "এগারোটা",
  12: "বারোটা",
};

export function toBengaliDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

export function getSystemTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string" && tz.trim().length > 0) {
      return tz.trim();
    }
  } catch {
    // Ignore Intl failure
  }
  return "UTC";
}

function resolveValidTimeZone(timeZoneOverride?: string): string {
  const candidate =
    typeof timeZoneOverride === "string" && timeZoneOverride.trim().length > 0
      ? timeZoneOverride.trim()
      : getSystemTimeZone();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return getSystemTimeZone();
  }
}

function getNumericOffsetString(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "";
    const match = tzPart.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (match) {
      const sign = match[1];
      const hh = match[2].padStart(2, "0");
      const mm = (match[3] || "00").padStart(2, "0");
      return `${sign}${hh}:${mm}`;
    }
    if (tzPart === "GMT" || tzPart === "UTC") {
      return "+00:00";
    }
  } catch {
    // Fallback below
  }
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

export function getPeriodForHour(hour24: number): {
  periodKey: TimePeriodKey;
  periodBn: TimeSnapshot["periodBn"];
  spokenPeriodBn: TimeSnapshot["spokenPeriodBn"];
  dayNightBn: TimeSnapshot["dayNightBn"];
  greetingBn: string;
  greetingEn: string;
} {
  if (hour24 >= 5 && hour24 <= 11) {
    return {
      periodKey: "morning",
      periodBn: "সকাল",
      spokenPeriodBn: "সকাল",
      dayNightBn: "দিন",
      greetingBn: "শুভ সকাল",
      greetingEn: "Good morning",
    };
  }
  if (hour24 >= 12 && hour24 <= 15) {
    return {
      periodKey: "noon",
      periodBn: "দুপুর",
      spokenPeriodBn: "দুপুর",
      dayNightBn: "দিন",
      greetingBn: "শুভ দুপুর",
      greetingEn: "Good afternoon",
    };
  }
  if (hour24 >= 16 && hour24 <= 17) {
    return {
      periodKey: "afternoon",
      periodBn: "বিকেল",
      spokenPeriodBn: "বিকেল",
      dayNightBn: "দিন",
      greetingBn: "শুভ বিকেল",
      greetingEn: "Good afternoon",
    };
  }
  if (hour24 >= 18 && hour24 <= 23) {
    return {
      periodKey: "night",
      periodBn: "রাত",
      spokenPeriodBn: "রাত",
      dayNightBn: "রাত",
      greetingBn: "শুভ সন্ধ্যা",
      greetingEn: "Good evening",
    };
  }
  // 00:00 - 04:59
  return {
    periodKey: "late_night",
    periodBn: "গভীর রাত",
    spokenPeriodBn: "রাত",
    dayNightBn: "রাত",
    greetingBn: "শুভ রাত্রি",
    greetingEn: "Good night",
  };
}

export function getTimeSnapshot(now: Date = new Date(), timeZoneOverride?: string): TimeSnapshot {
  const timeZone = resolveValidTimeZone(timeZoneOverride);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = Number(p.value);
    }
  }

  const year = map.year || now.getFullYear();
  const month = map.month || now.getMonth() + 1;
  const day = map.day || now.getDate();
  const rawHour = Number.isFinite(map.hour) ? map.hour : now.getHours();
  const hour24 = rawHour === 24 ? 0 : rawHour;
  const minute = Number.isFinite(map.minute) ? map.minute : now.getMinutes();
  const second = Number.isFinite(map.second) ? map.second : now.getSeconds();

  const ampm: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const pad2 = (n: number) => String(n).padStart(2, "0");

  const formatted24h = `${pad2(hour24)}:${pad2(minute)}`;
  const formatted24hWithSec = `${formatted24h}:${pad2(second)}`;
  const formatted12hEn = `${hour12}:${pad2(minute)} ${ampm}`;
  const offset = getNumericOffsetString(now, timeZone);
  const localIsoWithOffset = `${year}-${pad2(month)}-${pad2(day)}T${formatted24hWithSec}${offset}`;

  const period = getPeriodForHour(hour24);
  const hourWord = BN_HOUR_WORDS[hour12] || toBengaliDigits(hour12) + "টা";
  const spokenTimeBn =
    minute === 0
      ? `এখন ${period.spokenPeriodBn} ${hourWord} বাজে`
      : `এখন ${period.spokenPeriodBn} ${hourWord} বেজে ${toBengaliDigits(minute)} মিনিট`;

  const spokenTimeEn = `It is ${formatted12hEn} right now`;

  return {
    epochMs: now.getTime(),
    timeZone,
    year,
    month,
    day,
    hour24,
    minute,
    second,
    hour12,
    ampm,
    formatted24h,
    formatted24hWithSec,
    formatted12hEn,
    localIsoWithOffset,
    periodKey: period.periodKey,
    periodBn: period.periodBn,
    spokenPeriodBn: period.spokenPeriodBn,
    dayNightBn: period.dayNightBn,
    greetingBn: period.greetingBn,
    greetingEn: period.greetingEn,
    spokenTimeBn,
    spokenTimeEn,
  };
}

function isEnglishTimeAsk(text: string): boolean {
  const hasLatin = /[a-z]/i.test(text);
  const hasBanglaScript = /[\u0980-\u09FF]/.test(text);
  if (!hasLatin || hasBanglaScript) return false;
  // Distinguish pure English from Banglish words
  if (/\b(ekhon|akn|koyta|kota|baje|somoy|din|naki|rat|dupur|sokal|bikel|ki|koto)\b/i.test(text)) {
    return false;
  }
  return true;
}

export function answerTimeQueryLocally(
  rawInput: string,
  now: Date = new Date(),
  timeZoneOverride?: string
): LocalTimeAnswer {
  const snapshot = getTimeSnapshot(now, timeZoneOverride);
  const text = String(rawInput || "").normalize("NFC").trim();
  const lower = text.toLowerCase();

  if (!text) {
    return { handled: false, reply: "", snapshot };
  }

  // Never intercept reminder/task/weather/multi-action commands
  if (
    /(মনে কর|রিমাইন্ডার|কাজ|টাস্ক|আবহাওয়া|বৃষ্টি|তাপমাত্রা|রিপোর্ট|কল|হোয়াটসঅ্যাপ|মেসেজ|remind|alarm|task|weather|report|call|whatsapp|message|tomorrow|আগামীকাল|গতকাল)/i.test(
      lower
    )
  ) {
    return { handled: false, reply: "", snapshot };
  }

  const enMode = isEnglishTimeAsk(lower);

  // 1. Day vs Night question
  if (
    /^(?:(?:hey|hi|hello)\s+chintu[\s,!]*)?(?:এখন\s*)?(?:কি\s*)?(?:দিন\s*(?:না|নাকি|বা)\s*রাত|রাত\s*(?:না|নাকি|বা)\s*দিন|ekhon\s*(?:ki\s*)?(?:din\s*naki\s*rat|rat\s*naki\s*din)|is\s+it\s+(?:day|daytime|night|nighttime)(?:\s+or\s+(?:day|night))?)[?!.\s]*$/i.test(
      lower
    )
  ) {
    const reply = enMode
      ? `It is ${snapshot.dayNightBn === "রাত" ? "night" : "daytime"} right now, Sir (${snapshot.formatted12hEn}).`
      : `এখন ${snapshot.dayNightBn}, স্যার — ${snapshot.spokenTimeBn} (${snapshot.periodBn})।`;
    return { handled: true, queryType: "day_night", reply, snapshot };
  }

  // 2. Specific period verification ("এখন কি দুপুর?", "এখন কি সকাল?", "Is it morning?")
  const periodChecks: Array<{
    re: RegExp;
    matches: (p: TimePeriodKey) => boolean;
    bnLabel: string;
    enLabel: string;
  }> = [
    {
      re: /(?:এখন\s*কি\s*সকাল|ekhon\s*ki\s*(?:sokal|shokal)|is\s+it\s+morning)/i,
      matches: (p) => p === "morning",
      bnLabel: "সকাল",
      enLabel: "morning",
    },
    {
      re: /(?:এখন\s*কি\s*দুপুর|ekhon\s*ki\s*dupur|is\s+it\s+(?:noon|midday))/i,
      matches: (p) => p === "noon",
      bnLabel: "দুপুর",
      enLabel: "noon",
    },
    {
      re: /(?:এখন\s*কি\s*(?:বিকেল|বিকাল)|ekhon\s*ki\s*(?:bikel|bikal)|is\s+it\s+afternoon)/i,
      matches: (p) => p === "afternoon",
      bnLabel: "বিকেল",
      enLabel: "afternoon",
    },
    {
      re: /(?:এখন\s*কি\s*(?:সন্ধ্যা|সন্ধ্যে)|ekhon\s*ki\s*(?:sondha|shondha)|is\s+it\s+evening)/i,
      matches: (p) => p === "night" && snapshot.hour24 >= 18 && snapshot.hour24 < 20,
      bnLabel: "সন্ধ্যা",
      enLabel: "evening",
    },
    {
      re: /(?:এখন\s*কি\s*(?:গভীর\s*)?রাত|ekhon\s*ki\s*(?:gobhir\s*)?(?:rat|raat)|is\s+it\s+night)/i,
      matches: (p) => p === "night" || p === "late_night",
      bnLabel: "রাত",
      enLabel: "night",
    },
  ];

  for (const chk of periodChecks) {
    if (chk.re.test(lower) && text.length <= 60) {
      const yes = chk.matches(snapshot.periodKey);
      const reply = enMode
        ? yes
          ? `Yes Sir, it is ${chk.enLabel} — ${snapshot.formatted12hEn}.`
          : `No Sir, it is not ${chk.enLabel} — ${snapshot.spokenTimeEn} (${snapshot.periodBn}).`
        : yes
          ? `হ্যাঁ স্যার, ${snapshot.spokenTimeBn}।`
          : `না স্যার, এখন ${chk.bnLabel} নয় — ${snapshot.spokenTimeBn}।`;
      return { handled: true, queryType: "period_check", reply, snapshot };
    }
  }

  // 3. Direct time question ("What time is it?", "এখন কয়টা বাজে?", "ekhon koyta baje?")
  if (
    /^(?:(?:hey|hi|hello|চিন্টু|হে\s*চিন্টু)[\s,!]*)?(?:what(?:'s|\s+is)\s+the\s+time(?:\s+now|\s+right\s+now)?|what\s+time\s+is\s+it(?:\s+now|\s+right\s+now)?|tell\s+me\s+the\s+(?:current\s+)?time|current\s+time|(?:এখন\s*)?(?:কয়টা|কটা)\s*বাজে(?:\s*বলো|\s*হলো)?|(?:এখন\s*)?সময়\s*কত|(?:এখন\s*)?টাইম\s*কত|(?:ekhon|ekhn|akn)?\s*(?:koyta|koita|kota)\s*baje|(?:ekhon|akn)?\s*(?:somoy|time)\s*koto)[?!.\s]*$/i.test(
      lower
    )
  ) {
    const reply = enMode
      ? `${snapshot.spokenTimeEn}, Sir.`
      : `${snapshot.spokenTimeBn}, স্যার।`;
    return { handled: true, queryType: "time", reply, snapshot };
  }

  // 4. Time-of-day greeting ("Good morning, Chintu", "শুভ সকাল", etc.)
  const greetMatch = lower.match(
    /^(?:(?:hey|hi|hello)\s+chintu[\s,!]*)?(good\s+morning|good\s+afternoon|good\s+evening|good\s+night|শুভ\s*সকাল|শুভ\s*দুপুর|শুভ\s*বিকেল|শুভ\s*সন্ধ্যা|শুভ\s*রাত্রি)(?:[\s,!]*(?:chintu|চিন্টু|sir|স্যার))?[?!.\s]*$/i
  );
  if (greetMatch) {
    const g = greetMatch[1].toLowerCase();
    const isMorningGreet = /morning|সকাল/.test(g);
    const isAfternoonGreet = /afternoon|দুপুর|বিকেল/.test(g);
    const isEveningOrNightGreet = /evening|night|সন্ধ্যা|রাত্রি/.test(g);

    let matchesActual = false;
    if (isMorningGreet && snapshot.periodKey === "morning") matchesActual = true;
    if (isAfternoonGreet && (snapshot.periodKey === "noon" || snapshot.periodKey === "afternoon")) {
      matchesActual = true;
    }
    if (isEveningOrNightGreet && (snapshot.periodKey === "night" || snapshot.periodKey === "late_night")) {
      matchesActual = true;
    }

    const reply = enMode
      ? matchesActual
        ? `${snapshot.greetingEn}, Sir! It is ${snapshot.formatted12hEn}. How are your plans going today?`
        : `Actually it is ${snapshot.formatted12hEn} right now, Sir, so ${snapshot.greetingEn.toLowerCase()}! How can I help you?`
      : matchesActual
        ? `${snapshot.greetingBn}, স্যার! ${snapshot.spokenTimeBn}। আজকের কাজকর্ম কেমন চলছে?`
        : `আসলে ${snapshot.spokenTimeBn}, স্যার — তাই ${snapshot.greetingBn}! বলুন, আজ আপনাকে কীভাবে সাহায্য করতে পারি?`;
    return { handled: true, queryType: "greeting", reply, snapshot };
  }

  return { handled: false, reply: "", snapshot };
}
