import { getCollectionSummary, type CollectionSummaryResponseDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import AssistantEmptyState from './AssistantEmptyState.svelte';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getCollectionSummary: vi.fn(),
}));

const summary: CollectionSummaryResponseDto = {
  packs: [
    {
      pack: 'food',
      title: 'Food',
      place: 'restaurant',
      entry: 'menu items',
      visit: 'meals',
      photos: 36,
      visits: 3,
      places: 3,
      entries: 32,
      sources: 4,
      years: [2013, 2014, 2016],
      first: '2013-06-15',
      last: '2016-03-23',
      recentPlaces: [{ name: 'Noma Australia', visits: 1, last: '2016-03-23' }],
    },
  ],
  truncated: false,
};

describe('AssistantEmptyState component', () => {
  const onPick = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should ask about the collections of the library', async () => {
    vi.mocked(getCollectionSummary).mockResolvedValue(summary);
    render(AssistantEmptyState, { props: { onPick } });

    const question = await screen.findByRole('button', { name: 'assistant_question_food' });
    expect(screen.getByRole('button', { name: 'assistant_question_generic_collections' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'assistant_question_generic_museums' })).not.toBeInTheDocument();

    await fireEvent.click(question);
    expect(onPick).toHaveBeenCalledWith('assistant_question_food');
  });

  it('should fall back to generic questions', async () => {
    vi.mocked(getCollectionSummary).mockRejectedValue(new Error('offline'));
    render(AssistantEmptyState, { props: { onPick } });

    expect(await screen.findByRole('button', { name: 'assistant_question_generic_museums' })).toBeInTheDocument();
    expect(screen.getByText('assistant_ask_library')).toBeInTheDocument();
  });

  it('should not ask about the library with photos selected', () => {
    vi.mocked(getCollectionSummary).mockResolvedValue(summary);
    render(AssistantEmptyState, { props: { onPick, hasContext: true } });

    expect(screen.queryByText('assistant_ask_library')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'assistant_example_watercolor' })).toBeInTheDocument();
  });
});
