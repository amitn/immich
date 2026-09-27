import { render, screen, waitFor } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import CollectionMatches from './CollectionMatches.svelte';

describe('CollectionMatches component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should show the visits of the collections that match the question at once', async () => {
    sdkMock.searchCollections.mockResolvedValue({
      terms: { pack: 'food', text: ['noma'] },
      total: 1,
      visits: [
        {
          pack: 'food',
          place: 'Noma Australia',
          tag: 'Food/Noma Australia',
          date: '2016-03-24',
          city: 'Sydney',
          entries: [
            { name: 'Unripe Macadamia and Spanner Crab', photoIds: ['a'] },
            { name: 'Wild Seasonal Berries', photoIds: ['b'] },
          ],
          photoIds: ['a', 'b'],
        },
      ],
    });

    render(CollectionMatches, { props: { query: 'what did we eat at noma' } });

    await waitFor(() => expect(screen.getByTestId('collection-matches')).toBeInTheDocument());
    expect(sdkMock.searchCollections).toHaveBeenCalledWith({ q: 'what did we eat at noma' });
    expect(screen.getByRole('link', { name: 'Noma Australia' })).toHaveAttribute(
      'href',
      '/tags?path=Food%2FNoma%20Australia',
    );
    expect(screen.getByText('2016-03-24 · Sydney')).toBeInTheDocument();
    expect(screen.getByText('Unripe Macadamia and Spanner Crab, Wild Seasonal Berries')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'assistant_open_photo' })).toHaveLength(2);
  });

  it('should show nothing when nothing matches', async () => {
    sdkMock.searchCollections.mockResolvedValue({ terms: { text: [] }, total: 0, visits: [] });
    render(CollectionMatches, { props: { query: 'what did we do?' } });
    await waitFor(() => expect(sdkMock.searchCollections).toHaveBeenCalled());
    expect(screen.queryByTestId('collection-matches')).not.toBeInTheDocument();
  });
});
