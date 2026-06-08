import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichTerminbuchungen } from '@/lib/enrich';
import type { EnrichedTerminbuchungen } from '@/types/enriched';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { useState, useMemo, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { IconAlertCircle, IconTool, IconRefresh, IconCheck, IconPlus, IconPencil, IconTrash, IconDroplet, IconUsers, IconCalendar, IconClock } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { de } from 'date-fns/locale';
import { format, parseISO, startOfDay, addMinutes } from 'date-fns';
import {
  ResourceTimeline,
  ResourceTimelineSkeleton,
  ResourceTimelineError,
  type ResourceEvent,
  type ResourceGroup,
} from '@/components/widgets/ResourceTimeline';
import {
  RecordOverlay,
  RecordHeader,
  RecordSection,
  RecordField,
  RecordAttachments,
  useRecordOverlayStack,
} from '@/components/widgets/RecordView';
import { TerminbuchungenDialog } from '@/components/dialogs/TerminbuchungenDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatCard } from '@/components/StatCard';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';

// ─── constants ────────────────────────────────────────────────────────────────

const EVENT_PREFIX = 'termin';
const APPGROUP_ID = '6a214aad1e475090ad5bce57';
const REPAIR_ENDPOINT = '/claude/build/repair';

// Rooms in display order — keyed by LOOKUP_OPTIONS key
const ROOMS: ResourceGroup[] = [
  { key: 'raum_1', label: 'Raum 1', tone: 'primary' },
  { key: 'raum_2', label: 'Raum 2', tone: 'success' },
  { key: 'raum_3', label: 'Raum 3', tone: 'warning' },
];

// Slots: 8:00 – 11:40 in 20-min steps (last slot ends at 12:00)
const SLOT_MINUTES = 20;
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 12;

function terminIdOf(id: string): string {
  return id.split(':')[1] ?? '';
}

function toIsoMinute(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

// ─── conflict check ────────────────────────────────────────────────────────
/** Returns true if a room is already booked at that slot start (same day + same ISO minute). */
function isSlotTaken(
  terminbuchungen: EnrichedTerminbuchungen[],
  slotStart: Date,
  roomKey: string,
  excludeRecordId?: string,
): boolean {
  const slotIso = toIsoMinute(slotStart);
  return terminbuchungen.some(t => {
    if (excludeRecordId && t.record_id === excludeRecordId) return false;
    if (!t.fields.termin) return false;
    const roomMatch = t.fields.behandlungsraum?.key === roomKey;
    const timeMatch = t.fields.termin.slice(0, 16) === slotIso;
    return roomMatch && timeMatch;
  });
}

// ─── main component ────────────────────────────────────────────────────────

export default function DashboardOverview() {
  const {
    patienten, terminbuchungen,
    patientenMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const enrichedTerminbuchungen = enrichTerminbuchungen(terminbuchungen, { patientenMap });

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<EnrichedTerminbuchungen | null>(null);
  const [defaultFields, setDefaultFields] = useState<Record<string, unknown> | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  // Overlay (detail view on click)
  const overlay = useRecordOverlayStack<{ id: string }>();

  // ── KPI helpers ──────────────────────────────────────────────────────────
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  const todayBookings = useMemo(
    () => enrichedTerminbuchungen.filter(t => t.fields.termin?.startsWith(today)),
    [enrichedTerminbuchungen, today],
  );

  const totalSlots = (DAY_END_HOUR - DAY_START_HOUR) * (60 / SLOT_MINUTES) * ROOMS.length; // 12 slots × 3 rooms = 36
  const occupancyToday = todayBookings.length;
  const occupancyPct = Math.round((occupancyToday / totalSlots) * 100);

  // ── ResourceTimeline events ──────────────────────────────────────────────
  const events = useMemo<ResourceEvent[]>(
    () =>
      enrichedTerminbuchungen
        .filter(t => !!t.fields.termin && !!t.fields.behandlungsraum?.key)
        .map(t => {
          const startIso = t.fields.termin!.slice(0, 16);
          const endDate = addMinutes(parseISO(startIso), SLOT_MINUTES);
          return {
            id: `${EVENT_PREFIX}:${t.record_id}`,
            start: startIso,
            end: toIsoMinute(endDate),
            title: t.patientName || 'Patient',
            subtitle: format(parseISO(startIso), 'HH:mm', { locale: de }),
            tone: 'primary' as const,
            group: t.fields.behandlungsraum!.key,
          };
        }),
    [enrichedTerminbuchungen],
  );

  // ── empty-click → prefilled create dialog ────────────────────────────────
  const handleEmptyClick = useCallback(
    (date: Date, group?: string) => {
      if (!group) return;
      const roomKey = group;
      // Snap to 20-min boundary within 8–12 range
      const h = date.getHours();
      const m = Math.floor(date.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES;
      const slotStart = startOfDay(date);
      slotStart.setHours(h, m, 0, 0);
      if (h < DAY_START_HOUR || h >= DAY_END_HOUR) return; // outside window

      if (isSlotTaken(enrichedTerminbuchungen, slotStart, roomKey)) {
        setConflictMsg(`${ROOMS.find(r => r.key === roomKey)?.label} ist um ${format(slotStart, 'HH:mm')} bereits belegt.`);
        return;
      }

      const roomOpt = LOOKUP_OPTIONS['terminbuchungen']?.['behandlungsraum']?.find(o => o.key === roomKey);
      setDefaultFields({
        termin: toIsoMinute(slotStart),
        behandlungsraum: roomOpt ?? { key: roomKey, label: roomKey },
      });
      setEditingRecord(null);
      setDialogOpen(true);
    },
    [enrichedTerminbuchungen],
  );

  // ── drag reschedule ───────────────────────────────────────────────────────
  const handleEventDrop = useCallback(
    async (id: string, newStart: string, _newEnd?: string, newGroup?: string) => {
      const rid = terminIdOf(id);
      if (!rid) return;
      const slotStart = parseISO(newStart);
      const roomKey = newGroup ?? enrichedTerminbuchungen.find(t => t.record_id === rid)?.fields.behandlungsraum?.key ?? '';

      // Conflict check (exclude self)
      if (isSlotTaken(enrichedTerminbuchungen, slotStart, roomKey, rid)) {
        setConflictMsg(`${ROOMS.find(r => r.key === roomKey)?.label} ist um ${format(slotStart, 'HH:mm')} bereits belegt.`);
        return;
      }

      const roomOpt = LOOKUP_OPTIONS['terminbuchungen']?.['behandlungsraum']?.find(o => o.key === roomKey);
      try {
        await LivingAppsService.updateTerminbuchungenEntry(rid, {
          termin: newStart.slice(0, 16),
          ...(newGroup && roomOpt ? { behandlungsraum: roomOpt } : {}),
        });
        fetchAll();
      } catch {
        fetchAll();
      }
    },
    [enrichedTerminbuchungen, fetchAll],
  );

  // ── edit / delete ─────────────────────────────────────────────────────────
  const handleEventClick = useCallback(
    (ev: ResourceEvent) => {
      overlay.replace({ id: terminIdOf(ev.id) });
    },
    [overlay],
  );

  const currentTermin = overlay.top
    ? enrichedTerminbuchungen.find(t => t.record_id === overlay.top!.id)
    : undefined;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await LivingAppsService.deleteTerminbuchungenEntry(deleteTarget);
    fetchAll();
    overlay.close();
    setDeleteTarget(null);
  };

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Blutabnahme-Termine</h1>
          <p className="text-sm text-muted-foreground">
            {format(new Date(), 'EEEE, d. MMMM yyyy', { locale: de })}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditingRecord(null);
            setDefaultFields(undefined);
            setDialogOpen(true);
          }}
        >
          <IconPlus size={16} className="mr-1 shrink-0" />
          Neuer Termin
        </Button>
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="Termine heute"
          value={String(todayBookings.length)}
          description={`von ${totalSlots} Slots`}
          icon={<IconCalendar size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Auslastung"
          value={`${occupancyPct}%`}
          description="heute"
          icon={<IconDroplet size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Patienten"
          value={String(patienten.length)}
          description="gesamt"
          icon={<IconUsers size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Gesamt-Termine"
          value={String(terminbuchungen.length)}
          description="alle Zeiträume"
          icon={<IconClock size={18} className="text-muted-foreground" />}
        />
      </div>

      {/* ── Conflict toast ───────────────────────────────────────────────── */}
      {conflictMsg && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
          <IconAlertCircle size={18} className="text-destructive shrink-0" />
          <p className="text-sm text-destructive flex-1">{conflictMsg}</p>
          <button
            className="text-destructive/60 hover:text-destructive text-xs underline shrink-0"
            onClick={() => setConflictMsg(null)}
          >
            Schließen
          </button>
        </div>
      )}

      {/* ── Timeline ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        <ResourceTimeline
          events={events}
          groups={ROOMS}
          axis="time"
          dayStartHour={DAY_START_HOUR}
          dayEndHour={DAY_END_HOUR}
          dragSnapMinutes={SLOT_MINUTES}
          locale={de}
          onEventClick={handleEventClick}
          onEmptyClick={handleEmptyClick}
          onEventDrop={handleEventDrop}
          renderGroupHeader={group => (
            <div className="flex w-full flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">{group.label}</span>
              <span className="text-[11px] text-muted-foreground">
                {enrichedTerminbuchungen.filter(
                  t => t.fields.behandlungsraum?.key === group.key && t.fields.termin?.startsWith(today),
                ).length}{' '}
                Termine heute
              </span>
            </div>
          )}
          renderEmptySlot={(date, group) => {
            const taken = isSlotTaken(enrichedTerminbuchungen, date, group);
            return (
              <div
                className={`flex h-full w-full items-center justify-center rounded text-[10px] font-medium transition-colors ${
                  taken
                    ? 'bg-muted/30 text-muted-foreground cursor-not-allowed'
                    : 'text-muted-foreground/50 hover:bg-primary/5 hover:text-primary cursor-pointer'
                }`}
              >
                {!taken && <IconPlus size={12} className="shrink-0" />}
              </div>
            );
          }}
        />
      </div>

      {/* ── Today's list ─────────────────────────────────────────────────── */}
      {todayBookings.length > 0 && (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b">
            <h2 className="text-sm font-semibold text-foreground">Heutige Termine</h2>
          </div>
          <div className="divide-y">
            {todayBookings
              .slice()
              .sort((a, b) => (a.fields.termin ?? '').localeCompare(b.fields.termin ?? ''))
              .map(t => (
                <div key={t.record_id} className="flex items-center gap-3 px-4 py-3">
                  <div className="shrink-0 w-14 text-center">
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {t.fields.termin ? format(parseISO(t.fields.termin.slice(0, 16)), 'HH:mm') : '—'}
                    </span>
                  </div>
                  <div className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {t.fields.behandlungsraum?.label ?? '—'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate block">{t.patientName || '—'}</span>
                    {t.fields.bemerkungen && (
                      <span className="text-xs text-muted-foreground truncate block">{t.fields.bemerkungen}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditingRecord(t);
                        setDefaultFields(undefined);
                        setDialogOpen(true);
                      }}
                    >
                      <IconPencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(t.record_id)}
                    >
                      <IconTrash size={14} />
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Create / Edit dialog ──────────────────────────────────────────── */}
      <TerminbuchungenDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingRecord(null);
          setDefaultFields(undefined);
        }}
        onSubmit={async fields => {
          // Slot conflict check before save
          if (fields.termin && (fields.behandlungsraum as { key?: string } | undefined)?.key) {
            const roomKey = (fields.behandlungsraum as { key: string }).key;
            const slotStart = parseISO(String(fields.termin).slice(0, 16));
            if (isSlotTaken(enrichedTerminbuchungen, slotStart, roomKey, editingRecord?.record_id)) {
              const roomLabel = ROOMS.find(r => r.key === roomKey)?.label ?? roomKey;
              setConflictMsg(`${roomLabel} ist um ${format(slotStart, 'HH:mm')} bereits belegt. Bitte wähle einen anderen Slot.`);
              throw new Error('Slot bereits belegt');
            }
          }
          if (editingRecord) {
            await LivingAppsService.updateTerminbuchungenEntry(editingRecord.record_id, fields);
          } else {
            await LivingAppsService.createTerminbuchungenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingRecord?.fields ?? defaultFields}
        recordId={editingRecord?.record_id}
        patientenList={patienten}
        enablePhotoScan={AI_PHOTO_SCAN['Terminbuchungen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Terminbuchungen']}
      />

      {/* ── Delete confirm ────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Termin löschen"
        description="Möchtest du diesen Termin wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden."
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />

      {/* ── Record detail overlay ─────────────────────────────────────────── */}
      <RecordOverlay open={overlay.open} onClose={overlay.close} ariaLabel="Termin">
        {currentTermin && (
          <>
            <RecordHeader
              title={currentTermin.patientName || 'Patient'}
              meta={
                <>
                  {currentTermin.fields.behandlungsraum?.label ?? '—'} ·{' '}
                  {currentTermin.fields.termin
                    ? format(parseISO(currentTermin.fields.termin.slice(0, 16)), 'dd.MM.yyyy HH:mm', { locale: de })
                    : '—'}
                </>
              }
            />
            <RecordSection title="Termin-Details" cols={2}>
              <RecordField
                label="Datum & Uhrzeit"
                value={
                  currentTermin.fields.termin
                    ? format(parseISO(currentTermin.fields.termin.slice(0, 16)), 'EEEE, d. MMMM yyyy – HH:mm', { locale: de })
                    : undefined
                }
              />
              <RecordField label="Behandlungsraum" value={currentTermin.fields.behandlungsraum?.label} />
              <RecordField label="Patient" value={currentTermin.patientName || undefined} />
              <RecordField label="Slot-Ende" value={
                currentTermin.fields.termin
                  ? format(addMinutes(parseISO(currentTermin.fields.termin.slice(0, 16)), SLOT_MINUTES), 'HH:mm', { locale: de })
                  : undefined
              } />
            </RecordSection>
            {currentTermin.fields.bemerkungen && (
              <RecordSection title="Bemerkungen">
                <RecordField label="Notiz" value={currentTermin.fields.bemerkungen} />
              </RecordSection>
            )}
            <RecordAttachments appId={APP_IDS.TERMINBUCHUNGEN} recordId={currentTermin.record_id} />
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  overlay.close();
                  setEditingRecord(currentTermin);
                  setDefaultFields(undefined);
                  setDialogOpen(true);
                }}
              >
                <IconPencil size={14} className="mr-1 shrink-0" />
                Bearbeiten
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => {
                  setDeleteTarget(currentTermin.record_id);
                }}
              >
                <IconTrash size={14} className="mr-1 shrink-0" />
                Löschen
              </Button>
            </div>
          </>
        )}
      </RecordOverlay>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

// ─── Error ────────────────────────────────────────────────────────────────────

function DashboardError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const [repairing, setRepairing] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  const [repairDone, setRepairDone] = useState(false);
  const [repairFailed, setRepairFailed] = useState(false);

  const handleRepair = async () => {
    setRepairing(true);
    setRepairStatus('Reparatur wird gestartet...');
    setRepairFailed(false);

    const errorContext = JSON.stringify({
      type: 'data_loading',
      message: error.message,
      stack: (error.stack ?? '').split('\n').slice(0, 10).join('\n'),
      url: window.location.href,
    });

    try {
      const resp = await fetch(REPAIR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appgroup_id: APPGROUP_ID, error_context: errorContext }),
      });

      if (!resp.ok || !resp.body) {
        setRepairing(false);
        setRepairFailed(true);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data: ')) continue;
          const content = line.slice(6);
          if (content.startsWith('[STATUS]')) setRepairStatus(content.replace(/^\[STATUS]\s*/, ''));
          if (content.startsWith('[DONE]')) { setRepairDone(true); setRepairing(false); }
          if (content.startsWith('[ERROR]') && !content.includes('Dashboard-Links')) setRepairFailed(true);
        }
      }
    } catch {
      setRepairing(false);
      setRepairFailed(true);
    }
  };

  if (repairDone) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center">
          <IconCheck size={22} className="text-green-500" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold text-foreground mb-1">Dashboard repariert</h3>
          <p className="text-sm text-muted-foreground max-w-xs">Das Problem wurde behoben. Bitte lade die Seite neu.</p>
        </div>
        <Button size="sm" onClick={() => window.location.reload()}>
          <IconRefresh size={14} className="mr-1" />Neu laden
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
        <IconAlertCircle size={22} className="text-destructive" />
      </div>
      <div className="text-center">
        <h3 className="font-semibold text-foreground mb-1">Fehler beim Laden</h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          {repairing ? repairStatus : error.message}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onRetry} disabled={repairing}>Erneut versuchen</Button>
        <Button size="sm" onClick={handleRepair} disabled={repairing}>
          {repairing
            ? <span className="inline-block w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-1" />
            : <IconTool size={14} className="mr-1" />}
          {repairing ? 'Reparatur läuft...' : 'Dashboard reparieren'}
        </Button>
      </div>
      {repairFailed && <p className="text-sm text-destructive">Automatische Reparatur fehlgeschlagen. Bitte kontaktiere den Support.</p>}
    </div>
  );
}
