import { BookStylePreset } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component, ComponentProps } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import StyleCreatorModal from '$lib/modals/StyleCreatorModal.svelte';
import { resetBookStylePresets } from '$lib/utils/book-style';
import { bookDetailFactory, bookUserStyleFactory } from '@test-data/factories/book-factory';
import { bookStylePresets } from '@test-data/factories/book-review-factory';
import BookStyleMenu from './BookStyleMenu.svelte';

const { flags } = vi.hoisted(() => ({ flags: { assistant: true } }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: flags } as never,
}));

const [classic, soft, , food] = bookStylePresets;

type Props = ComponentProps<typeof BookStyleMenu>;
/** TestWrapper provides the tooltips of the menu button */
type WrapperProps = { component: Component<Props>; componentProps: Props };

describe('BookStyleMenu component', () => {
  const onUpdated = vi.fn();

  const renderMenu = (props: Props) =>
    render(TestWrapper as Component<WrapperProps>, {
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
      expect.stringContaining('book_style_preset_food'),
    ]);
    expect(entries.map((entry) => entry.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
  });

  it('should label the button like the other header buttons', async () => {
    const book = bookDetailFactory.build({ style: { ...soft.style } });

    renderMenu({ book, onUpdated });
    const button = await screen.findByRole('button', { name: 'book_style_current' });

    expect(button).toHaveTextContent('book_style');
    expect(button).toHaveAttribute('aria-haspopup', 'true');
  });

  it('should theme the menu for dark mode', async () => {
    const book = bookDetailFactory.build({ style: { ...soft.style } });

    renderMenu({ book, onUpdated });
    const [entry] = await openMenu();

    expect(entry).toHaveClass('dark:bg-neutral-900', 'dark:text-immich-dark-fg');
    expect(screen.getByRole('menu').parentElement).toHaveClass('dark:bg-neutral-900');
  });

  it('should show a custom style', async () => {
    const book = bookDetailFactory.build({ style: { ...soft.style, marginMm: 15 } });

    renderMenu({ book, onUpdated });
    const entries = await openMenu();

    expect(entries).toHaveLength(5);
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

  it('should say which style is being applied and leave the confirmation to the viewer', async () => {
    const book = bookDetailFactory.build({ style: { ...soft.style } });
    const onApplying = vi.fn();
    sdkMock.updateBook.mockResolvedValue({ ...book, style: { ...classic.style } });

    renderMenu({ book, onUpdated, onApplying });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitemradio', { name: /book_style_preset_classic/ }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(onApplying).toHaveBeenCalledWith('book_style_preset_classic');
    expect(toastManager.success).not.toHaveBeenCalled();
  });

  it('should stop applying a style that could not be saved', async () => {
    const book = bookDetailFactory.build({ style: { ...soft.style } });
    const onApplying = vi.fn();
    sdkMock.updateBook.mockRejectedValue(new Error('offline'));
    vi.spyOn(toastManager, 'danger').mockImplementation(() => {});

    renderMenu({ book, onUpdated, onApplying });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitemradio', { name: /book_style_preset_classic/ }));

    await waitFor(() => expect(onApplying).toHaveBeenLastCalledWith());
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('should apply the food preset and mark it', async () => {
    const book = bookDetailFactory.build({ style: { ...soft.style } });
    const updated = { ...book, style: { ...food.style } };
    sdkMock.updateBook.mockResolvedValue(updated);

    renderMenu({ book, onUpdated });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitemradio', { name: /book_style_preset_food/ }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
    expect(sdkMock.updateBook).toHaveBeenCalledWith({ id: book.id, bookUpdateDto: { stylePreset: 'food' } });
  });

  it('should mark the food preset of a food book', async () => {
    const book = bookDetailFactory.build({ style: { ...food.style } });

    renderMenu({ book, onUpdated });
    const entries = await openMenu();

    expect(entries.map((entry) => entry.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true']);
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

  describe('your styles', () => {
    const wedding = bookUserStyleFactory.build({ name: 'Wedding', description: 'Ivory, sage and gold' });

    beforeEach(() => {
      flags.assistant = true;
      sdkMock.getBookUserStyles.mockResolvedValue([wedding]);
    });

    it("should list the user's own styles after the presets", async () => {
      const book = bookDetailFactory.build({ style: { ...soft.style } });

      renderMenu({ book, onUpdated });
      const entries = await openMenu();

      expect(screen.getByText('book_style_yours')).toBeInTheDocument();
      expect(entries.at(-1)).toHaveTextContent('Wedding');
      expect(entries.at(-1)).toHaveTextContent('Ivory, sage and gold');
      expect(entries.at(-1)).toHaveAttribute('aria-checked', 'false');
    });

    it('should apply a style of your own like a preset', async () => {
      const book = bookDetailFactory.build({ style: { ...soft.style } });
      const updated = { ...book, style: { ...wedding.style } };
      sdkMock.updateBook.mockResolvedValue(updated);

      renderMenu({ book, onUpdated });
      await openMenu();
      await fireEvent.click(screen.getByRole('menuitemradio', { name: /Wedding/ }));

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
      expect(sdkMock.updateBook).toHaveBeenCalledWith({ id: book.id, bookUpdateDto: { styleId: wedding.id } });
      expect(modalManager.showDialog).not.toHaveBeenCalled();
    });

    it('should mark the style of your own the book uses instead of showing a custom style', async () => {
      const book = bookDetailFactory.build({ style: { ...wedding.style } });

      renderMenu({ book, onUpdated });
      const entries = await openMenu();

      expect(entries.some((entry) => entry.textContent?.includes('book_style_custom'))).toBe(false);
      expect(screen.getByRole('menuitemradio', { name: /Wedding/ })).toHaveAttribute('aria-checked', 'true');
    });

    it('should open the style creator for the book', async () => {
      const show = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
      const book = bookDetailFactory.build({ style: { ...soft.style } });

      renderMenu({ book, onUpdated });
      await openMenu();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'style_creator_create_with_assistant' }));

      expect(show).toHaveBeenCalledWith(StyleCreatorModal, { target: { kind: 'book', book } });
    });

    it('should not offer the assistant when it is disabled', async () => {
      flags.assistant = false;
      const book = bookDetailFactory.build({ style: { ...soft.style } });

      renderMenu({ book, onUpdated });
      await openMenu();

      expect(screen.queryByRole('menuitem', { name: 'style_creator_create_with_assistant' })).not.toBeInTheDocument();
    });
  });
});
