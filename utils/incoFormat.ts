// Defensive plain-text normaliser for inco's replies. The edge prompt asks
// Gemini for PLAIN TEXT (the chat bubble renders raw text, not markdown), but
// the model frequently ignores that and emits **bold**, `code`, "* " bullets,
// "# " headings, and [text](url) links. Strip that lightweight markdown so the
// bubble shows clean text instead of literal asterisks. Conservative on
// purpose: it must NOT mangle plain prose, snake_case, URLs, or "2 * 3".

export function stripIncoMarkdown(input: string): string {
  if (!input) return '';
  let text = input;

  // Line-anchored constructs first (headings, bullets), so a leading "* " is
  // treated as a bullet and never as the opening of an italic span.
  text = text
    .split('\n')
    .map((line) => {
      // "# Heading" / "### Sub" -> "Heading" (only at line start, up to 3 spaces).
      let l = line.replace(/^\s{0,3}#{1,6}[ \t]+/, '');
      // "* item" / "- item" / "+ item" -> "• item" (keep leading indent).
      l = l.replace(/^(\s*)[*+-][ \t]+/, '$1• ');
      return l;
    })
    .join('\n');

  // [text](url) -> text  (sources are already shown as chips below the bubble).
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // **bold** / __bold__ -> bold.
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, '$1');
  text = text.replace(/__([\s\S]+?)__/g, '$1');
  // *italic* -> italic. Require a non-space right after "*" and before the
  // closing "*", so "2 * 3" and a stray bullet asterisk are left untouched.
  text = text.replace(/\*(?=\S)([\s\S]*?\S)\*/g, '$1');
  // `code` -> code.
  text = text.replace(/`([^`]+)`/g, '$1');

  return text.trim();
}
