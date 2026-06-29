/**
 * App Store Connect accepts a fixed set of locale shortcodes for metadata and
 * screenshots. Some are language-only ("it", "sv", "ja") and some are
 * region-qualified ("en-US", "de-DE", "pt-BR"). Xcode projects, however, use
 * their own codes ("en", "fr", "it-IT", "zh-Hans-CN", ...), so we normalize.
 *
 * Source of truth: Apple's "Managing metadata in your app by using locale
 * shortcodes" table. Getting this wrong yields a confusing ASC 409:
 * "The language specified is not listed for localization".
 */

/** Every locale code App Store Connect recognizes (exact, canonical forms). */
const ASC_LOCALES = new Set<string>([
  "ar-SA",
  "bn-BD",
  "ca",
  "zh-Hans",
  "zh-Hant",
  "hr",
  "cs",
  "da",
  "nl-NL",
  "en-AU",
  "en-CA",
  "en-GB",
  "en-US",
  "fi",
  "fr-FR",
  "fr-CA",
  "de-DE",
  "el",
  "gu-IN",
  "he",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "kn-IN",
  "ko",
  "ms",
  "ml-IN",
  "mr-IN",
  "no",
  "or-IN",
  "pl",
  "pt-BR",
  "pt-PT",
  "pa-IN",
  "ro",
  "ru",
  "sk",
  "sl-SI",
  "es-MX",
  "es-ES",
  "sv",
  "ta-IN",
  "te-IN",
  "th",
  "tr",
  "uk",
  "ur-PK",
  "vi",
]);

/**
 * Default ASC code for a language-only / aliased Xcode code where ASC expects a
 * specific region (or a different identifier entirely). Codes that are already
 * canonical (in ASC_LOCALES) don't need an entry here.
 */
const SHORT_TO_ASC: Record<string, string> = {
  en: "en-US",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
  pt: "pt-BR",
  nl: "nl-NL",
  zh: "zh-Hans",
  ar: "ar-SA",
  // Norwegian Bokmål and legacy Hebrew code from older Xcode projects.
  nb: "no",
  iw: "he",
};

/** Convert an Xcode/BCP-47 locale to the closest App Store Connect shortcode. */
export function localeToAsc(locale: string): string {
  // Already a canonical ASC code (e.g. "it", "sv", "en-GB", "pt-PT").
  if (ASC_LOCALES.has(locale)) return locale;

  // Direct alias for a language-only / non-canonical code.
  if (SHORT_TO_ASC[locale]) return SHORT_TO_ASC[locale];

  // Chinese scripts can arrive as zh-Hans-CN / zh-Hant-TW / zh_TW etc.
  const normalized = locale.replace(/_/g, "-");
  if (/(^|-)Hant(-|$)/i.test(normalized) || /(^|-)(TW|HK|MO)$/i.test(normalized))
    return "zh-Hant";
  if (/(^|-)Hans(-|$)/i.test(normalized) || /^zh(-|$)/i.test(normalized))
    return "zh-Hans";

  // Region-qualified code we don't recognize (e.g. "it-IT", "sv-SE"): fall back
  // to the base language, mapping it through the alias table if needed.
  const base = normalized.split("-")[0];
  if (ASC_LOCALES.has(base)) return base;
  if (SHORT_TO_ASC[base]) return SHORT_TO_ASC[base];

  // Last resort: hand back the original and let ASC reject it with a clear error.
  return locale;
}

/** Whether a locale resolves to a code App Store Connect will accept. */
export function isAscLocale(locale: string): boolean {
  return ASC_LOCALES.has(localeToAsc(locale));
}
