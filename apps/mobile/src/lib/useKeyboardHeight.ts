import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How much of the screen the keyboard covers right now, in dp; 0 when hidden.
 *
 * Android used to shrink the window for the keyboard and every sheet rose
 * with it. Drawn edge to edge, the window keeps its size and the keyboard is
 * simply laid over the bottom — over the reason box a driver is typing into.
 * A sheet that adds this much padding at its foot rises clear of it, and
 * what he writes stays in view while he writes it. On iOS the avoiding view
 * does this already, so the answer is 0 there.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
