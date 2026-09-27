import { UserMetadataKey } from 'src/enum.js';
import { getPreferences, getPreferencesPartial, mergePreferences } from 'src/utils/preferences.js';

describe('AI answers preference', () => {
  it('should answer the questions of the search bar by default', () => {
    expect(getPreferences([]).aiAnswers).toEqual({ enabled: true });
  });

  it('should keep AI answers turned off', () => {
    const off = mergePreferences(getPreferences([]), { aiAnswers: { enabled: false } });
    const partial = getPreferencesPartial(off);
    expect(partial).toEqual({ aiAnswers: { enabled: false } });
    expect(getPreferences([{ key: UserMetadataKey.Preferences, value: partial }]).aiAnswers).toEqual({
      enabled: false,
    });
  });
});
