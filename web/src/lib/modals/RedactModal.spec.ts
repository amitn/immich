import {
  RedactionKind,
  RedactionReason,
  RedactionStyle,
  type RedactionRegionDto,
  type RedactionSuggestionResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { assetFactory } from '@test-data/factories/asset-factory';
import RedactModal from './RedactModal.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// #14: the redaction editor shows the suggested regions as boxes to turn on and off, takes drawn boxes, previews the
// result and saves a copy

const region = (overrides: Partial<RedactionRegionDto>): RedactionRegionDto => ({
  id: 'face:1',
  kind: RedactionKind.Face,
  reason: RedactionReason.Unknown,
  selected: true,
  x: 0.1,
  y: 0.1,
  width: 0.2,
  height: 0.2,
  ...overrides,
});

const suggestion = (regions: RedactionRegionDto[]): RedactionSuggestionResponseDto => ({
  assetId: 'asset-1',
  width: 2000,
  height: 1000,
  regions,
  hasFaces: regions.some(({ kind }) => kind === RedactionKind.Face),
  hasText: false,
  scene: null,
});

describe('RedactModal component', () => {
  const onClose = vi.fn();
  const asset = assetFactory.build({ id: 'asset-1', originalFileName: 'IMG_0001.jpg' });
  const kept = region({ id: 'face:alice', personName: 'Alice', reason: RedactionReason.Kept, selected: false });
  const stranger = region({ id: 'face:2', x: 0.5 });
  const plate = region({
    id: 'text:3',
    kind: RedactionKind.Plate,
    reason: RedactionReason.Plate,
    text: 'AB12 CDE',
    y: 0.8,
  });

  beforeEach(() => {
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    URL.createObjectURL = vi.fn(() => 'blob:redacted');
    URL.revokeObjectURL = vi.fn();
    sdkMock.suggestRedactions.mockResolvedValue(suggestion([kept, stranger, plate]));
    sdkMock.renderRedactionPreview.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  const save = () => screen.getByRole('button', { name: 'redact_save' });

  it('should show the suggestions as boxes, the kept people off', async () => {
    render(RedactModal, { props: { asset, onClose } });

    const alice = await screen.findByRole('button', { name: 'redact_kind_face · Alice' });
    expect(alice).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'redact_kind_face' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'redact_kind_plate · AB12 CDE' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // placed by fractions of the photo
    expect(alice.style.left).toBe('10%');
    expect(screen.getByRole('checkbox', { name: 'redact_kind_face · Alice' })).not.toBeChecked();
    expect(sdkMock.suggestRedactions).toHaveBeenCalledWith({ id: asset.id, redactionSuggestDto: {} });
    expect(save()).toBeEnabled();
  });

  it('should save the selected areas as a copy, and open it', async () => {
    sdkMock.redactAsset.mockResolvedValue({
      id: 'copy-1',
      sourceId: asset.id,
      regionCount: 2,
      description: '2 faces',
      duplicate: false,
    });
    render(RedactModal, { props: { asset, onClose } });

    // Alice too, and pixelated; but not the plate
    await fireEvent.click(await screen.findByRole('button', { name: 'redact_kind_face · Alice' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'redact_kind_plate · AB12 CDE' }));
    await fireEvent.click(screen.getByLabelText('redact_style_pixelate'));
    await fireEvent.click(save());

    await waitFor(() => expect(sdkMock.redactAsset).toHaveBeenCalled());
    expect(sdkMock.redactAsset).toHaveBeenCalledWith({
      id: asset.id,
      redactionCreateDto: {
        regions: [
          { x: 0.1, y: 0.1, width: 0.2, height: 0.2, kind: RedactionKind.Face },
          { x: 0.5, y: 0.1, width: 0.2, height: 0.2, kind: RedactionKind.Face },
        ],
        style: RedactionStyle.Pixelate,
      },
    });
    expect(await screen.findByText('redact_done')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(onClose).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith('/photos/copy-1');
  });

  it('should take a drawn box, and remove it', async () => {
    sdkMock.suggestRedactions.mockResolvedValue(suggestion([]));
    render(RedactModal, { props: { asset, onClose } });

    expect(await screen.findByText('redact_no_suggestions')).toBeInTheDocument();
    expect(save()).toBeDisabled();

    await fireEvent.click(screen.getByRole('button', { name: 'redact_draw' }));
    const canvas = screen.getByTestId('redact-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await fireEvent.pointerDown(canvas, { clientX: 20, clientY: 10, pointerId: 1 });
    await fireEvent.pointerMove(canvas, { clientX: 60, clientY: 50, pointerId: 1 });
    await fireEvent.pointerUp(canvas, { clientX: 60, clientY: 50, pointerId: 1 });

    const box = await screen.findByRole('button', { name: 'redact_kind_manual' });
    expect(box.style.left).toBe('10%');
    expect(box.style.width).toBe('20%');
    expect(box.style.height).toBe('40%');
    expect(save()).toBeEnabled();
    expect(screen.getByText('redact_selected_count')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'redact_remove_area' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'redact_kind_manual' })).not.toBeInTheDocument());
    expect(save()).toBeDisabled();
  });

  it('should preview the result rendered by the server', async () => {
    render(RedactModal, { props: { asset, onClose } });
    await screen.findByRole('button', { name: 'redact_kind_face · Alice' });

    await fireEvent.click(screen.getByRole('button', { name: 'redact_preview' }));

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'redact_preview' })).toHaveAttribute('src', 'blob:redacted'),
    );
    expect(sdkMock.renderRedactionPreview).toHaveBeenCalledWith({
      id: asset.id,
      redactionPreviewDto: {
        regions: [
          { x: 0.5, y: 0.1, width: 0.2, height: 0.2, kind: RedactionKind.Face },
          { x: 0.1, y: 0.8, width: 0.2, height: 0.2, kind: RedactionKind.Plate },
        ],
        style: RedactionStyle.Blur,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'redact_edit' }));
    expect(await screen.findByRole('button', { name: 'redact_kind_face · Alice' })).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:redacted');
  });

  it('should tell why a copy could not be made', async () => {
    sdkMock.redactAsset.mockRejectedValue(new Error('boom'));
    render(RedactModal, { props: { asset, onClose } });
    await screen.findByRole('button', { name: 'redact_kind_face · Alice' });

    await fireEvent.click(save());
    expect(await screen.findByText('errors.unable_to_redact_photo')).toBeInTheDocument();
  });
});
