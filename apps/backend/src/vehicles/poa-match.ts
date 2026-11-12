/**
 * Does a name on a power of attorney (ishonchnoma) mean this driver?
 *
 * The papers are typed by the state registry and the driver list by the
 * office, so one person is spelt several ways: "Naximov Ilxomjon" and
 * "Nahimov Ilhom", "Pulatov Husniddin" and "Pulatov Xusniddin", "Kadirov Vaxid" and
 * "Qodirov Abduvohid". Both sides are brought to a consonant skeleton (x/h,
 * q/k alike, vowels and apostrophes dropped); the surnames must agree, and
 * the given names must agree as far as the shorter one goes either way round.
 */
const skeleton = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ʻʼ'`‘’‛]/g, '')
    .replace(/x/g, 'h')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/[aeiouyё]/g, '')
    .replace(/(.)\1+/g, '$1');

const words = (s: string) =>
  s
    .replace(/\(.*?\)/g, ' ')
    .split(/[^\p{L}ʻʼ'`‘’]+/u)
    .filter(Boolean);

export function sameDriverName(onPaper: string, driver: string): boolean {
  const a = words(onPaper).map(skeleton).filter(Boolean);
  const b = words(driver).map(skeleton).filter(Boolean);
  if (a.length === 0 || b.length === 0) return false;
  // A one-word name in the office list ("Miraziz") is matched as it stands.
  if (b.length === 1) return a.includes(b[0]) && b[0].length >= 3;
  if (a[0] !== b[0]) return false;
  const [x, y] = [a[1] ?? '', b[1] ?? ''];
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

/** The people a power of attorney names, one per comma; dates in brackets dropped. */
export function namesOnPaper(holder: string | null | undefined): string[] {
  return (holder ?? '')
    .replace(/\(.*?\)/g, '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
