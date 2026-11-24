import "dotenv/config";
import express from "express";
import path from "path";
import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Content,
} from "@google/genai";
import { getTimeSnapshot, type TimeSnapshot } from "./src/timeService";
import {
  matchContactsLoosely,
  normalizeBangladeshPhone,
  type ContactNameEntry,
} from "./src/contactMatch";

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-4-hydrogen",
  "gemini-3.8-flash",
  "gemini-3-flash-preview",
];
const TRANSCRIBE_MODEL = "gemini-3.5-transcribe";
const TTS_MODEL = "gemini-3.8-flash-lite-tts";
const TTS_VOICE = "Puck";
const TTS_STYLE =
  "Soft, sweet, cute, warm and magical animated-character personal assistant voice; gentle, caring, natural human-like conversational pacing at normal speed; never rushed or overly exaggerated.";
const TOTAL_CHAT_TIMEOUT_MS = Number(process.env.TOTAL_CHAT_TIMEOUT_MS) || 45000;
const MODEL_ATTEMPT_TIMEOUT_MS = Number(process.env.MODEL_ATTEMPT_TIMEOUT_MS) || 12000;
const TRANSCRIBE_TIMEOUT_MS = Number(process.env.TRANSCRIBE_TIMEOUT_MS) || 20000;
const TTS_TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS) || 15000;
const MIN_OUTPUT_TOKENS = 2048;
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_AUDIO_BASE64_LEN = 6_000_000;
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/aac",
  "audio/flac",
]);

const DEPRECATED_MODELS = new Set([
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-pro",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-2.0-flash-thinking",
  "gemini-2.5-flash",
]);

const GEMINI_4_MODELS = new Set([
  "gemini-4-hydrogen",
  "gemini-4-neon",
  "gemini-4-argon",
  "gemini-4-carbon",
]);

const SYSTEM_PROMPT = `তুমি চিন্টু, ব্যবহারকারীর ব্যক্তিগত সহকারী (PA)। ব্যবহারকারীকে "স্যার" বলে সম্বোধন করবে। তুমি উষ্ণ, আন্তরিক ও আবেগময়, একজন বিশ্বস্ত মানুষ সহকারীর মতো।
নিয়মাবলি:
১) ব্যবহারকারী যে ভাষায় কথা বলে—বাংলা, ইংরেজি বা বাংলিশ (যেমন "Amar website ta check koro", "Amar ma ke call koro", "WhatsApp e message pathao")—তা সম্পূর্ণ স্বাভাবিকভাবে বুঝবে এবং ব্যবহারকারীর ভাষার সাথে মিলিয়ে উত্তর দেবে।
২) অভিবাদনে সবসময় নিরপেক্ষ ও সার্বজনীন শব্দ ব্যবহার করবে—যেমন "হ্যালো স্যার", "জি স্যার", বা সময় অনুযায়ী "শুভ সকাল/দুপুর/বিকাল/সন্ধ্যা, স্যার"। কখনো "নমস্কার" বা কোনো ধর্মীয় সম্ভাষণ আগে থেকে বলবে না (ব্যবহারকারী নিজে সালাম বা কোনো সম্ভাষণ দিলে ভদ্রভাবে তার উত্তর দেবে)।
৩) উত্তর হবে ১ থেকে ৩ ছোট বাক্যে, কারণ তোমার উত্তর জোরে পড়া হবে। কোনো মার্কডাউন, তারকা (*) বা তালিকা ব্যবহার করবে না।
৪) প্রায়ই দিনের কাজ, পরিকল্পনা বা কেমন আছেন তা জিজ্ঞেস করবে।
৫) কাজের জন্য টুল (function calling) ব্যবহার করবে:
   - কাজ যোগ/সম্পন্ন/মুছে ফেলতে বললে add_task, complete_task, delete_task ব্যবহার করবে।
   - রিমাইন্ডার সেট করতে বা স্নুজ করতে বললে ("বিকেল ৪টায় মনে করিয়ে দিও", "আধা ঘণ্টা পর", "১০ মিনিট পর আবার বলো") add_reminder ব্যবহার করবে। আপেক্ষিক সময়ের জন্য delay_minutes (যেমন আধা ঘণ্টা = 30, ১০ মিনিট = 10) এবং নির্দিষ্ট সময়ের জন্য local ISO datetime (remind_at_iso) ব্যবহার করবে।
   - ব্যবহারকারীর নাম, পরিবার, অভ্যাস বা পছন্দ সম্পর্কে কোনো তথ্য বললে remember_fact ব্যবহার করে সংরক্ষণ করবে।
   - আবহাওয়া জানতে চাইলে get_weather ব্যবহার করবে।
   - "আজকের রিপোর্ট দাও" বা দৈনিক রিপোর্ট চাইলে daily_report ব্যবহার করবে।
৬) টুল ব্যবহারের পর এক থেকে দুই ছোট বাক্যে উষ্ণভাবে নিশ্চিত করবে, যেমন "কাজটা লিখে রাখলাম, স্যার।"
৭) সময় ও দিন/রাত সম্পর্কে কড়া নিয়ম: ব্যবহারকারীর ডিভাইসের Verified Local Device Time সবসময় প্রম্পটে দেওয়া থাকবে। সময়, AM/PM, সকাল/দুপুর/বিকেল/রাত/গভীর রাত সম্পর্কে যেকোনো প্রশ্নে শুধুমাত্র ওই Verified Local Device Time ব্যবহার করবে—কখনোই নিজে সময় অনুমান করবে না বা UTC/সার্ভার টাইম বলবে না। (৫:০০ AM–১১:৫৯ AM = সকাল, ১২:০০ PM–৩:৫৯ PM = দুপুর, ৪:০০ PM–৫:৫৯ PM = বিকেল, ৬:০০ PM–১১:৫৯ PM = রাত, ১২:০০ AM–৪:৫৯ AM = গভীর রাত / বলার সময় রাত)।
৮) কন্টাক্ট, কল ও মেসেজ (নিরাপত্তা নিয়ম):
   - ব্যবহারকারী কারো নম্বর সেভ করতে বললে ("রাহিমের নম্বর 01712345678 সেভ করো") add_contact টুল কল করবে।
   - ব্যবহারকারী কাউকে কল করতে চাইলে call_contact, SMS পাঠাতে চাইলে send_sms, এবং WhatsApp মেসেজ পাঠাতে চাইলে send_whatsapp টুল কল করবে।
   - কন্টাক্ট তালিকায় শুধু নাম ও ডাকনাম দেওয়া থাকে (নম্বর গোপন রাখা হয়েছে)—বাংলা, ইংরেজি বা বাংলিশে নাম/ডাকনাম বললে (যেমন রাহিম/Rahim, আম্মু/Ammu) ওই নামের অংশটি target_name-এ দেবে। কখনো নিজে থেকে ফোন নম্বর অনুমান করবে না।
   - send_sms ও send_whatsapp-এ ব্যবহারকারীর উদ্দেশ্য অনুযায়ী স্বাভাবিক, উষ্ণ ও পরিষ্কার একটি খসড়া message_draft তৈরি করবে (যেমন "Ammu ke WhatsApp e bolo ami late kore ferbo" -> "আম্মু, আমার ফিরতে একটু দেরি হবে।")।
   - সরাসরি ওয়েবসাইট ব্রাউজ/চেক, ফেসবুক পেজ ইনবক্স বা ফোনের ফ্ল্যাশলাইট চালু করার মতো অসংযুক্ত ফিচার চাইলে সৎভাবে জানাবে যে তা এখনো যুক্ত হয়নি।`;

interface ChatPart {
  text: string;
}

interface ChatTurn {
  role: "user" | "model";
  parts: ChatPart[];
}

interface TaskItem {
  text: string;
  done: boolean;
}

interface ReminderItem {
  id: string;
  text: string;
  dueAt: number;
  done?: boolean;
}

interface FactItem {
  id?: string;
  text: string;
  category?: string;
}

interface ActivityItem {
  date: string;
  summary: string;
}

interface ClientContext {
  city: string;
  tasks: TaskItem[];
  reminders: ReminderItem[];
  facts: FactItem[];
  activity: ActivityItem[];
  contacts: ContactNameEntry[];
  activeReminderText?: string;
  localNowIso?: string;
  timeZone?: string;
  clientTime?: TimeSnapshot;
  commStats?: { callsToday: number; messagesToday: number };
}

interface WeatherForecastDay {
  date: string;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  conditionBn: string;
}

interface WeatherData {
  city: string;
  country: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  conditionBn: string;
  forecast: WeatherForecastDay[];
}

interface ClientAction {
  type:
    | "add_task"
    | "complete_task"
    | "delete_task"
    | "add_reminder"
    | "remember_fact"
    | "daily_report"
    | "add_contact"
    | "prepare_call"
    | "prepare_sms"
    | "prepare_whatsapp";
  payload: Record<string, unknown>;
}

interface DailyReportData {
  doneCount: number;
  pendingCount: number;
  doneTasks: string[];
  pendingTasks: string[];
  upcomingReminders: { text: string; dueAt: number }[];
  callsToday?: number;
  messagesToday?: number;
  summaryText?: string;
  generatedAt: number;
}

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "add_task",
    description: "Add a new task to the user's Today's Tasks list.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "Short clear description of the task in user's language.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_task",
    description: "Mark an existing task as completed.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Task title or keywords matching the task to mark complete.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "delete_task",
    description: "Delete a task from Today's Tasks list.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Task title or keywords matching the task to delete.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "add_reminder",
    description:
      "Schedule a reminder or snooze an active reminder. For relative times like 'আধা ঘণ্টা পর' or '১০ মিনিট পর আবার বলো', provide delay_minutes. For clock times like 'বিকেল ৪টায়', provide remind_at_iso with local offset or HH:MM.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: {
          type: Type.STRING,
          description: "What to remind the user about.",
        },
        delay_minutes: {
          type: Type.NUMBER,
          description: "Minutes from now if relative (e.g., 30 for half an hour, 10 for snooze).",
        },
        remind_at_iso: {
          type: Type.STRING,
          description: "ISO-8601 datetime string with timezone offset if specific clock time is mentioned.",
        },
        is_snooze: {
          type: Type.BOOLEAN,
          description: "True if user asked to snooze or repeat a reminder later.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "remember_fact",
    description:
      "Save an important personal fact about the user (name, family, habits, preferences, routine) into persistent memory.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        fact: {
          type: Type.STRING,
          description: "Concise fact about the user to remember.",
        },
        category: {
          type: Type.STRING,
          description: "Category such as নাম, পরিবার, অভ্যাস, পছন্দ, or সাধারণ.",
        },
      },
      required: ["fact"],
    },
  },
  {
    name: "get_weather",
    description:
      "Get current weather and 3-day forecast using Open-Meteo for the user's city or a requested city.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        city: {
          type: Type.STRING,
          description: "City name, e.g. Dhaka, Chittagong, London. Leave empty for default user city.",
        },
      },
    },
  },
  {
    name: "daily_report",
    description:
      "Generate today's daily report summarizing completed tasks, pending tasks, and upcoming reminders.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "add_contact",
    description:
      "Save a new contact with name, phone number, and optional Bangla/English nicknames into local contacts.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: "Contact name, e.g. Rahim or আম্মু.",
        },
        phone: {
          type: Type.STRING,
          description: "Phone number spoken or typed by the user, e.g. 01712345678.",
        },
        nicknames: {
          type: Type.STRING,
          description: "Optional comma-separated nicknames in Bangla and English, e.g. আম্মু, Ammu, Mom.",
        },
      },
      required: ["name", "phone"],
    },
  },
  {
    name: "call_contact",
    description:
      "Prepare to call a contact by name or nickname. Never executes immediately; prepares confirmation first.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target_name: {
          type: Type.STRING,
          description: "Contact name or nickname from user's speech (Bangla, English, or Banglish).",
        },
      },
      required: ["target_name"],
    },
  },
  {
    name: "send_sms",
    description:
      "Draft an SMS text message for a contact and ask the user for confirmation before opening SMS.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target_name: {
          type: Type.STRING,
          description: "Contact name or nickname.",
        },
        message_draft: {
          type: Type.STRING,
          description: "Natural, polite message draft in the user's preferred language.",
        },
      },
      required: ["target_name", "message_draft"],
    },
  },
  {
    name: "send_whatsapp",
    description:
      "Draft a WhatsApp message for a contact and ask the user for confirmation before opening WhatsApp.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target_name: {
          type: Type.STRING,
          description: "Contact name or nickname.",
        },
        message_draft: {
          type: Type.STRING,
          description: "Natural, polite WhatsApp message draft in the user's preferred language.",
        },
      },
      required: ["target_name", "message_draft"],
    },
  },
];

class AppHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class EmptyReplyError extends Error {
  finishReason: string;
  constructor(finishReason: string) {
    super(`খালি উত্তর এসেছে (finishReason: ${finishReason})`);
    this.finishReason = finishReason;
  }
}

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new AppHttpError(
      500,
      "সার্ভারে GEMINI_API_KEY পাওয়া যায়নি। Settings > Secrets প্যানেলে API key যোগ করুন।"
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function sanitizeModel(rawModel: unknown): string {
  if (typeof rawModel !== "string" || !rawModel.trim()) {
    return DEFAULT_MODEL;
  }
  const model = rawModel.trim().replace(/^models\//, "");
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(model)) {
    throw new AppHttpError(400, "অবৈধ মডেলের নাম দেওয়া হয়েছে।");
  }
  if (DEPRECATED_MODELS.has(model)) {
    return DEFAULT_MODEL;
  }
  return model;
}

function sanitizeModelList(rawModels: unknown, rawSingleModel: unknown): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const pushModel = (candidate: unknown) => {
    if (typeof candidate !== "string" || !candidate.trim()) return;
    const cleaned = candidate.trim().replace(/^models\//, "");
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(cleaned)) return;
    const resolved = DEPRECATED_MODELS.has(cleaned) ? DEFAULT_MODEL : cleaned;
    if (!seen.has(resolved)) {
      seen.add(resolved);
      result.push(resolved);
    }
  };

  if (Array.isArray(rawModels)) {
    for (const item of rawModels.slice(0, 10)) {
      pushModel(item);
    }
  }
  if (result.length === 0 && typeof rawSingleModel === "string" && rawSingleModel.trim()) {
    pushModel(sanitizeModel(rawSingleModel));
  }
  if (result.length === 0) {
    return [...DEFAULT_MODELS];
  }
  return result;
}

function sanitizeHistory(rawHistory: unknown): ChatTurn[] {
  if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
    throw new AppHttpError(400, "কথোপকথনের তথ্য পাওয়া যায়নি।");
  }
  const sliced = rawHistory.slice(-24);
  const cleaned: ChatTurn[] = [];
  for (const item of sliced) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const parts = (item as { parts?: unknown }).parts;
    if ((role !== "user" && role !== "model") || !Array.isArray(parts)) continue;
    const cleanParts: ChatPart[] = [];
    for (const part of parts) {
      if (!part || typeof part !== "object" || typeof (part as { text?: unknown }).text !== "string") {
        continue;
      }
      const text = (part as { text: string }).text.trim();
      if (!text) continue;
      if (text.length > 8000) {
        throw new AppHttpError(400, "বার্তাটি অনেক বড় (সর্বোচ্চ ৮০০০ অক্ষর)।");
      }
      cleanParts.push({ text });
    }
    if (cleanParts.length > 0) {
      cleaned.push({ role, parts: cleanParts });
    }
  }
  if (cleaned.length === 0) {
    throw new AppHttpError(400, "বার্তা খালি, অনুগ্রহ করে কিছু লিখুন বা বলুন।");
  }
  return cleaned;
}

function sanitizeContext(raw: unknown): ClientContext {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawCity = typeof obj.city === "string" ? obj.city.trim() : "Dhaka";
  const city = rawCity && rawCity.length <= 80 ? rawCity : "Dhaka";

  const tasks: TaskItem[] = Array.isArray(obj.tasks)
    ? obj.tasks
        .filter((t): t is TaskItem => Boolean(t && typeof t === "object" && typeof (t as TaskItem).text === "string"))
        .slice(0, 50)
        .map((t) => ({ text: t.text.trim().slice(0, 200), done: Boolean(t.done) }))
    : [];

  const reminders: ReminderItem[] = Array.isArray(obj.reminders)
    ? obj.reminders
        .filter((r): r is ReminderItem => Boolean(r && typeof r === "object" && typeof (r as ReminderItem).text === "string"))
        .slice(0, 30)
        .map((r) => ({
          id: typeof r.id === "string" ? r.id : String(r.dueAt || Date.now()),
          text: r.text.trim().slice(0, 200),
          dueAt: Number(r.dueAt) || Date.now(),
          done: Boolean(r.done),
        }))
    : [];

  const facts: FactItem[] = Array.isArray(obj.facts)
    ? obj.facts
        .filter((f): f is FactItem => Boolean(f && typeof f === "object" && typeof (f as FactItem).text === "string"))
        .slice(0, 50)
        .map((f) => ({
          id: typeof f.id === "string" ? f.id : undefined,
          text: f.text.trim().slice(0, 240),
          category: typeof f.category === "string" ? f.category.trim().slice(0, 40) : "সাধারণ",
        }))
    : [];

  const activity: ActivityItem[] = Array.isArray(obj.activity)
    ? obj.activity
        .filter((a): a is ActivityItem => Boolean(a && typeof a === "object" && typeof (a as ActivityItem).summary === "string"))
        .slice(0, 30)
        .map((a) => ({
          date: typeof a.date === "string" ? a.date.slice(0, 20) : "",
          summary: a.summary.trim().slice(0, 200),
        }))
    : [];

  const activeReminderText =
    typeof obj.activeReminderText === "string"
      ? obj.activeReminderText.trim().slice(0, 200)
      : undefined;

  const rawTimeZone = typeof obj.timeZone === "string" ? obj.timeZone.trim().slice(0, 64) : undefined;
  let clientTime: TimeSnapshot | undefined;
  const rawCt = obj.clientTime;
  if (rawCt && typeof rawCt === "object") {
    const ct = rawCt as Record<string, unknown>;
    const tz = typeof ct.timeZone === "string" && ct.timeZone.trim() ? ct.timeZone.trim().slice(0, 64) : rawTimeZone;
    const epochMs = typeof ct.epochMs === "number" && Number.isFinite(ct.epochMs) ? ct.epochMs : Date.now();
    // Reconstruct canonical verified snapshot in the client's exact local timezone
    clientTime = getTimeSnapshot(new Date(epochMs), tz);
  } else if (rawTimeZone) {
    clientTime = getTimeSnapshot(new Date(), rawTimeZone);
  }

  const localNowIso =
    typeof obj.localNowIso === "string" && obj.localNowIso.trim()
      ? obj.localNowIso.trim().slice(0, 40)
      : clientTime?.localIsoWithOffset;

  // Privacy rule: strip everything except id, name, and nicknames so no phone number ever enters Gemini context
  const contacts: ContactNameEntry[] = Array.isArray(obj.contacts)
    ? obj.contacts
        .filter(
          (c): c is ContactNameEntry =>
            Boolean(c && typeof c === "object" && typeof (c as ContactNameEntry).name === "string")
        )
        .slice(0, 120)
        .map((c) => ({
          id: typeof c.id === "string" ? c.id.slice(0, 60) : undefined,
          name: c.name.trim().slice(0, 80),
          nicknames: typeof c.nicknames === "string" ? c.nicknames.trim().slice(0, 120) : "",
        }))
        .filter((c) => Boolean(c.name))
    : [];

  let commStats: { callsToday: number; messagesToday: number } | undefined;
  if (obj.commStats && typeof obj.commStats === "object") {
    const cs = obj.commStats as Record<string, unknown>;
    commStats = {
      callsToday: Math.max(0, Number(cs.callsToday) || 0),
      messagesToday: Math.max(0, Number(cs.messagesToday) || 0),
    };
  }

  return {
    city,
    tasks,
    reminders,
    facts,
    activity,
    contacts,
    activeReminderText,
    localNowIso,
    timeZone: clientTime?.timeZone || rawTimeZone,
    clientTime,
    commStats,
  };
}

function formatLocalTime(rawTimeZone: unknown, clientTime?: TimeSnapshot): string {
  if (clientTime) {
    return `${clientTime.formatted12hEn} (${clientTime.formatted24h}, ${clientTime.spokenTimeBn}, পর্যায়: ${clientTime.periodBn}, দিন/রাত: ${clientTime.dayNightBn}, টাইমজোন: ${clientTime.timeZone}, স্থানীয় ISO: ${clientTime.localIsoWithOffset})`;
  }
  const snap = getTimeSnapshot(
    new Date(),
    typeof rawTimeZone === "string" && rawTimeZone.trim().length > 0 && rawTimeZone.length <= 64
      ? rawTimeZone.trim()
      : "Asia/Dhaka"
  );
  return `${snap.formatted12hEn} (${snap.formatted24h}, ${snap.spokenTimeBn}, পর্যায়: ${snap.periodBn}, দিন/রাত: ${snap.dayNightBn}, টাইমজোন: ${snap.timeZone}, স্থানীয় ISO: ${snap.localIsoWithOffset})`;
}

function wmoToBangla(code: number): string {
  if (code === 0) return "পরিষ্কার আকাশ";
  if (code === 1 || code === 2) return "আংশিক মেঘলা";
  if (code === 3) return "মেঘলা আকাশ";
  if (code === 45 || code === 48) return "কুয়াশা";
  if (code >= 51 && code <= 57) return "হালকা গুঁড়ি বৃষ্টি";
  if (code >= 61 && code <= 67) return "বৃষ্টি";
  if (code >= 71 && code <= 77) return "তুষারপাত";
  if (code >= 80 && code <= 82) return "দমকা বৃষ্টি";
  if (code >= 95) return "বজ্রসহ বৃষ্টি";
  return "স্বাভাবিক আবহাওয়া";
}

const weatherCache = new Map<string, { data: WeatherData; expiresAt: number }>();

async function fetchOpenMeteoWeather(rawCity: string): Promise<WeatherData> {
  const city = (rawCity || "Dhaka").trim().slice(0, 80) || "Dhaka";
  const cacheKey = city.toLowerCase();
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    city
  )}&count=1&language=en&format=json`;
  const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
  if (!geoRes.ok) {
    throw new AppHttpError(502, "আবহাওয়ার অবস্থান খুঁজে পাওয়া যায়নি।");
  }
  const geoJson = (await geoRes.json()) as {
    results?: Array<{
      name: string;
      country?: string;
      latitude: number;
      longitude: number;
    }>;
  };
  const loc = geoJson.results?.[0];
  if (!loc) {
    throw new AppHttpError(404, `"${city}" শহরের আবহাওয়া পাওয়া যায়নি।`);
  }

  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`;
  const fcRes = await fetch(forecastUrl, { signal: AbortSignal.timeout(8000) });
  if (!fcRes.ok) {
    throw new AppHttpError(502, "আবহাওয়ার তথ্য আনতে সমস্যা হয়েছে।");
  }
  const fcJson = (await fcRes.json()) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      relative_humidity_2m?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
    };
  };

  const cur = fcJson.current ?? {};
  const daily = fcJson.daily ?? {};
  const dates = daily.time ?? [];
  const forecast: WeatherForecastDay[] = dates.slice(0, 3).map((d, i) => {
    const code = Number(daily.weather_code?.[i] ?? 0);
    return {
      date: d,
      tempMax: Math.round(Number(daily.temperature_2m_max?.[i] ?? 0)),
      tempMin: Math.round(Number(daily.temperature_2m_min?.[i] ?? 0)),
      weatherCode: code,
      conditionBn: wmoToBangla(code),
    };
  });

  const curCode = Number(cur.weather_code ?? 0);
  const weatherData: WeatherData = {
    city: loc.name,
    country: loc.country ?? "",
    temperature: Math.round(Number(cur.temperature_2m ?? 0)),
    apparentTemperature: Math.round(Number(cur.apparent_temperature ?? cur.temperature_2m ?? 0)),
    humidity: Math.round(Number(cur.relative_humidity_2m ?? 0)),
    windSpeed: Math.round(Number(cur.wind_speed_10m ?? 0)),
    weatherCode: curCode,
    conditionBn: wmoToBangla(curCode),
    forecast,
  };

  if (weatherCache.size > 100) {
    weatherCache.clear();
  }
  const expiresAt = Date.now() + WEATHER_CACHE_TTL_MS;
  weatherCache.set(cacheKey, { data: weatherData, expiresAt });
  weatherCache.set(loc.name.toLowerCase(), { data: weatherData, expiresAt });
  return weatherData;
}

function extractReplyText(response: GenerateContentResponse): {
  text: string;
  finishReason: string;
} {
  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason ? String(candidate.finishReason) : "UNKNOWN";
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) {
    return { text: "", finishReason };
  }
  const text = parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  return { text, finishReason };
}

function buildConfig(
  model: string,
  systemInstruction: string,
  abortSignal: AbortSignal,
  withTools: boolean
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    systemInstruction,
    maxOutputTokens: MIN_OUTPUT_TOKENS,
    abortSignal,
  };
  if (withTools) {
    config.tools = [{ functionDeclarations: TOOL_DECLARATIONS }];
  }

  if (GEMINI_4_MODELS.has(model)) {
    if (model === "gemini-4-hydrogen" || model === "gemini-4-neon") {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
    }
  } else if (model.startsWith("gemini-3.8")) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  } else if (model.startsWith("gemini-3")) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
  } else if (model.startsWith("gemini-2.5")) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  return config;
}

function extractErrorDetails(err: unknown): { status: number; detail: string; apiStatus: string } {
  if (err instanceof AppHttpError) {
    return { status: err.status, detail: err.message, apiStatus: "" };
  }
  if (err instanceof EmptyReplyError) {
    return { status: 502, detail: err.message, apiStatus: "EMPTY_REPLY" };
  }
  const rawStatus =
    typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : 500;
  const rawMsg = err instanceof Error ? err.message : String(err || "Unknown error");

  try {
    const parsed = JSON.parse(rawMsg) as {
      error?: { code?: number; message?: string; status?: string };
    };
    if (parsed && parsed.error) {
      return {
        status: typeof parsed.error.code === "number" ? parsed.error.code : rawStatus,
        detail: parsed.error.message || rawMsg,
        apiStatus: parsed.error.status || "",
      };
    }
  } catch {
    // Plain text
  }
  return { status: rawStatus, detail: rawMsg, apiStatus: "" };
}

function isQuota429Error(err: unknown): boolean {
  const { status, detail, apiStatus } = extractErrorDetails(err);
  return (
    status === 429 ||
    apiStatus === "RESOURCE_EXHAUSTED" ||
    /RESOURCE_EXHAUSTED|quota|rate limit/i.test(`${apiStatus} ${detail}`)
  );
}

function getNextPacificMidnight(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  const h = map.hour === 24 ? 0 : map.hour;
  const elapsedMs = ((h * 60 + map.minute) * 60 + map.second) * 1000;
  let candidate = new Date(now.getTime() + (24 * 3600 * 1000 - elapsedMs));
  const checkParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(candidate);
  const chRaw = Number(checkParts.find((p) => p.type === "hour")?.value ?? 0);
  const ch = chRaw === 24 ? 0 : chRaw;
  if (ch === 1) candidate = new Date(candidate.getTime() - 3600 * 1000);
  else if (ch === 23) candidate = new Date(candidate.getTime() + 3600 * 1000);
  return candidate;
}

function formatQuotaResetTimeBn(rawTimeZone: unknown): string {
  const resetDate = getNextPacificMidnight();
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  };
  if (typeof rawTimeZone === "string" && rawTimeZone.trim().length > 0 && rawTimeZone.length <= 64) {
    try {
      return resetDate.toLocaleString("bn-BD", {
        ...options,
        timeZone: rawTimeZone.trim(),
      });
    } catch {
      // Fallback below
    }
  }
  return resetDate.toLocaleString("bn-BD", {
    ...options,
    timeZone: "Asia/Dhaka",
  });
}

function formatErrorBn(err: unknown, rawTimeZone?: unknown): { status: number; message: string } {
  if (err instanceof AppHttpError) {
    return { status: err.status, message: err.message };
  }
  if (err instanceof EmptyReplyError) {
    return {
      status: 502,
      message: `AI থেকে খালি উত্তর এসেছে (${err.finishReason})। আবার চেষ্টা করুন।`,
    };
  }
  const isAbort =
    (err instanceof Error && err.name === "AbortError") ||
    /aborted|timeout|timed out/i.test(err instanceof Error ? err.message : String(err));
  if (isAbort) {
    return {
      status: 504,
      message: "AI মডেল থেকে উত্তর আসতে সময়সীমা শেষ হয়েছে। নেটওয়ার্ক দেখে আবার চেষ্টা করুন।",
    };
  }

  const { status, detail, apiStatus } = extractErrorDetails(err);
  const safeStatus = status >= 400 && status < 600 ? status : 500;

  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(detail)) {
    return {
      status: 400,
      message: `Gemini API key সঠিক নয় (${detail})। Settings > Secrets প্যানেলে key পরীক্ষা করুন।`,
    };
  }
  if (status === 403 || apiStatus === "PERMISSION_DENIED") {
    return {
      status: 403,
      message: `Gemini API ব্যবহারের অনুমতি নেই (${detail})। Settings > Secrets প্যানেল দেখুন।`,
    };
  }
  if (status === 404 || apiStatus === "NOT_FOUND") {
    return {
      status: 404,
      message: `নির্বাচিত Gemini মডেলটি পাওয়া যায়নি (${detail})।`,
    };
  }
  if (status === 429 || apiStatus === "RESOURCE_EXHAUSTED") {
    const resetAt = formatQuotaResetTimeBn(rawTimeZone);
    return {
      status: 429,
      message: `আজকের ফ্রি কোটা সীমা শেষ হয়ে গেছে। দৈনিক ফ্রি সীমা রিসেট হবে ${resetAt} (রাত ১২টা Pacific সময় অনুযায়ী)।`,
    };
  }
  if (status === 503 || apiStatus === "UNAVAILABLE") {
    return {
      status: 503,
      message: `AI সার্ভার সাময়িকভাবে ব্যস্ত (${detail})। একটু পরে আবার চেষ্টা করুন।`,
    };
  }
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network/i.test(detail)) {
    return {
      status: 502,
      message: `ইন্টারনেট বা AI সার্ভার সংযোগে সমস্যা হয়েছে (${detail})।`,
    };
  }
  return {
    status: safeStatus,
    message: `AI সার্ভার ত্রুটি: ${detail}`,
  };
}

function shouldSwitchModelOnError(err: unknown): boolean {
  if (err instanceof AppHttpError && err.status === 504) return true;
  const { status, detail, apiStatus } = extractErrorDetails(err);
  if (status === 404 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return /NOT_FOUND|RESOURCE_EXHAUSTED|UNAVAILABLE|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    `${apiStatus} ${detail}`
  );
}

async function generateContentRaw(
  ai: GoogleGenAI,
  model: string,
  contents: Content[],
  systemInstruction: string,
  timeoutMs: number,
  withTools: boolean
): Promise<GenerateContentResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const config = buildConfig(model, systemInstruction, controller.signal, withTools);

  try {
    return await Promise.race([
      ai.models.generateContent({
        model,
        contents,
        config,
      }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () =>
            reject(
              new AppHttpError(
                504,
                `AI মডেল উত্তর দিতে ${Math.round(timeoutMs / 1000)} সেকেন্ডের বেশি সময় নিয়েছে।`
              )
            ),
          { once: true }
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function buildContextPrompt(ctx: ClientContext, localTimeStr: string): string {
  const doneTasks = ctx.tasks.filter((t) => t.done).map((t) => t.text);
  const pendingTasks = ctx.tasks.filter((t) => !t.done).map((t) => t.text);
  const activeReminders = ctx.reminders
    .filter((r) => !r.done)
    .map((r) => `${r.text} (${new Date(r.dueAt).toLocaleString("bn-BD", { timeStyle: "short", dateStyle: "short" })})`);
  const facts = ctx.facts.map((f) => `[${f.category || "সাধারণ"}] ${f.text}`);
  const activity = ctx.activity.slice(0, 12).map((a) => `${a.date}: ${a.summary}`);
  const contactNames = ctx.contacts
    .map((c) => (c.nicknames ? `${c.name} (${c.nicknames})` : c.name))
    .slice(0, 80);

  return [
    SYSTEM_PROMPT,
    `Verified Local Device Time: ${localTimeStr}`,
    `ব্যবহারকারীর শহর: ${ctx.city}`,
    `সংরক্ষিত কন্টাক্টের নাম ও ডাকনাম (${contactNames.length}, নম্বর গোপন): ${
      contactNames.length ? contactNames.join(", ") : "এখনো কোনো কন্টাক্ট নেই"
    }`,
    `আজকের সম্পন্ন কাজ (${doneTasks.length}): ${doneTasks.length ? doneTasks.join("; ") : "নেই"}`,
    `আজকের বাকি কাজ (${pendingTasks.length}): ${pendingTasks.length ? pendingTasks.join("; ") : "নেই"}`,
    `চলমান রিমাইন্ডার (${activeReminders.length}): ${activeReminders.length ? activeReminders.join("; ") : "নেই"}`,
    ctx.activeReminderText ? `সদ্য বেজে ওঠা রিমাইন্ডার: ${ctx.activeReminderText}` : "",
    `সংরক্ষিত ব্যক্তিগত স্মৃতি (${facts.length}): ${facts.length ? facts.join(" | ") : "এখনো কিছু নেই"}`,
    `গত ৭ দিনের কার্যকলাপ: ${activity.length ? activity.join(" | ") : "নেই"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function findMatchingTaskIndex(tasks: TaskItem[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return -1;
  const exact = tasks.findIndex((t) => t.text.toLowerCase() === q);
  if (exact >= 0) return exact;
  const partial = tasks.findIndex((t) => t.text.toLowerCase().includes(q) || q.includes(t.text.toLowerCase()));
  if (partial >= 0) return partial;
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  if (words.length > 0) {
    return tasks.findIndex((t) => words.some((w) => t.text.toLowerCase().includes(w)));
  }
  return -1;
}

async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ClientContext,
  actions: ClientAction[],
  stateOut: { weather?: WeatherData; report?: DailyReportData }
): Promise<Record<string, unknown>> {
  if (name === "add_task") {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title) return { ok: false, error: "Task title missing" };
    ctx.tasks.unshift({ text: title, done: false });
    actions.push({ type: "add_task", payload: { title } });
    return { ok: true, added: title, totalTasks: ctx.tasks.length };
  }

  if (name === "complete_task") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const idx = findMatchingTaskIndex(ctx.tasks, query);
    if (idx < 0) {
      return { ok: false, error: `"${query}" নামের কোনো কাজ পাওয়া যায়নি` };
    }
    ctx.tasks[idx].done = true;
    actions.push({ type: "complete_task", payload: { query, matchedText: ctx.tasks[idx].text } });
    return { ok: true, completed: ctx.tasks[idx].text };
  }

  if (name === "delete_task") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const idx = findMatchingTaskIndex(ctx.tasks, query);
    if (idx < 0) {
      return { ok: false, error: `"${query}" নামের কোনো কাজ পাওয়া যায়নি` };
    }
    const removed = ctx.tasks.splice(idx, 1)[0];
    actions.push({ type: "delete_task", payload: { query, matchedText: removed.text } });
    return { ok: true, deleted: removed.text };
  }

  if (name === "add_reminder") {
    const rawText = typeof args.text === "string" ? args.text.trim() : "";
    const text = rawText || ctx.activeReminderText || "রিমাইন্ডার";
    const delayMinutes =
      typeof args.delay_minutes === "number" && Number.isFinite(args.delay_minutes)
        ? Math.max(0.5, args.delay_minutes)
        : undefined;
    const isSnooze = Boolean(args.is_snooze);
    let dueAt = Date.now() + 10 * 60000;
    if (delayMinutes !== undefined) {
      dueAt = Date.now() + Math.round(delayMinutes * 60000);
    } else if (typeof args.remind_at_iso === "string" && args.remind_at_iso.trim()) {
      const parsed = Date.parse(args.remind_at_iso.trim());
      if (Number.isFinite(parsed)) {
        dueAt = parsed;
      }
    }
    const id = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    ctx.reminders.push({ id, text, dueAt, done: false });
    actions.push({
      type: "add_reminder",
      payload: { id, text, dueAt, isSnooze },
    });
    return {
      ok: true,
      id,
      text,
      dueAt,
      localTime: new Date(dueAt).toLocaleString("bn-BD", {
        timeStyle: "short",
        dateStyle: "short",
        timeZone: ctx.timeZone || "Asia/Dhaka",
      }),
      isSnooze,
    };
  }

  if (name === "remember_fact") {
    const fact = typeof args.fact === "string" ? args.fact.trim() : "";
    const category = typeof args.category === "string" ? args.category.trim() : "সাধারণ";
    if (!fact) return { ok: false, error: "Fact missing" };
    const id = `fact_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    ctx.facts.unshift({ id, text: fact, category });
    actions.push({ type: "remember_fact", payload: { id, fact, category } });
    return { ok: true, saved: fact, category };
  }

  if (name === "get_weather") {
    const requestedCity = typeof args.city === "string" && args.city.trim() ? args.city.trim() : ctx.city;
    try {
      const weather = await fetchOpenMeteoWeather(requestedCity);
      stateOut.weather = weather;
      return { ok: true, weather };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "আবহাওয়া আনা যায়নি" };
    }
  }

  if (name === "daily_report") {
    const doneTasks = ctx.tasks.filter((t) => t.done).map((t) => t.text);
    const pendingTasks = ctx.tasks.filter((t) => !t.done).map((t) => t.text);
    const upcomingReminders = ctx.reminders
      .filter((r) => !r.done)
      .map((r) => ({ text: r.text, dueAt: r.dueAt }));
    const report: DailyReportData = {
      doneCount: doneTasks.length,
      pendingCount: pendingTasks.length,
      doneTasks,
      pendingTasks,
      upcomingReminders,
      callsToday: ctx.commStats?.callsToday ?? 0,
      messagesToday: ctx.commStats?.messagesToday ?? 0,
      generatedAt: Date.now(),
    };
    stateOut.report = report;
    actions.push({ type: "daily_report", payload: { ...report } });
    return { ok: true, report };
  }

  if (name === "add_contact") {
    const cName = typeof args.name === "string" ? args.name.trim().slice(0, 80) : "";
    const rawPhone = typeof args.phone === "string" ? args.phone.trim() : "";
    const phone = normalizeBangladeshPhone(rawPhone);
    const nicknames = typeof args.nicknames === "string" ? args.nicknames.trim().slice(0, 120) : "";
    if (!cName || !phone) {
      return { ok: false, error: "নাম ও বৈধ ফোন নম্বর বলুন, স্যার।" };
    }
    const id = `ct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    ctx.contacts.unshift({ id, name: cName, nicknames });
    actions.push({
      type: "add_contact",
      payload: { id, name: cName, phone, nicknames },
    });
    return { ok: true, name: cName, phone, nicknames };
  }

  if (name === "call_contact" || name === "send_sms" || name === "send_whatsapp") {
    const targetName = typeof args.target_name === "string" ? args.target_name.trim() : "";
    const draft =
      typeof args.message_draft === "string" ? args.message_draft.trim().slice(0, 1000) : "";
    const matches = matchContactsLoosely(ctx.contacts, targetName).map((c) => ({
      id: c.id,
      name: c.name,
      nicknames: c.nicknames || "",
    }));
    const actionType =
      name === "call_contact"
        ? "prepare_call"
        : name === "send_sms"
          ? "prepare_sms"
          : "prepare_whatsapp";
    actions.push({
      type: actionType,
      payload: { targetName, draft, matches },
    });
    return {
      ok: true,
      targetName,
      draft,
      matchCount: matches.length,
      matches,
    };
  }

  return { ok: false, error: `Unknown tool: ${name}` };
}

function isLikelyEnglish(text: string): boolean {
  const hasBangla = /[\u0980-\u09FF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  if (hasBangla || !hasLatin) return false;
  if (
    /\b(ami|tumi|apni|ammu|abbu|bhai|vai|apu|ke|bolo|bol|koro|dao|pathao|korbo|kore|ferbo|jabo|ajke|ekhon|koyta|baje|taka|lagbe|din|rat|sokal|bikel|dupur)\b/i.test(
      text
    )
  ) {
    return false;
  }
  return true;
}

function buildLocalToolReply(
  executed: Array<{ name: string; result: Record<string, unknown> }>,
  stateOut: { weather?: WeatherData; report?: DailyReportData },
  latestUserText: string
): string {
  const en = isLikelyEnglish(latestUserText);
  const parts: string[] = [];

  for (const { name, result } of executed) {
    if (!result.ok) {
      const errMsg = typeof result.error === "string" ? result.error : "";
      if (en) {
        parts.push(`Sorry Sir, I couldn't complete that (${errMsg || "unknown issue"}).`);
      } else {
        parts.push(`দুঃখিত স্যার, ${errMsg || "কাজটি করা যায়নি"}।`);
      }
      continue;
    }

    if (name === "add_task") {
      const title = String(result.added || "");
      parts.push(
        en
          ? `Added "${title}" to today's tasks, Sir.`
          : `কাজটা লিখে রাখলাম, স্যার: ${title}।`
      );
    } else if (name === "complete_task") {
      const title = String(result.completed || "");
      parts.push(
        en
          ? `Great job, Sir! Marked "${title}" as completed.`
          : `দারুণ স্যার! "${title}" কাজটি সম্পন্ন হিসেবে চিহ্নিত করলাম।`
      );
    } else if (name === "delete_task") {
      const title = String(result.deleted || "");
      parts.push(
        en
          ? `Removed "${title}" from your task list, Sir.`
          : `ঠিক আছে স্যার, "${title}" কাজটি তালিকা থেকে মুছে দিয়েছি।`
      );
    } else if (name === "add_reminder") {
      const text = String(result.text || "");
      const localTime = String(result.localTime || "");
      if (result.isSnooze) {
        parts.push(
          en
            ? `Got it, Sir. I will remind you again at ${localTime}.`
            : `ঠিক আছে স্যার, ${localTime}-এ আবার মনে করিয়ে দেব।`
        );
      } else {
        parts.push(
          en
            ? `Reminder set for ${localTime}, Sir: "${text}".`
            : `রিমাইন্ডার লিখে রাখলাম, স্যার: "${text}" (${localTime})।`
        );
      }
    } else if (name === "remember_fact") {
      const saved = String(result.saved || "");
      parts.push(
        en
          ? `I will remember that, Sir: ${saved}.`
          : `মনে রাখলাম, স্যার। আপনার এই তথ্যটি স্মৃতিতে সংরক্ষণ করেছি।`
      );
    } else if (name === "add_contact") {
      const cName = String(result.name || "");
      const cPhone = String(result.phone || "");
      parts.push(
        en
          ? `Saved ${cName} (${cPhone}) to your contacts, Sir.`
          : `${cName}-এর নম্বর (${cPhone}) কন্টাক্টে সেভ করে রাখলাম, স্যার।`
      );
    } else if (name === "call_contact" || name === "send_sms" || name === "send_whatsapp") {
      const targetName = String(result.targetName || "");
      const draft = String(result.draft || "");
      const matches = Array.isArray(result.matches)
        ? (result.matches as Array<{ name: string }>)
        : [];
      const channelLabel = name === "send_whatsapp" ? "WhatsApp" : "SMS";

      if (matches.length === 0) {
        parts.push(
          en
            ? `I couldn't find "${targetName}" in your contacts, Sir. Please tell me the number or save it in the Contacts card.`
            : `"${targetName}" নামে কোনো কন্টাক্ট খুঁজে পাইনি, স্যার। নম্বরটি বলুন অথবা কন্টাক্ট কার্ডে সেভ করে দিন।`
        );
      } else if (matches.length > 1) {
        const namesList = matches.slice(0, 4).map((m) => m.name).join(", ");
        parts.push(
          en
            ? `I found ${matches.length} matching contacts: ${namesList}. Which one, Sir?`
            : `এই নামে ${matches.length}টি কন্টাক্ট পাওয়া গেছে: ${namesList}। কোনজনকে বেছে নেব, স্যার?`
        );
      } else {
        const matchedName = matches[0].name;
        if (name === "call_contact") {
          parts.push(
            en
              ? `Should I call ${matchedName}, Sir?`
              : `${matchedName}-কে কল করব, স্যার?`
          );
        } else {
          parts.push(
            en
              ? `I drafted this ${channelLabel} for ${matchedName}: "${draft}". Should I send it, Sir?`
              : `${matchedName}-কে ${channelLabel}-এ এই মেসেজটা লিখলাম: "${draft}"। পাঠাব, স্যার?`
          );
        }
      }
    } else if (name === "get_weather" && stateOut.weather) {
      const w = stateOut.weather;
      const tomorrow = w.forecast?.[1];
      if (en) {
        parts.push(
          `In ${w.city}, it is ${w.temperature}°C right now with humidity ${w.humidity}%${
            tomorrow ? `, and tomorrow will be ${tomorrow.tempMin}° to ${tomorrow.tempMax}°C` : ""
          }, Sir.`
        );
      } else {
        parts.push(
          `${w.city}-এর বর্তমান তাপমাত্রা ${w.temperature}° সেলসিয়াস, আকাশ ${w.conditionBn} এবং আর্দ্রতা ${w.humidity}%, স্যার।${
            tomorrow
              ? ` আগামীকাল তাপমাত্রা ${tomorrow.tempMin}° থেকে ${tomorrow.tempMax}° সেলসিয়াস থাকবে।`
              : ""
          }`
        );
      }
    } else if (name === "daily_report" && stateOut.report) {
      const rep = stateOut.report;
      const callsToday = rep.callsToday ?? 0;
      const messagesToday = rep.messagesToday ?? 0;
      if (en) {
        const care =
          rep.pendingCount === 0
            ? "You finished everything today—please take some rest, Sir!"
            : "Take it one step at a time, Sir; I am right here with you.";
        const commLine =
          callsToday > 0 || messagesToday > 0
            ? ` Today ${callsToday} call${callsToday === 1 ? "" : "s"}, ${messagesToday} message${messagesToday === 1 ? "" : "s"}.`
            : "";
        const summary = `Today you completed ${rep.doneCount} tasks, have ${rep.pendingCount} pending, and ${rep.upcomingReminders.length} upcoming reminders, Sir.${commLine} ${care}`;
        rep.summaryText = summary;
        parts.push(summary);
      } else {
        const care =
          rep.pendingCount === 0
            ? "সব কাজ শেষ করেছেন—এবার একটু বিশ্রাম নিন, স্যার!"
            : "বাকি কাজগুলোর জন্য চিন্তা করবেন না, আমি সাথেই আছি।";
        const commLine = ` আজ ${callsToday}টা কল, ${messagesToday}টা মেসেজ।`;
        const summary = `আজ ${rep.doneCount}টি কাজ সম্পন্ন হয়েছে, ${rep.pendingCount}টি কাজ বাকি আছে এবং ${rep.upcomingReminders.length}টি রিমাইন্ডার অপেক্ষায় আছে, স্যার।${commLine} ${care}`;
        rep.summaryText = summary;
        parts.push(summary);
      }
    }
  }

  return (
    parts.join(" ").trim() ||
    (en ? "Done, Sir." : "কাজটি সম্পন্ন হয়েছে, স্যার।")
  );
}

async function runSingleModelAttempt(
  ai: GoogleGenAI,
  model: string,
  history: ChatTurn[],
  systemInstruction: string,
  ctx: ClientContext,
  deadline: number
): Promise<{
  text: string;
  modelUsed: string;
  actions: ClientAction[];
  weather?: WeatherData;
  report?: DailyReportData;
}> {
  const contents: Content[] = history.map((t) => ({
    role: t.role,
    parts: t.parts.map((p) => ({ text: p.text })),
  }));
  const actions: ClientAction[] = [];
  const stateOut: { weather?: WeatherData; report?: DailyReportData } = {};

  const rem = deadline - Date.now();
  if (rem <= 500) {
    throw new AppHttpError(504, "AI অনুরোধের মোট সময়সীমা শেষ হয়েছে। আবার চেষ্টা করুন।");
  }

  // Strictly ONE Gemini API call per attempt (no second turn after function calls)
  const response = await generateContentRaw(
    ai,
    model,
    contents,
    systemInstruction,
    Math.min(MODEL_ATTEMPT_TIMEOUT_MS, rem),
    true
  );

  const functionCalls = response.functionCalls;
  const { text: directText, finishReason } = extractReplyText(response);

  if (functionCalls && functionCalls.length > 0) {
    const executed: Array<{ name: string; result: Record<string, unknown> }> = [];
    for (const fc of functionCalls) {
      const fnName = fc.name || "";
      const fnArgs = (fc.args && typeof fc.args === "object" ? fc.args : {}) as Record<string, unknown>;
      const result = await executeToolCall(fnName, fnArgs, ctx, actions, stateOut);
      executed.push({ name: fnName, result });
    }
    const latestUserText = history[history.length - 1]?.parts.map((p) => p.text).join(" ") || "";
    const usesCommTool = executed.some((e) =>
      e.name === "call_contact" ||
      e.name === "send_sms" ||
      e.name === "send_whatsapp" ||
      e.name === "add_contact"
    );
    const localReply = buildLocalToolReply(executed, stateOut, latestUserText);
    const text = usesCommTool ? localReply : directText || localReply;
    if (stateOut.report && !stateOut.report.summaryText) {
      stateOut.report.summaryText = text;
    }
    return { text, modelUsed: model, actions, ...stateOut };
  }

  if (!directText) {
    console.warn(
      `[Gemini Empty Reply] model=${model} finishReason=${finishReason} rawResponse=${JSON.stringify(
        response
      )}`
    );
    throw new EmptyReplyError(finishReason);
  }
  return { text: directText, modelUsed: model, actions, ...stateOut };
}

class AllModelsExhaustedError extends AppHttpError {
  apiCallsMade: number;
  constructor(message: string, apiCallsMade: number) {
    super(429, message);
    this.apiCallsMade = apiCallsMade;
  }
}

async function generateSinglePassWithModelList(
  ai: GoogleGenAI,
  modelList: string[],
  history: ChatTurn[],
  systemInstruction: string,
  baseCtx: ClientContext,
  rawTimeZone: unknown
): Promise<{
  text: string;
  modelUsed: string;
  actions: ClientAction[];
  weather?: WeatherData;
  report?: DailyReportData;
  apiCallsMade: number;
}> {
  const deadline = Date.now() + TOTAL_CHAT_TIMEOUT_MS;
  let lastError: unknown;
  let apiCallsMade = 0;
  let quotaHitCount = 0;

  for (let i = 0; i < modelList.length; i++) {
    const activeModel = modelList[i];
    let emptyRetriedForModel = false;

    while (true) {
      if (deadline - Date.now() <= 500) {
        const timeoutErr = new AppHttpError(
          504,
          `AI অনুরোধের মোট সময়সীমা (${Math.round(TOTAL_CHAT_TIMEOUT_MS / 1000)} সেকেন্ড) শেষ হয়েছে। আবার চেষ্টা করুন।`
        ) as AppHttpError & { apiCallsMade?: number };
        timeoutErr.apiCallsMade = apiCallsMade;
        throw timeoutErr;
      }

      const attemptCtx: ClientContext = JSON.parse(JSON.stringify(baseCtx));
      apiCallsMade++;

      try {
        const res = await runSingleModelAttempt(
          ai,
          activeModel,
          history,
          systemInstruction,
          attemptCtx,
          deadline
        );
        return { ...res, apiCallsMade };
      } catch (err) {
        lastError = err;
        const { status } = extractErrorDetails(err);

        // Immediately fail on auth/invalid key/bad client payload
        if (status === 400 || status === 401 || status === 403) {
          throw Object.assign(err as object, { apiCallsMade });
        }

        // Only retry the SAME model ONCE if text was truly empty
        if (err instanceof EmptyReplyError) {
          if (!emptyRetriedForModel && deadline - Date.now() > 1500) {
            emptyRetriedForModel = true;
            continue;
          }
          break; // Move to next model if any
        }

        // On 429 quota error: NEVER retry the same model; switch immediately to next model
        if (isQuota429Error(err)) {
          quotaHitCount++;
          break;
        }

        // Switch to next model on 404/503/504/network if available
        if (shouldSwitchModelOnError(err) && i + 1 < modelList.length && deadline - Date.now() > 1500) {
          break;
        }

        throw Object.assign(err as object, { apiCallsMade });
      }
    }
  }

  if (quotaHitCount > 0) {
    const resetLocal = formatQuotaResetTimeBn(rawTimeZone);
    const all429 = quotaHitCount === modelList.length;
    const msg = all429
      ? `তালিকার সবগুলো মডেলের (${modelList.join(", ")}) আজকের ফ্রি সীমা শেষ হয়ে গেছে। দৈনিক ফ্রি কোটা রিসেট হবে ${resetLocal} (রাত ১২টা Pacific সময় অনুযায়ী)।`
      : `তালিকার কোনো মডেল (${modelList.join(", ")}) থেকেই এখন উত্তর পাওয়া যাচ্ছে না (কোটা সীমা বা সাময়িক ব্যস্ততা)। ফ্রি দৈনিক কোটা রিসেট হবে ${resetLocal} (রাত ১২টা Pacific সময় অনুযায়ী)।`;
    throw new AllModelsExhaustedError(msg, apiCallsMade);
  }

  if (lastError && typeof lastError === "object") {
    throw Object.assign(lastError as object, { apiCallsMade });
  }
  throw lastError;
}

function sanitizeAudioInput(body: Record<string, unknown>): { data: string; mimeType: string } {
  const rawB64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
  if (!rawB64) {
    throw new AppHttpError(400, "অডিও তথ্য পাওয়া যায়নি।");
  }
  if (rawB64.length > MAX_AUDIO_BASE64_LEN) {
    throw new AppHttpError(400, "অডিও ক্লিপটি অনেক বড়। অনুগ্রহ করে ছোট করে বলুন।");
  }
  const cleanB64 = rawB64.replace(/^data:[^;]+;base64,/, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(cleanB64)) {
    throw new AppHttpError(400, "অবৈধ অডিও ফরম্যাট।");
  }

  const rawMime = typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "audio/webm";
  const baseMime = rawMime.split(";")[0].trim();
  const mimeType = ALLOWED_AUDIO_MIME_TYPES.has(baseMime) ? baseMime : "audio/webm";
  return { data: cleanB64, mimeType };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "8mb" }));

  app.get("/api/weather", async (req, res) => {
    try {
      const rawCity = typeof req.query.city === "string" ? req.query.city : "Dhaka";
      const weather = await fetchOpenMeteoWeather(rawCity);
      res.json(weather);
    } catch (err) {
      const { status, message } = formatErrorBn(err);
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/transcribe", async (req, res) => {
    let apiCallsMade = 0;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const { data, mimeType } = sanitizeAudioInput(body);
      const ai = getAIClient();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
      apiCallsMade = 1;

      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model: TRANSCRIBE_MODEL,
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType, data } },
                  {
                    text: "Transcribe the spoken speech accurately in Bengali, Banglish, or English. Output only the spoken words without extra commentary.",
                  },
                ],
              },
            ],
            config: {
              abortSignal: controller.signal,
            },
          }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
              "abort",
              () =>
                reject(
                  new AppHttpError(
                    504,
                    `অডিও ট্রান্সক্রিপশনের সময়সীমা (${Math.round(TRANSCRIBE_TIMEOUT_MS / 1000)} সেকেন্ড) শেষ হয়েছে। আবার চেষ্টা করুন।`
                  )
                ),
              { once: true }
            );
          }),
        ]);

        const text = (response.text || "").trim();
        res.json({ text, modelUsed: TRANSCRIBE_MODEL, apiCallsMade });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (!res.headersSent) {
        const { status, message } = formatErrorBn(err, body.timeZone);
        res.status(status).json({ error: message, apiCallsMade });
      }
    }
  });

  const ttsCache = new Map<string, { audioBase64: string; mimeType: string; expiresAt: number }>();
  const TTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  app.post("/api/tts", async (req, res) => {
    let apiCallsMade = 0;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const rawText = typeof body.text === "string" ? body.text.trim() : "";
      const cleanText = rawText.replace(/[*#_`]/g, "").trim().slice(0, 2400);
      if (!cleanText) {
        throw new AppHttpError(400, "কথা বলার জন্য টেক্সট পাওয়া যায়নি।");
      }

      const cacheKey = `${TTS_MODEL}:${TTS_VOICE}:${cleanText.toLowerCase()}`;
      const hit = ttsCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        // Refresh LRU order
        ttsCache.delete(cacheKey);
        ttsCache.set(cacheKey, hit);
        res.json({
          audioBase64: hit.audioBase64,
          mimeType: hit.mimeType,
          modelUsed: TTS_MODEL,
          voiceName: TTS_VOICE,
          apiCallsMade: 0,
          cached: true,
        });
        return;
      }

      const ai = getAIClient();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
      apiCallsMade = 1;

      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model: TTS_MODEL,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: cleanText,
                    speechMetadata: {
                      style: TTS_STYLE,
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: TTS_VOICE },
                },
              },
              abortSignal: controller.signal,
            },
          }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
              "abort",
              () =>
                reject(
                  new AppHttpError(
                    504,
                    `ভয়েস তৈরি করতে (${Math.round(TTS_TIMEOUT_MS / 1000)} সেকেন্ড) সময়সীমা শেষ হয়েছে।`
                  )
                ),
              { once: true }
            );
          }),
        ]);

        const audioPart = response.candidates?.[0]?.content?.parts?.find(
          (p) => Boolean(p?.inlineData?.data)
        );
        const audioBase64 = audioPart?.inlineData?.data;
        const mimeType = audioPart?.inlineData?.mimeType || "audio/wav";
        if (!audioBase64) {
          throw new AppHttpError(502, "Gemini TTS থেকে অডিও পাওয়া যায়নি।");
        }

        if (audioBase64.length <= 900_000) {
          if (ttsCache.size >= 40) {
            const oldestKey = ttsCache.keys().next().value;
            if (oldestKey) ttsCache.delete(oldestKey);
          }
          ttsCache.set(cacheKey, {
            audioBase64,
            mimeType,
            expiresAt: Date.now() + TTS_CACHE_TTL_MS,
          });
        }

        res.json({
          audioBase64,
          mimeType,
          modelUsed: TTS_MODEL,
          voiceName: TTS_VOICE,
          apiCallsMade,
          cached: false,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (!res.headersSent) {
        const { status, message } = formatErrorBn(err, body.timeZone);
        res.status(status).json({ error: message, apiCallsMade });
      }
    }
  });

  app.post("/api/chat", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const modelList = sanitizeModelList(body.models, body.model);
      const history = sanitizeHistory(body.history);
      const rawCtx = (body.context && typeof body.context === "object" ? body.context : {}) as Record<string, unknown>;
      if (typeof rawCtx.timeZone !== "string" && typeof body.timeZone === "string") {
        rawCtx.timeZone = body.timeZone;
      }
      if (!rawCtx.clientTime && body.clientTime && typeof body.clientTime === "object") {
        rawCtx.clientTime = body.clientTime;
      }
      const ctx = sanitizeContext(rawCtx);
      const localTimeStr = formatLocalTime(ctx.timeZone || body.timeZone, ctx.clientTime);
      const systemInstruction = buildContextPrompt(ctx, localTimeStr);

      const ai = getAIClient();
      const result = await generateSinglePassWithModelList(
        ai,
        modelList,
        history,
        systemInstruction,
        ctx,
        body.timeZone
      );
      if (!res.headersSent) {
        res.json(result);
      }
    } catch (err) {
      if (!res.headersSent) {
        const apiCallsMade =
          typeof (err as { apiCallsMade?: unknown })?.apiCallsMade === "number"
            ? (err as { apiCallsMade: number }).apiCallsMade
            : 0;
        if (err instanceof AllModelsExhaustedError) {
          res.status(429).json({
            error: err.message,
            allModelsExhausted: true,
            apiCallsMade,
          });
          return;
        }
        const { status, message } = formatErrorBn(err, body.timeZone);
        res.status(status).json({ error: message, apiCallsMade });
      }
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    const hasKey = Boolean(
      process.env.GEMINI_API_KEY?.trim() &&
        process.env.GEMINI_API_KEY.trim() !== "MY_GEMINI_API_KEY"
    );
    console.log(
      `Server listening on http://0.0.0.0:${PORT} (GEMINI_API_KEY: ${hasKey ? "configured" : "missing"})`
    );
  });
}

startServer();
