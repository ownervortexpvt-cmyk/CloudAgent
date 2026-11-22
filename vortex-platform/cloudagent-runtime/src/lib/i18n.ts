/**
 * v151 — VORTEX ECOSYSTEM i18n (Cloud Agent side)
 * One platform, three languages: English (global default) / বাংলা / हिन्दी.
 * English is the primary language for every country; Bengali and Hindi are
 * selectable. Choice persists in localStorage (`ca:lang`) and re-renders all
 * subscribed components via a tiny custom-event bus (no provider needed).
 */
import { useEffect, useState } from "react";

export type Lang = "en" | "bn" | "hi";

export const LANGS: { id: Lang; label: string; native: string }[] = [
  { id: "en", label: "English", native: "English" },
  { id: "bn", label: "Bengali", native: "বাংলা" },
  { id: "hi", label: "Hindi", native: "हिन्दी" },
];

const LS_KEY = "ca:lang";
const EVENT = "ca:lang-changed";

/** English is the key + the fallback. bn/hi override. */
const DICT: Record<string, { bn?: string; hi?: string }> = {
  // Settings — tabs
  "settings.title": { bn: "সেটিংস", hi: "सेटिंग्स" },
  "settings.plan": { bn: "প্ল্যান ও বিলিং", hi: "प्लान और बिलिंग" },
  "settings.refer": { bn: "রেফার ও আর্ন", hi: "रेफर और अर्न" },
  "settings.general": { bn: "সাধারণ", hi: "सामान्य" },
  "settings.providers": { bn: "AI প্রোভাইডার", hi: "AI प्रोवाइडर" },
  "settings.editor": { bn: "এডিটর", hi: "एडिटर" },
  "settings.terminal": { bn: "টার্মিনাল", hi: "टर्मिनल" },
  "settings.usage": { bn: "ব্যবহার", hi: "उपयोग" },
  "settings.benchmarks": { bn: "বেঞ্চমার্ক", hi: "बेंचमार्क" },
  "settings.env": { bn: "এনভায়রনমেন্ট ভেরিয়েবল", hi: "एनवायरनमेंट वेरिएबल" },
  "settings.info": { bn: "প্রজেক্ট তথ্য", hi: "प्रोजेक्ट जानकारी" },
  "settings.project": { bn: "প্রজেক্ট", hi: "प्रोजेक्ट" },
  // General
  "general.title": { bn: "সাধারণ", hi: "सामान्य" },
  "general.language": { bn: "ভাষা", hi: "भाषा" },
  "general.languageHint": {
    bn: "পুরো প্ল্যাটফর্মের জন্য প্রদর্শনের ভাষা। English সব দেশের প্রধান ভাষা।",
    hi: "पूरे प्लेटफ़ॉर्म के लिए प्रदर्शन भाषा। English सभी देशों की मुख्य भाषा है।",
  },
  "general.theme": { bn: "থিম", hi: "थीम" },
  "general.dark": { bn: "ডার্ক", hi: "डार्क" },
  "general.light": { bn: "লাইট", hi: "लाइट" },
  "general.autoSave": { bn: "ফাইল অটো-সেভ", hi: "फ़ाइल ऑटो-सेव" },
  "general.autoSaveHint": {
    bn: "টাইপ করার 800ms পরে স্বয়ংক্রিয়ভাবে সেভ হয়। বন্ধ = Ctrl+S বা Save All দিয়ে ম্যানুয়াল সেভ।",
    hi: "टाइप करने के 800ms बाद स्वतः सेव हो जाता है। बंद = Ctrl+S या Save All से मैन्युअल सेव।",
  },
  // Platform shortcuts (the 4 buttons)
  "shortcuts.title": { bn: "প্ল্যাটফর্ম শর্টকাট", hi: "प्लेटफ़ॉर्म शॉर्टकट" },
  "shortcuts.hint": {
    bn: "একই Vortex Platform-এর চারটি মডিউল — এক ক্লিকে যেকোনোটিতে যান।",
    hi: "एक ही Vortex Platform के चार मॉड्यूल — एक क्लिक में किसी पर भी जाएँ।",
  },
  "shortcuts.website": { bn: "Vortex Website-এ যান", hi: "Vortex Website पर जाएँ" },
  "shortcuts.server": { bn: "Vortex Server-এ যান", hi: "Vortex Server पर जाएँ" },
  "shortcuts.appverse": { bn: "APPVERSE-এ যান", hi: "APPVERSE पर जाएँ" },
  "shortcuts.agent": { bn: "Cloud Agent-এ যান", hi: "Cloud Agent पर जाएँ" },
  "shortcuts.websiteDesc": { bn: "পাবলিক ওয়েবসাইট ও মার্কেটপ্লেস", hi: "सार्वजनिक वेबसाइट और मार्केटप्लेस" },
  "shortcuts.serverDesc": { bn: "VORTEX CORE কন্ট্রোল প্লেন", hi: "VORTEX CORE कंट्रोल प्लेन" },
  "shortcuts.appverseDesc": { bn: "অ্যাপ রেজিস্ট্রি ও ডিস্ট্রিবিউশন", hi: "ऐप रजिस्ट्री और वितरण" },
  "shortcuts.agentDesc": { bn: "AI বিল্ডার — এই অ্যাপ", hi: "AI बिल्डर — यह ऐप" },
  // Common
  "common.signOut": { bn: "সাইন আউট", hi: "साइन आउट" },
  "common.settings": { bn: "সেটিংস", hi: "सेटिंग्स" },
  "common.language": { bn: "ভাষা", hi: "भाषा" },
  "common.save": { bn: "সেভ", hi: "सेव" },
  "common.saved": { bn: "সেভ হয়েছে", hi: "सेव हो गया" },
  "common.cancel": { bn: "বাতিল", hi: "रद्द करें" },
  "common.close": { bn: "বন্ধ করুন", hi: "बंद करें" },
  "common.open": { bn: "খুলুন", hi: "खोलें" },
  "common.openTab": { bn: "নতুন ট্যাবে খুলুন", hi: "नए टैब में खोलें" },
  "common.runtime": { bn: "রানটাইম", hi: "रनटाइम" },
  "common.active": { bn: "সক্রিয়", hi: "सक्रिय" },
};

export function getLang(): Lang {
  if (typeof window === "undefined") return "en";
  const v = localStorage.getItem(LS_KEY);
  return v === "bn" || v === "hi" ? v : "en";
}

export function setLang(lang: Lang) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, lang);
  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Translate a key in the current language. English fallback, then the key. */
export function translate(key: string, lang?: Lang): string {
  const l = lang ?? getLang();
  if (l === "en") return key.split(".").pop() ?? key;
  const entry = DICT[key];
  if (!entry) return key.split(".").pop() ?? key;
  return entry[l] ?? key.split(".").pop() ?? key;
}

/** React hook — re-renders the component when the language changes. */
export function useLang(): { lang: Lang; t: (k: string) => string; setLang: (l: Lang) => void } {
  const [lang, setLangState] = useState<Lang>(() => getLang());
  useEffect(() => {
    const on = () => setLangState(getLang());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return { lang, t: (k: string) => translate(k, lang), setLang: setLang };
}
