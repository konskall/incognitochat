// Render emoji as Twemoji images instead of the OS emoji font (Segoe UI Emoji /
// Apple / Noto), so reactions + the picker look modern AND identical on every
// device. We self-host the SVG subset used by the UI under `public/emoji/`
// (filenames = Twemoji's codepoint scheme). Graphics © Twitter/Twemoji
// contributors, licensed CC-BY 4.0.

// Twemoji's filename rule (grabTheRightIcon): when the sequence contains a
// zero-width joiner (U+200D) keep the U+FE0F variation selectors; otherwise
// strip every U+FE0F. Our UI set has no ZWJ sequences, so FE0F is stripped
// (e.g. ❤️ U+2764 U+FE0F -> "2764", ✌️ -> "270c").
export function emojiToFilename(emoji: string): string {
  const cps = Array.from(emoji).map((c) => c.codePointAt(0) as number);
  const hasZWJ = cps.includes(0x200d);
  const kept = hasZWJ ? cps : cps.filter((c) => c !== 0xfe0f);
  return kept.map((c) => c.toString(16)).join('-');
}

// Base-path-aware URL to the self-hosted SVG (mirrors the favicon pattern, so it
// works on GitHub Pages' /incognitochat/ subpath and in local dev).
export function twemojiUrl(emoji: string): string {
  return `${import.meta.env.BASE_URL}emoji/${emojiToFilename(emoji)}.svg`;
}
