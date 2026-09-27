import { BookStylePreset } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { BOOK_STYLE_PRESETS, resetBookStylePresets } from '$lib/utils/book-style';
import { bookUserStyleFactory } from '@test-data/factories/book-factory';
import { bookStylePresets } from '@test-data/factories/book-review-factory';
import BookStylePresetPicker from './BookStylePresetPicker.svelte';

describe('BookStylePresetPicker component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetBookStylePresets();
    sdkMock.getBookStylePresets.mockResolvedValue(bookStylePresets);
  });

  it('should offer the presets and choose soft by default', () => {
    render(BookStylePresetPicker);

    const radios = screen.getAllByRole('radio');
    // the built-in presets, food, then the presets of the other collection packs
    const values = radios.map((radio) => radio.getAttribute('value'));
    expect(values.slice(0, 4)).toEqual(['soft', 'classic', 'bold', 'food']);
    expect(values).toEqual([...BOOK_STYLE_PRESETS]);
    expect(screen.getByRole('radio', { name: /book_style_preset_soft/ })).toBeChecked();
    expect(screen.getByText('book_style_preset_soft_description')).toBeInTheDocument();
  });

  it('should select another preset', async () => {
    render(BookStylePresetPicker);

    await fireEvent.click(screen.getByRole('radio', { name: /book_style_preset_bold/ }));

    expect(screen.getByRole('radio', { name: /book_style_preset_bold/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /book_style_preset_soft/ })).not.toBeChecked();
    expect(screen.getByText('book_style_preset_bold_description')).toBeInTheDocument();
  });

  it('should offer the food preset', async () => {
    render(BookStylePresetPicker);

    await fireEvent.click(screen.getByRole('radio', { name: /book_style_preset_food/ }));

    expect(screen.getByRole('radio', { name: /book_style_preset_food/ })).toBeChecked();
    expect(screen.getByText('book_style_preset_food_description')).toBeInTheDocument();
  });

  it('should start from the given preset', () => {
    render(BookStylePresetPicker, { props: { value: BookStylePreset.Classic } });

    expect(screen.getByRole('radio', { name: /book_style_preset_classic/ })).toBeChecked();
  });

  it('should draw the swatches with the colors and margins of the presets', async () => {
    const { container } = render(BookStylePresetPicker);

    await waitFor(() => expect(screen.getAllByText('book_style_margins')).toHaveLength(4));
    const swatches = [...container.querySelectorAll<HTMLElement>(':scope label > span[aria-hidden="true"]')];
    expect(swatches.slice(0, 4).map((swatch) => swatch.style.backgroundColor)).toEqual([
      '#f6f1e7',
      '#ffffff',
      '#ffffff',
      '#f6f0e4',
    ]);
    // the food swatch looks like a printed menu
    expect(swatches.slice(0, 4).map((swatch) => swatch.dataset.look)).toEqual(['plain', 'plain', 'plain', 'printed']);
    expect(swatches[3].textContent).toContain('Aa');
    expect(sdkMock.getBookStylePresets).toHaveBeenCalledTimes(1);
  });

  it('should still offer the presets when they cannot be loaded', async () => {
    sdkMock.getBookStylePresets.mockRejectedValue(new Error('offline'));

    render(BookStylePresetPicker);

    await waitFor(() => expect(sdkMock.getBookStylePresets).toHaveBeenCalled());
    expect(screen.getAllByRole('radio')).toHaveLength(BOOK_STYLE_PRESETS.length);
    expect(screen.queryByText('book_style_margins')).not.toBeInTheDocument();
  });

  describe('your styles', () => {
    it("should offer the user's own styles after the presets", async () => {
      const wedding = bookUserStyleFactory.build({ name: 'Wedding', description: 'Ivory, sage and gold' });
      sdkMock.getBookUserStyles.mockResolvedValue([wedding]);
      const onUserStyles = vi.fn();

      render(BookStylePresetPicker, { props: { onUserStyles } });

      const radio = await screen.findByRole('radio', { name: /Wedding/ });
      expect(radio).toHaveAttribute('value', wedding.id);
      expect(screen.getByText('book_style_yours')).toBeInTheDocument();
      expect(onUserStyles).toHaveBeenCalledWith([wedding]);

      await fireEvent.click(radio);
      expect(radio).toBeChecked();
      expect(screen.getByText('Ivory, sage and gold')).toBeInTheDocument();
    });

    it('should hide the section without styles of your own', async () => {
      sdkMock.getBookUserStyles.mockResolvedValue([]);

      render(BookStylePresetPicker);

      await waitFor(() => expect(sdkMock.getBookUserStyles).toHaveBeenCalled());
      expect(screen.queryByText('book_style_yours')).not.toBeInTheDocument();
    });

    it('should offer to create a style with the assistant', async () => {
      const onCreateWithAssistant = vi.fn();

      render(BookStylePresetPicker, { props: { onCreateWithAssistant } });
      await fireEvent.click(screen.getByRole('button', { name: 'style_creator_create_with_assistant' }));

      expect(onCreateWithAssistant).toHaveBeenCalled();
    });

    it('should not offer the assistant without a handler', () => {
      render(BookStylePresetPicker);
      expect(screen.queryByRole('button', { name: 'style_creator_create_with_assistant' })).not.toBeInTheDocument();
    });
  });
});
