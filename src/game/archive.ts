// Scan archive — pure store + localStorage serde. Never throws on bad data.

export interface ArchiveEntry {
  id: string;
  name: string;
  scans: number;
  /** epoch ms of the latest scan */
  last: number;
  resource: string;
  amount: number;
}

export interface Archive {
  scans: Record<string, ArchiveEntry>;
  resources: Record<string, number>;
}

export const ARCHIVE_KEY = 'seer.archive';

export function emptyArchive(): Archive {
  return { scans: {}, resources: {} };
}

/** pure: returns a new Archive with the scan recorded */
export function addScan(
  a: Archive,
  t: { id: string; name: string; resource: string; amount: number },
  now: number,
): Archive {
  const prev = a.scans[t.id];
  const entry: ArchiveEntry = prev
    ? { ...prev, name: t.name, resource: t.resource, amount: t.amount, scans: prev.scans + 1, last: now }
    : { id: t.id, name: t.name, scans: 1, last: now, resource: t.resource, amount: t.amount };
  return {
    scans: { ...a.scans, [t.id]: entry },
    resources: { ...a.resources, [t.resource]: (a.resources[t.resource] ?? 0) + t.amount },
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** bad JSON / missing top-level fields → emptyArchive(); malformed entries
 *  are sanitised. Never throws. */
export function parseArchive(raw: string | null): Archive {
  if (raw === null) return emptyArchive();
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return emptyArchive();
    const o = v as Record<string, unknown>;
    if (!o.scans || typeof o.scans !== 'object' || !o.resources || typeof o.resources !== 'object') {
      return emptyArchive();
    }
    const out = emptyArchive();
    for (const [k, e] of Object.entries(o.scans as Record<string, unknown>)) {
      if (!e || typeof e !== 'object') continue;
      const en = e as Record<string, unknown>;
      out.scans[k] = {
        id: str(en.id) || k,
        name: str(en.name),
        scans: num(en.scans),
        last: num(en.last),
        resource: str(en.resource),
        amount: num(en.amount),
      };
    }
    for (const [k, n] of Object.entries(o.resources as Record<string, unknown>)) {
      out.resources[k] = num(n);
    }
    return out;
  } catch {
    return emptyArchive();
  }
}

export function serializeArchive(a: Archive): string {
  return JSON.stringify(a);
}

export function totalScans(a: Archive): number {
  let n = 0;
  for (const e of Object.values(a.scans)) n += e.scans;
  return n;
}
