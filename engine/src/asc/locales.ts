/**
 * App Store Connect uses full locale identifiers (e.g. "en-US", "fr-FR").
 * Xcode projects frequently use short codes ("en", "fr"). Map the common
 * short codes to their App Store defaults; pass through anything already long.
 */
const SHORT_TO_ASC: Record<string, string> = {
  en: "en-US",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
  it: "it-IT",
  pt: "pt-BR",
  nl: "nl-NL",
  sv: "sv-SE",
  da: "da",
  fi: "fi",
  no: "no",
  pl: "pl",
  ru: "ru",
  tr: "tr",
  ja: "ja",
  ko: "ko",
  zh: "zh-Hans",
  "zh-Hans": "zh-Hans",
  "zh-Hant": "zh-Hant",
  ar: "ar-SA",
  he: "he",
  th: "th",
  vi: "vi",
  id: "id",
  cs: "cs",
  el: "el",
  hu: "hu",
  ro: "ro",
  uk: "uk",
  hi: "hi",
  ms: "ms",
  hr: "hr",
  sk: "sk",
  ca: "ca",
};

export function localeToAsc(locale: string): string {
  if (SHORT_TO_ASC[locale]) return SHORT_TO_ASC[locale];
  if (locale.includes("-")) return locale;
  return locale;
}
