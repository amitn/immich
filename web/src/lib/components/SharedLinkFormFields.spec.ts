import userEvent from '@testing-library/user-event';
import { renderWithTooltips } from '$tests/helpers';
import SharedLinkFormFields from './SharedLinkFormFields.svelte';

describe('SharedLinkFormFields component', () => {
  const isChecked = (element: Element) =>
    element instanceof HTMLInputElement ? element.checked : element.getAttribute('aria-checked') === 'true';

  it('turns downloads off when metadata is disabled', async () => {
    const { container } = renderWithTooltips(SharedLinkFormFields, {
      slug: '',
      password: '',
      description: '',
      allowDownload: true,
      allowUpload: false,
      showMetadata: true,
      expiresAt: null,
    });
    const user = userEvent.setup();

    const switches = Array.from(container.querySelectorAll('[role="switch"], input[type="checkbox"]'));
    expect(switches).toHaveLength(3);

    const [showMetadataSwitch, allowDownloadSwitch] = switches;
    expect(isChecked(allowDownloadSwitch)).toBe(true);

    await user.click(showMetadataSwitch);

    expect(isChecked(showMetadataSwitch)).toBe(false);
    expect(isChecked(allowDownloadSwitch)).toBe(false);
  });

  it('keeps the PDF download of a book when metadata is disabled, and never offers uploads', async () => {
    const { container } = renderWithTooltips(SharedLinkFormFields, {
      slug: '',
      password: '',
      description: '',
      allowDownload: true,
      allowUpload: false,
      showMetadata: true,
      expiresAt: null,
      isBook: true,
    });
    const user = userEvent.setup();

    const switches = Array.from(container.querySelectorAll('[role="switch"], input[type="checkbox"]'));
    expect(switches).toHaveLength(2);
    expect(container.textContent).toContain('book_share_allow_pdf_download');
    expect(container.textContent).not.toContain('allow_public_user_to_upload');

    const [showMetadataSwitch, allowDownloadSwitch] = switches;
    await user.click(showMetadataSwitch);

    expect(isChecked(showMetadataSwitch)).toBe(false);
    expect(isChecked(allowDownloadSwitch)).toBe(true);
  });
});
