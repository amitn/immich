import en from '$i18n/en.json';

describe('the Photo books section of the system settings', () => {
  it('should describe both its map pages and its suggested books', () => {
    const description = en.admin.book_settings_description;

    expect(description).toMatch(/map pages/i);
    expect(description).toMatch(/suggested books/i);
  });
});
