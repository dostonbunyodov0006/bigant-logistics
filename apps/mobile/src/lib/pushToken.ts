/**
 * The FCM token this device registered with, remembered so that logging out
 * can take it off the account. Without that, a phone handed to another driver
 * kept receiving the first one's orders.
 *
 * Kept in its own module because the auth context and the push hook both need
 * it, and importing one from the other would close a cycle.
 */
let current: string | null = null;

export const pushToken = {
  get: () => current,
  set: (token: string | null) => {
    current = token;
  },
};
