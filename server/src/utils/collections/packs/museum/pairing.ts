import { SubjectAssigner, SubjectMatch, matchSubjects } from 'src/utils/collections/match.js';

/**
 * The museum pack's assignment of the artworks to the entries of the wall labels: what CLIP sees of each artwork and
 * each label entry, weighed by the sequence of the photos (a label is photographed a few seconds after its artwork, or
 * before it), see `MatchOptions.sequence` (in the pack's match options). Artworks that smart search has not seen yet
 * are left for the reader to name.
 */
export const assignArtworks: SubjectAssigner = (photos, entries, options) => {
  const seen = photos.filter((photo) => photo.embedding.length > 0);
  const candidates = entries.every((entry) => entry.embedding)
    ? entries.map(({ embedding, sourceTime }) => ({
        embedding: embedding!,
        ...(sourceTime !== undefined && { sourceTime }),
      }))
    : [];
  const result = matchSubjects(seen, candidates, options);
  const unseen: SubjectMatch[] = photos
    .filter((photo) => photo.embedding.length === 0)
    .map((photo) => ({ ids: [photo.id], score: 0, unsure: true, suggestions: [] }));
  return { ...result, matches: [...result.matches, ...unseen] };
};
