import { BookStylePreset } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { resetBookStylePresets } from '$lib/utils/book-style';
import { bookDetailFactory } from '@test-data/factories/book-factory';
import { bookStylePresets } from '@test-data/factories/book-review-factory';
import type { ComponentProps } from 'svelte';
import BookStyleMenu from './BookStyleMenu.svelte';

const [classic, soft] = bookStylePresets;

describe('BookStyleMenu component', () => {
  const onUpdated = vi.fn();

  const renderMenu = (props: ComponentProps<typeof BookStyleMenu>) =>
    render(TestWrapper<ComponentProps<typeof BookStyleMenu>>, {
      props: { component: BookStyleMenu, componentProps: props },
    });

  const openMenu = async () => {
    await fireEvent.click(await screen.findByRole('button', { name: 'book_style_current' }));
    return screen.findAllByRole('menuitemradio');
  };

  beforeEach(() => {
    vi.resetAllMocks();
    resetBookStylePresets();
    sdkMock.getBookStylePresets.mockResolvedValue(bookStylePresets);
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(true);
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
  });

  it('should mark the preset the book uses', async () => {
    const book = bookDetailFactory.build({ style: { ...soft.style, background: '#F6F1E7' } });

    renderMenu({ book, onUpdated });
    const entries = await openMenu();

    expect(entries.map((entry) => entry.textContent)).toEqual([
      expect.stringContaining('book_style_preset_soft'),
      expect.stringContaining('book_style_preset_classic'),
      expect.stringContaining('book_style_preset_bold'),
    ]);
    expect(entries.map((entry) => entry.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('should show a custom style', async () => {
    const book = bookDetailFactory.build({ style: { ...soft.style, marginMm: 15 } });

    renderMenu({ book, onUpdated });
    const entries = await openMenu();

    expect(entries).toHaveLength(4);
    expect(entries[0]).toHaveTextContent('book_style_custom');
    expect(entries[0]).toHaveAttribute('aria-checked', 'true');
    expect(entries[0]).toHaveAttribute('aria-disabled', 'true');
    expect(entries.slice(1).every((entry) => entry.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('should apply a preset and hand over the updated book', async () => {
    const book = bookDetailFactory.build({ style: { ...soft.style } });
    const updated = { ...book, style: { ...classic.style }, updatedAt: '2026-09-25T12:00:00.000Z' };
    sdkMock.updateBook.mockResolvedValue(updated);

    renderMenu({ book, onUpdated });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitemradio', { name: /book_style_preset_classic/ }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
    expect(sdkMock.updateBook).toHaveBeenCalledWith({
      id: book.id,
      bookUpdateDto: { stylePreset: BookStylePreset.Classic },
    });
    expect(modalManager.showDialog).not.toHaveBeenCalled();
  });

  it('should not apply the preset that is already used', async () => {
    const book = bookDetailFactory.build({ style: { ...soft.style } });

    renderMenu({ book, onUpdated });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitemradio', { name: /book_style_preset_soft/ }));

    expect(sdkMock.updateBook).not.toHaveBeenCalled();
  });

  it('should ask before replacing a custom style', async () => {
    vi.mocked(modalManager.showDialog).mockResolvedValue(false);
    const book = bookDetailFactory.build({ style: { ...soft.style, textColor: '#000000' } });

    renderMenu({ book, onUpdated });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitemradio', { name: /book_style_preset_bold/ }));

    await waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
    expect(sdkMock.updateBook).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });
});
