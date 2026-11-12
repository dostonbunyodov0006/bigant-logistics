// First, before anything of ours runs: a crash is reported, not swallowed.
import './lib/crashReport';
import { bootBegin } from './lib/bootTrace';
bootBegin();
import './lib/backgroundLocation';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { registerRootComponent } from 'expo';
import { StatusBar } from 'expo-status-bar';
import { isDarkTheme } from './components/theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './auth/AuthContext';
import { RootNavigator } from './navigation/RootNavigator';
import { useAppUpdates } from './hooks/useAppUpdates';
import { useUpdateChannel } from './hooks/useUpdateChannel';
import { useDriverLocation } from './hooks/useDriverLocation';
import { usePushNotifications } from './hooks/usePushNotifications';
import { ToastProvider } from './components/Toast';
import { ConnectionGuard } from './components/ConnectionGuard';
import { BreakLapsedPrompt } from './components/BreakExtend';
import { useAuth } from './auth/AuthContext';
import './i18n';

// Its own leaf (owner, 07.11.2026): the location gate reads the shift and the
// order list, and their refreshes must not re-render the whole navigator.
function DriverLocation() {
  useDriverLocation();
  return null;
}

/** "Your break has ended": drivers only (owner, 12.11.2026). */
function DriverBreakPrompt() {
  const { user } = useAuth();
  return user?.role === 'driver' ? <BreakLapsedPrompt /> : null;
}

function AppInner() {
  // A change reaches the phone the moment the app is opened, not the opening
  // after that.
  useAppUpdates();
  // Test phones take a new update before everyone else (owner, 09.11.2026).
  useUpdateChannel();
  usePushNotifications();
  return (
    <>
      <DriverLocation />
      <RootNavigator />
      <ConnectionGuard />
      <DriverBreakPrompt />
      <StatusBar style={isDarkTheme ? 'light' : 'dark'} />
    </>
  );
}

/**
 * Whether this app's screen has been in front at least once since the code
 * started (owner, 12.11.2026). Android may start the code with no screen at
 * all — the location services brought back after the app was swiped away —
 * and then the whole app ran unseen: a GPS read and a post every 5 s, the
 * update check, the polling. Until the screen is shown nothing of the app
 * runs; the background location tasks are module-level and work regardless.
 */
function useScreenShown(): boolean {
  const [shown, setShown] = useState(AppState.currentState === 'active');
  useEffect(() => {
    if (shown) return;
    if (AppState.currentState === 'active') {
      setShown(true);
      return;
    }
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setShown(true);
    });
    return () => sub.remove();
  }, [shown]);
  return shown;
}

function App() {
  const shown = useScreenShown();
  if (!shown) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <AppInner />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default App;
registerRootComponent(App);
