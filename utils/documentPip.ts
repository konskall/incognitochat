// Document Picture-in-Picture: a real OS-level, always-on-top window (Chrome/Edge
// desktop only). The caller portals React into the returned window's document.body.
// Returns null if unsupported or the user/system blocks it.
export function docPipSupported(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

export async function openDocPip(width = 360, height = 260): Promise<Window | null> {
  try {
    const dp = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture;
    if (!dp) return null;
    const w = await dp.requestWindow({ width, height });
    copyStyles(w.document);
    w.document.body.style.margin = '0';
    w.document.body.style.background = '#020617';
    return w;
  } catch { return null; }
}

// Clone the parent document's stylesheets into the PiP document so Tailwind
// classes render. Same-origin sheets are inlined; cross-origin ones are re-linked.
function copyStyles(doc: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
      const style = doc.createElement('style'); style.textContent = css; doc.head.appendChild(style);
    } catch {
      if (sheet.href) { const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; doc.head.appendChild(link); }
    }
  }
}
