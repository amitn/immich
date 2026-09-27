/**
 * "Ask your library" from the search bar: a question gets the usual results at once, and an answer of the assistant
 * beside them. Questions are told apart from searches without AI: a question mark, or a question word first.
 */

const QUESTION_WORDS = new Set([
  'what',
  "what's",
  'whats',
  'which',
  'when',
  'where',
  "where's",
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'did',
  'do',
  'does',
  'is',
  'are',
  'was',
  'were',
  'have',
  'has',
  'can',
  'could',
  'should',
  'would',
  'will',
]);

/** at least this many words, so that "who" or "when" alone stay a search */
const MIN_QUESTION_WORDS = 2;

export const isQuestion = (text: string | undefined | null) => {
  const value = (text ?? '').trim();
  if (!value) {
    return false;
  }
  if (value.includes('?')) {
    return true;
  }
  const words = value.toLowerCase().replaceAll('’', "'").split(/\s+/);
  return words.length >= MIN_QUESTION_WORDS && QUESTION_WORDS.has(words[0]);
};

/** the line an answer ends with (see `ANSWER_SOURCES_PREFIX` on the server) */
export const ANSWER_SOURCES_PREFIX = 'Sources:';

const UUID = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gi;

export type ParsedAnswer = {
  /** the answer without its sources line */
  text: string;
  /** the photos the answer rests on */
  photoIds: string[];
  /** the collection tags it used, e.g. Food/Noma Australia */
  tags: string[];
};

/**
 * Splits the sources line off an answer: "Sources: photos <id>, <id>; tags Food/Noma Australia". Photos named in the
 * text are cited too; an answer still streaming may have no sources line yet
 */
export const parseAnswer = (answer: string | undefined): ParsedAnswer => {
  const lines = (answer ?? '').trimEnd().split('\n');
  const index = lines.findLastIndex((line) =>
    line
      .trim()
      .replace(/^[*_]+/, '')
      .startsWith(ANSWER_SOURCES_PREFIX),
  );
  const sources = index === -1 ? '' : lines.slice(index).join(' ');
  const text = (index === -1 ? lines : lines.slice(0, index)).join('\n').trim();

  const tagPart = /\btags?\b:?\s*(.*)$/i.exec(sources.replaceAll(UUID, ''))?.[1] ?? '';
  const tags = tagPart
    .split(/[,;]/)
    .map((tag) =>
      tag
        .replaceAll(/[*_`.]+$/g, '')
        .replaceAll(/^[*_`\s]+/g, '')
        .trim(),
    )
    .filter((tag) => tag.includes('/'));

  const photoIds = [...new Set([...sources.matchAll(UUID), ...text.matchAll(UUID)].map(([id]) => id.toLowerCase()))];
  // ids in the text are shown as photos, not as text
  const readable = text
    .replaceAll(
      /\s*\(?\s*(?:photo(?:Id)?s?:?\s*)?(?:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}[,\s]*)+\)?/gi,
      ' ',
    )
    .replaceAll(/ {2,}/g, ' ')
    .replaceAll(/ ([.,;:])/g, '$1')
    .trim();

  return { text: readable, photoIds, tags: [...new Set(tags)] };
};
