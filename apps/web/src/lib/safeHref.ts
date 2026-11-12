/**
 * A link only to an http(s) address (06.11.2026): photo addresses come from
 * phones, and React renders `javascript:…` in href as given — a click would
 * run it in the console with the admin's session. Anything else: no link.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim()) ? url : undefined;
}
