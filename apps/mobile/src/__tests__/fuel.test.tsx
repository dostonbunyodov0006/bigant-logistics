/**
 * The pump: Marshrut starts the navigator, "Siz keldingiz" comes when he is
 * in the station's zone and the camera opens by itself; test accounts can
 * say they have arrived without driving there.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockTake = jest.fn().mockResolvedValue(null);
const mockOpenRoute = jest.fn().mockResolvedValue(true);
let mockPhone = '+998900000007';
const mockParams = {
  fuelType: 'metan',
  station: { id: 's1', name: 'Metan Yujniy', lat: 41.2, lng: 69.2, address: null, brand: null },
  distanceM: 1600,
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === 'fuel'
      ? { data: { fence_check: false, fence_radius_m: 150 } }
      : { data: { phone_number: mockPhone } },
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: () => Promise.resolve({ granted: false }),
}));
jest.mock('../hooks/useFuelPhoto', () => ({ useFuelPhoto: () => ({ take: mockTake, busy: false }) }));
jest.mock('../lib/navigation', () => ({ openRoute: (...a: unknown[]) => mockOpenRoute(...a) }));
jest.mock('../components/Icon', () => ({ Icon: () => null }));
jest.mock('../lib/useBottomInset', () => ({ useBottomInset: () => 0 }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FuelStationScreen } = require('../screens/fuel/FuelStationScreen');

beforeEach(() => {
  mockTake.mockClear();
  mockOpenRoute.mockClear();
  mockPhone = '+998900000007';
});

describe('the pump, after Marshrut', () => {
  it('navigator closed before getting there: the message, Marshrut again under it, no camera', () => {
    render(<FuelStationScreen />);
    expect(screen.getByText('fuel.notArrived')).toBeTruthy();
    expect(screen.queryByText('fuel.takePhoto')).toBeNull();
    fireEvent.press(screen.getByText('fuel.routeButton'));
    expect(mockOpenRoute).toHaveBeenCalledTimes(1);
  });

  it('in the zone: "Siz keldingiz" with the photo button under it — he takes the pump himself', () => {
    render(<FuelStationScreen />);
    fireEvent.press(screen.getByText('fuel.testArrive'));
    expect(screen.getByText('fuel.arrived')).toBeTruthy();
    expect(screen.queryByText('fuel.routeButton')).toBeNull();
    expect(mockTake).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('fuel.takePhoto'));
    expect(mockTake).toHaveBeenCalledTimes(1);
  });

  it('a real driver has no test button', () => {
    mockPhone = '+998900000103';
    render(<FuelStationScreen />);
    expect(screen.queryByText('fuel.testArrive')).toBeNull();
  });
});
