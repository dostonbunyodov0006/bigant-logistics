import { useLocation } from 'react-router-dom';

/**
 * Where the seller board lives: /seller for a seller, /statuslar inside the
 * admin console (owner, 05.11.2026). Links within the board follow it.
 */
export function useBoardBase(): '/seller' | '/statuslar' {
  return useLocation().pathname.startsWith('/statuslar') ? '/statuslar' : '/seller';
}
