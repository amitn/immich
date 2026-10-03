import { EmailRenderRequest, EmailRepository, EmailTemplate } from 'src/repositories/email.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { automock } from 'test/utils.js';

describe(EmailRepository.name, () => {
  let sut: EmailRepository;

  beforeEach(() => {
    // eslint-disable-next-line no-sparse-arrays
    sut = new EmailRepository(automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false }));
  });

  describe('renderEmail', () => {
    it('should render the email correctly for TEST_EMAIL template', async () => {
      const request: EmailRenderRequest = {
        template: EmailTemplate.TEST_EMAIL,
        data: { displayName: 'Alen Turing', baseUrl: 'http://localhost' },
        customTemplate: '',
      };

      const result = await sut.renderEmail(request);

      expect(result.html).toContain('<!DOCTYPE html PUBLIC');
      expect(result.text).toContain('test email');
    });

    it('should render the email correctly for WELCOME template', async () => {
      const request: EmailRenderRequest = {
        template: EmailTemplate.WELCOME,
        data: { displayName: 'Alen Turing', username: 'turing', baseUrl: 'http://localhost' },
        customTemplate: '',
      };

      const result = await sut.renderEmail(request);

      expect(result.html).toContain('<!DOCTYPE html PUBLIC');
      expect(result.text).toContain('A new account has been created for you');
    });

    it('should render the email correctly for ALBUM_INVITE template', async () => {
      const request: EmailRenderRequest = {
        template: EmailTemplate.ALBUM_INVITE,
        data: {
          albumName: 'Vacation',
          albumId: '123',
          senderName: 'John',
          recipientName: 'Jane',
          baseUrl: 'http://localhost',
        },
        customTemplate: '',
      };

      const result = await sut.renderEmail(request);

      expect(result.html).toContain('<!DOCTYPE html PUBLIC');
      expect(result.text).toContain('Vacation');
    });

    it('should render the weekly digest with its sections and links (#6)', async () => {
      const request: EmailRenderRequest = {
        template: EmailTemplate.MEMORY_DIGEST,
        data: {
          baseUrl: 'http://localhost',
          recipientName: 'Jane',
          memories: [
            { title: 'Your trip to Lisbon', subtitle: '1–5 October 2023', url: 'http://localhost/memories/1' },
          ],
          drafts: [],
          visits: [{ title: 'Name the dishes from last night?', url: 'http://localhost/photos/2' }],
        },
        customTemplate: '',
      };

      const result = await sut.renderEmail(request);

      expect(result.html).toContain('<!DOCTYPE html PUBLIC');
      expect(result.html).toContain('http://localhost/memories/1');
      expect(result.text).toContain('Your trip to Lisbon');
      expect(result.text).toContain('Name the dishes from last night?');
      expect(result.text.toLowerCase()).toContain('new journal visits to name');
      // an empty section is left out
      expect(result.text.toLowerCase()).not.toContain('photo books waiting for you');
    });

    it('should render the email correctly for ALBUM_UPDATE template', async () => {
      const request: EmailRenderRequest = {
        template: EmailTemplate.ALBUM_UPDATE,
        data: { albumName: 'Holiday', albumId: '123', recipientName: 'Jane', baseUrl: 'http://localhost' },
        customTemplate: '',
      };

      const result = await sut.renderEmail(request);

      expect(result.html).toContain('<!DOCTYPE html PUBLIC');
      expect(result.text).toContain('Holiday');
    });
  });
});
