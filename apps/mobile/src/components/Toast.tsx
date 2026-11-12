import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ToastContextValue = {
  showSuccess: (message: string) => void;
  showWarning: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
const TOAST_DURATION_MS = 2500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccess = useCallback((nextMessage: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setWarning(false);
    setMessage(nextMessage);
    timerRef.current = setTimeout(() => {
      setMessage(null);
      timerRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  const showWarning = useCallback((nextMessage: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setWarning(true);
    setMessage(nextMessage);
    timerRef.current = setTimeout(() => {
      setMessage(null);
      timerRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showSuccess, showWarning }}>
      <View style={s.root}>
        {children}
        {message ? (
          <View pointerEvents="none" style={[s.position, { top: insets.top + 12 }]}>
            <View style={[s.toast, warning && s.toastWarning]}>
              <Text style={[s.icon, warning && s.iconWarning]}>{warning ? '!' : '✓'}</Text>
              <Text style={[s.message, warning && s.messageWarning]}>{message}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  position: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1000,
    alignItems: 'center',
  },
  // Solid, not a wash: the dark theme's success tint is translucent, and the
  // toast laid over the page let the page show through its letters.
  toast: {
    maxWidth: 440,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#15803d',
    paddingHorizontal: 18,
    paddingVertical: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  toastWarning: { backgroundColor: '#b91c1c' },
  icon: { fontSize: 20, fontWeight: '900', color: '#ffffff' },
  iconWarning: { color: '#ffffff' },
  message: { flexShrink: 1, fontSize: 17, fontWeight: '800', color: '#ffffff' },
  messageWarning: { color: '#ffffff' },
});
