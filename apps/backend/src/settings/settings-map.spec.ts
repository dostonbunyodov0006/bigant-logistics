import { SettingsController } from './settings.controller';

describe('SettingsController.getMap', () => {
  const make = (key: string | undefined) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new SettingsController({} as any, {} as any, { get: jest.fn().mockReturnValue(key) } as any);

  it('hands out the Google key when one is set', () => {
    expect(make('AIza-test').getMap()).toEqual({ google_maps_key: 'AIza-test', esri_key: 'AIza-test' });
  });

  it('says there is none, so the map falls back to our own tiles', () => {
    expect(make(undefined).getMap()).toEqual({ google_maps_key: null, esri_key: null });
  });
});
