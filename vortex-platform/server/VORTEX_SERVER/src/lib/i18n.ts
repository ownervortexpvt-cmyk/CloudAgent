/**
 * v151 — VORTEX ECOSYSTEM i18n (VORTEX Server side)
 * One platform, three languages: English (global default) / বাংলা / हिन्दी.
 * English is the primary language for every country. Choice persists in
 * localStorage (`vx:lang`) and re-renders subscribers via a custom event.
 */
import { useEffect, useState } from "react";

export type Lang = "en" | "bn" | "hi";

export const LANGS: { id: Lang; label: string; native: string }[] = [
  { id: "en", label: "English", native: "English" },
  { id: "bn", label: "Bengali", native: "বাংলা" },
  { id: "hi", label: "Hindi", native: "हिन्दी" },
];

const LS_KEY = "vx:lang";
const EVENT = "vx:lang-changed";

/** English is the key + the fallback. bn/hi override. */
const DICT: Record<string, { bn?: string; hi?: string }> = {
  // Dashboard nav (sidebar)
  "nav.overview": { bn: "ওভারভিউ", hi: "ओवरव्यू" },
  "nav.vserver": { bn: "সার্ভার — সেন্ট্রাল ইনফ্রা", hi: "सर्वर — सेंट्रल इंफ्रा" },
  "nav.services": { bn: "সার্ভিস রেজিস্ট্রি", hi: "सर्विस रजिस्ट्री" },
  "nav.servers": { bn: "সার্ভারসমূহ", hi: "सर्वर" },
  "nav.network": { bn: "নেটওয়ার্ক", hi: "नेटवर्क" },
  "nav.databases": { bn: "ডেটাবেজসমূহ", hi: "डेटाबेस" },
  "nav.backups": { bn: "ব্যাকআপ", hi: "बैकअप" },
  "nav.monitoring": { bn: "মনিটরিং", hi: "मॉनिटरिंग" },
  "nav.gateway": { bn: "API গেটওয়ে", hi: "API गेटवे" },
  "nav.storage": { bn: "স্টোরেজ", hi: "स्टोरेज" },
  "nav.files": { bn: "ফাইলসমূহ", hi: "फ़ाइलें" },
  "nav.security": { bn: "নিরাপত্তা", hi: "सुरक्षा" },
  "nav.deploys": { bn: "ডিপ্লয়মেন্ট", hi: "डिप्लॉयमेंट" },
  "nav.devops": { bn: "CI/CD ও SSL", hi: "CI/CD और SSL" },
  "nav.expansion": { bn: "এক্সপানশন (P6)", hi: "एक्सपैंशन (P6)" },
  "nav.phase7": { bn: "বিলিং ও পোর্টাল (P7)", hi: "बिलिंग और पोर्टल (P7)" },
  "nav.vaas": { bn: "VaaS (P8)", hi: "VaaS (P8)" },
  "nav.apps": { bn: "অ্যাপ্লিকেশনসমূহ", hi: "एप्लिकेशन" },
  "nav.keys": { bn: "API কীসমূহ", hi: "API कुंजियाँ" },
  "nav.config": { bn: "কনফিগারেশন", hi: "कॉन्फ़िगरेशन" },
  "nav.logs": { bn: "মেইল ও অডিট", hi: "मेल और ऑडिट" },
  "nav.roadmap": { bn: "রোডম্যাপ", hi: "रोडमैप" },
  "nav.mode": { bn: "মোড: প্রাইভেট", hi: "मोड: प्राइवेट" },
  "nav.signOut": { bn: "সাইন আউট", hi: "साइन आउट" },
  // Configuration view
  "config.title": { bn: "কনফিগারেশন", hi: "कॉन्फ़िगरेशन" },
  "config.subtitle": {
    bn: "CORE-এর কেন্দ্রীয় কনফিগ স্টোর — প্রতিটি মডিউল যে এক উৎস থেকে পড়ে।",
    hi: "CORE का केंद्रीय कॉन्फिग स्टोर — हर मॉड्यूल जिस एक स्रोत से पढ़ता है।",
  },
  "config.save": { bn: "সেভ", hi: "सेव" },
  "config.saving": { bn: "সেভ হচ্ছে…", hi: "सेव हो रहा है…" },
  "config.saved": { bn: "সেভ হয়েছে", hi: "सेव हो गया" },
  "config.saveFailed": { bn: "সেভ ব্যর্থ", hi: "सेव विफल" },
  "config.defaultValue": { bn: "ডিফল্ট:", hi: "डिफ़ॉल्ट:" },
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
  "shortcuts.serverDesc": { bn: "VORTEX CORE কন্ট্রোল প্লেন — এই অ্যাপ", hi: "VORTEX CORE कंट्रोल प्लेन — यह ऐप" },
  "shortcuts.appverseDesc": { bn: "অ্যাপ রেজিস্ট্রি ও ডিস্ট্রিবিউশন", hi: "ऐप रजिस्ट्री और वितरण" },
  "shortcuts.agentDesc": { bn: "AI বিল্ডার", hi: "AI बिल्डर" },
  // Login
  "login.title": { bn: "VORTEX ID", hi: "VORTEX ID" },
  "login.subtitle": { bn: "কন্ট্রোল প্লেনে প্রবেশ করুন", hi: "कंट्रोल प्लेन में प्रवेश करें" },
  "login.email": { bn: "ইমেইল", hi: "ईमेल" },
  "login.password": { bn: "পাসওয়ার্ড", hi: "पासवर्ड" },
  "login.signIn": { bn: "সাইন ইন", hi: "साइन इन" },
  "login.signingIn": { bn: "সাইন ইন হচ্ছে…", hi: "साइन इन हो रहा है…" },
  // Language
  "common.language": { bn: "ভাষা", hi: "भाषा" },
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
