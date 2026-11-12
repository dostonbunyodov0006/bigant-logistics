/** "+30 daqiqa" asks what work he is still on before it is sent (owner, 07.11.2026). */
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockExtend = jest.fn();
const mockStop = jest.fn();
let mockShift: Record<string, unknown> = {};
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
jest.mock('../components/Icon', () => ({ Icon: () => null }));
jest.mock('../components/ShiftProvider', () => ({ useShiftContext: () => mockShift }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ShiftHomeCards } = require('../components/ShiftHomeCards');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { canSendNote, END_CHECK_NOTE_MAX } = require('../components/EndCheckNote');

beforeEach(() => {
  mockExtend.mockClear();
  mockStop.mockClear();
  mockShift = {
    onShift: true,
    pending: false,
    extendError: null,
    endCheck: { awaiting_answer: true, asked_at: '2026-11-07T13:00:00.000Z', unanswered: 0, zone: 'tashkent', shift_end: '18:00' },
    extend: mockExtend,
    stop: mockStop,
  };
});

describe('the end-of-day card', () => {
  it('"+30 daqiqa" opens the note box instead of sending at once', () => {
    render(<ShiftHomeCards />);
    expect(screen.queryByText('shift.extendNoteLabel')).toBeNull();
    fireEvent.press(screen.getByText('shift.extend'));
    expect(mockExtend).not.toHaveBeenCalled();
    expect(screen.getByText('shift.extendNoteLabel')).toBeTruthy();
    expect(screen.getByText('shift.extendSend')).toBeTruthy();
  });

  it('Yuborish does nothing with an empty or blank note, and sends the note once written', () => {
    render(<ShiftHomeCards />);
    fireEvent.press(screen.getByText('shift.extend'));
    fireEvent.press(screen.getByText('shift.extendSend'));
    fireEvent.changeText(screen.getByLabelText('shift.extendNoteLabel'), '   ');
    fireEvent.press(screen.getByText('shift.extendSend'));
    expect(mockExtend).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('shift.extendNoteLabel'), 'Chilonzorda yuk tushiryapman');
    fireEvent.press(screen.getByText('shift.extendSend'));
    expect(mockExtend).toHaveBeenCalledWith('Chilonzorda yuk tushiryapman');
  });

  it('a refused send is said under the note, not in an alert box', () => {
    mockShift = { ...mockShift, extendError: 'errors.end_check_note_required' };
    render(<ShiftHomeCards />);
    fireEvent.press(screen.getByText('shift.extend'));
    expect(screen.getByText('errors.end_check_note_required')).toBeTruthy();
  });

  it('"Ishni tugatish" is unchanged: it ends the shift at once', () => {
    render(<ShiftHomeCards />);
    fireEvent.press(screen.getByText('shift.stop'));
    expect(mockStop).toHaveBeenCalled();
  });

  it('nothing shown while no question waits', () => {
    mockShift = { ...mockShift, endCheck: { ...(mockShift.endCheck as object), awaiting_answer: false } };
    render(<ShiftHomeCards />);
    expect(screen.queryByText('shift.extend')).toBeNull();
  });
});

describe('what counts as a note', () => {
  it('trimmed, not empty, at most 300 characters', () => {
    expect(canSendNote('')).toBe(false);
    expect(canSendNote('  \n ')).toBe(false);
    expect(canSendNote(' yuk ')).toBe(true);
    expect(END_CHECK_NOTE_MAX).toBe(300);
    expect(canSendNote('x'.repeat(300))).toBe(true);
    expect(canSendNote('x'.repeat(301))).toBe(false);
  });
});
