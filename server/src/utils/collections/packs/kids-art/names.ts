/*
 * What the kids' art pack hides: the full names of children. Artworks are signed ("Mosca Alberto", "by Ksenia
 * Krizhanovskaya"), and parents type full names; the pack keeps at most one name of a person, the first one written,
 * in every text it lets out (the names read on the artworks, the places and entries the assistant passes in, and so
 * the tags, descriptions and captions of books): `redactChildNames` runs on all of them. A family name alone ("the
 * Tanaka family") is not a child's name, and stays.
 */

/**
 * Words that are capitalized in titles and greetings but never a surname: "Buon Natale", "Merry Christmas", "Two
 * Foxes", "Santa Claus". A run of capitalized words made only of other words is a name.
 */
const COMMON_WORDS = new Set(
  // English
  (
    'a an the my our your his her their its this that these those and or of to for from with without by in on at ' +
    'under over up down into out off near after before behind beside between i me we you he she it they is am are ' +
    'was be love loves happy merry christmas xmas new year birthday easter halloween valentine valentines mother ' +
    "mother's mothers father father's fathers day days night morning evening thank thanks you dear mom mum mommy " +
    'mummy dad daddy mama papa granny grandma grandmother grandpa grandfather grandparents nana nonna nonno ' +
    'nonnino family friends friend santa claus reindeer tree trees house home sweet garden school class grade ' +
    'drawing drawings picture painting letter card poster portrait self big little small tall one two three four ' +
    'five six seven eight nine ten first second third last red orange yellow green blue purple pink brown black ' +
    'white gold silver rainbow sun moon star stars sky sea ocean river lake mountain forest flower flowers leaf ' +
    'leaves rain snow cloud clouds cat cats dog dogs bird birds fish fox foxes horse horses bear bears elephant ' +
    'elephants lion tiger rabbit bunny mouse dolphin whale butterfly ant sparrow dragon unicorn princess prince ' +
    'king queen castle car cars train plane boat ship rocket robot monster ghost witch fairy dinosaur spring summer ' +
    'autumn fall winter january february march april may june july august september october november december ' +
    'monday tuesday wednesday thursday friday saturday sunday me myself ' +
    // Italian, German, French, Spanish, Russian greetings and family words
    'buon buona buone natale pasqua compleanno anno nuovo auguri caro cara cari miei mio mia papà mamma festa ' +
    'frohe fröhliche weihnachten ostern geburtstag alles gute liebe lieber mama oma opa familie ' +
    'joyeux joyeuse noël noel pâques anniversaire bonne année maman papa famille ' +
    'feliz navidad cumpleaños año mamá papá familia ' +
    'с днём рождения новым годом мама папа бабушка дедушка кот кошка'
  ).split(/\s+/),
);

/**
 * Common given names, to keep the right word of a name signed surname first, as Italian and Japanese schools do
 * ("Mosca Alberto" is Alberto): a run of names whose first word is none of these and whose later word is keeps that
 * word instead
 */
const GIVEN_NAMES = new Set(
  (
    'alberto alessandro alessia alice andrea angela anna antonio arianna beatrice camilla carla carlo chiara ' +
    'cristina daniele davide elena elisa emma federico francesca francesco gabriele giacomo gianni giorgia giorgio ' +
    'giovanni giulia giuseppe laura leonardo lorenzo luca lucia luigi marco maria mario marta martina matteo michele ' +
    'nicola paola paolo pietro riccardo roberto sara simone sofia stefano tommaso valentina vittoria ' +
    'adam alex alexander amelia amy ava ben benjamin charlie charlotte chloe daniel david ella emily ethan eva grace ' +
    'hannah harry isabella jack jacob james jane jessica john joshua katie leo liam lily lucy mary mia michael noah ' +
    'olivia oliver peter rose ruby ryan samuel sophie thomas william zoe ' +
    'anton ben clara emil felix finn greta hanna jonas julia lena lea leon lukas luisa max maximilian mila nora ' +
    'paul sophia ' +
    'camille chloé hugo inès jules léa louis louise lucas manon nathan théo ' +
    'alejandro carmen diego javier lucía mateo pablo ' +
    'alexei alexandra anastasia daria dmitri ekaterina irina ivan kseniya ksenia maria masha nikita olga pavel ' +
    'polina sergei sofia svetlana tatiana vera yulia ' +
    'алексей анастасия анна вера дарья дмитрий екатерина иван ирина ксения мария никита ольга павел полина ' +
    'сергей софия татьяна юлия ' +
    'hanako haruto hina himari kaito koharu mei ren riko sakura sota yui yuki yuto'
  ).split(/\s+/),
);

/** the particles inside a name, which keep a run of names going: "Carl von Lützow" */
const PARTICLES = new Set(['von', 'van', 'de', 'der', 'di', 'da', 'del', 'della', 'du', 'le', 'la', 'ten', 'ter']);

/** "Vera", "PETROVA", "Петрова", "O'Neil", "Anne-Marie" */
const NAME_WORD = /^(?:\p{Lu}[\p{Ll}'’-]*\p{Ll}|\p{Lu}[\p{Lu}'’-]*\p{Lu})$/u;

/** words of family, which make a place of a family, not of a child */
const FAMILY = /(?<!\p{L})(?:family|famiglia|familie|famille|familia|семья)(?!\p{L})/iu;

const fold = (word: string) => word.toLocaleLowerCase();

const isNameWord = (word: string) =>
  NAME_WORD.test(word) && (!COMMON_WORDS.has(fold(word)) || GIVEN_NAMES.has(fold(word)));

/**
 * A text with at most one name of each person in it: a run of two or more capitalized words that are not the words of
 * titles and greetings ("Vera Petrova", "HANAKO TANAKA", "Вера Петрова") keeps its first word, or its given name
 * when it is signed surname first ("Rossi Marco" is Marco), and the child of a place ("Lily Green, 2020") keeps only
 * the first word of its name whatever it is; "the Tanaka family, 2011–2021" stays as it is.
 */
export const redactChildNames = (text: string): string => {
  // a place: "<child>, <year>" keeps one word of the child
  const place = /^\s*([^,()]+?)\s*,\s*(\d{4}(?:\s*[–-]\s*\d{2,4})?)\s*$/u.exec(text);
  if (place && !FAMILY.test(place[1])) {
    const [first] = redactRuns(place[1]).split(/\s+/, 1);
    return `${first}, ${place[2]}`;
  }
  return redactRuns(text);
};

type Token = { open: string; word: string; close: string; space: string };

/** the runs of names of a text cut to one word: the first, or the given name of a name signed surname first */
const redactRuns = (text: string) => {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/(\S+)(\s*)/gu)) {
    const [, open, word, close] = /^([("“'«]*)(.*?)([)"”'»,.;:!?]*)$/u.exec(match[1])!;
    tokens.push({ open, word, close, space: match[2] });
  }
  const lead = /^\s*/.exec(text)![0];
  const result: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    // a run: a name, then names and particles, until a word that is neither or a closing mark
    let end = index;
    if (isNameWord(token.word) && !token.close) {
      while (end + 1 < tokens.length && !tokens[end + 1].open) {
        const next = tokens[end + 1];
        const name = isNameWord(next.word);
        if (!name && (!PARTICLES.has(next.word) || next.close)) {
          break;
        }
        end++;
        if (next.close) {
          break;
        }
      }
    }
    const run = tokens.slice(index, end + 1);
    const names = run.filter(({ word }) => isNameWord(word));
    if (names.length < 2) {
      result.push(`${token.open}${token.word}${token.close}${token.space}`);
      index++;
      continue;
    }
    const kept = GIVEN_NAMES.has(fold(names[0].word))
      ? names[0]
      : (names.find(({ word }) => GIVEN_NAMES.has(fold(word))) ?? names[0]);
    const last = run.at(-1)!;
    result.push(`${token.open}${kept.word}${last.close}${last.space}`);
    index = end + 1;
  }
  return lead + result.join('');
};

/** the first name of a child from a name the user or the artwork gives, e.g. "Vera" of "Vera Petrova, age 9" */
export const getFirstName = (name: string) => {
  const [first] = redactChildNames(name).split(/[\s,]+/, 1);
  return first && isNameWord(first) ? first : undefined;
};
