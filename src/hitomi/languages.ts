/**
 * Hitomi's full language set — all 44, transcribed from the site's generated `language_support.js`
 * (`bitnumber_language` gives the names, `language_localname` the native names). Each name is a
 * literal nozomi path segment: `index-japanese.nozomi`, `tag/female:yuri-korean.nozomi`, …
 *
 * `all` is hitomi's own "any language" sentinel, not a synthetic option.
 */
export const LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "All languages" },
  // The four dominant scanlation languages first; the rest alphabetical by English name.
  { value: "english", label: "English" },
  { value: "japanese", label: "Japanese (日本語)" },
  { value: "chinese", label: "Chinese (中文)" },
  { value: "korean", label: "Korean (한국어)" },
  { value: "albanian", label: "Albanian (Shqip)" },
  { value: "arabic", label: "Arabic (العربية)" },
  { value: "bulgarian", label: "Bulgarian (Български)" },
  { value: "burmese", label: "Burmese (မြန်မာဘာသာ)" },
  { value: "catalan", label: "Catalan (Català)" },
  { value: "cebuano", label: "Cebuano" },
  { value: "czech", label: "Czech (Čeština)" },
  { value: "danish", label: "Danish (Dansk)" },
  { value: "dutch", label: "Dutch (Nederlands)" },
  { value: "esperanto", label: "Esperanto" },
  { value: "estonian", label: "Estonian (Eesti)" },
  { value: "finnish", label: "Finnish (Suomi)" },
  { value: "french", label: "French (Français)" },
  { value: "german", label: "German (Deutsch)" },
  { value: "greek", label: "Greek (Ελληνικά)" },
  { value: "hebrew", label: "Hebrew (עברית)" },
  { value: "hindi", label: "Hindi" },
  { value: "hungarian", label: "Hungarian (Magyar)" },
  { value: "icelandic", label: "Icelandic (Íslenska)" },
  { value: "indonesian", label: "Indonesian (Bahasa Indonesia)" },
  { value: "italian", label: "Italian (Italiano)" },
  { value: "javanese", label: "Javanese (Basa Jawa)" },
  { value: "khmer", label: "Khmer" },
  { value: "latin", label: "Latin (Latina)" },
  { value: "mongolian", label: "Mongolian (Монгол)" },
  { value: "norwegian", label: "Norwegian (Norsk)" },
  { value: "persian", label: "Persian (فارسی)" },
  { value: "polish", label: "Polish (Polski)" },
  { value: "portuguese", label: "Portuguese (Português)" },
  { value: "romanian", label: "Romanian (Română)" },
  { value: "russian", label: "Russian (Русский)" },
  { value: "serbian", label: "Serbian (Srpski)" },
  { value: "slovak", label: "Slovak (Slovenčina)" },
  { value: "spanish", label: "Spanish (Español)" },
  { value: "swedish", label: "Swedish (Svenska)" },
  { value: "tagalog", label: "Tagalog" },
  { value: "thai", label: "Thai (ไทย)" },
  { value: "turkish", label: "Turkish (Türkçe)" },
  { value: "ukrainian", label: "Ukrainian (Українська)" },
  { value: "vietnamese", label: "Vietnamese (Tiếng Việt)" },
];

/** Lowercase hitomi language names, for validating a `language:` search term. */
export const LANGUAGE_NAMES: ReadonlySet<string> = new Set(LANGUAGES.map((l) => l.value));
