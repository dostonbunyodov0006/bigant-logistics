/**
 * "BIGANT sklad" → "BIGANT skladga", under the question "Tovar qayerga
 * qaytadi?".
 *
 * The list answers a question, so it reads as an answer. Uzbek spells the
 * dative three ways depending on the last sound: -ka after k, -qa after q,
 * -ga otherwise.
 */
export function toward(name: string): string {
  const last = name.trim().slice(-1).toLocaleLowerCase('uz');
  if (last === 'k') return `${name}ka`;
  if (last === 'q') return `${name}qa`;
  return `${name}ga`;
}
