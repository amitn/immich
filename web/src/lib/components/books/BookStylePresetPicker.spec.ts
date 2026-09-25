import { BookStylePreset } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { resetBookStylePresets } from '$lib/utils/book-style';
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
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual(['soft', 'classic', 'bold']);
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

  it('should start from the given preset', () => {
    render(BookStylePresetPicker, { props: { value: BookStylePreset.Classic } });

    expect(screen.getByRole('radio', { name: /book_style_preset_classic/ })).toBeChecked();
  });

  it('should draw the swatches with the colors and margins of the presets', async () => {
    const { container } = render(BookStylePresetPicker);

    await waitFor(() => expect(screen.getAllByText('book_style_margins')).toHaveLength(3));
    const swatches = [...container.querySelectorAll<HTMLElement>('label > span[aria-hidden="true"]')];
    expect(swatches.map((swatch) => swatch.style.backgroundColor)).toEqual([
      '#f6f1e7',
      '#ffffff',
      '#ffffff',
    ]);
    expect(sdkMock.getBookStylePresets).toHaveBeenCalledTimes(1);
  });

  it('should still offer the presets when they cannot be loaded', async () => {
    sdkMock.getBookStylePresets.mockRejectedValue(new Error('offline'));

    render(BookStylePresetPicker);

    await waitFor(() => expect(sdkMock.getBookStylePresets).toHaveBeenCalled());
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByText('book_style_margins')).not.toBeInTheDocument();
  });
});
