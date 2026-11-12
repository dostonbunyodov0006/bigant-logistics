/**
 * Carries "open the end-of-day reminder" from a push tap to the home screen.
 *
 * The tap is handled in usePushNotifications, which lives above navigation;
 * the sheet lives inside the driver's home. When the tap cold-starts the app
 * the home is not mounted yet, so the request waits here until it is.
 */
type Listener = () => void;

let listener: Listener | null = null;
let pending = false;

export const shiftPrompt = {
  /** A reminder push was tapped. */
  open(): void {
    if (listener) listener();
    else pending = true;
  },
  /** The home screen takes the requests; one that came before it is delivered at once. */
  subscribe(fn: Listener): () => void {
    listener = fn;
    if (pending) {
      pending = false;
      fn();
    }
    return () => {
      if (listener === fn) listener = null;
    };
  },
};
