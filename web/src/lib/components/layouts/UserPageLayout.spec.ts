import { render, screen } from '@testing-library/svelte';
import UserPageLayout from './UserPageLayout.svelte';

vi.mock('$lib/components/shared-components/navigation-bar/NavigationBar.svelte', async () => {
  return await import('@test-data/mocks/Empty.mock.svelte');
});
vi.mock('$lib/components/shared-components/side-bar/UserSidebar.svelte', async () => {
  return await import('@test-data/mocks/Empty.mock.svelte');
});

describe('UserPageLayout component', () => {
  it('should cut a long title with an ellipsis and show it whole in its tooltip', () => {
    const title = 'Crete, October 2016: Samaria Gorge, Sougia, Loutro and the south coast';
    render(UserPageLayout, { title, description: 'Ten days by bus and ferry' });

    const header = document.querySelector('#user-page-header')!;
    expect(header).toHaveTextContent(title);
    expect(header).toHaveClass('truncate', 'min-w-0');
    expect(header).toHaveAttribute('title', title);
    expect(header.parentElement).toHaveClass('min-w-0');

    const description = screen.getByText('Ten days by bus and ferry');
    expect(description).toHaveClass('truncate');
    expect(description).toHaveAttribute('title', 'Ten days by bus and ferry');
  });
});
