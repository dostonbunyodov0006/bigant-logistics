/** "Nega qaytdi?": one culprit's reasons at a time, under a row of buttons. */
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
jest.mock('../components/Icon', () => ({ Icon: () => null }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('../lib/useBottomInset', () => ({ useBottomInset: () => 0 }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { VozvratReasonList } = require('../screens/vozvrat/VozvratParts');

const draft = (reason: string | null = null) => ({ product: null, reason }) as never;

describe('Nega qaytdi? — culprit buttons', () => {
  it('shows the buttons and no reasons until one is pressed', () => {
    render(<VozvratReasonList draft={draft()} onBack={jest.fn()} onPick={jest.fn()} />);
    expect(screen.getByText('vozvrat.culprit_sotuvchi')).toBeTruthy();
    expect(screen.getByText('vozvrat.culprit_mijoz')).toBeTruthy();
    expect(screen.queryByText('s1')).toBeNull();
  });

  it('Sotuvchi opens its reasons; Mijoz closes them and opens its own', () => {
    render(<VozvratReasonList draft={draft()} onBack={jest.fn()} onPick={jest.fn()} />);
    fireEvent.press(screen.getByText('vozvrat.culprit_sotuvchi'));
    expect(screen.getByText('s1')).toBeTruthy();
    expect(screen.queryByText('m1')).toBeNull();
    fireEvent.press(screen.getByText('vozvrat.culprit_mijoz'));
    expect(screen.getByText('m1')).toBeTruthy();
    expect(screen.queryByText('s1')).toBeNull();
    fireEvent.press(screen.getByText('vozvrat.culprit_haydovchi'));
    expect(screen.getByText('h1')).toBeTruthy();
    expect(screen.queryByText('m1')).toBeNull();
  });

  it('opens on the group of the reason already chosen, and a tap picks it', () => {
    const onPick = jest.fn();
    render(<VozvratReasonList draft={draft('o2')} onBack={jest.fn()} onPick={onPick} />);
    expect(screen.getByText('o2')).toBeTruthy();
    fireEvent.press(screen.getByText('o1'));
    expect(onPick).toHaveBeenCalledWith('o1');
  });
});

describe('the product photos — up to four', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VozvratItemForm } = require('../screens/vozvrat/VozvratParts');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toItemInput, emptyDraft } = require('../lib/vozvrat');
  const product = { id: 'p1', name: 'Un', unit: 'kg', xodovoy: true };
  const form = (extraPhotos: string[], onChange = jest.fn()) =>
    render(
      <VozvratItemForm
        draft={{ ...emptyDraft(), product, photoUri: 'file:///a.jpg', extraPhotos }}
        onChange={onChange}
        onBack={jest.fn()}
        onChangeProduct={jest.fn()}
        onOpenReasons={jest.fn()}
        onSave={jest.fn()}
        onRemove={null}
        saving={false}
      />,
    );

  it('after the first photo "Yana surat" shows, until there are four', () => {
    form([]);
    expect(screen.getByText('vozvrat.morePhoto')).toBeTruthy();
    screen.unmount();
    form(['file:///b.jpg', 'file:///c.jpg', 'file:///d.jpg']);
    expect(screen.queryByText('vozvrat.morePhoto')).toBeNull();
  });

  it('a further photo can be taken off', () => {
    const onChange = jest.fn();
    form(['file:///b.jpg', 'file:///c.jpg'], onChange);
    fireEvent.press(screen.getAllByLabelText('vozvrat.removePhoto')[0]!);
    expect(onChange).toHaveBeenCalledWith({ extraPhotos: ['file:///c.jpg'] });
  });

  it('the server gets them all', () => {
    const d = {
      ...emptyDraft(),
      product,
      condition: 'good',
      reason: 's1',
      photoUrl: 'https://x/a.jpg',
      extraPhotos: ['https://x/b.jpg', 'https://x/c.jpg'],
    };
    expect(toItemInput(d).extra_photo_urls).toEqual(['https://x/b.jpg', 'https://x/c.jpg']);
  });
});
