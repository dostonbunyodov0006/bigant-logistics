/**
 * The driver's screens render — the guard the white screen of 28.10.2026 lacked:
 * the action bar read the shift from a provider that only wraps the home
 * screen, threw on an order opened from the list, and the phone went white.
 */
import { render, screen } from '@testing-library/react-native';
import { order } from './fixtures';

// --- what the screens lean on, stood in for --------------------------------
const mut = () => ({ mutate: jest.fn(), isPending: false, isError: false, error: null, reset: jest.fn() });
const mockJourney = {
  pending: false,
  pendingAssignment: null,
  assignmentsQ: { isError: false, isFetching: false, refetch: jest.fn() },
  acceptM: mut(), departPickupM: mut(), arrivePickupM: mut(), departCustomerM: mut(), arriveCustomerM: mut(),
  deliverM: mut(), startReturnM: mut(), exceptionM: mut(), departReturnM: mut(), arriveReturnM: mut(),
  completeReturnM: mut(), deferReturnM: mut(),
};
let mockOnShift = true;
let mockCurrent: unknown = undefined;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../lib/useBottomInset', () => ({ useBottomInset: () => 0 }));
jest.mock('../hooks/useShift', () => ({ useOnShift: () => mockOnShift }));
jest.mock('../hooks/useOrderJourney', () => ({ useOrderJourney: () => mockJourney }));
jest.mock('../screens/tabs/CurrentOrdersTab', () => ({ useCurrentOrder: () => mockCurrent }));
jest.mock('../components/Toast', () => ({ useToast: () => ({ showSuccess: jest.fn(), showWarning: jest.fn() }) }));
jest.mock('../components/Icon', () => ({ Icon: () => null }));
jest.mock('../components/EtaLine', () => ({ EtaLine: () => null }));
jest.mock('../components/PhotoSheet', () => ({ PhotoSheet: () => null }));
jest.mock('../components/ProblemSheet', () => ({ ProblemSheet: () => null }));
jest.mock('../components/ReturnDestinationSheet', () => ({ ReturnDestinationSheet: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OrderActionBar } = require('../components/OrderActionBar');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OrderRow } = require('../components/OrderRow');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PhoneCallButton } = require('../components/OrderCallActions');

beforeEach(() => {
  mockOnShift = true;
  mockCurrent = undefined;
});

describe('the action bar', () => {
  it('renders on an order opened from the list (no ShiftProvider) — no white screen', () => {
    expect(() => render(<OrderActionBar order={order()} />)).not.toThrow();
  });

  it('off shift: the lock line, not the buttons', () => {
    mockOnShift = false;
    render(<OrderActionBar order={order()} />);
    expect(screen.getByText('shift.startToWork')).toBeTruthy();
  });

  it('a booking not open yet: read-only, with its own lock line', () => {
    render(<OrderActionBar order={order({ actions_available_at: '2999-01-01T00:00:00.000Z' })} />);
    expect(screen.getByText('orders.notOpenYet')).toBeTruthy();
  });

  it('a return opened from "Vozvrat qilinadigan yuk bor" has no Ojidaniya', () => {
    const ret = order({
      status: 'returning',
      next_action: { type: 'return_depart', pickup_id: 'p1' } as never,
      pickup_sources: [{ id: 'p1', name: 'BIGANT sklad', return_required: true, leg_status: 'arrived' } as never],
    });
    const { unmount } = render(<OrderActionBar order={ret} />);
    expect(screen.queryByText('home.returnDefer')).toBeTruthy();
    unmount();
    render(<OrderActionBar order={ret} takeReturn />);
    expect(screen.queryByText('home.returnDefer')).toBeNull();
  });

  it("a vozvrat the seller made has no Ojidaniya either", () => {
    const ret = order({
      status: 'returning',
      kind: 'vozvrat',
      next_action: { type: 'return_depart', pickup_id: 'p1' } as never,
      pickup_sources: [{ id: 'p1', name: 'BIGANT sklad', return_required: true, leg_status: 'pending' } as never],
    });
    render(<OrderActionBar order={ret} />);
    expect(screen.queryByText('home.returnDefer')).toBeNull();
  });
});

describe('calls while another order is under way', () => {
  it('a row offers the seller call when nothing else is under way', () => {
    render(<OrderRow order={order()} onPress={jest.fn()} />);
    expect(screen.getByLabelText('orders.callSeller')).toBeTruthy();
  });

  it('and hides it when another order is the current one', () => {
    mockCurrent = order({ id: 'other' });
    render(<OrderRow order={order()} onPress={jest.fn()} />);
    expect(screen.queryByLabelText('orders.callSeller')).toBeNull();
  });

  it('a locked call button cannot be pressed', () => {
    render(<PhoneCallButton phone="+998900000102" label="Sotuvchiga" disabled />);
    expect(screen.getByRole('button').props.accessibilityState).toMatchObject({ disabled: true });
  });
});
