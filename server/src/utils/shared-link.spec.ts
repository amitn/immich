import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import {
  asSharedLinkToken,
  getSharedLinkAuthTokens,
  requireNotSharedLink,
  requireSharedLinkLogin,
} from 'src/utils/shared-link.js';
import { newCryptoRepositoryMock } from 'test/repositories/crypto.repository.mock.js';
import { factory } from 'test/small.factory.js';

describe('shared link utils', () => {
  const crypto = newCryptoRepositoryMock() as unknown as CryptoRepository;

  it('should read the tokens from the cookie', () => {
    expect(getSharedLinkAuthTokens({ immich_shared_link_token: 'a,b' })).toEqual(['a', 'b']);
    expect(getSharedLinkAuthTokens({})).toEqual([]);
    expect(getSharedLinkAuthTokens(undefined)).toEqual([]);
  });

  describe('requireSharedLinkLogin', () => {
    it('should let users and links without a password pass', () => {
      expect(() => requireSharedLinkLogin(crypto, factory.auth(), [])).not.toThrow();
      expect(() => requireSharedLinkLogin(crypto, factory.auth({ sharedLink: {} }), [])).not.toThrow();
    });

    it('should require the token of the password', () => {
      const auth = factory.auth({ sharedLink: { password: 'secret' } });
      const token = asSharedLinkToken(crypto, { id: auth.sharedLink!.id, password: 'secret' });
      const oldToken = asSharedLinkToken(crypto, { id: auth.sharedLink!.id, password: 'old' });

      expect(() => requireSharedLinkLogin(crypto, auth, [])).toThrow(UnauthorizedException);
      expect(() => requireSharedLinkLogin(crypto, auth, [oldToken])).toThrow(UnauthorizedException);
      expect(() => requireSharedLinkLogin(crypto, auth, ['other', token])).not.toThrow();
    });
  });

  it('should reject shared links where they never apply', () => {
    expect(() => requireNotSharedLink(factory.auth({ sharedLink: {} }))).toThrow(ForbiddenException);
    expect(() => requireNotSharedLink(factory.auth())).not.toThrow();
  });
});
