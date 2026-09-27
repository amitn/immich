import { render } from '@testing-library/svelte';
import AssistantMarkdown from './AssistantMarkdown.svelte';

// happy-dom implements `nodeName` only on the Node subclasses, which is where DOMPurify reads it from (see
// `markdown.spec.ts`)
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

describe('AssistantMarkdown component', () => {
  const gougeres = '7144b65c-9b36-4845-9280-0522144198e6';
  const unknown = '192ae623-a809-4808-a97f-921d44246f93';
  const text = `1. Gougères — \`${gougeres}\`\n2. Salmon Tartare Cornet — \`${unknown}\``;

  it('should show the photos of the chat as thumbnail chips linking to them, and other ids as text', () => {
    const { container } = render(AssistantMarkdown, { props: { text, assetIds: new Set([gougeres]) } });

    const chips = container.querySelectorAll('a[data-asset-chip]');
    expect(chips).toHaveLength(1);
    expect(chips[0].getAttribute('href')).toContain(gougeres);
    expect(chips[0].getAttribute('aria-label')).toBe('assistant_open_this_photo');
    expect(chips[0].querySelector('img')?.getAttribute('src')).toContain(gougeres);
    expect(container.querySelector('code')?.textContent).toBe(unknown);
  });

  it('should leave every id as text without the photos of the chat', () => {
    const { container } = render(AssistantMarkdown, { props: { text } });

    expect(container.querySelector('a[data-asset-chip]')).toBeNull();
    expect(container.querySelectorAll('code')).toHaveLength(2);
  });
});
