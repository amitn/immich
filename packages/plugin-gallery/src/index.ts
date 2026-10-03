import { wrapper } from '@immich/plugin-sdk';
import type { Manifest } from '../dist/index.d.ts';
import { gallery } from './host.js';

/** true when `value` is the tag `path` or a tag under it, e.g. Food/Noma/Tartare is under Food and Food/Noma */
const isTagUnder = (value: string, path: string) => {
  const tag = value.toLowerCase();
  // es2020 (quickjs): no String.replaceAll
  const target = path
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  return target.length > 0 && (tag === target || tag.startsWith(`${target}/`));
};

const methods = wrapper<Manifest>({
  assetTagPathFilter: ({ data, config }) => {
    const hasTag = data.asset.tags.some(({ value }) => isTagUnder(value, config.tag));
    return { workflow: { continue: config.inverse ? !hasTag : hasTag } };
  },

  addToSpace: ({ data, config, workflow }) => {
    gallery(workflow.authToken)('addToSpace', {
      assetId: data.asset.id,
      spaceIds: config.spaceIds,
    });

    return {};
  },

  addToSpaceAlbum: ({ data, config, workflow }) => {
    gallery(workflow.authToken)('addToSpaceAlbum', {
      assetId: data.asset.id,
      spaceId: config.spaceId,
      albumName: config.albumName,
    });

    return {};
  },
});

const {
  assetTagPathFilter,
  addToSpace,
  addToSpaceAlbum,

  // should be empty. ensures that every field is destructured
  ...rest
} = methods;

export { addToSpace, addToSpaceAlbum, assetTagPathFilter };

'All methods must be destructured and exported' satisfies string & typeof rest;
