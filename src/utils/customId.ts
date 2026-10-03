/**
 * Construit un customId `namespace:arg1:arg2`.
 * Les arguments sont encodés pour ne jamais contenir ':'.
 * Limite Discord : 100 caractères.
 */
export function buildCustomId(namespace: string, ...args: (string | number | boolean | null | undefined)[]): string {
  const parts = [namespace, ...args.map((a) => encodeURIComponent(String(a ?? '')))];
  const id = parts.join(':');
  if (id.length > 100) throw new Error(`customId trop long (${id.length} > 100) : ${id}`);
  return id;
}

export function parseCustomId(customId: string): { namespace: string; args: string[] } {
  const [namespace, ...rest] = customId.split(':');
  return { namespace: namespace ?? '', args: rest.map((r) => safeDecode(r)) };
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
