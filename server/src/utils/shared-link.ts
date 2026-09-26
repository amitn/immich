import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { ImmichCookie } from 'src/enum.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';

/** the tokens of the password protected shared links the visitor has logged in to, from the cookie */
export const getSharedLinkAuthTokens = (cookies: Record<string, string> | undefined) => {
  return cookies?.[ImmichCookie.SharedLinkToken]?.split(',') || [];
};

/** the token a visitor gets for entering the password of a shared link, which changes with the password */
export const asSharedLinkToken = (crypto: CryptoRepository, sharedLink: { id: string; password: string }) => {
  return crypto.hashSha256(`${sharedLink.id}-${sharedLink.password}`).toString('base64');
};

/** A visitor of a password protected shared link must have entered the password; other users pass */
export const requireSharedLinkLogin = (crypto: CryptoRepository, auth: AuthDto, authTokens: string[]) => {
  const sharedLink = auth.sharedLink;
  if (!sharedLink?.password) {
    return;
  }

  if (!authTokens.includes(asSharedLinkToken(crypto, { id: sharedLink.id, password: sharedLink.password }))) {
    throw new UnauthorizedException('Password required');
  }
};

/**
 * For what a shared link may never do, even where its access to the resource would allow it: e.g. a link to a book
 * reads the web book, but not the book's details (its photos, its album) nor exports it
 */
export const requireNotSharedLink = (auth: AuthDto) => {
  if (auth.sharedLink) {
    throw new ForbiddenException('Not available through a shared link');
  }
};
