import { PassThrough } from 'node:stream';
import { getBearerToken, isSecretValid, parseMessage, readLines } from 'src/utils/agent/host-protocol.js';

const collect = (maxBytes = 1024) => {
  const stream = new PassThrough();
  const lines: string[] = [];
  const onError = vi.fn();
  readLines(
    stream,
    (line) => {
      lines.push(line);
    },
    { maxBytes, onError },
  );
  return { stream, lines, onError };
};

describe('agent host protocol', () => {
  describe(readLines.name, () => {
    it('should split lines, also across chunks', () => {
      const { stream, lines } = collect();
      stream.write('{"a":1}\n{"b"');
      stream.write(':2}\n\n{"c":3}');
      stream.write('\n');
      expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    });

    it('should keep multi-byte characters split across chunks', () => {
      const { stream, lines } = collect();
      const bytes = Buffer.from('"חלון 🪟"\n');
      stream.write(bytes.subarray(0, 3));
      stream.write(bytes.subarray(3));
      expect(lines).toEqual(['"חלון 🪟"']);
    });

    it('should fail on a line that is too long', () => {
      const { stream, lines, onError } = collect(10);
      stream.write('0123456789');
      stream.write('0123456789\n{"a":1}\n');
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Message larger than 10 bytes' }));
      expect(lines).toEqual([]);
    });
  });

  describe(parseMessage.name, () => {
    it('should parse messages', () => {
      expect(parseMessage('{"type":"ping"}')).toEqual({ type: 'ping' });
    });

    it.each(['', 'null', '[]', '{"jsonrpc":"2.0"}', '{"type":1}', 'not json'])('should ignore %j', (line) => {
      expect(parseMessage(line)).toBeUndefined();
    });
  });

  describe(isSecretValid.name, () => {
    it('should compare secrets', () => {
      expect(isSecretValid('secret', 'secret')).toBe(true);
      expect(isSecretValid('secret', 'Secret')).toBe(false);
      expect(isSecretValid('secret', 'secret2')).toBe(false);
      expect(isSecretValid('secret', undefined)).toBe(false);
    });
  });

  describe(getBearerToken.name, () => {
    it('should read bearer tokens', () => {
      expect(getBearerToken('Bearer abc')).toBe('abc');
      expect(getBearerToken('bearer abc')).toBe('abc');
      expect(getBearerToken('Basic abc')).toBeUndefined();
      expect(getBearerToken('Bearer')).toBeUndefined();
      expect(getBearerToken(undefined)).toBeUndefined();
    });
  });
});
