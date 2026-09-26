/**
 * Fonts tried before each generic family. The pages are drawn by librsvg, and fontconfig may resolve a bare `serif` to
 * whatever font is installed first, even a sans-serif one, so fonts common on servers and desktops come first. The
 * metric-compatible pairs (Liberation Serif and Times New Roman, Liberation Sans and Arial) keep the text of the HTML
 * export laid out like the rendered pages and the PDF.
 */
export const BOOK_FONT_STACKS: Record<string, string[]> = {
  serif: ['Liberation Serif', 'Times New Roman', 'Times', 'DejaVu Serif', 'Noto Serif', 'FreeSerif', 'serif'],
  'sans-serif': ['Liberation Sans', 'Arial', 'Helvetica', 'DejaVu Sans', 'Noto Sans', 'FreeSans', 'sans-serif'],
  monospace: ['Liberation Mono', 'Courier New', 'DejaVu Sans Mono', 'Noto Sans Mono', 'FreeMono', 'monospace'],
};

const GENERIC_FAMILIES = new Set([...Object.keys(BOOK_FONT_STACKS), 'cursive', 'fantasy', 'system-ui']);

const formatFamily = (name: string) => (GENERIC_FAMILIES.has(name) || !/\s/.test(name) ? name : `'${name}'`);

/**
 * The font-family list for a style's font family, the same for the rendered pages, the maps, the PDF and the HTML
 * export: every generic family is preceded by its stack (see `BOOK_FONT_STACKS`), and a list without a generic family
 * falls back to the serif stack, e.g. "serif" → "'Liberation Serif', 'Times New Roman', …, serif".
 */
export const getFontStack = (fontFamily: string | null | undefined) => {
  const names = (fontFamily ?? '')
    .split(',')
    .map((name) => name.trim().replaceAll(/^['"]+|['"]+$/g, ''))
    .filter(Boolean)
    .map((name) => (GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : name));
  if (names.every((name) => !GENERIC_FAMILIES.has(name))) {
    names.push('serif');
  }

  const seen = new Set<string>();
  const stack: string[] = [];
  for (const name of names.flatMap((item) => BOOK_FONT_STACKS[item] ?? [item])) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    stack.push(formatFamily(name));
  }
  return stack.join(', ');
};
