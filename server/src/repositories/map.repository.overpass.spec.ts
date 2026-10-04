import { MapRepository } from 'src/repositories/map.repository.js';

describe(`${MapRepository.name} queryOverpass`, () => {
  let sut: MapRepository;
  const fetchMock = vi.fn();

  beforeEach(() => {
    sut = new MapRepository({} as never, {} as never, { setContext: () => {} } as never, {} as never);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should post the query and return the JSON response', async () => {
    fetchMock.mockResolvedValue(Response.json({ elements: [] }, { status: 200 }));

    await expect(sut.queryOverpass('https://overpass.example/api/interpreter', '[out:json];')).resolves.toEqual({
      elements: [],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://overpass.example/api/interpreter');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('data=%5Bout%3Ajson%5D%3B');
    expect(init.headers['User-Agent']).toMatch(/^immich-server\/\S+ \(\+https:\/\/immich\.app\)$/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('should fail on an error response', async () => {
    fetchMock.mockResolvedValue(new Response('busy', { status: 429, statusText: 'Too Many Requests' }));

    await expect(sut.queryOverpass('https://overpass.example/api/interpreter', '[out:json];')).rejects.toThrow(
      'Overpass API responded with 429 Too Many Requests',
    );
  });
});
