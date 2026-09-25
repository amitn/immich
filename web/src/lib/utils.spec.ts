import { AssetTypeEnum, BookExportFormat } from '@immich/sdk';
import { getAssetUrl, getBookExportUrl, getBookPageRenderUrl, getBookPreviewUrl, semverToName } from '$lib/utils';
import { assetFactory } from '@test-data/factories/asset-factory';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';

describe('utils', () => {
  describe(getAssetUrl.name, () => {
    it('should return thumbnail URL for static images', () => {
      const asset = assetFactory.build({
        originalPath: 'image.jpg',
        originalMimeType: 'image/jpeg',
        type: AssetTypeEnum.Image,
      });

      const url = getAssetUrl({ asset });

      // Should return a thumbnail URL (contains /thumbnail)
      expect(url).toContain('/thumbnail');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL for static gifs', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
      });

      const url = getAssetUrl({ asset });

      expect(url).toContain('/thumbnail');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL for static webp images', () => {
      const asset = assetFactory.build({
        originalPath: 'image.webp',
        originalMimeType: 'image/webp',
        type: AssetTypeEnum.Image,
      });

      const url = getAssetUrl({ asset });

      expect(url).toContain('/thumbnail');
      expect(url).toContain(asset.id);
    });

    it('should return original URL for animated gifs', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
        duration: 2000,
      });

      const url = getAssetUrl({ asset });

      // Should return original URL (contains /original)
      expect(url).toContain('/original');
      expect(url).toContain(asset.id);
    });

    it('should return original URL for animated webp images', () => {
      const asset = assetFactory.build({
        originalPath: 'image.webp',
        originalMimeType: 'image/webp',
        type: AssetTypeEnum.Image,
        duration: 2000,
      });

      const url = getAssetUrl({ asset });

      expect(url).toContain('/original');
      expect(url).toContain(asset.id);
    });

    it('should return original URL for video assets with forceOriginal', () => {
      const asset = assetFactory.build({
        originalPath: 'video.mp4',
        originalMimeType: 'video/mp4',
        type: AssetTypeEnum.Video,
      });

      const url = getAssetUrl({ asset, forceOriginal: true });

      expect(url).toContain('/original');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL for video assets without forceOriginal', () => {
      const asset = assetFactory.build({
        originalPath: 'video.mp4',
        originalMimeType: 'video/mp4',
        type: AssetTypeEnum.Video,
      });

      const url = getAssetUrl({ asset });

      expect(url).toContain('/thumbnail');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL for static images in shared link even with download and showMetadata permissions', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
      });
      const sharedLink = sharedLinkFactory.build({ allowDownload: true, showMetadata: true, assets: [asset] });

      const url = getAssetUrl({ asset, sharedLink });

      expect(url).toContain('/thumbnail');
      expect(url).toContain(asset.id);
    });

    it('should return original URL for animated images in shared link with download and showMetadata permissions', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
        duration: 2000,
      });
      const sharedLink = sharedLinkFactory.build({ allowDownload: true, showMetadata: true, assets: [asset] });

      const url = getAssetUrl({ asset, sharedLink });

      expect(url).toContain('/original');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL (not original) for animated images when shared link download permission is false', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
        duration: 2000,
      });
      const sharedLink = sharedLinkFactory.build({ allowDownload: false, assets: [asset] });

      const url = getAssetUrl({ asset, sharedLink });

      expect(url).toContain('/thumbnail');
      expect(url).not.toContain('/original');
      expect(url).toContain(asset.id);
    });

    it('should return thumbnail URL (not original) for animated images when shared link showMetadata permission is false', () => {
      const asset = assetFactory.build({
        originalPath: 'image.gif',
        originalMimeType: 'image/gif',
        type: AssetTypeEnum.Image,
        duration: 2000,
      });
      const sharedLink = sharedLinkFactory.build({ showMetadata: false, assets: [asset] });

      const url = getAssetUrl({ asset, sharedLink });

      expect(url).toContain('/thumbnail');
      expect(url).not.toContain('/original');
      expect(url).toContain(asset.id);
    });
  });

  describe('book urls', () => {
    it('should point to the export files', () => {
      expect(getBookExportUrl({ id: 'book-1', format: BookExportFormat.Pdf })).toBe('/api/books/book-1/pdf');
      expect(getBookExportUrl({ id: 'book-1', format: BookExportFormat.Html })).toBe('/api/books/book-1/html');
    });

    it('should render a page at the requested size', () => {
      expect(getBookPageRenderUrl({ id: 'book-1', pageId: 'page-1' })).toBe(
        '/api/books/book-1/pages/page-1/render?size=1200',
      );
      expect(getBookPageRenderUrl({ id: 'book-1', pageId: 'page-1', size: 300, cacheKey: 'v2' })).toBe(
        '/api/books/book-1/pages/page-1/render?size=300&c=v2',
      );
    });

    it('should point to the preview', () => {
      expect(getBookPreviewUrl({ id: 'book-1' })).toBe('/api/books/book-1/preview');
      expect(getBookPreviewUrl({ id: 'book-1', cacheKey: '2026-09-25T10:00:00.000Z' })).toBe(
        '/api/books/book-1/preview?v=2026-09-25T10%3A00%3A00.000Z',
      );
    });
  });

  describe('semverToName', () => {
    it('should not append release candidate tag if prelease is not set', () => {
      expect(semverToName({ major: 3, minor: 0, patch: 0, prerelease: null })).toEqual('v3.0.0');
    });

    it('should append release candidate if set', () => {
      expect(semverToName({ major: 3, minor: 0, patch: 0, prerelease: 0 })).toEqual('v3.0.0-rc.0');
    });
  });
});
