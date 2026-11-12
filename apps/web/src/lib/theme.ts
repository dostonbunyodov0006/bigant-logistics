export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'bigant.admin.theme';

function getSystemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getPreferredTheme(): Theme {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
  } catch {
    // Storage can be unavailable in private browsing; the system preference is
    // still a safe fallback.
  }

  return getSystemTheme();
}

export function getAppliedTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function applyTheme(theme: Theme, persist = true) {
  document.documentElement.classList.toggle('dark', theme === 'dark');

  if (!persist) return;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is optional and must not prevent switching themes.
  }
}

export function initializeTheme() {
  applyTheme(getPreferredTheme(), false);
}
