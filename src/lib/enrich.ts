import type { EnrichedTerminbuchungen } from '@/types/enriched';
import type { Patienten, Terminbuchungen } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveDisplay(url: unknown, map: Map<string, any>, ...fields: string[]): string {
  if (!url) return '';
  const id = extractRecordId(url);
  if (!id) return '';
  const r = map.get(id);
  if (!r) return '';
  return fields.map(f => String(r.fields[f] ?? '')).join(' ').trim();
}

interface TerminbuchungenMaps {
  patientenMap: Map<string, Patienten>;
}

export function enrichTerminbuchungen(
  terminbuchungen: Terminbuchungen[],
  maps: TerminbuchungenMaps
): EnrichedTerminbuchungen[] {
  return terminbuchungen.map(r => ({
    ...r,
    patientName: resolveDisplay(r.fields.patient, maps.patientenMap, 'vorname', 'nachname'),
  }));
}
