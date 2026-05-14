import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ChevronLeft, ChevronRight, Link2, Calendar as CalendarIcon, DollarSign, Edit2, Check, X, Settings2, Sun, Eye, Lock, RefreshCw } from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths,
  isToday, isSameDay, isBefore, isAfter, differenceInDays, isFriday, isSaturday,
  startOfWeek, endOfWeek, addWeeks, subWeeks, addDays
} from 'date-fns';
import { parseDateInTz, DEFAULT_TZ } from '@/lib/dates/propertyTz';

interface PropertyItem {
  id: string;
  title: string;
  cover_image: string | null;
  price_per_night: number;
  currency: string | null;
  min_nights: number | null;
  max_nights: number | null;
  timezone?: string | null;
  availability_settings?: unknown;
}

interface BookingBar {
  id: string;
  guestName: string;
  guestAvatar: string | null;
  checkIn: Date;
  checkOut: Date;
  status: string;
  numGuests: number;
  propertyId: string;
  totalPrice: number;
  nightlyRate: number;
  cleaningFee: number;
  serviceFee: number;
  numNights: number;
}

interface AvailabilityEntry {
  id: string;
  date: string;
  is_available: boolean | null;
  custom_price: number | null;
  property_id: string;
}

type ViewMode = 'month' | 'week';

export default function HostCalendar() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [bookings, setBookings] = useState<BookingBar[]>([]);
  const [availability, setAvailability] = useState<AvailabilityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<Date | null>(null);

  const [panelAvailable, setPanelAvailable] = useState(true);
  const [panelPrice, setPanelPrice] = useState('');

  const [editingBasePrice, setEditingBasePrice] = useState(false);
  const [basePriceInput, setBasePriceInput] = useState('');

  const [weekendPricingEnabled, setWeekendPricingEnabled] = useState(false);
  const [weekendPrice, setWeekendPrice] = useState('');
  const [editingWeekendPrice, setEditingWeekendPrice] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [minNights, setMinNights] = useState(1);
  const [maxNights, setMaxNights] = useState(365);
  const [advanceNotice, setAdvanceNotice] = useState('same_day');
  const [prepTime, setPrepTime] = useState('none');
  const [availWindow, setAvailWindow] = useState('12');

  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [syncUrl, setSyncUrl] = useState('');
  const [connectedCalendars, setConnectedCalendars] = useState<{ url: string; name: string; lastSync: string }[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const selectedProperty = properties.find(p => p.id === selectedPropertyId);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from('properties')
        .select('id, title, cover_image, price_per_night, currency, min_nights, max_nights, timezone, availability_settings')
        .eq('host_id', user.id)
        .eq('status', 'active');
      if (data && data.length > 0) {
        setProperties(data);
        setSelectedPropertyId(data[0].id);
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const refreshAvailability = useCallback(async () => {
    if (!selectedPropertyId) return;
    const start = startOfMonth(subMonths(currentMonth, 1));
    const end = endOfMonth(addMonths(currentMonth, 2));
    const { data } = await supabase.from('property_availability').select('*')
      .eq('property_id', selectedPropertyId)
      .gte('date', format(start, 'yyyy-MM-dd'))
      .lte('date', format(end, 'yyyy-MM-dd'));
    if (data) setAvailability(data);
  }, [selectedPropertyId, currentMonth]);

  useEffect(() => {
    if (!user || !selectedPropertyId) return;
    const start = startOfMonth(subMonths(currentMonth, 1));
    const end = endOfMonth(addMonths(currentMonth, 2));

    const fetchData = async () => {
      const { data: bData } = await supabase
        .from('bookings')
        .select('id, check_in_date, check_out_date, status, num_guests, guest_id, property_id, total_price, nightly_rate, cleaning_fee, service_fee, num_nights')
        .eq('property_id', selectedPropertyId)
        .in('status', ['confirmed', 'completed'])
        .gte('check_out_date', format(start, 'yyyy-MM-dd'))
        .lte('check_in_date', format(end, 'yyyy-MM-dd'));

      if (bData) {
        const guestIds = [...new Set(bData.map(b => b.guest_id))];
        const { data: profiles } = await supabase
          .from('profiles').select('user_id, full_name, avatar_url').in('user_id', guestIds);
        const pm = new Map(profiles?.map(p => [p.user_id, p]) || []);
        const tz = properties.find(p => p.id === selectedPropertyId)?.timezone || DEFAULT_TZ;
        setBookings(bData.map(b => {
          const prof = pm.get(b.guest_id);
          return {
            id: b.id, guestName: prof?.full_name || 'Guest', guestAvatar: prof?.avatar_url || null,
            // Anchor stay dates to the property's timezone so the calendar grid
            // shows the same day everywhere, not the viewer's local shift.
            checkIn: parseDateInTz(b.check_in_date, tz),
            checkOut: parseDateInTz(b.check_out_date, tz),
            status: b.status, numGuests: b.num_guests, propertyId: b.property_id,
            totalPrice: b.total_price, nightlyRate: b.nightly_rate,
            cleaningFee: b.cleaning_fee || 0, serviceFee: b.service_fee || 0,
            numNights: b.num_nights,
          };
        }));
      }
      await refreshAvailability();
    };
    fetchData();

    // Fallback refetch — guarantees the calendar reflects new paid bookings
    // even if realtime missed the UPDATE (websocket reconnect / mobile bg).
    // Triggered by BookingConfirmation after a successful payment, by other
    // tabs via the storage event, and when the host re-focuses this tab.
    const onStorage = (e: StorageEvent) => { if (e.key === 'bookings:refetch') fetchData(); };
    const onCustom = () => { fetchData(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchData(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('bookings:refetch', onCustom as EventListener);
    window.addEventListener('focus', onCustom);
    document.addEventListener('visibilitychange', onVisibility);

    // Also subscribe to realtime row changes for this property's bookings —
    // primary push channel, the listeners above are the safety net.
    // Track per-property toasts so a flurry of UPDATE events for the same
    // booking only produces one "new paid booking" notification.
    const toastedConfirmIds = new Set<string>();
    const channel = supabase
      .channel(`host-cal-bookings-${selectedPropertyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `property_id=eq.${selectedPropertyId}` },
        (payload) => {
          // Toast on the actual pending → confirmed transition so the host
          // sees a live signal that a guest's payment just landed and the
          // calendar is being updated.
          if (payload.eventType === 'UPDATE') {
            const newRow = payload.new as { id?: string; status?: string };
            const oldRow = payload.old as { status?: string };
            if (
              newRow?.id &&
              newRow.status === 'confirmed' &&
              oldRow?.status === 'pending' &&
              !toastedConfirmIds.has(newRow.id)
            ) {
              toastedConfirmIds.add(newRow.id);
              toast({
                title: 'New booking confirmed',
                description: 'Updating the calendar with the new reservation…',
              });
            }
          }
          fetchData();
        },
      )
      .subscribe();

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('bookings:refetch', onCustom as EventListener);
      window.removeEventListener('focus', onCustom);
      document.removeEventListener('visibilitychange', onVisibility);
      supabase.removeChannel(channel);
    };
  }, [user, selectedPropertyId, currentMonth, refreshAvailability]);

  // Auto-sync connected iCal calendars every 2 hours
  useEffect(() => {
    if (connectedCalendars.length === 0 || !selectedPropertyId) return;
    const syncAll = async () => {
      for (const cal of connectedCalendars) {
        try {
          const resp = await fetch(cal.url);
          if (!resp.ok) continue;
          const text = await resp.text();
          const events = text.split('BEGIN:VEVENT');
          for (const event of events.slice(1)) {
            const dtStartMatch = event.match(/DTSTART[^:]*:(\d{8})/);
            const dtEndMatch = event.match(/DTEND[^:]*:(\d{8})/);
            if (dtStartMatch && dtEndMatch) {
              const s = dtStartMatch[1];
              const e = dtEndMatch[1];
              const sd = new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`);
              const ed = new Date(`${e.slice(0,4)}-${e.slice(4,6)}-${e.slice(6,8)}`);
              if (!isNaN(sd.getTime()) && !isNaN(ed.getTime())) {
                const ae = new Date(ed); ae.setDate(ae.getDate() - 1);
                const days = sd <= ae ? eachDayOfInterval({ start: sd, end: ae }) : [sd];
                for (const day of days) {
                  const ds = format(day, 'yyyy-MM-dd');
                  const ex = availability.find(a => a.date === ds && a.property_id === selectedPropertyId);
                  if (ex) { if (ex.is_available !== false) await supabase.from('property_availability').update({ is_available: false }).eq('id', ex.id); }
                  else await supabase.from('property_availability').insert({ property_id: selectedPropertyId, date: ds, is_available: false });
                }
              }
            }
          }
        } catch { /* skip */ }
      }
      setConnectedCalendars(prev => prev.map(c => ({ ...c, lastSync: new Date().toISOString() })));
      await refreshAvailability();
    };
    syncAll();
    const iv = setInterval(syncAll, 2 * 60 * 60 * 1000);
    return () => clearInterval(iv);
  }, [connectedCalendars.length, selectedPropertyId]);

  useEffect(() => {
    if (selectedProperty) {
      setMinNights(selectedProperty.min_nights || 1);
      setMaxNights(selectedProperty.max_nights || 365);
      setBasePriceInput(String(selectedProperty.price_per_night));
      if (!weekendPrice) setWeekendPrice(String(Math.round(selectedProperty.price_per_night * 1.2)));
      // Hydrate availability settings from the property record so the dialog
      // always reflects what is actually saved server-side.
      const s = (selectedProperty.availability_settings ?? {}) as {
        advance_notice?: string;
        preparation_time?: string;
        availability_window?: string;
      };
      setAdvanceNotice(s.advance_notice ?? 'same_day');
      setPrepTime(s.preparation_time ?? 'none');
      setAvailWindow(s.availability_window ?? '12');
    }
  }, [selectedProperty]);

  useEffect(() => {
    if (selectedDates.length > 0) {
      const firstDate = selectedDates[0];
      const booked = isBookedDate(firstDate);
      const blocked = isBlocked(firstDate);
      if (booked || blocked) {
        // Don't allow editing availability/price for booked/blocked dates
        setPanelAvailable(false);
        setPanelPrice('');
      } else {
        const avail = getAvailForDate(firstDate);
        setPanelAvailable(avail?.is_available !== false);
        setPanelPrice(String(getPriceForDate(firstDate)));
      }
    }
  }, [selectedDates]);

  const getAvailForDate = (date: Date): AvailabilityEntry | undefined => {
    return availability.find(a => a.date === format(date, 'yyyy-MM-dd'));
  };

  const getBookingsForDate = (date: Date): BookingBar[] => {
    return bookings.filter(b =>
      b.status !== 'cancelled' &&
      (isSameDay(date, b.checkIn) || isAfter(date, b.checkIn)) && isBefore(date, b.checkOut)
    );
  };

  // Weekend = Friday, Saturday, Sunday
  const isWeekendDay = (date: Date): boolean => {
    const d = date.getDay(); // 0=Sun, 5=Fri, 6=Sat
    return d === 0 || d === 5 || d === 6;
  };

  const getPriceForDate = (date: Date): number => {
    const avail = getAvailForDate(date);
    if (avail?.custom_price) return avail.custom_price;
    if (weekendPricingEnabled && isWeekendDay(date)) {
      return parseFloat(weekendPrice) || selectedProperty?.price_per_night || 0;
    }
    return selectedProperty?.price_per_night || 0;
  };

  const isBlocked = (date: Date): boolean => getAvailForDate(date)?.is_available === false;

  const isBookedDate = (date: Date): boolean => {
    return bookings.some(b =>
      b.status !== 'cancelled' &&
      (isSameDay(date, b.checkIn) || isAfter(date, b.checkIn)) && isBefore(date, b.checkOut)
    );
  };

  const handleDateMouseDown = (date: Date) => {
    setIsDragging(true);
    dragStartRef.current = date;
    setSelectedDates([date]);
  };
  const handleDateMouseEnter = (date: Date) => {
    if (!isDragging || !dragStartRef.current) return;
    const s = dragStartRef.current;
    const [a, b] = isBefore(date, s) ? [date, s] : [s, date];
    setSelectedDates(eachDayOfInterval({ start: a, end: b }));
  };
  const handleDateMouseUp = () => setIsDragging(false);

  const handleSaveDateChanges = async () => {
    if (!selectedPropertyId || selectedDates.length === 0) return;
    // Don't allow changes on booked dates
    const editableDates = selectedDates.filter(d => !isBookedDate(d));
    if (editableDates.length === 0) {
      toast({ title: 'Cannot modify', description: 'Booked dates cannot be changed.', variant: 'destructive' });
      return;
    }
    const price = parseFloat(panelPrice) || null;

    for (const date of editableDates) {
      const dateStr = format(date, 'yyyy-MM-dd');
      const existing = availability.find(a => a.date === dateStr && a.property_id === selectedPropertyId);
      if (existing) {
        await supabase.from('property_availability').update({ is_available: panelAvailable, custom_price: price }).eq('id', existing.id);
      } else {
        await supabase.from('property_availability').insert({ property_id: selectedPropertyId, date: dateStr, is_available: panelAvailable, custom_price: price });
      }
    }
    await refreshAvailability();
    toast({ title: 'Calendar updated', description: `${editableDates.length} date(s) updated.` });
    setSelectedDates([]);
  };

  const handleSaveBasePrice = async () => {
    if (!selectedPropertyId) return;
    const newPrice = parseFloat(basePriceInput);
    if (isNaN(newPrice) || newPrice <= 0) return;
    await supabase.from('properties').update({ price_per_night: newPrice }).eq('id', selectedPropertyId);
    setProperties(prev => prev.map(p => p.id === selectedPropertyId ? { ...p, price_per_night: newPrice } : p));
    setEditingBasePrice(false);
    toast({ title: 'Base price updated', description: `Default nightly rate set to $${newPrice}.` });
  };

  const handleSaveWeekendPricing = async () => {
    if (!selectedPropertyId) return;
    const wp = parseFloat(weekendPrice);
    if (isNaN(wp) || wp <= 0) return;
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(addMonths(currentMonth, 1));
    const allDays = eachDayOfInterval({ start, end });
    const weekendDays = allDays.filter(d => isWeekendDay(d));

    for (const date of weekendDays) {
      const dateStr = format(date, 'yyyy-MM-dd');
      const existing = availability.find(a => a.date === dateStr && a.property_id === selectedPropertyId);
      if (existing) {
        if (!existing.custom_price || existing.custom_price === selectedProperty?.price_per_night) {
          await supabase.from('property_availability').update({ custom_price: wp }).eq('id', existing.id);
        }
      } else {
        await supabase.from('property_availability').insert({ property_id: selectedPropertyId, date: dateStr, is_available: true, custom_price: wp });
      }
    }
    await refreshAvailability();
    setEditingWeekendPrice(false);
    toast({ title: 'Weekend pricing applied', description: `Fri, Sat & Sun set to ${currSymbol}${wp}/night.` });
  };

  const handleSaveSettings = async () => {
    if (!selectedPropertyId) return;
    const availability_settings = {
      advance_notice: advanceNotice,
      preparation_time: prepTime,
      availability_window: availWindow,
    };
    const { error } = await supabase
      .from('properties')
      .update({ min_nights: minNights, max_nights: maxNights, availability_settings })
      .eq('id', selectedPropertyId);
    if (error) {
      toast({ title: 'Could not save settings', description: error.message, variant: 'destructive' });
      return;
    }
    // Reflect the saved values into local state so the calendar gates update
    // immediately without needing a full reload.
    setProperties(prev => prev.map(p => p.id === selectedPropertyId
      ? { ...p, min_nights: minNights, max_nights: maxNights, availability_settings }
      : p));
    toast({ title: 'Settings saved', description: 'Your availability rules now apply to new bookings.' });
    setShowSettings(false);
  };

  const handleConnectCalendar = async () => {
    if (!syncUrl.trim() || !selectedPropertyId) return;
    setIsSyncing(true);
    try {
      const url = new URL(syncUrl.trim());
      if (!url.pathname.includes('.ics') && !url.href.includes('ical')) {
        toast({ title: 'Invalid URL', description: 'Please provide a valid iCal (.ics) URL.', variant: 'destructive' });
        setIsSyncing(false);
        return;
      }
      let blocked = 0;
      try {
        const resp = await fetch(syncUrl.trim());
        if (resp.ok) {
          const text = await resp.text();
          const events = text.split('BEGIN:VEVENT');
          for (const event of events.slice(1)) {
            const dtStartMatch = event.match(/DTSTART[^:]*:(\d{8})/);
            const dtEndMatch = event.match(/DTEND[^:]*:(\d{8})/);
            if (dtStartMatch && dtEndMatch) {
              const startStr = dtStartMatch[1];
              const endStr = dtEndMatch[1];
              const startDate = new Date(`${startStr.slice(0, 4)}-${startStr.slice(4, 6)}-${startStr.slice(6, 8)}`);
              const endDate = new Date(`${endStr.slice(0, 4)}-${endStr.slice(4, 6)}-${endStr.slice(6, 8)}`);
              if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
                // Block check-in through day before checkout (checkout date stays available)
                const actualEnd = new Date(endDate);
                actualEnd.setDate(actualEnd.getDate() - 1);
                const days = startDate <= actualEnd ? eachDayOfInterval({ start: startDate, end: actualEnd }) : [startDate];
                for (const day of days) {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const existing = availability.find(a => a.date === dateStr && a.property_id === selectedPropertyId);
                  if (existing) {
                    await supabase.from('property_availability').update({ is_available: false }).eq('id', existing.id);
                  } else {
                    await supabase.from('property_availability').insert({ property_id: selectedPropertyId, date: dateStr, is_available: false });
                  }
                  blocked++;
                }
              }
            }
          }
        }
      } catch { /* CORS fallback */ }
      const name = url.hostname.replace('www.', '').split('.')[0];
      const calName = name.charAt(0).toUpperCase() + name.slice(1);
      setConnectedCalendars(prev => [...prev, { url: syncUrl.trim(), name: calName, lastSync: new Date().toISOString() }]);
      await refreshAvailability();
      toast({ title: 'Calendar connected', description: blocked > 0 ? `${blocked} dates blocked from ${calName}.` : `${calName} calendar linked.` });
      setSyncUrl('');
      setShowSyncDialog(false);
    } catch {
      toast({ title: 'Invalid URL', description: 'Please enter a valid calendar URL.', variant: 'destructive' });
    }
    setIsSyncing(false);
  };

  const currency = selectedProperty?.currency || 'USD';
  const currSymbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';

  const renderDayCell = (day: Date, monthDate: Date, cellHeight: string) => {
    const blocked = isBlocked(day);
    const booked = isBookedDate(day);
    const isSelected = selectedDates.some(d => isSameDay(d, day));
    const today = isToday(day);
    const past = isBefore(day, new Date()) && !today;
    const dayBookings = getBookingsForDate(day);
    const isWeekend = isWeekendDay(day);
    const isOutside = day.getMonth() !== monthDate.getMonth();
    const unavailable = blocked || booked;

    let bgClass = 'bg-background hover:bg-accent/30';
    if (isOutside) bgClass = 'bg-muted/10';
    else if (isSelected) bgClass = 'bg-primary/10 ring-1 ring-inset ring-primary/50';
    else if (booked) bgClass = 'bg-blue-50 dark:bg-blue-950/30';
    else if (blocked) bgClass = 'bg-muted';
    else if (past) bgClass = 'bg-muted/40';
    else if (isWeekend && weekendPricingEnabled) bgClass = 'bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/30';

    return (
      <div
        key={day.toISOString()}
        className={`${cellHeight} border-b border-r border-border p-1 select-none transition-colors relative ${bgClass} ${isOutside ? 'opacity-40' : ''} ${past ? 'cursor-not-allowed opacity-60 pointer-events-none' : 'cursor-pointer'}`}
        aria-disabled={past || undefined}
        onMouseDown={() => { if (isOutside || past) return; handleDateMouseDown(day); }}
        onMouseEnter={() => { if (past) return; handleDateMouseEnter(day); }}
      >
        <div className="flex items-start justify-between">
          <span className={`text-[11px] leading-none font-medium ${today ? 'w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px]' : ''} ${unavailable || past ? 'text-muted-foreground' : 'text-foreground'}`}>
            {format(day, 'd')}
          </span>
          {booked && <Lock className="w-2.5 h-2.5 text-blue-500" />}
          {blocked && !booked && <X className="w-2.5 h-2.5 text-destructive/60" />}
          {isWeekend && weekendPricingEnabled && !unavailable && !past && (
            <Sun className="w-2.5 h-2.5 text-amber-500" />
          )}
        </div>

        {/* Only show price for available, non-booked, non-blocked, future dates */}
        {!unavailable && !past && !isOutside && (
          <span className={`text-[10px] mt-0.5 block ${isWeekend && weekendPricingEnabled ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}`}>
            {currSymbol}{getPriceForDate(day)}
          </span>
        )}

        {/* Diagonal lines for manually blocked */}
        {blocked && !booked && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <svg className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <pattern id={`diag-${format(day, 'yyyy-MM-dd')}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" opacity="0.25" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#diag-${format(day, 'yyyy-MM-dd')})`} />
            </svg>
          </div>
        )}

        {/* Booking bars — render a segment at the start of each week-row the booking spans */}
        {dayBookings.map(booking => {
          // Last occupied day = day BEFORE checkout (checkout date stays free for new bookings)
          const lastOccupied = addDays(booking.checkOut, -1);
          const dayOfWeek = getDay(day); // 0 = Sun
          const isStartOfBooking = isSameDay(day, booking.checkIn);
          const isStartOfRow = dayOfWeek === 0;
          // Render segment only at booking start OR at start of a new week row while still within booking
          if (!isStartOfBooking && !isStartOfRow) return null;
          if (isAfter(day, lastOccupied)) return null;
          // Days remaining in this row from current cell
          const daysToRowEnd = 7 - dayOfWeek;
          // Days remaining in booking from current cell (inclusive) — extend slightly past checkout for visual continuity
          const daysToBookingEnd = differenceInDays(lastOccupied, day) + 1;
          const barLength = Math.max(1, Math.min(daysToRowEnd, daysToBookingEnd));
          const isCancelled = booking.status === 'cancelled';
          const isContinuation = !isStartOfBooking;
          const continuesNextRow = barLength < daysToBookingEnd;

          return (
            <div
              key={`${booking.id}-${format(day, 'yyyy-MM-dd')}`}
              className={`absolute bottom-1 left-0 h-5 flex items-center gap-1 px-1.5 text-[9px] font-semibold z-10 pointer-events-none truncate shadow-sm
                ${isCancelled ? 'bg-destructive/20 text-destructive line-through' : 'bg-destructive text-destructive-foreground'}
                ${isStartOfBooking ? 'rounded-l-md' : ''}
                ${!continuesNextRow && !isContinuation ? 'rounded-r-md' : ''}
                ${!continuesNextRow && isContinuation ? 'rounded-r-md' : ''}
                ${isStartOfBooking && !continuesNextRow ? 'rounded-md' : ''}
              `}
              style={{ width: `calc(${barLength * 100}% - 2px)` }}
            >
              {isStartOfBooking && booking.guestAvatar && (
                <img src={booking.guestAvatar} alt="" className="w-3 h-3 rounded-full object-cover shrink-0 ring-1 ring-destructive-foreground/40" />
              )}
              <span className="truncate">
                {isContinuation ? `↳ ${booking.guestName}` : booking.guestName}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderMonth = (monthDate: Date) => {
    const monthStart = startOfMonth(monthDate);
    const monthEnd = endOfMonth(monthDate);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const startDay = getDay(monthStart);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div key={monthDate.toISOString()} className="mb-6">
        <h2 className="text-sm font-semibold mb-3 text-foreground">{format(monthDate, 'MMMM yyyy')}</h2>
        <div className="grid grid-cols-7 border border-border rounded-t-lg overflow-hidden">
          {dayNames.map(d => (
            <div key={d} className="text-center text-[11px] text-muted-foreground py-2 font-medium bg-muted/50 border-b border-border">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-l border-border rounded-b-lg overflow-hidden" onMouseUp={handleDateMouseUp} onMouseLeave={() => { if (isDragging) handleDateMouseUp(); }}>
          {Array.from({ length: startDay }).map((_, i) => (
            <div key={`e-${i}`} className="h-[68px] border-b border-r border-border bg-muted/20" />
          ))}
          {days.map(day => renderDayCell(day, monthDate, 'h-[68px]'))}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="mb-6">
        <div className="grid grid-cols-7 border border-border rounded-t-lg overflow-hidden">
          {dayNames.map((d, i) => (
            <div key={d} className="text-center py-2 border-b border-border bg-muted/50">
              <div className="text-[11px] text-muted-foreground font-medium">{d}</div>
              <div className={`text-lg font-semibold mt-0.5 ${isToday(days[i]) ? 'text-primary' : 'text-foreground'}`}>{format(days[i], 'd')}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-l border-border rounded-b-lg overflow-hidden" onMouseUp={handleDateMouseUp} onMouseLeave={() => { if (isDragging) handleDateMouseUp(); }}>
          {days.map(day => renderDayCell(day, currentWeekStart, 'h-[160px]'))}
        </div>
      </div>
    );
  };

  // Build the right panel content for selected dates
  const selectedDateRange = selectedDates.length > 0
    ? selectedDates.length === 1
      ? format(selectedDates[0], 'EEE, MMM d, yyyy')
      : `${format(selectedDates[0], 'MMM d')} – ${format(selectedDates[selectedDates.length - 1], 'MMM d, yyyy')}`
    : null;

  // Find booking for selected date(s)
  const selectedBooking = selectedDates.length > 0
    ? getBookingsForDate(selectedDates[0]).find(b => b.status !== 'cancelled')
    : undefined;

  const anySelectedBooked = selectedDates.some(d => isBookedDate(d));
  const anySelectedBlocked = selectedDates.some(d => isBlocked(d) && !isBookedDate(d));

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </Layout>
    );
  }

  if (properties.length === 0) {
    return (
      <Layout>
        <div className="container mx-auto py-16 text-center">
          <CalendarIcon className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold mb-2">No Active Listings</h1>
          <p className="text-muted-foreground">Create and publish a property to manage your calendar.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto max-w-7xl px-4 py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <CalendarIcon className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold">Calendar</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center border border-border rounded-lg overflow-hidden">
              <button
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'month' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent'}`}
                onClick={() => setViewMode('month')}
              >
                Month
              </button>
              <button
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'week' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent'}`}
                onClick={() => { setViewMode('week'); setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 })); }}
              >
                Week
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setCurrentMonth(new Date()); setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 })); }}>Today</Button>
            <Button variant="outline" size="sm" onClick={() => setShowSyncDialog(true)}>
              <Link2 className="w-3.5 h-3.5 mr-1.5" /> Connect
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
              <Settings2 className="w-3.5 h-3.5 mr-1.5" /> Settings
            </Button>
          </div>
        </div>

        {/* Property selector */}
        {properties.length > 1 && (
          <div className="flex items-center gap-3 mb-6 overflow-x-auto pb-2">
            {properties.map(p => (
              <button
                key={p.id}
                onClick={() => { setSelectedPropertyId(p.id); setSelectedDates([]); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all shrink-0
                  ${selectedPropertyId === p.id ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/40'}
                `}
              >
                {p.cover_image ? (
                  <img src={p.cover_image} alt="" className="w-8 h-8 rounded object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center"><CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" /></div>
                )}
                <span className="text-xs font-medium max-w-[120px] truncate">{p.title}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-6">
          {/* Calendar area */}
          <div className="flex-1 min-w-0">
            {viewMode === 'month' ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <h2 className="text-base font-semibold">{format(currentMonth, 'MMMM yyyy')}</h2>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
                {renderMonth(currentMonth)}
                {renderMonth(addMonths(currentMonth, 1))}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeekStart(w => subWeeks(w, 1))}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <h2 className="text-base font-semibold">
                    {format(currentWeekStart, 'MMM d')} – {format(endOfWeek(currentWeekStart, { weekStartsOn: 0 }), 'MMM d, yyyy')}
                  </h2>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeekStart(w => addWeeks(w, 1))}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
                {renderWeekView()}
              </>
            )}

            {/* Legend */}
              <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5"><div className="w-4 h-2.5 bg-destructive rounded-sm" /> Booked</div>
              <div className="flex items-center gap-1.5"><div className="w-4 h-2.5 bg-muted rounded-sm relative overflow-hidden"><div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,hsl(var(--muted-foreground)/0.2)_2px,hsl(var(--muted-foreground)/0.2)_3px)]" /></div> Blocked</div>
              <div className="flex items-center gap-1.5"><div className="w-4 h-2.5 bg-primary/10 rounded-sm ring-1 ring-primary/50" /> Selected</div>
              {weekendPricingEnabled && (
                <div className="flex items-center gap-1.5"><Sun className="w-3 h-3 text-amber-500" /> Weekend rate</div>
              )}
              {connectedCalendars.length > 0 && (
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500" /> {connectedCalendars.length} synced</div>
              )}
            </div>
          </div>

          {/* Right panel */}
          <div className="w-[300px] shrink-0 hidden lg:block">
            <Card className="p-4 sticky top-4">
              {selectedDates.length > 0 ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-sm">{selectedDateRange}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{selectedDates.length} night{selectedDates.length > 1 ? 's' : ''}</p>
                  </div>

                  {/* Booking details with payment breakdown */}
                  {selectedBooking && (
                    <>
                      <Separator />
                      <div className="bg-primary/5 rounded-lg p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <Lock className="w-3.5 h-3.5 text-primary" />
                          <p className="text-xs font-medium text-primary">Booked</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {selectedBooking.guestAvatar && <img src={selectedBooking.guestAvatar} className="w-7 h-7 rounded-full object-cover" />}
                          <div>
                            <p className="text-sm font-medium">{selectedBooking.guestName}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {format(selectedBooking.checkIn, 'MMM d')} – {format(selectedBooking.checkOut, 'MMM d')} · {selectedBooking.numGuests} guest{selectedBooking.numGuests > 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>

                        {/* Payment breakdown */}
                        <Separator />
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Payment Breakdown</p>
                          {/* Per-night distribution */}
                          {Array.from({ length: selectedBooking.numNights }).map((_, i) => {
                            const nightDate = addDays(selectedBooking.checkIn, i);
                            const perNight = selectedBooking.nightlyRate;
                            return (
                              <div key={i} className="flex justify-between text-[10px]">
                                <span className="text-muted-foreground">{format(nightDate, 'MMM d (EEE)')}</span>
                                <span className="font-medium">{currSymbol}{perNight.toFixed(2)}</span>
                              </div>
                            );
                          })}
                          <Separator className="my-1" />
                          <div className="flex justify-between text-[10px]">
                            <span className="text-muted-foreground">Subtotal ({selectedBooking.numNights} nights)</span>
                            <span>{currSymbol}{(selectedBooking.nightlyRate * selectedBooking.numNights).toFixed(2)}</span>
                          </div>
                          {selectedBooking.cleaningFee > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span className="text-muted-foreground">Cleaning fee</span>
                              <span>{currSymbol}{selectedBooking.cleaningFee.toFixed(2)}</span>
                            </div>
                          )}
                          {selectedBooking.serviceFee > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span className="text-muted-foreground">Service fee</span>
                              <span>{currSymbol}{selectedBooking.serviceFee.toFixed(2)}</span>
                            </div>
                          )}
                          <Separator className="my-1" />
                          <div className="flex justify-between text-xs font-semibold">
                            <span>Total</span>
                            <span>{currSymbol}{selectedBooking.totalPrice.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Manual block details */}
                  {anySelectedBlocked && !selectedBooking && (
                    <>
                      <Separator />
                      <div className="bg-muted rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <X className="w-3.5 h-3.5 text-destructive" />
                          <p className="text-xs font-medium">Manually Blocked</p>
                        </div>
                        <p className="text-[10px] text-muted-foreground">These dates are blocked and not available for booking. Toggle availability below to unblock.</p>
                      </div>
                    </>
                  )}

                  {/* Only show edit controls for non-booked dates */}
                  {!anySelectedBooked ? (
                    <>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-xs font-medium">Availability</Label>
                          <p className="text-[10px] text-muted-foreground">{panelAvailable ? 'Open for bookings' : 'Blocked'}</p>
                        </div>
                        <Switch checked={panelAvailable} onCheckedChange={setPanelAvailable} />
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Nightly price</Label>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-xs text-muted-foreground">{currSymbol}</span>
                          <Input type="number" value={panelPrice} onChange={e => setPanelPrice(e.target.value)} min={0} className="h-8 text-sm w-28" />
                        </div>
                      </div>
                      <Button size="sm" className="w-full" onClick={handleSaveDateChanges}>Save Changes</Button>
                    </>
                  ) : (
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <Lock className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
                      <p className="text-[10px] text-muted-foreground">Booked dates cannot be modified</p>
                    </div>
                  )}
                  <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setSelectedDates([])}>Clear Selection</Button>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Base price */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-sm flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" /> Base Price</h3>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setEditingBasePrice(true); setBasePriceInput(String(selectedProperty?.price_per_night || 0)); }}>
                        <Edit2 className="w-3 h-3" />
                      </Button>
                    </div>
                    {editingBasePrice ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{currSymbol}</span>
                          <Input type="number" value={basePriceInput} onChange={e => setBasePriceInput(e.target.value)} min={1} className="h-8 text-sm w-24" />
                        </div>
                        <div className="flex gap-1.5">
                          <Button size="sm" className="h-7 text-xs" onClick={handleSaveBasePrice}><Check className="w-3 h-3 mr-1" /> Save</Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingBasePrice(false)}>Cancel</Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground">Updates default price for all dates.</p>
                      </div>
                    ) : (
                      <p className="text-sm font-bold text-rating">{currSymbol}{selectedProperty?.price_per_night || 0}<span className="text-rating/80 font-normal"> / night</span></p>
                    )}
                  </div>

                  <Separator />

                  {/* Weekend pricing */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-sm flex items-center gap-1.5"><Sun className="w-3.5 h-3.5 text-amber-500" /> Weekend Pricing</h3>
                      <Switch checked={weekendPricingEnabled} onCheckedChange={setWeekendPricingEnabled} />
                    </div>
                    {weekendPricingEnabled && (
                      <div className="space-y-2">
                        <p className="text-[10px] text-muted-foreground">Auto-apply to Friday, Saturday & Sunday</p>
                        {editingWeekendPrice ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">{currSymbol}</span>
                              <Input type="number" value={weekendPrice} onChange={e => setWeekendPrice(e.target.value)} min={1} className="h-8 text-sm w-24" />
                            </div>
                            <div className="flex gap-1.5">
                              <Button size="sm" className="h-7 text-xs" onClick={handleSaveWeekendPricing}><Check className="w-3 h-3 mr-1" /> Apply</Button>
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingWeekendPrice(false)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-bold text-rating">{currSymbol}{weekendPrice}<span className="text-rating/80 font-normal"> / night</span></p>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditingWeekendPrice(true)}><Edit2 className="w-3 h-3" /></Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div>
                    <h3 className="font-semibold text-sm flex items-center gap-1.5 mb-2"><Settings2 className="w-3.5 h-3.5" /> Availability</h3>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>Min stay: {minNights} night{minNights > 1 ? 's' : ''}</p>
                      <p>Max stay: {maxNights} nights</p>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="font-semibold text-sm flex items-center gap-1.5 mb-2"><Link2 className="w-3.5 h-3.5" /> Synced Calendars</h3>
                    {connectedCalendars.length > 0 ? (
                      <div className="space-y-2">
                        {connectedCalendars.map((cal, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded p-2">
                            <div className="w-2 h-2 rounded-full bg-green-500 shrink-0 animate-pulse" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{cal.name}</p>
                              <p className="text-[10px] text-muted-foreground">Last sync: {format(new Date(cal.lastSync), 'MMM d, h:mm a')}</p>
                              <p className="text-[9px] text-muted-foreground/60">Auto-syncs every 2 hours</p>
                            </div>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" title="Refresh now" onClick={async () => {
                              toast({ title: 'Refreshing...', description: `Syncing ${cal.name}` });
                              try {
                                const resp = await fetch(cal.url);
                                if (resp.ok) {
                                  const text = await resp.text();
                                  const events = text.split('BEGIN:VEVENT');
                                  let blocked = 0;
                                  for (const event of events.slice(1)) {
                                    const dtS = event.match(/DTSTART[^:]*:(\d{8})/);
                                    const dtE = event.match(/DTEND[^:]*:(\d{8})/);
                                    if (dtS && dtE) {
                                      const sd = new Date(`${dtS[1].slice(0,4)}-${dtS[1].slice(4,6)}-${dtS[1].slice(6,8)}`);
                                      const ed = new Date(`${dtE[1].slice(0,4)}-${dtE[1].slice(4,6)}-${dtE[1].slice(6,8)}`);
                                      if (!isNaN(sd.getTime()) && !isNaN(ed.getTime())) {
                                        const ae = new Date(ed); ae.setDate(ae.getDate() - 1);
                                        const days = sd <= ae ? eachDayOfInterval({ start: sd, end: ae }) : [sd];
                                        for (const day of days) {
                                          const ds = format(day, 'yyyy-MM-dd');
                                          const ex = availability.find(a => a.date === ds && a.property_id === selectedPropertyId);
                                          if (ex) { if (ex.is_available !== false) await supabase.from('property_availability').update({ is_available: false }).eq('id', ex.id); }
                                          else await supabase.from('property_availability').insert({ property_id: selectedPropertyId!, date: ds, is_available: false });
                                          blocked++;
                                        }
                                      }
                                    }
                                  }
                                  setConnectedCalendars(prev => prev.map((c, idx) => idx === i ? { ...c, lastSync: new Date().toISOString() } : c));
                                  await refreshAvailability();
                                  toast({ title: 'Sync complete', description: `${blocked} dates synced from ${cal.name}.` });
                                }
                              } catch { toast({ title: 'Sync failed', description: 'Could not reach calendar URL.', variant: 'destructive' }); }
                            }}>
                              <RefreshCw className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0" onClick={() => setConnectedCalendars(prev => prev.filter((_, idx) => idx !== i))}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No calendars connected</p>
                    )}
                    <Button variant="outline" size="sm" className="w-full mt-2 text-xs" onClick={() => setShowSyncDialog(true)}>
                      <Link2 className="w-3 h-3 mr-1" /> Connect
                    </Button>
                  </div>

                  <Separator />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">Click or drag dates to select. Adjust availability and pricing on the right.</p>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* Availability Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Availability Settings</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">
            <p className="text-sm text-muted-foreground">These apply to all nights, unless customized by date.</p>
            <div>
              <h4 className="font-medium text-sm mb-2">Trip length</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Minimum nights</Label>
                  <Input type="number" value={minNights} onChange={e => setMinNights(Number(e.target.value))} min={1} className="h-9" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Maximum nights</Label>
                  <Input type="number" value={maxNights} onChange={e => setMaxNights(Number(e.target.value))} min={1} className="h-9" />
                </div>
              </div>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium text-sm mb-2">Advance notice</h4>
              <Select value={advanceNotice} onValueChange={setAdvanceNotice}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="same_day">Same day (book anytime today)</SelectItem>
                  <SelectItem value="1_day">At least 1 day</SelectItem>
                  <SelectItem value="2_days">At least 2 days</SelectItem>
                  <SelectItem value="3_days">At least 3 days</SelectItem>
                  <SelectItem value="7_days">At least 7 days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Same day: guests can book any time today, even at 11:59 PM.</p>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium text-sm mb-2">Preparation time</h4>
              <Select value={prepTime} onValueChange={setPrepTime}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="1_night">1 night before and after</SelectItem>
                  <SelectItem value="2_nights">2 nights before and after</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium text-sm mb-2">Availability window</h4>
              <Select value={availWindow} onValueChange={setAvailWindow}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 months</SelectItem>
                  <SelectItem value="6">6 months</SelectItem>
                  <SelectItem value="9">9 months</SelectItem>
                  <SelectItem value="12">12 months</SelectItem>
                  <SelectItem value="24">All future dates</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettings(false)}>Cancel</Button>
            <Button onClick={handleSaveSettings}>Save Settings</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Calendar Sync Dialog */}
      <Dialog open={showSyncDialog} onOpenChange={setShowSyncDialog}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Connect Calendars</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2 max-w-full overflow-hidden">
            <p className="text-sm text-muted-foreground">Sync calendars so they automatically stay up to date and block booked dates.</p>
            <div>
              <h4 className="font-medium text-sm mb-1.5">Import from another website</h4>
              <p className="text-xs text-muted-foreground mb-2">Paste an iCal URL (.ics) from Airbnb, Booking.com, or VRBO. Booked dates will be automatically blocked.</p>
              <div className="flex gap-2 min-w-0">
                <Input placeholder="https://www.airbnb.com/calendar/ical/..." value={syncUrl} onChange={e => setSyncUrl(e.target.value)} className="flex-1 min-w-0 h-9" />
                <Button className="h-9 shrink-0" onClick={handleConnectCalendar} disabled={isSyncing}>
                  {isSyncing ? 'Syncing...' : 'Import'}
                </Button>
              </div>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium text-sm mb-1.5">Export this calendar</h4>
              <p className="text-xs text-muted-foreground mb-2">Copy this link and paste it into another platform to sync bookings.</p>
              <div className="flex gap-2 min-w-0">
                <Input readOnly value={`${window.location.origin}/api/ical/${selectedPropertyId}`} className="flex-1 min-w-0 text-xs h-9" />
                <Button variant="outline" className="h-9 shrink-0" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/api/ical/${selectedPropertyId}`); toast({ title: 'Copied!' }); }}>Copy</Button>
              </div>
            </div>
            {connectedCalendars.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="font-medium text-sm mb-2">Connected calendars</h4>
                  <div className="space-y-2">
                    {connectedCalendars.map((cal, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded p-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 shrink-0 animate-pulse" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium">{cal.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{cal.url}</p>
                          <p className="text-[10px] text-muted-foreground">Last sync: {format(new Date(cal.lastSync), 'MMM d, h:mm a')}</p>
                        </div>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setConnectedCalendars(prev => prev.filter((_, idx) => idx !== i))}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSyncDialog(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
