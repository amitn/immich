import { getCollageRoute } from '$lib/utils/collage';

describe('getCollageRoute', () => {
  it('should open a collage over its album, or in the timeline', () => {
    expect(getCollageRoute('asset-id', 'album-id')).toBe('/albums/album-id/photos/asset-id');
    expect(getCollageRoute('asset-id')).toBe('/photos/asset-id');
  });

  it('should open a collage over an album of a space in that space', () => {
    expect(getCollageRoute('asset-id', 'album-id', 'space-id')).toBe(
      '/spaces/space-id/albums/album-id/photos/asset-id',
    );
  });
});
