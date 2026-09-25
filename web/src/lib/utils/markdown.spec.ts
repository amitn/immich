import { renderMarkdown } from '$lib/utils/markdown';

// happy-dom implements `nodeName` only on the Node subclasses and returns '' from Node.prototype,
// which is where DOMPurify reads it from. Real browsers (and jsdom) behave correctly, so forward
// the base getter to the subclass implementation before DOMPurify is loaded.
vi.hoisted(() => {
  Object.defineProperty(Node.prototype, 'nodeName', {
    configurable: true,
    get(this: Node) {
      let prototype = Object.getPrototypeOf(this);
      while (prototype && prototype !== Node.prototype) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'nodeName');
        if (descriptor?.get) {
          return descriptor.get.call(this);
        }
        prototype = Object.getPrototypeOf(prototype);
      }
      return '';
    },
  });
});

describe(renderMarkdown.name, () => {
  it('should return an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
    expect(renderMarkdown(null)).toBe('');
  });

  it('should render basic markdown', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and `code`\n\n- one\n- two');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('should render tables', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('should strip script tags', () => {
    const html = renderMarkdown('hello <script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('hello');
  });

  it('should strip event handler attributes', () => {
    const html = renderMarkdown('<a href="/albums/1" onclick="alert(1)">x</a> <b onmouseover="alert(1)">y</b>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onmouseover');
  });

  it('should remove javascript: links', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click');
  });

  it('should remove data: links', () => {
    const html = renderMarkdown('[click](data:text/html;base64,PHNjcmlwdD4=)');
    expect(html).not.toContain('data:');
  });

  it('should strip images to avoid remote requests', () => {
    const html = renderMarkdown('![tracker](https://example.com/pixel.png) text');
    expect(html).not.toContain('<img');
    expect(html).toContain('text');
  });

  it('should strip iframes', () => {
    const html = renderMarkdown('<iframe srcdoc="x"></iframe>ok');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('ok');
  });

  it('should strip forms', () => {
    const html = renderMarkdown('<form action="/x">ok</form>');
    expect(html).not.toContain('<form');
    expect(html).toContain('ok');
  });

  it('should strip inputs and buttons', () => {
    expect(renderMarkdown('a <input name="password"> b')).not.toContain('<input');
    expect(renderMarkdown('a <button>go</button> b')).not.toContain('<button');
  });

  it('should open external links in a new tab', () => {
    const html = renderMarkdown('[Immich](https://immich.app)');
    expect(html).toContain('href="https://immich.app"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('should keep internal links in the same tab', () => {
    const html = renderMarkdown('[album](/albums/123)');
    expect(html).toContain('href="/albums/123"');
    expect(html).not.toContain('target=');
  });

  it('should reject protocol-relative links', () => {
    const html = renderMarkdown('[x](//evil.example.com)');
    expect(html).not.toContain('evil.example.com');
  });

  it('should strip inline styles and classes', () => {
    const html = renderMarkdown('<span style="position:fixed" class="fixed inset-0">x</span>');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('class=');
  });

  it('should convert single newlines to line breaks', () => {
    expect(renderMarkdown('line 1\nline 2')).toContain('<br>');
  });
});
