import { isQuestion, parseAnswer } from '$lib/utils/ask-library';

describe('isQuestion', () => {
  it.each([
    'what did we eat at noma',
    'Which museums did we visit?',
    'when did we last make the quiche',
    'Where were we on 4 October 2016',
    "what's the wine we had in Mosel",
    'who came to the wedding',
    'how many dishes did we have at the french laundry',
    'did we go to Sicily in 2009',
    'noma?',
    'beach at sunset ?',
  ])('should see a question in "%s"', (text) => {
    expect(isQuestion(text)).toBe(true);
  });

  it.each([
    'beach at sunset',
    'noma',
    'when',
    'Who',
    '',
    ' '.repeat(3),
    'whatever happened',
    'dog playing in the snow',
  ])('should see a search in "%s"', (text) => {
    expect(isQuestion(text)).toBe(false);
  });

  it('should handle a missing query', () => {
    expect(isQuestion(undefined)).toBe(false);
    expect(isQuestion(null)).toBe(false);
  });
});

describe('parseAnswer', () => {
  const a = '1f0c3f2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
  const b = '9a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

  it('should split the sources line into photos and tags', () => {
    expect(
      parseAnswer(
        `You had 8 dishes at Noma Australia on 24 March 2016, the Unripe Macadamia first.\nSources: photos ${a}, ${b}; tags Food/Noma Australia, Wine/Noma Australia`,
      ),
    ).toEqual({
      text: 'You had 8 dishes at Noma Australia on 24 March 2016, the Unripe Macadamia first.',
      photoIds: [a, b],
      tags: ['Food/Noma Australia', 'Wine/Noma Australia'],
    });
  });

  it('should read a sources line in bold and without tags', () => {
    expect(parseAnswer(`Nothing matches.\n\n**Sources:** none`)).toEqual({
      text: 'Nothing matches.',
      photoIds: [],
      tags: [],
    });
    expect(parseAnswer(`Twice.\n*Sources:* photos ${a}.`)).toEqual({ text: 'Twice.', photoIds: [a], tags: [] });
  });

  it('should cite the photos named in the text, and not show their ids', () => {
    expect(parseAnswer(`The quiche, on 15 November 2006 (photos ${a}, ${b}).`)).toEqual({
      text: 'The quiche, on 15 November 2006.',
      photoIds: [a, b],
      tags: [],
    });
  });

  it('should show an answer still streaming without its sources', () => {
    expect(parseAnswer('You visited three muse')).toEqual({ text: 'You visited three muse', photoIds: [], tags: [] });
    expect(parseAnswer(undefined)).toEqual({ text: '', photoIds: [], tags: [] });
  });
});
