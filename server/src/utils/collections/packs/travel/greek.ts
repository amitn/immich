/**
 * Greek print as OCR trained on Latin and CJK text reads it: "KTEA XANISN-PEOYMNOY" for "ΚΤΕΛ ΧΑΝΙΩΝ-ΡΕΘΥΜΝΟΥ", Latin
 * letters that look like the Greek ones. Such words are mapped back to Greek capitals (the likeliest letter for each
 * lookalike) and transliterated to Latin, so that "XANIA" reads "Chania". Letters that look alike in Greek (Α, Λ and
 * Δ all read as A) can't be told apart, so names come out close, not always right: callers flag them.
 */

/** the Greek capital each Latin (or misread) letter most likely is */
const LOOKALIKES: Record<string, string> = {
  A: 'Α',
  B: 'Β',
  E: 'Ε',
  Z: 'Ζ',
  H: 'Η',
  I: 'Ι',
  K: 'Κ',
  M: 'Μ',
  N: 'Ν',
  O: 'Ο',
  P: 'Ρ',
  T: 'Τ',
  Y: 'Υ',
  X: 'Χ',
  // Ω, Φ, Π, Γ, Λ, Σ... are read as other letters or pairs
  Q: 'Ω',
  W: 'Ω',
  Φ: 'Φ',
  Ω: 'Ω',
  Π: 'Π',
  Γ: 'Γ',
  Λ: 'Λ',
  Σ: 'Σ',
  Δ: 'Δ',
  Θ: 'Θ',
  Ξ: 'Ξ',
  Ψ: 'Ψ',
};

/** Latin letters that no Greek capital looks like: a word with one of them is Latin ("SOUGIA", "BUS") */
const LATIN_ONLY = /[CDFGJLRSUV]/;

/** words of English (and label) text that are made only of Greek lookalikes and stay as they are */
const LATIN_WORDS = new Set([
  'A',
  'AE',
  'AM',
  'AN',
  'AT',
  'BE',
  'BY',
  'EXIT',
  'HOTEL',
  'IN',
  'INN',
  'IT',
  'KEY',
  'MAN',
  'MAP',
  'MAY',
  'ME',
  'MEN',
  'MINI',
  'NAME',
  'NO',
  'NOTE',
  'NOT',
  'ON',
  'ONE',
  'OK',
  'PM',
  'TAXI',
  'TIME',
  'TO',
  'TOKEN',
  'TOP',
  'TOTAL',
  'TOY',
  'YEN',
  'ZONE',
]);

const GREEK = /\p{Script=Greek}/u;

/**
 * whether a word may be Greek read as Latin lookalikes: capitals only, no letter that is only Latin, and some sign of
 * Greek (a Greek capital, or a letter pair typical of Greek such as OY or a final E for Σ); on a document known to be
 * Greek (`context`), any such word that is not English
 */
export const isGreekLookalike = (word: string, context = false) =>
  word.length >= 3 &&
  /^\p{Lu}+$/u.test(word) &&
  !LATIN_ONLY.test(word) &&
  !LATIN_WORDS.has(word) &&
  (context || GREEK.test(word) || /OY|YO|HM|HN|KT|NK|PX|XP|AE$|OE$|HE$/.test(word) || /[XY]/.test(word));

/**
 * Greek capitals from lookalike Latin letters. Σ is read as E: at the end of a word after a vowel (ΟΣ, ΗΣ, ΑΣ) and at
 * its start before Α or Ο (ΣΑ and ΣΟ are common, ΕΑ and ΕΟ rare)
 */
export const toGreek = (word: string) =>
  [...word]
    .map((char, index) => {
      if (char === 'E' && index === word.length - 1 && index > 0 && /[AOHIY]/.test(word[index - 1])) {
        return 'Σ';
      }
      if (char === 'E' && index === 0 && /[AO]/.test(word[1] ?? '')) {
        return 'Σ';
      }
      // "SN" and "ISN" are how OCR reads Ω
      return LOOKALIKES[char] ?? char;
    })
    .join('')
    .replaceAll('ΙΣΝ', 'ΙΩΝ');

const DIGRAPHS: Array<[string, string]> = [
  ['ΟΥ', 'ou'],
  ['ΑΙ', 'ai'],
  ['ΕΙ', 'ei'],
  ['ΟΙ', 'oi'],
  ['ΑΥ', 'av'],
  ['ΕΥ', 'ev'],
  ['ΓΓ', 'ng'],
  ['ΓΚ', 'gk'],
  ['ΜΠ', 'mp'],
  ['ΝΤ', 'nt'],
];

const LETTERS: Record<string, string> = {
  Α: 'a',
  Β: 'v',
  Γ: 'g',
  Δ: 'd',
  Ε: 'e',
  Ζ: 'z',
  Η: 'i',
  Θ: 'th',
  Ι: 'i',
  Κ: 'k',
  Λ: 'l',
  Μ: 'm',
  Ν: 'n',
  Ξ: 'x',
  Ο: 'o',
  Π: 'p',
  Ρ: 'r',
  Σ: 's',
  Τ: 't',
  Υ: 'y',
  Φ: 'f',
  Χ: 'ch',
  Ψ: 'ps',
  Ω: 'o',
};

/** "ΧΑΝΙΑ" → "Chania", "ΣΟΥΓΙΑ" → "Sougia" (ELOT 743, simplified) */
export const transliterateGreek = (text: string) => {
  const upper = text
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toUpperCase();
  let result = '';
  for (let index = 0; index < upper.length;) {
    const pair = DIGRAPHS.find(([greek]) => upper.startsWith(greek, index));
    if (pair) {
      result += pair[1];
      index += 2;
      continue;
    }
    const char = upper[index];
    result += LETTERS[char] ?? char.toLowerCase();
    index++;
  }
  // capitalize every word
  return result.replaceAll(/(^|[\s-])(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
};

/** whether a text has Greek letters */
export const hasGreek = (text: string) => /\p{Script=Greek}/u.test(text);

/**
 * A place or company name as printed on a Greek document, in Latin letters: Greek capitals are transliterated, words
 * read as Latin lookalikes are mapped back to Greek first, and Latin words are kept (title case). `lookalike` says
 * whether any word was decoded from lookalikes, so the name may be misspelled.
 */
export const readGreekName = (text: string, context = true): { name: string; lookalike: boolean } => {
  let lookalike = false;
  const name = text
    .split(/(\s+|-)/)
    .map((part) => {
      if (!/\p{L}/u.test(part)) {
        return part;
      }
      if (hasGreek(part)) {
        return transliterateGreek(toGreek(part.toUpperCase()));
      }
      if (isGreekLookalike(part, context)) {
        lookalike = true;
        return transliterateGreek(toGreek(part));
      }
      return part === part.toUpperCase() ? part.charAt(0) + part.slice(1).toLowerCase() : part;
    })
    .join('');
  return { name, lookalike };
};
