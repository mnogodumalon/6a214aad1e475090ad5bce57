import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Patienten, Terminbuchungen } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';

export function useDashboardData() {
  const [patienten, setPatienten] = useState<Patienten[]>([]);
  const [terminbuchungen, setTerminbuchungen] = useState<Terminbuchungen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [patientenData, terminbuchungenData] = await Promise.all([
        LivingAppsService.getPatienten(),
        LivingAppsService.getTerminbuchungen(),
      ]);
      setPatienten(patientenData);
      setTerminbuchungen(terminbuchungenData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Fehler beim Laden der Daten'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Silent background refresh (no loading state change → no flicker)
  useEffect(() => {
    async function silentRefresh() {
      try {
        const [patientenData, terminbuchungenData] = await Promise.all([
          LivingAppsService.getPatienten(),
          LivingAppsService.getTerminbuchungen(),
        ]);
        setPatienten(patientenData);
        setTerminbuchungen(terminbuchungenData);
      } catch {
        // silently ignore — stale data is better than no data
      }
    }
    function handleRefresh() { void silentRefresh(); }
    window.addEventListener('dashboard-refresh', handleRefresh);
    return () => window.removeEventListener('dashboard-refresh', handleRefresh);
  }, []);

  const patientenMap = useMemo(() => {
    const m = new Map<string, Patienten>();
    patienten.forEach(r => m.set(r.record_id, r));
    return m;
  }, [patienten]);

  return { patienten, setPatienten, terminbuchungen, setTerminbuchungen, loading, error, fetchAll, patientenMap };
}