export interface ContactNameEntry {
  id?: string;
  name: string;
  nicknames?: string;
}

export function normalizeBangladeshPhone(raw: string): string {
  const bnToAscii = String(raw || "").replace(/[০-৯]/g, (d) =>
    String("০১২৩৪৫৬৭৮৯".indexOf(d))
  );
  const cleaned = bnToAscii.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  const digitsOnly = cleaned.replace(/\+/g, "");

  // 008801XXXXXXXXX -> +8801XXXXXXXXX
  if (/^008801\d{9}$/.test(digitsOnly)) {
    return "+" + digitsOnly.slice(2);
  }
  // 8801XXXXXXXXX -> +8801XXXXXXXXX
  if (/^8801\d{9}$/.test(digitsOnly)) {
    return "+" + digitsOnly;
  }
  // 01XXXXXXXXX (11 digits) -> +8801XXXXXXXXX
  if (/^01\d{9}$/.test(digitsOnly)) {
    return "+880" + digitsOnly.slice(1);
  }
  // 1XXXXXXXXX (10 digits missing leading 0) -> +8801XXXXXXXXX
  if (/^1[3-9]\d{8}$/.test(digitsOnly)) {
    return "+880" + digitsOnly;
  }
  if (cleaned.startsWith("+") && digitsOnly.length >= 6) {
    return "+" + digitsOnly;
  }
  return digitsOnly;
}

export function phoneToWhatsAppDigits(normalizedPhone: string): string {
  return normalizeBangladeshPhone(normalizedPhone).replace(/[^\d]/g, "");
}

// Phonetic transliteration from Bengali Unicode -> approximate Latin/Banglish for loose matching
const BN_MAP: Record<string, string> = {
  অ: "o",
  আ: "a",
  ই: "i",
  ঈ: "i",
  উ: "u",
  ঊ: "u",
  ঋ: "ri",
  এ: "e",
  ঐ: "oi",
  ও: "o",
  ঔ: "ou",
  "া": "a",
  "ি": "i",
  "ী": "i",
  "ু": "u",
  "ূ": "u",
  "ৃ": "ri",
  "ে": "e",
  "ৈ": "oi",
  "ো": "o",
  "ৌ": "ou",
  "ং": "ng",
  "ঃ": "h",
  "ঁ": "",
  "্": "",
  ক: "k",
  খ: "kh",
  গ: "g",
  ঘ: "gh",
  ঙ: "ng",
  চ: "c",
  ছ: "ch",
  জ: "j",
  ঝ: "jh",
  ঞ: "n",
  ট: "t",
  ঠ: "th",
  ড: "d",
  ঢ: "dh",
  ণ: "n",
  ত: "t",
  থ: "th",
  দ: "d",
  ধ: "dh",
  ন: "n",
  প: "p",
  ফ: "f",
  ব: "b",
  ভ: "v",
  ম: "m",
  য: "j",
  র: "r",
  ল: "l",
  শ: "sh",
  ষ: "sh",
  স: "s",
  হ: "h",
  ড়: "r",
  ঢ়: "rh",
  য়: "y",
  ৎ: "t",
};

export function toPhoneticLatin(raw: string): string {
  const nfc = String(raw || "").normalize("NFC").toLowerCase().trim();
  let out = "";
  for (let i = 0; i < nfc.length; i++) {
    const ch = nfc[i];
    if (BN_MAP[ch] !== undefined) {
      out += BN_MAP[ch];
      continue;
    }
    if (/[a-z0-9\s]/.test(ch)) {
      out += ch;
    } else if (/[-_,./'"]/.test(ch)) {
      out += " ";
    }
  }
  return out
    .replace(/ph/g, "f")
    .replace(/bh/g, "v")
    .replace(/wh/g, "w")
    .replace(/ee|ea/g, "i")
    .replace(/oo/g, "u")
    .replace(/z/g, "j")
    .replace(/q/g, "k")
    .replace(/c(?=[ei])/g, "s")
    .replace(/c/g, "k")
    .replace(/(.)\1+/g, "$1") // collapse double letters e.g. ammu -> amu, momm -> mom
    .replace(/\s+/g, " ")
    .trim();
}

function consonantSkeleton(s: string): string {
  return s.replace(/[aeiou]/g, "");
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) dp[j] = prev;
      else dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function scoreAlias(queryRaw: string, queryPhon: string, aliasRaw: string): number {
  const ar = aliasRaw.normalize("NFC").toLowerCase().trim();
  const qr = queryRaw.normalize("NFC").toLowerCase().trim();
  if (!ar || !qr) return 0;
  if (ar === qr) return 100;

  const ap = toPhoneticLatin(ar);
  if (!ap || !queryPhon) return 0;
  if (ap === queryPhon) return 95;

  // Token-level exact / prefix / fuzzy match
  const qTokens = queryPhon.split(/\s+/).filter(Boolean);
  const aTokens = ap.split(/\s+/).filter(Boolean);

  for (const qt of qTokens) {
    if (qt.length < 2) continue;
    for (const at of aTokens) {
      if (at === qt) return 90;
      if (at.startsWith(qt) || qt.startsWith(at)) {
        if (Math.min(at.length, qt.length) >= 3) return 80;
      }
      if (Math.abs(at.length - qt.length) <= 1 && Math.min(at.length, qt.length) >= 4) {
        if (editDistance(at, qt) <= 1) return 75;
      }
      const ask = consonantSkeleton(at);
      const qsk = consonantSkeleton(qt);
      if (ask.length >= 2 && ask === qsk && editDistance(at, qt) <= 2) {
        return 72;
      }
    }
  }

  if (ap.includes(queryPhon) && queryPhon.length >= 3) return 70;
  if (queryPhon.includes(ap) && ap.length >= 3) return 68;
  return 0;
}

export function matchContactsLoosely<T extends ContactNameEntry>(
  contacts: T[],
  rawQuery: string
): T[] {
  const query = String(rawQuery || "").trim();
  if (!query || !Array.isArray(contacts) || contacts.length === 0) return [];
  const queryPhon = toPhoneticLatin(query);

  const scored: Array<{ contact: T; score: number }> = [];
  for (const c of contacts) {
    const aliases = [
      c.name,
      ...(c.nicknames ? c.nicknames.split(/[,/|;]+/) : []),
    ]
      .map((s) => s.trim())
      .filter(Boolean);

    let best = 0;
    for (const alias of aliases) {
      const sc = scoreAlias(query, queryPhon, alias);
      if (sc > best) best = sc;
    }
    if (best >= 68) {
      scored.push({ contact: c, score: best });
    }
  }

  if (scored.length === 0) return [];
  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  // If there is a unique very strong exact match (>=90) and runner-up is noticeably weaker (<82), pick unique
  if (topScore >= 90 && scored.length > 1 && scored[1].score < 82) {
    return [scored[0].contact];
  }
  // Return all contacts tied or closely matching (score >= topScore - 10)
  return scored.filter((s) => s.score >= topScore - 10).map((s) => s.contact);
}
