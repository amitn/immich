import { getRenamedSettingsRedirect } from '$lib/journals/settings-redirect';

const url = (path: string) => new URL(path, 'http://localhost');

describe(getRenamedSettingsRedirect.name, () => {
  it('should send the old Collections section of the system settings to Journals', () => {
    expect(getRenamedSettingsRedirect(url('/admin/system-settings?isOpen=collections'))).toBe(
      '/admin/system-settings?isOpen=journals',
    );
  });

  it('should send the old notification setting of the user to the journal one, keeping the other keys', () => {
    expect(getRenamedSettingsRedirect(url('/user-settings?isOpen=feature+collection-notifications&x=1#top'))).toBe(
      '/user-settings?isOpen=feature+journal-notifications&x=1#top',
    );
  });

  it('should not open a section twice', () => {
    expect(getRenamedSettingsRedirect(url('/admin/system-settings?isOpen=journals+collections'))).toBe(
      '/admin/system-settings?isOpen=journals',
    );
  });

  it('should leave current keys alone', () => {
    expect(getRenamedSettingsRedirect(url('/admin/system-settings?isOpen=journals+food'))).toBeUndefined();
    expect(getRenamedSettingsRedirect(url('/admin/system-settings'))).toBeUndefined();
    expect(getRenamedSettingsRedirect(url('/admin/system-settings?isOpen=constructor'))).toBeUndefined();
  });
});
