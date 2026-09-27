import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: true, async: false });

const FORBID_TAGS = ['img', 'picture', 'video', 'audio', 'source', 'iframe', 'form', 'input', 'button', 'style'];
const SAFE_URL = /^(?:https?:|mailto:|\/(?!\/)|#)/i;

let hooksInstalled = false;

const installHooks = () => {
  if (hooksInstalled) {
    return;
  }
  hooksInstalled = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A') {
      return;
    }

    const href = node.getAttribute('href') ?? '';
    if (!SAFE_URL.test(href)) {
      node.removeAttribute('href');
      return;
    }

    if (/^https?:/i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
};

/** the link and thumbnail of a photo, shown as a chip where its id is in the text */
export type AssetChip = { href: string; src: string; label: string };

export type RenderMarkdownOptions = {
  /** the chip of a photo id (lower case), or undefined to leave the id as text: only ids the caller knows are photos */
  getAssetChip?: (id: string) => AssetChip | undefined;
};

const UUID = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gi;
const HAS_UUID = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/i;
const UUID_ONLY = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** a chip built after sanitizing, from the caller's own link and thumbnail: never from the markdown */
const createChip = (document: Document, id: string, chip: AssetChip) => {
  const link = document.createElement('a');
  link.setAttribute('href', chip.href);
  link.setAttribute('title', chip.label);
  link.setAttribute('aria-label', chip.label);
  link.dataset.assetChip = id;
  const image = document.createElement('img');
  image.setAttribute('src', chip.src);
  image.setAttribute('alt', '');
  image.setAttribute('loading', 'lazy');
  image.setAttribute('draggable', 'false');
  link.append(image);
  return link;
};

/** replaces the known photo ids of the text, as inline code or words, with chips; ids in links and code blocks stay */
const addAssetChips = (root: DocumentFragment, getAssetChip: NonNullable<RenderMarkdownOptions['getAssetChip']>) => {
  const document = root.ownerDocument;
  for (const code of root.querySelectorAll('code')) {
    const id = code.textContent?.trim() ?? '';
    const chip = code.closest('pre, a') || !UUID_ONLY.test(id) ? undefined : getAssetChip(id.toLowerCase());
    if (chip) {
      code.replaceWith(createChip(document, id.toLowerCase(), chip));
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('a, code, pre')) {
      texts.push(node as Text);
    }
  }
  for (const text of texts) {
    const value = text.data;
    const parts: Array<string | Node> = [];
    let last = 0;
    for (const match of value.matchAll(UUID)) {
      const id = match[0].toLowerCase();
      const chip = getAssetChip(id);
      if (!chip) {
        continue;
      }
      parts.push(value.slice(last, match.index), createChip(document, id, chip));
      last = match.index + match[0].length;
    }
    if (parts.length === 0) {
      continue;
    }
    parts.push(value.slice(last));
    text.replaceWith(...parts.filter((part) => part !== ''));
  }
};

/**
 * Renders untrusted markdown (e.g. agent output) to sanitized HTML.
 * Images and embedded media are stripped (no remote requests), external links open in a new tab,
 * and only http(s), mailto, same-origin and fragment links are kept. With `getAssetChip`, the ids of known photos
 * become chips with their thumbnail, which link to the photo.
 */
export const renderMarkdown = (
  markdown: string | undefined | null,
  { getAssetChip }: RenderMarkdownOptions = {},
): string => {
  if (!markdown) {
    return '';
  }

  installHooks();

  const html = marked.parse(markdown) as string;
  const config = { USE_PROFILES: { html: true }, FORBID_TAGS, FORBID_ATTR: ['style', 'class', 'id'] };
  if (!getAssetChip || !HAS_UUID.test(markdown)) {
    return DOMPurify.sanitize(html, config);
  }

  const fragment = DOMPurify.sanitize(html, { ...config, RETURN_DOM_FRAGMENT: true });
  addAssetChips(fragment, getAssetChip);
  const container = fragment.ownerDocument.createElement('div');
  container.append(fragment);
  return container.getHTML();
};
