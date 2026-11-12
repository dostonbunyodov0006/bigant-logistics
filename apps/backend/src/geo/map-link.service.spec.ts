import { MapLinkService, followRedirects } from './map-link.service';

function redirectTo(location: string, status = 302) {
  return new Response('', { status, headers: { location } });
}

afterEach(() => jest.restoreAllMocks());

describe('MapLinkService', () => {
  it('follows a Yandex short link to the pin it shares', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(redirectTo('https://yandex.uz/maps/10335/tashkent/?ll=69.240562%2C41.311081&pt=69.241000%2C41.312000&z=17'))
      .mockResolvedValueOnce(new Response('<html/>', { status: 200 }));
    const r = await new MapLinkService().resolve('https://yandex.ru/maps/-/CHxyzABC');
    expect(r.location).toEqual({ lat: 41.312, lng: 69.241, usable: true });
    expect(r.url).toContain('yandex.uz/maps');
    expect((fetchSpy.mock.calls[0] as [string, RequestInit])[1].redirect).toBe('manual');
  });

  it('follows a Google short link to the place pin', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(redirectTo('https://www.google.com/maps/place/Chorsu/@41.3265,69.2362,17z/data=!3m1!4b1!4m6!3m5!8m2!3d41.326582!4d69.236194'))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const r = await new MapLinkService().resolve('maps.app.goo.gl/abcDEF123');
    expect(r.location).toEqual({ lat: 41.326582, lng: 69.236194, usable: true });
  });

  it('reads a long link or bare coordinates without fetching', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const svc = new MapLinkService();
    expect((await svc.resolve('41.311081, 69.240562')).location).toEqual({ lat: 41.311081, lng: 69.240562, usable: true });
    expect((await svc.resolve('https://yandex.uz/maps/?ll=69.24,41.31')).location?.lat).toBe(41.31);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never leaves the map hosts, and gives up on a dead link', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(redirectTo('https://evil.example.com/x'));
    expect(await followRedirects('https://yandex.ru/maps/-/CHabc')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await followRedirects('http://yandex.ru/maps/-/CHabc')).toBeNull();
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('timeout'));
    expect(await followRedirects('https://maps.app.goo.gl/zzz')).toBeNull();
  });
});
