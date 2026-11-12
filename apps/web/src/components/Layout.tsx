import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Role } from '@bigant/shared';
import logo from '../assets/logo.png';
import logoDark from '../assets/logo-dark.png';
import { useAuth } from '../auth/AuthContext';
import { NotificationsBell } from './NotificationsBell';
import { LanguageSwitcher } from './LanguageSwitcher';
import { applyTheme, getAppliedTheme } from '../lib/theme';

type NavKey =
  | 'nav.dashboard'
  | 'nav.orders'
  | 'nav.statuses'
  | 'nav.drivers'
  | 'nav.vehicles'
  | 'nav.staff'
  | 'nav.clients'
  | 'nav.pickupPlaces'
  | 'nav.documents'
  | 'nav.workHours'
  | 'nav.attendance'
  | 'nav.workReport'
  | 'nav.fines'
  | 'nav.payroll'
  | 'nav.leave'
  | 'nav.expenses'
  | 'nav.fuel'
  | 'nav.service'
  | 'nav.vozvrat'
  | 'nav.analytics'
  | 'nav.track'
  | 'nav.settings';

type GroupKey =
  | 'nav.groupOperations'
  | 'nav.groupFleet'
  | 'nav.groupDirectory'
  | 'nav.groupTime'
  | 'nav.groupFinance';

/**
 * `match` lists extra path prefixes that belong to this item, for detail routes
 * whose path does not start with the item's own (/sellers/:id under Staff).
 * Without it those pages would leave the sidebar with no group highlighted.
 */
type NavItem = { to: string; labelKey: NavKey; roles?: Role[]; match?: string[] };

// Sellers are deliberately absent from every `roles` list: App routes them to
// the dedicated /seller board and never renders this Layout, so listing them
// here would only imply access they cannot reach.
const STAFF: Role[] = ['admin', 'manager'];

/** A group with `to` is one link, not a list: its parts are tabs on its own page. */
const NAV_GROUPS: { titleKey: GroupKey; items: NavItem[]; to?: string }[] = [
  {
    titleKey: 'nav.groupOperations',
    items: [
      { to: '/', labelKey: 'nav.dashboard' },
      { to: '/orders', labelKey: 'nav.orders' },
      { to: '/statuslar', labelKey: 'nav.statuses' },
    ],
  },
  {
    titleKey: 'nav.groupFleet',
    items: [
      { to: '/drivers', labelKey: 'nav.drivers', roles: STAFF },
      { to: '/vehicles', labelKey: 'nav.vehicles', roles: STAFF },
    ],
  },
  {
    titleKey: 'nav.groupDirectory',
    items: [
      { to: '/clients', labelKey: 'nav.clients', roles: STAFF },
      { to: '/staff', labelKey: 'nav.staff', roles: STAFF, match: ['/sellers'] },
      { to: '/pickup-places', labelKey: 'nav.pickupPlaces', roles: STAFF },
    ],
  },
  {
    titleKey: 'nav.groupTime',
    // One press opens Ish vaqti with its parts side by side (owner, 30.10.2026).
    to: '/ish-vaqti',
    items: [{ to: '/ish-vaqti', labelKey: 'nav.workHours', roles: STAFF }],
  },
  {
    titleKey: 'nav.groupFinance',
    items: [
      { to: '/payroll', labelKey: 'nav.payroll', roles: STAFF },
      { to: '/expenses', labelKey: 'nav.expenses', roles: STAFF },
    ],
  },
];

// Pinned below a divider rather than inside a collapsible group.
const FOOTER_NAV: NavItem[] = [{ to: '/settings', labelKey: 'nav.settings', roles: STAFF }];

const STORAGE_KEY = 'bigant.nav.openGroups';

function loadOpenGroups(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    // Private mode or corrupt value: fall back to the active group.
    return null;
  }
}

function saveOpenGroups(keys: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Persistence is a convenience; a failure here must not break the nav.
  }
}

/** True when `pathname` is the item's own route or sits underneath it. */
function itemMatchesPath(item: NavItem, pathname: string): boolean {
  const prefixes = [item.to, ...(item.match ?? [])];
  return prefixes.some((p) =>
    p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`),
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'block rounded-lg px-3 py-2 text-sm font-medium transition',
    isActive ? 'bg-brand-tint text-brand-dark' : 'text-graphite hover:bg-paper',
  );

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={clsx('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
    >
      <path d="M7.5 4.5l5.5 5.5-5.5 5.5V4.5z" />
    </svg>
  );
}

/**
 * Grouped, collapsible sidebar. This was a flat list of 17 identical-looking
 * rows; collapsing the groups means only the section you are working in is
 * showing. Settings sits apart at the bottom because it is configuration
 * rather than a place you work.
 */
export function Layout() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const visible = (items: NavItem[]) =>
    items.filter((n) => !n.roles || (user != null && n.roles.includes(user.role)));

  // "Dispetcher", not the stored "manager" — the heading under his own name is
  // the one place the internal word used to show through.
  const ROLE_LABELS = {
    admin: 'nav.roleAdmin',
    manager: 'nav.roleManager',
    seller: 'nav.roleSeller',
    driver: 'nav.roleDriver',
  } as const;
  const roleLabel = user ? t(ROLE_LABELS[user.role]) : '';

  const groups = NAV_GROUPS.map((g) => ({ ...g, items: visible(g.items) })).filter(
    (g) => g.items.length > 0,
  );
  const footer = visible(FOOTER_NAV);

  // A driver only ever sees Operations; collapsing a single group (or labelling
  // it) is pure friction, so the links render bare.
  const collapsible = groups.length > 1;

  const activeGroup = groups.find((g) =>
    g.items.some((n) => itemMatchesPath(n, pathname)),
  )?.titleKey;

  const [open, setOpen] = useState<string[]>(
    () => loadOpenGroups() ?? (activeGroup ? [activeGroup] : []),
  );
  const [theme, setTheme] = useState(getAppliedTheme);
  // The gear at the top right (owner, 03.11.2026): who is signed in, the
  // notifications and Chiqish live behind it; language and theme stay outside.
  const [menuOpen, setMenuOpen] = useState(false);

  // Navigating into a collapsed group opens it, so a deep link or a redirect
  // never leaves you looking at a sidebar with no visible active item. Manual
  // collapses of other groups are preserved.
  useEffect(() => {
    if (!activeGroup) return;
    setOpen((cur) => (cur.includes(activeGroup) ? cur : [...cur, activeGroup]));
  }, [activeGroup]);

  useEffect(() => {
    saveOpenGroups(open);
  }, [open]);

  const toggle = (key: string) =>
    setOpen((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    setTheme(nextTheme);
  };

  return (
    <div className="admin-shell flex h-screen bg-paper text-ink transition-colors duration-200">
      <aside className="flex w-60 flex-col border-r border-mist bg-white">
        <div className="flex h-20 items-center border-b border-mist px-4">
          {/* The company logo as the owner gave it (03.11.2026), cut out of its white background. */}
          <img src={logo} alt="BIGANT" className="logo logo-light h-14 w-auto" />
          <img src={logoDark} alt="BIGANT" className="logo logo-dark h-14 w-auto" />
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          {groups.map((group) => {
            const isOpen = !collapsible || open.includes(group.titleKey);
            const panelId = `nav-${group.titleKey.replace(/\W/g, '-')}`;
            return (
              <div key={group.titleKey} className="mb-1 last:mb-0">
                {group.to ? (
                  <NavLink
                    // Set apart from the group above it.
                    style={{ marginTop: 4 }}
                    to={group.to}
                    className={({ isActive }) =>
                      clsx(
                        'flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider transition',
                        isActive ? 'bg-brand-tint text-brand-dark' : 'text-slate-light hover:bg-paper hover:text-slate',
                      )
                    }
                  >
                    {/* The same mark as the other group headings, so it reads as a
                        group of its own and not as the last line of the one above. */}
                    <Chevron open={false} />
                    <span>{t(group.titleKey)}</span>
                  </NavLink>
                ) : null}
                {!group.to && collapsible && (
                  <button
                    type="button"
                    onClick={() => toggle(group.titleKey)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-light transition hover:bg-paper hover:text-slate"
                  >
                    <Chevron open={isOpen} />
                    <span>{t(group.titleKey)}</span>
                    {/* A collapsed group still shows that the current page is
                        inside it, otherwise closing it hides where you are. */}
                    {!isOpen && group.titleKey === activeGroup && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" />
                    )}
                  </button>
                )}
                {!group.to && isOpen && (
                  <div id={panelId} className="mt-0.5 space-y-1 pb-2 pl-2">
                    {group.items.map((n) => (
                      <NavLink key={n.to} to={n.to} end={n.to === '/'} className={linkClass}>
                        {t(n.labelKey)}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {footer.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-mist pt-3">
              {footer.map((n) => (
                <NavLink key={n.to} to={n.to} className={linkClass}>
                  {t(n.labelKey)}
                </NavLink>
              ))}
            </div>
          )}
        </nav>

      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-end border-b border-mist bg-white px-6">
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={toggleTheme}
              className="btn-ghost h-9 w-9 p-0"
              aria-label={t(theme === 'dark' ? 'nav.enableLightMode' : 'nav.enableDarkMode')}
              title={t(theme === 'dark' ? 'nav.enableLightMode' : 'nav.enableDarkMode')}
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
                  <path
                    d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
                  <path
                    d="M20.5 15.4A8.5 8.5 0 0 1 8.6 3.5 8.5 8.5 0 1 0 20.5 15.4Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            <NotificationsBell />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="rounded-lg p-2 text-slate transition hover:bg-paper hover:text-ink"
                aria-label={t('nav.settings')}
                aria-expanded={menuOpen}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
                </svg>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                  <div className="absolute right-0 z-50 mt-2 w-64 overflow-visible rounded-xl border border-mist bg-white py-1 shadow-xl">
                    <div className="border-b border-mist px-4 py-2.5 leading-tight">
                      <div className="text-sm font-medium text-ink">{user?.name}</div>
                      <div className="text-xs uppercase tracking-wide text-slate-light">{roleLabel}</div>
                    </div>
                    <button
                      type="button"
                      onClick={logout}
                      className="flex w-full items-center gap-3 border-t border-mist px-4 py-2.5 text-left text-sm text-ink transition hover:bg-paper"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <path d="M16 17l5-5-5-5" />
                        <path d="M21 12H9" />
                      </svg>
                      {t('nav.signOut')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
