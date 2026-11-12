/** Service step 1 on a weak signal (owner, 07.11.2026). */
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockRefetch = jest.fn();
let mockReasons: { data?: unknown; isError: boolean; isLoading: boolean } = { isError: true, isLoading: false };
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { preselect: ['r-cached'] } }),
}));
jest.mock('@tanstack/react-query', () => ({
  QueryClient: class {},
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey.includes('reasons')
      ? { ...mockReasons, refetch: mockRefetch, isFetching: false }
      : { data: [{ reason_id: 'r-cached', remaining_km: 100 }] },
}));
jest.mock('../components/Icon', () => ({ Icon: () => null }));
jest.mock('../lib/useBottomInset', () => ({ useBottomInset: () => 0 }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ServiceReasonsScreen, resolveWorks } = require('../screens/service/ServiceReasonsScreen');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SERVICE_KEYS } = require('../lib/service');

const oil = { id: 'r1', name: 'Moy', approved: true, interval_km: 10000 };

beforeEach(() => {
  mockRefetch.mockClear();
  mockReasons = { isError: true, isLoading: false };
});

describe('the reasons list did not load', () => {
  it('says so with a retry, and the button stays grey for a tick it cannot send', () => {
    expect(SERVICE_KEYS.reasons).toContain('reasons');
    render(<ServiceReasonsScreen />);
    expect(screen.getByText('service.listFailed')).toBeTruthy();
    fireEvent.press(screen.getByText('common.retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('service.pickFirst')).toBeTruthy();
  });

  it('loaded: no error line, and the cached tick that is in the catalogue lights the button', () => {
    mockReasons = { isError: false, isLoading: false, data: [{ ...oil, id: 'r-cached' }] };
    render(<ServiceReasonsScreen />);
    expect(screen.queryByText('service.listFailed')).toBeNull();
    expect(screen.getByText('service.goNowSub')).toBeTruthy();
  });
});

describe('the works that will be sent', () => {
  it('a tick missing from the catalogue counts for nothing; typed works count', () => {
    expect(resolveWorks(['gone'], undefined, [])).toEqual([]);
    expect(resolveWorks(['gone', 'r1'], [oil], [])).toEqual([{ reason_id: 'r1', name: 'Moy' }]);
    expect(resolveWorks(['gone'], [], ['Fara'])).toEqual([{ custom_name: 'Fara', name: 'Fara' }]);
  });
});
