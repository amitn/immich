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

/**
 * Renders untrusted markdown (e.g. agent output) to sanitized HTML.
 * Images and embedded media are stripped (no remote requests), external links open in a new tab,
 * and only http(s), mailto, same-origin and fragment links are kept.
 */
export const renderMarkdown = (markdown: string | undefined | null): string => {
  if (!markdown) {
    return '';
  }

  installHooks();

  const html = marked.parse(markdown) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR: ['style', 'class', 'id'],
  });
};
