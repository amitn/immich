import { AgentToolService } from 'src/services/agent-tool.service.js';
import {
  ANSWER_SOURCES_PREFIX,
  ASSISTANT_INSTRUCTIONS,
  QUICK_ANSWER_INSTRUCTIONS,
  buildPromptText,
} from 'src/utils/agent/instructions.js';
import { newTestService } from 'test/utils.js';

describe('ASSISTANT_INSTRUCTIONS', () => {
  const section = ASSISTANT_INSTRUCTIONS.slice(ASSISTANT_INSTRUCTIONS.indexOf('Designing styles'));

  it('should explain how to design styles', () => {
    expect(section).toContain('Book styles:');
    expect(section).toContain('Art styles:');
    expect(section).toMatch(/Only save_book_style after the user approves/);
  });

  it('should tell the agent not to print photo ids, as the chat shows the photos of the tool results', () => {
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/Don't print photo ids in your replies/);
    expect(ASSISTANT_INSTRUCTIONS).not.toMatch(/show the matching photos by their ids/);
  });

  it('should only name tools that exist', () => {
    const { sut } = newTestService(AgentToolService);
    const tools = new Set(sut.getTools().map((tool) => tool.name));
    const named = section
      .matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)
      .map(([name]) => name)
      .toArray();

    expect(named).toEqual(
      expect.arrayContaining(['get_photo_palette', 'preview_book_style', 'save_book_style', 'test_art_style']),
    );
    expect(named.filter((name) => !tools.has(name))).toEqual([]);
  });
});

describe('QUICK_ANSWER_INSTRUCTIONS', () => {
  it('should come before a question of the search bar, and only then', () => {
    const text = buildPromptText({ text: 'which museums did we visit?', instructions: false, answer: true });
    expect(text).toBe(`<quick-answer>\n${QUICK_ANSWER_INSTRUCTIONS}\n</quick-answer>\n\nwhich museums did we visit?`);
    expect(buildPromptText({ text: 'hello', instructions: false })).toBe('hello');
  });

  it('should ask for a sources line the web app can read', () => {
    expect(QUICK_ANSWER_INSTRUCTIONS).toContain(`starts with "${ANSWER_SOURCES_PREFIX}"`);
    expect(QUICK_ANSWER_INSTRUCTIONS).toMatch(/Never change the library/);
  });

  it('should only name tools that exist', () => {
    const { sut } = newTestService(AgentToolService);
    const tools = new Set(sut.getTools().map((tool) => tool.name));
    const named = QUICK_ANSWER_INSTRUCTIONS.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)
      .map(([name]) => name)
      .toArray();
    expect(named).toEqual(['query_journals', 'search_photos', 'find_events']);
    expect(named.filter((name) => !tools.has(name))).toEqual([]);
  });
});
