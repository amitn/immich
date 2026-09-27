import { AgentToolService } from 'src/services/agent-tool.service.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { newTestService } from 'test/utils.js';

describe('ASSISTANT_INSTRUCTIONS', () => {
  const section = ASSISTANT_INSTRUCTIONS.slice(ASSISTANT_INSTRUCTIONS.indexOf('Designing styles'));

  it('should explain how to design styles', () => {
    expect(section).toContain('Book styles:');
    expect(section).toContain('Art styles:');
    expect(section).toMatch(/Only save_book_style after the user approves/);
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
