/**
 * CalendarWidget.example.tsx — the single copyable wiring truth for CalendarWidget.
 *
 * This file is STATIC (no Jinja2, no conditional emission) and is compiled by
 * the contract tsc-gate against the frozen hotel fixture (entity `buchung` with
 * fields `gast`/`anreise`/`abreise`/`zimmer`; entity `zimmer` with field `name`). It
 * shows the full wiring the agent reproduces in the dashboard: map records →
 * CalendarEvent[], open a <RecordOverlay> on click, reschedule via drag, render
 * a custom chip with tone, drill in from an empty slot. Copy a block, swap the
 * field names, ship.
 *
 * Every import resolves; every enum value is a real one; there is NO `parseId`
 * helper — the event id is built with a template literal and read back with
 * `id.split(':')` (the family convention, exactly as RecordView does).
 *
 * Service / type names are EXACTLY what the generators derive from the fixture
 * keys: app key `buchung` → interface `Buchung`, `APP_IDS.BUCHUNG`, methods
 * `getBuchung()` / `updateBuchungEntry(id, fields)` (the singular helper appends
 * `Entry` when the name has no trailing 's' to drop); app key `zimmer` →
 * interface `Zimmer`, `APP_IDS.ZIMMER`, method `getZimmer()`.
 */
import { useEffect, useMemo, useState } from 'react';
import { de } from 'date-fns/locale';
import { parseISO, isBefore, startOfToday } from 'date-fns';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import type { Buchung, Zimmer } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { formatDate } from '@/lib/formatters';
import { IconBed } from '@tabler/icons-react';
import {
  RecordOverlay,
  RecordHeader,
  RecordSection,
  RecordField,
  RecordAttachments,
  useRecordOverlayStack,
} from './RecordView';
import {
  CalendarWidget,
  CalendarToolbar,
  CalendarSkeleton,
  CalendarError,
  useCalendar,
  type CalendarEvent,
  type CalendarTone,
} from './CalendarWidget';

// The event id is a TEMPLATE LITERAL `${entity}:${recordId}` — no `parseId`
// helper exists. Read it back with split(':'). This is the family convention
// (RecordView's overlay stack does the same with { type, id }).
const EVENT_PREFIX = 'buchung';
function buchungIdOf(ev: CalendarEvent): string {
  return ev.id.split(':')[1] ?? '';
}

// Map a `zimmer` applookup URL (the value Living-Apps stores) to its label by id.
// Inline literal — never a phantom import.
function makeGetZimmerName(zimmerList: Zimmer[]) {
  return (url?: unknown): string => {
    if (!url) return 'Ohne Zimmer';
    const refId = extractRecordId(url);
    return zimmerList.find(z => z.record_id === refId)?.fields.name ?? 'Ohne Zimmer';
  };
}

// tone is a CLOSED enum (CalendarTone). Pick from a real value — `'danger'` does
// NOT exist; the closest is `'destructive'`. Anything richer than a colour
// (icon, badge) belongs in renderEvent, not in a new prop.
function toneForBuchung(b: Buchung): CalendarTone {
  if (!b.fields.anreise) return 'warning';                   // missing date → needs attention
  return isBefore(parseISO(b.fields.anreise), startOfToday()) ? 'default' : 'primary';
}

export function HotelCalendarExample() {
  const [buchungen, setBuchungen] = useState<Buchung[]>([]);
  const [zimmerList, setZimmerList] = useState<Zimmer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const cal = useCalendar({ initialView: 'month' });
  const overlay = useRecordOverlayStack<{ type: string; id: string }>();
  const getZimmerName = makeGetZimmerName(zimmerList);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, z] = await Promise.all([LivingAppsService.getBuchung(), LivingAppsService.getZimmer()]);
      setBuchungen(b);
      setZimmerList(z);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  // Records → the widget's lean, data-agnostic event shape. The field names
  // (gast/anreise/abreise/zimmer) live HERE, in the consumer — never in the widget.
  const events = useMemo<CalendarEvent[]>(
    () =>
      buchungen
        .filter(b => !!b.fields.anreise)
        .map(b => ({
          id: `${EVENT_PREFIX}:${b.record_id}`,
          start: b.fields.anreise!,
          end: b.fields.abreise,             // optional → newEnd only fires when this exists
          allDay: true,                      // date-only fields are all-day bookings
          title: b.fields.gast ?? 'Ohne Gast',
          subtitle: getZimmerName(b.fields.zimmer),
          tone: toneForBuchung(b),
        })),
    [buchungen, zimmerList],
  );

  // Reschedule on drag. DRAG IS OFF until onEventDrop is passed. Optimistic
  // patch, re-fetch on error. newEnd is undefined when the event has no `abreise`
  // — patch the end field ONLY when it is present (the family idiom).
  const reschedule = async (eventId: string, newStart: string, newEnd?: string) => {
    const rid = eventId.split(':')[1];
    if (!rid) return;
    setBuchungen(prev =>
      prev.map(b =>
        b.record_id === rid
          ? { ...b, fields: { ...b.fields, anreise: newStart, ...(newEnd ? { abreise: newEnd } : {}) } }
          : b,
      ),
    );
    try {
      await LivingAppsService.updateBuchungEntry(rid, { anreise: newStart, ...(newEnd ? { abreise: newEnd } : {}) });
    } catch {
      await reload();
    }
  };

  if (loading) return <CalendarSkeleton />;
  if (error) return <CalendarError error={error} onRetry={() => void reload()} />;

  const currentBuchung = overlay.top ? buchungen.find(b => b.record_id === overlay.top!.id) : undefined;

  return (
    <>
      <CalendarWidget
        events={events}
        view={cal.view}
        referenceDate={cal.cursor}
        locale={de}
        onViewChange={cal.setView}
        onRangeChange={(from, to) => {
          // Lazy-load hook: scope a fetch to the visible window if needed.
          void from; void to;
        }}
        onEventClick={ev => overlay.replace({ type: EVENT_PREFIX, id: buchungIdOf(ev) })}
        onEventDrop={reschedule}
        onEmptyClick={date => {
          // Empty-slot tap. `group` (2nd arg) is ALWAYS undefined here — the
          // calendar has no second axis. Drill into the day instead of booking.
          cal.setCursor(date);
          cal.setView('day');
        }}
        renderEvent={(ev, meta) => (
          // tone comes from the event; the chip itself is fully ours via render-prop.
          <div
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
              ev.tone === 'primary' ? 'bg-primary/15 text-primary' : 'bg-muted text-foreground'
            } ${meta.isStart ? 'rounded-l-md' : ''} ${meta.isEnd ? 'rounded-r-md' : ''}`}
          >
            <IconBed className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{ev.title}</span>
          </div>
        )}
      >
        <CalendarToolbar calendar={cal} locale={de} />
      </CalendarWidget>

      {/* A clicked event opens a <RecordOverlay> — the calendar owns no detail layer. */}
      <RecordOverlay open={overlay.open} onClose={overlay.close} ariaLabel="Buchung">
        {currentBuchung && (
          <>
            <RecordHeader
              title={currentBuchung.fields.gast ?? 'Ohne Gast'}
              subtitle={getZimmerName(currentBuchung.fields.zimmer)}
              meta={
                <>
                  {formatDate(currentBuchung.fields.anreise)}
                  {currentBuchung.fields.abreise ? ` – ${formatDate(currentBuchung.fields.abreise)}` : ''}
                </>
              }
            />
            <RecordSection title="Zeitraum" cols={2}>
              <RecordField label="Anreise" value={currentBuchung.fields.anreise} format="date" />
              <RecordField label="Abreise" value={currentBuchung.fields.abreise} format="date" />
            </RecordSection>
            <RecordAttachments appId={APP_IDS.BUCHUNG} recordId={currentBuchung.record_id} />
          </>
        )}
      </RecordOverlay>
    </>
  );
}
