import { NormalizedRect, resolveBookStyle } from 'src/dtos/book.dto.js';
import {
  LINE_HEIGHT,
  PRINT_DPI,
  PageTextBlock,
  RenderBookInput,
  RenderPageInput,
  RenderSource,
  fitText,
  planPage,
} from 'src/utils/book/render.js';

/** CSS pixels of a page's long edge on a large screen; images are sized for this at `HTML_PIXEL_RATIO` */
export const HTML_REFERENCE_PAGE_PX = 1000;
export const HTML_PIXEL_RATIO = 2;
export const HTML_MAX_IMAGE_PX = 2000;
export const HTML_JPEG_QUALITY = 82;
/** larger files are still written, but are hard to email */
export const HTML_LARGE_FILE_BYTES = 60 * 1024 * 1024;

export type HtmlImageQuality = { pixelRatio: number; maxImagePx: number; jpegQuality: number };

/** full quality for the exported file */
export const HTML_EXPORT_QUALITY: HtmlImageQuality = { pixelRatio: 2, maxImagePx: 2000, jpegQuality: 82 };

/** the in-app preview is built on demand, so it trades sharpness for speed */
export const HTML_PREVIEW_QUALITY: HtmlImageQuality = { pixelRatio: 1.25, maxImagePx: 1400, jpegQuality: 75 };

export const HTML_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/**
 * Map pages are drawn as one image by the page renderer.
 * TODO: the map layouts (`map`, `map-photo`) and `renderMapImage` in src/utils/book/map.ts come from the map pages
 * branch; once it is merged, renderBookPage draws them and nothing else is needed here.
 */
export const isImagePageLayout = (layout: string) => layout.startsWith('map');

export type ImageSize = { width: number; height: number };

/** An embedded photo: `region` of the asset (normalized), encoded as JPEG */
export type HtmlImage = {
  data: Buffer;
  region: NormalizedRect;
  /** full-resolution size of the asset, which the crops are relative to */
  width: number;
  height: number;
  /** alt text when the slot has no caption, e.g. the file name */
  alt: string;
};

export type HtmlImageRequest = {
  /** the part of the asset that is visible on any page */
  region: NormalizedRect;
  /** output pixels per full-resolution pixel, at most 1 */
  scale: number;
};

export type HtmlBookOptions = {
  images: Map<string, HtmlImage>;
  /** pre-rendered JPEGs of whole pages, by zero-based page index (map pages) */
  pageImages?: Map<number, Buffer>;
  dateRange?: { start: Date; end: Date } | null;
  generatedAt?: Date;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const num = (value: number) => String(Math.round(value * 10_000) / 10_000);
const pct = (value: number) => `${num(value)}%`;

export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const safeColor = (value: string | null | undefined, fallback: string) =>
  value && /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value : fallback;

const safeFontFamily = (value: string) => value.replaceAll(/[^\w\s,'-]/g, '').trim() || 'serif';

/** A file name for the download, e.g. "Summer in Rome!" → "summer-in-rome.html" */
export const getHtmlFileName = (title: string) => {
  const slug = title
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return `${slug || 'photo-book'}.html`;
};

/**
 * The part of a crop that is visible in a slot: like the PDF renderer, a crop whose aspect ratio differs from the
 * slot's is cover-fitted and trimmed around its centre.
 */
export const getEffectiveCrop = (crop: NormalizedRect, image: ImageSize, slotAspect: number): NormalizedRect => {
  const cropAspect = (crop.width * image.width) / (crop.height * image.height);
  if (!(cropAspect > 0) || !(slotAspect > 0) || !Number.isFinite(cropAspect)) {
    return { ...crop };
  }

  if (cropAspect > slotAspect) {
    const width = (crop.width * slotAspect) / cropAspect;
    return { x: crop.x + (crop.width - width) / 2, y: crop.y, width, height: crop.height };
  }

  const height = (crop.height * cropAspect) / slotAspect;
  return { x: crop.x, y: crop.y + (crop.height - height) / 2, width: crop.width, height };
};

export const getBoundingRect = (rects: NormalizedRect[]): NormalizedRect => {
  const x1 = clamp(Math.min(...rects.map((rect) => rect.x)), 0, 1);
  const y1 = clamp(Math.min(...rects.map((rect) => rect.y)), 0, 1);
  const x2 = clamp(Math.max(...rects.map((rect) => rect.x + rect.width)), 0, 1);
  const y2 = clamp(Math.max(...rects.map((rect) => rect.y + rect.height)), 0, 1);
  return { x: x1, y: y1, width: Math.max(x2 - x1, 1e-6), height: Math.max(y2 - y1, 1e-6) };
};

/**
 * CSS for an image inside a slot (`overflow: hidden`) that shows exactly the effective crop: the image is scaled so
 * the crop fills the slot and moved so the crop's top-left corner is at the slot's. `width`/`height` are percentages
 * of the slot, `x`/`y` percentages of the image itself (for `translate`).
 */
export const getSlotImageStyle = (
  crop: NormalizedRect,
  region: NormalizedRect,
  image: ImageSize,
  slotAspect: number,
) => {
  const visible = getEffectiveCrop(crop, image, slotAspect);
  const relative = {
    x: (visible.x - region.x) / region.width,
    y: (visible.y - region.y) / region.height,
    width: visible.width / region.width,
    height: visible.height / region.height,
  };

  return {
    width: 100 / relative.width,
    height: 100 / relative.height,
    x: -100 * relative.x,
    y: -100 * relative.y,
  };
};

/** Pixel size of a region of the asset at the given scale */
export const getRegionSize = (region: NormalizedRect, image: ImageSize, scale: number): ImageSize => ({
  width: Math.max(1, Math.round(region.width * image.width * scale)),
  height: Math.max(1, Math.round(region.height * image.height * scale)),
});

const planGeometry = (book: RenderBookInput, page: RenderPageInput, sources = new Map<string, RenderSource>()) =>
  planPage(book, page, { dpi: PRINT_DPI, mode: 'print', sources });

/**
 * What to embed for every asset: the bounding box of its visible crops on all pages (so a photo used twice is
 * embedded once), sized so each use gets `HTML_PIXEL_RATIO`× its CSS size, capped at `HTML_MAX_IMAGE_PX`.
 */
export const planHtmlImages = (
  book: RenderBookInput,
  pages: RenderPageInput[],
  sizes: Map<string, ImageSize>,
  { pixelRatio, maxImagePx }: Pick<HtmlImageQuality, 'pixelRatio' | 'maxImagePx'> = HTML_EXPORT_QUALITY,
): Map<string, HtmlImageRequest> => {
  const longEdgeMm = Math.max(book.pageWidthMm, book.pageHeightMm);
  const pxPerMm = (HTML_REFERENCE_PAGE_PX * pixelRatio) / longEdgeMm;
  const uses = new Map<string, { rects: NormalizedRect[]; scale: number }>();

  for (const page of pages) {
    if (isImagePageLayout(page.layout)) {
      continue;
    }

    for (const slot of planGeometry(book, page).slots) {
      const image = slot.assetId ? sizes.get(slot.assetId) : undefined;
      if (!slot.assetId || !image?.width || !image.height || slot.rectMm.width <= 0 || slot.rectMm.height <= 0) {
        continue;
      }

      const visible = getEffectiveCrop(slot.crop, image, slot.rectMm.width / slot.rectMm.height);
      const scale = (slot.rectMm.width * pxPerMm) / (visible.width * image.width);
      const use = uses.get(slot.assetId) ?? { rects: [], scale: 0 };
      use.rects.push(visible);
      use.scale = Math.max(use.scale, scale);
      uses.set(slot.assetId, use);
    }
  }

  const requests = new Map<string, HtmlImageRequest>();
  for (const [assetId, use] of uses) {
    const image = sizes.get(assetId)!;
    const region = getBoundingRect(use.rects);
    const longEdge = Math.max(region.width * image.width, region.height * image.height);
    requests.set(assetId, { region, scale: Math.min(use.scale, 1, maxImagePx / longEdge) });
  }

  return requests;
};

/** Page numbers (one-based) of each spread: the cover alone, then left/right pairs */
export const getSpreads = (pageCount: number): number[][] => {
  const spreads: number[][] = [];
  for (let number = 1; number <= pageCount; number++) {
    const key = Math.floor(number / 2);
    if (spreads.length === key) {
      spreads.push([]);
    }
    spreads[key].push(number);
  }
  return spreads;
};

export const formatDateRange = (range: { start: Date; end: Date }) =>
  new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).formatRange(
    range.start,
    range.end,
  );

type ImageRefs = { ids: Map<string, string>; next: number };

/** The first use of an image carries the data; later uses point at it and are filled in by the script */
const imageSource = (refs: ImageRefs, key: string, data: Buffer) => {
  const id = refs.ids.get(key);
  if (id) {
    return `data-same="${id}"`;
  }

  const newId = `img-${++refs.next}`;
  refs.ids.set(key, newId);
  return `id="${newId}" src="data:image/jpeg;base64,${data.toString('base64')}"`;
};

const renderText = (block: PageTextBlock, page: { width: number; height: number }) => {
  const padding = block.band ? block.fontPx * 0.5 : 0;
  const inner = {
    width: Math.max(1, block.rect.width - 2 * padding),
    height: Math.max(1, block.rect.height - 2 * padding),
  };
  const { fontPx } = fitText(block.text, inner, block.fontPx);
  const tag = block.kind === 'title' || block.kind === 'sectionTitle' ? 'h2' : 'p';
  const classes = ['text', block.band && 'band', block.valign === 'bottom' && 'bottom'].filter(Boolean).join(' ');
  const style = [
    `left:${pct((block.rect.left / page.width) * 100)}`,
    `top:${pct((block.rect.top / page.height) * 100)}`,
    `width:${pct((block.rect.width / page.width) * 100)}`,
    `height:${pct((block.rect.height / page.height) * 100)}`,
    `font-size:${num((fontPx / page.width) * 100)}cqw`,
    `text-align:${block.align}`,
    `color:${safeColor(block.color, '#222222')}`,
    block.bold ? 'font-weight:bold' : '',
    block.italic ? 'font-style:italic' : '',
  ]
    .filter(Boolean)
    .join(';');

  return `<div class="${classes}" style="${style}"><${tag}>${escapeHtml(block.text)}</${tag}></div>`;
};

type RenderContext = { options: HtmlBookOptions; sources: Map<string, RenderSource>; refs: ImageRefs };

const renderPage = (book: RenderBookInput, page: RenderPageInput, index: number, context: RenderContext) => {
  const { options, refs } = context;
  const style = resolveBookStyle(book.style);
  const number = index + 1;
  const background = safeColor(page.background, safeColor(style.background, '#ffffff'));
  const open = `<section class="page" id="page-${number}" aria-label="Page ${number}" style="background:${background}">`;

  const pageImage = options.pageImages?.get(index);
  if (pageImage) {
    const alt = [page.sectionTitle, page.caption].filter(Boolean).join(' – ') || `Page ${number}`;
    return `${open}<img class="page-image" ${imageSource(refs, `page:${index}`, pageImage)} alt="${escapeHtml(alt)}"></section>`;
  }

  const plan = planGeometry(book, page, context.sources);
  const parts: string[] = [open];

  for (const slot of plan.slots) {
    const image = slot.assetId ? options.images.get(slot.assetId) : undefined;
    if (!slot.assetId || !image) {
      continue;
    }

    const rect = slot.rectMm;
    const css = getSlotImageStyle(slot.crop, image.region, image, rect.width / rect.height);
    const alt = slot.caption ?? image.alt;
    parts.push(
      `<div class="slot" style="left:${pct((rect.x / book.pageWidthMm) * 100)};top:${pct((rect.y / book.pageHeightMm) * 100)};` +
        `width:${pct((rect.width / book.pageWidthMm) * 100)};height:${pct((rect.height / book.pageHeightMm) * 100)}">` +
        `<img ${imageSource(refs, `asset:${slot.assetId}`, image.data)} alt="${escapeHtml(alt)}" ` +
        `style="width:${pct(css.width)};height:${pct(css.height)};transform:translate(${pct(css.x)},${pct(css.y)})">` +
        `</div>`,
    );
  }

  for (const block of plan.text) {
    parts.push(renderText(block, plan.spec));
  }

  parts.push('</section>');
  return parts.join('');
};

const STYLE = `
*{box-sizing:border-box}
:root{color-scheme:light dark;--chrome:#e9e7e3;--fg:#1d1d1d;--muted:#5f5f5f;--btn:#ffffff;--line:#c4c2bd;--accent:#4250af;--on-accent:#ffffff}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--chrome:#161616;--fg:#ececec;--muted:#a8a8a8;--btn:#262626;--line:#444444;--accent:#adcbfa;--on-accent:#101010}}
:root[data-theme=dark]{--chrome:#161616;--fg:#ececec;--muted:#a8a8a8;--btn:#262626;--line:#444444;--accent:#adcbfa;--on-accent:#101010}
html,body{margin:0}
body{--bar-h:9rem;--pw:min(calc((100vw - 3rem) / 2),calc((100vh - var(--bar-h)) * var(--ar)));min-height:100vh;display:flex;flex-direction:column;background:var(--chrome);color:var(--fg);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body.thumbs-open{--bar-h:15rem}
@media (max-width:700px){body{--pw:min(calc(100vw - 2rem),calc((100vh - var(--bar-h)) * var(--ar)))}}
html:not(.js) .js-only{display:none!important}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;padding:.6rem 1rem}
.bar h1{margin:0;font-size:1.05rem;font-weight:600}
.bar p{margin:0;color:var(--muted);font-size:.85rem}
.tools{display:flex;gap:.4rem;margin-left:auto}
button{min-height:2.25rem;padding:.3rem .85rem;border:1px solid var(--line);border-radius:999px;background:var(--btn);color:inherit;font:inherit;cursor:pointer}
button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button:disabled{opacity:.4;cursor:default}
main{flex:1;display:flex;flex-direction:column;align-items:center;gap:1.5rem;padding:1rem}
.spread{display:contents}
.page{position:relative;flex:none;width:min(100%,60rem);aspect-ratio:var(--ar);overflow:hidden;container-type:inline-size;background:#ffffff;color:var(--text);font-family:var(--font);box-shadow:0 1px 3px rgba(0,0,0,.25),0 8px 24px rgba(0,0,0,.12)}
.mode-book main{justify-content:center;gap:0}
.mode-book .spread{display:flex;justify-content:center}
.mode-book .spread:not(.shown),.mode-book main .page:not(.shown){display:none}
.mode-book main .page{width:var(--pw)}
.mode-book .spread .page:first-child:not(:only-child)::after,.mode-book .spread .page:last-child:not(:only-child)::after{content:"";position:absolute;top:0;bottom:0;width:5%;pointer-events:none}
.mode-book .spread .page:first-child:not(:only-child)::after{right:0;background:linear-gradient(to left,rgba(0,0,0,.14),rgba(0,0,0,0))}
.mode-book .spread .page:last-child:not(:only-child)::after{left:0;background:linear-gradient(to right,rgba(0,0,0,.14),rgba(0,0,0,0))}
.slot{position:absolute;overflow:hidden}
.slot img{position:absolute;left:0;top:0;display:block;max-width:none;object-fit:cover;transform-origin:0 0}
.page-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.text{position:absolute;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.text.bottom{justify-content:flex-end}
.text>*{margin:0;font-size:inherit;font-weight:inherit;line-height:${LINE_HEIGHT};white-space:pre-line;overflow-wrap:anywhere}
.text.band>*{padding:.5em;background:rgba(0,0,0,.45)}
.pager{display:none;align-items:center;justify-content:center;gap:.75rem;padding:.5rem 1rem}
.mode-book .pager{display:flex}
.pager output{min-width:9rem;text-align:center;font-variant-numeric:tabular-nums}
.thumbs{display:none;gap:.5rem;padding:.25rem 1rem 1rem;overflow-x:auto}
.mode-book .thumbs:not([hidden]){display:flex}
.thumbs button{flex:none;width:4.5rem;min-height:0;padding:0;border:2px solid transparent;border-radius:3px;background:none}
.thumbs button[aria-current=true]{border-color:var(--accent)}
.thumbs .page{width:100%;box-shadow:none;pointer-events:none}
footer{padding:1rem;color:var(--muted);font-size:.8rem;text-align:center}
@media print{
html,body{background:none}
.bar,.pager,.thumbs,footer{display:none!important}
main{display:block;padding:0}
.spread,main .page{display:block!important}
main .page{width:var(--page-w)!important;height:var(--page-h);box-shadow:none;break-after:page;print-color-adjust:exact;-webkit-print-color-adjust:exact}
main .page::after{display:none!important}
}`;

const SCRIPT = `(function () {
  'use strict';
  // in the Immich preview this page is framed, and Esc would never reach the dialog around it
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && window.parent !== window) {
      window.parent.postMessage({ type: 'immich-book-preview', action: 'close' }, '*');
    }
  });

  var root = document.documentElement;
  var body = document.body;
  root.classList.add('js');
  var toArray = function (list) { return Array.prototype.slice.call(list); };
  toArray(document.querySelectorAll('img[data-same]')).forEach(function (img) {
    var source = document.getElementById(img.getAttribute('data-same'));
    if (source) { img.src = source.src; }
  });

  var main = document.getElementById('pages');
  var pages = toArray(main.querySelectorAll('.page'));
  var spreads = toArray(main.querySelectorAll('.spread'));
  var narrow = window.matchMedia('(max-width: 700px)');
  var counter = document.getElementById('counter');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var thumbs = document.getElementById('thumbs');
  var thumbsToggle = document.getElementById('thumbs-toggle');
  var modeButtons = toArray(document.querySelectorAll('[data-mode]'));
  var current = 0;
  var mode = 'scroll';

  var views = function () {
    return narrow.matches
      ? pages.map(function (page) { return [page]; })
      : spreads.map(function (spread) { return toArray(spread.querySelectorAll('.page')); });
  };
  var viewOf = function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].indexOf(pages[current]) !== -1) { return i; }
    }
    return 0;
  };

  var render = function () {
    var list = views();
    var index = viewOf(list);
    var shown = list[index];
    pages.forEach(function (page) { page.classList.toggle('shown', shown.indexOf(page) !== -1); });
    spreads.forEach(function (spread) { spread.classList.toggle('shown', spread.contains(shown[0])); });
    var first = pages.indexOf(shown[0]) + 1;
    var last = pages.indexOf(shown[shown.length - 1]) + 1;
    counter.textContent = (first === last ? 'Page ' + first : 'Pages ' + first + '–' + last) + ' of ' + pages.length;
    prev.disabled = index === 0;
    next.disabled = index === list.length - 1;
    toArray(thumbs.children).forEach(function (button, i) {
      button.setAttribute('aria-current', String(shown.indexOf(pages[i]) !== -1));
    });
    // decode the neighbouring pages so turning a page does not show them blank
    [list[index - 1], list[index + 1]].forEach(function (view) {
      (view || []).forEach(function (page) {
        toArray(page.querySelectorAll('img')).forEach(function (img) {
          if (img.decode) { img.decode().catch(function () {}); }
        });
      });
    });
  };

  var go = function (delta) {
    var list = views();
    var index = viewOf(list) + delta;
    if (index >= 0 && index < list.length) {
      current = pages.indexOf(list[index][0]);
      render();
    }
  };

  var goTo = function (index) {
    current = Math.min(Math.max(index, 0), pages.length - 1);
    if (mode === 'book') { render(); } else { pages[current].scrollIntoView({ block: 'start' }); }
  };

  var firstVisible = function () {
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].getBoundingClientRect().bottom > 80) { return i; }
    }
    return 0;
  };

  var setMode = function (value, scroll) {
    if (mode === 'scroll' && value === 'book' && scroll) { current = firstVisible(); }
    mode = value;
    body.classList.toggle('mode-book', value === 'book');
    body.classList.toggle('mode-scroll', value !== 'book');
    modeButtons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-mode') === value));
    });
    if (value === 'book') { render(); } else if (scroll) { pages[current].scrollIntoView({ block: 'start' }); }
  };

  modeButtons.forEach(function (button) {
    button.addEventListener('click', function () { setMode(button.getAttribute('data-mode'), true); });
  });
  prev.addEventListener('click', function () { go(-1); });
  next.addEventListener('click', function () { go(1); });

  document.addEventListener('keydown', function (event) {
    if (mode !== 'book' || event.altKey || event.ctrlKey || event.metaKey) { return; }
    var keys = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 };
    if (keys[event.key]) {
      event.preventDefault();
      go(keys[event.key]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      goTo(event.key === 'Home' ? 0 : pages.length - 1);
    }
  });

  var touch = null;
  main.addEventListener('touchstart', function (event) {
    touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }, { passive: true });
  main.addEventListener('touchend', function (event) {
    if (!touch || mode !== 'book') { return; }
    var dx = event.changedTouches[0].clientX - touch.x;
    var dy = event.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { go(dx < 0 ? 1 : -1); }
  }, { passive: true });

  var onNarrowChange = function () { if (mode === 'book') { render(); } };
  if (narrow.addEventListener) { narrow.addEventListener('change', onNarrowChange); }

  thumbsToggle.addEventListener('click', function () {
    if (!thumbs.children.length) {
      pages.forEach(function (page, i) {
        var button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', 'Go to page ' + (i + 1));
        var copy = page.cloneNode(true);
        copy.removeAttribute('id');
        copy.removeAttribute('aria-label');
        copy.classList.remove('shown');
        copy.setAttribute('aria-hidden', 'true');
        toArray(copy.querySelectorAll('[id]')).forEach(function (node) { node.removeAttribute('id'); });
        button.appendChild(copy);
        button.addEventListener('click', function () { goTo(i); });
        thumbs.appendChild(button);
      });
    }
    var open = thumbs.hidden;
    thumbs.hidden = !open;
    body.classList.toggle('thumbs-open', open);
    thumbsToggle.setAttribute('aria-expanded', String(open));
    render();
  });

  document.getElementById('theme').addEventListener('click', function () {
    var dark = root.getAttribute('data-theme')
      ? root.getAttribute('data-theme') === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
  });

  var match = /^#page-([0-9]+)$/.exec(window.location.hash);
  if (match) { current = Math.min(Math.max(Number(match[1]) - 1, 0), pages.length - 1); }
  setMode(narrow.matches ? 'scroll' : 'book', false);
  if (match && mode === 'scroll') { pages[current].scrollIntoView({ block: 'start' }); }
})();`;

/** One self-contained HTML file: inline CSS and script, photos as data URIs and no external requests */
export const buildBookHtml = (book: RenderBookInput, pages: RenderPageInput[], options: HtmlBookOptions): string => {
  const style = resolveBookStyle(book.style);
  const context: RenderContext = {
    options,
    // only used to tell which slots have a photo
    sources: new Map(
      [...options.images].map(([assetId, image]) => [assetId, { input: '', width: image.width, height: image.height }]),
    ),
    refs: { ids: new Map(), next: 0 },
  };
  const title = escapeHtml(book.title);
  const dates = options.dateRange ? formatDateRange(options.dateRange) : null;
  const description = [book.subtitle, dates].filter(Boolean).join(' · ');
  const meta = [book.subtitle, dates, `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`]
    .filter(Boolean)
    .map((value) => escapeHtml(value!))
    .join(' · ');
  const generatedAt = (options.generatedAt ?? new Date()).toISOString().slice(0, 10);

  const variables = [
    `--ar:${num(book.pageWidthMm / book.pageHeightMm)}`,
    `--page-w:${book.pageWidthMm}mm`,
    `--page-h:${book.pageHeightMm}mm`,
    `--font:${safeFontFamily(style.fontFamily)}`,
    `--text:${safeColor(style.textColor, '#222222')}`,
  ].join(';');

  const spreads = getSpreads(pages.length).map(
    (numbers) =>
      `<div class="spread">${numbers.map((number) => renderPage(book, pages[number - 1], number - 1, context)).join('')}</div>`,
  );

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${HTML_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="Immich">',
    description ? `<meta name="description" content="${escapeHtml(description)}">` : '',
    `<title>${title}</title>`,
    `<style>:root{${variables}}${STYLE}\n@page{size:${book.pageWidthMm}mm ${book.pageHeightMm}mm;margin:0}</style>`,
    '</head>',
    '<body class="mode-scroll">',
    '<header class="bar">',
    `<div><h1>${title}</h1><p>${meta}</p></div>`,
    '<div class="tools js-only" role="group" aria-label="View">',
    '<button type="button" data-mode="book" aria-pressed="false">Book</button>',
    '<button type="button" data-mode="scroll" aria-pressed="true">Scroll</button>',
    '<button type="button" id="theme" aria-label="Switch between light and dark background">◐</button>',
    '</div>',
    '</header>',
    `<main id="pages" aria-label="${title}">`,
    ...spreads,
    '</main>',
    '<nav class="pager js-only" aria-label="Page navigation">',
    '<button type="button" id="prev" aria-label="Previous pages">‹</button>',
    '<output id="counter" aria-live="polite"></output>',
    '<button type="button" id="next" aria-label="Next pages">›</button>',
    '<button type="button" id="thumbs-toggle" aria-expanded="false" aria-controls="thumbs">Thumbnails</button>',
    '</nav>',
    '<nav class="thumbs js-only" id="thumbs" aria-label="Thumbnails" hidden></nav>',
    `<footer>Made with Immich · ${generatedAt}</footer>`,
    `<script>${SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
};
