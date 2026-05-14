import { useState, useEffect, useRef, useCallback } from 'react';
import { CheckoutModal } from '@/components/CheckoutModal';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '@/hooks/use-mobile';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { RatingSummary } from '@/components/property/RatingSummary';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformSettings, calculateFees } from '@/hooks/usePlatformSettings';
import { format, differenceInDays, addDays } from 'date-fns';
import { parseDateInTz, formatDateInTz, daysBetweenInTz, dateKeyInTz, DEFAULT_TZ, todayInTz, isSameDayCheckInOpen } from '@/lib/dates/propertyTz';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Heart, Share, Star, MapPin, Users, Bed, Bath, Home,
  Wifi, Wind, Thermometer, Tv, Car, Waves, Check, Calendar as CalendarIcon,
  ChevronLeft, ChevronRight, Shield, MessageSquare, Minus, Plus, ChevronUp, ChevronDown,
  Clock, DoorOpen, DoorClosed, Ban, Cigarette, PartyPopper, PawPrint,
  Mountain, Utensils, Dumbbell, Flame, Droplets, AirVent, Coffee,
  WashingMachine, Laptop, Lock, Eye, Zap, X, Grid3X3, Images, Edit,
  Umbrella, Flower2, Snowflake, Plug, Dog, Briefcase, Shirt, Fan, Sparkles
} from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';
import { useProfileCompleteness } from '@/hooks/useProfileCompleteness';
import { IncompleteProfileModal } from '@/components/IncompleteProfileModal';
import { usePlatformControls } from '@/hooks/usePlatformControls';
import { useIsHostMode, setHostMode } from '@/hooks/useHostModeGuard';

type Property = Database['public']['Tables']['properties']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];
type Review = Database['public']['Tables']['reviews']['Row'] & {
  reviewer_profile?: Profile | null;
};

const amenityIcons: Record<string, any> = {
  wifi: Wifi,
  wind: Wind,
  thermometer: Thermometer,
  tv: Tv,
  car: Car,
  waves: Waves,
  mountain: Mountain,
  utensils: Utensils,
  dumbbell: Dumbbell,
  flame: Flame,
  droplets: Droplets,
  'air-vent': AirVent,
  coffee: Coffee,
  'washing-machine': WashingMachine,
  laptop: Laptop,
  lock: Lock,
  eye: Eye,
  zap: Zap,
  umbrella: Umbrella,
  flower: Flower2,
  snowflake: Snowflake,
  plug: Plug,
  dog: Dog,
  briefcase: Briefcase,
  shirt: Shirt,
  fan: Fan,
  bath: Bath,
  sparkles: Sparkles,
};

const categoryLabels: Record<string, string> = {
  essentials: 'Essentials',
  outdoor: 'Outdoor & Nature',
  entertainment: 'Entertainment',
  fitness: 'Fitness & Wellness',
  indoor: 'Indoor Features',
  parking: 'Parking & Transport',
  policies: 'Guest Policies',
  work: 'Work & Productivity',
};

export default function PropertyDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user, isHost, profile } = useAuth();
  const { settings: platformSettings } = usePlatformSettings();
  const { toast } = useToast();
  // Reactive — re-renders if the user flips the host/guest toggle anywhere.
  const isInHostMode = useIsHostMode();

  const [property, setProperty] = useState<Property | null>(null);
  const [host, setHost] = useState<Profile | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [mutualReviews, setMutualReviews] = useState<any[]>([]);
  const [allReviewsOpen, setAllReviewsOpen] = useState(false);
  const [amenities, setAmenities] = useState<{ name: string; icon: string; category: string }[]>([]);
  const [bookedDates, setBookedDates] = useState<Date[]>([]);
  const [bookedDateKeys, setBookedDateKeys] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isFavorited, setIsFavorited] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Booking state
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});
  const checkIn = dateRange.from;
  const checkOut = dateRange.to;
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [pets, setPets] = useState(0);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutData, setCheckoutData] = useState<{
    bookingId: string;
    propertyTitle: string;
    totalPrice: number;
    currency: string;
    numNights: number;
    checkIn: string;
    checkOut: string;
  } | null>(null);
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);
  const { isComplete: isProfileComplete, missingFields, loading: profileLoading } = useProfileCompleteness();
  const { controls: platformControls } = usePlatformControls();
  // Calendar debug toggle — surfaces the computed booked date keys (DB-side,
  // anchored to the property timezone) and the viewer-formatted key for the
  // last clicked day. Helps diagnose timezone / blocking mismatches reported
  // by hosts when guests claim a day "should be" available.
  const [calendarDebug, setCalendarDebug] = useState(false);
  const [debugClickedKey, setDebugClickedKey] = useState<{
    viewerLocal: string;
    propertyTz: string;
    blocked: boolean;
  } | null>(null);
  // Re-render the same-day hint once a minute so the eligibility flips at
  // the property's checkout cutoff without requiring the user to refresh.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const totalGuests = adults + children;
  const guests = totalGuests.toString();
  const propertyTimezone = property?.timezone || DEFAULT_TZ;
  // Calendar cells from react-day-picker are local-midnight Date objects
  // representing a literal calendar day (e.g. "April 23"). The blocked-key
  // set uses the same literal `YYYY-MM-DD` from the database, anchored to
  // the property timezone. Compare them by formatting the cell as its OWN
  // local Y-M-D — this guarantees "April 23 on the calendar" matches
  // "April 23 in the booking" regardless of the viewer's UTC offset.
  const isBlockedKey = (value: Date) => {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return bookedDateKeys.has(`${y}-${m}-${d}`);
  };

  useEffect(() => {
    if (id) {
      fetchProperty();
      fetchBookedDates();
      if (user) {
        checkFavorite();
      }
    }
  }, [id, user]);

  // Once the property (and therefore its timezone) is known, re-key all
  // blocked dates in that zone so the calendar renders identically for
  // every viewer. The first call above runs against DEFAULT_TZ as a
  // placeholder; this one is the source of truth.
  useEffect(() => {
    if (!id || !property?.id) return;
    fetchBookedDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, property?.id, (property as any)?.timezone]);

  // Live-refresh blocked dates when any booking for this property changes
  // (e.g. another guest just paid and the booking flipped to confirmed) or
  // when the host adjusts manual availability. Ensures every viewer sees
  // the same blocked calendar without needing to reload.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`property-cal-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `property_id=eq.${id}` },
        () => { fetchBookedDates(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'property_availability', filter: `property_id=eq.${id}` },
        () => { fetchBookedDates(); },
      )
      .subscribe();
    const onFocus = () => fetchBookedDates();
    window.addEventListener('focus', onFocus);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
    };
  }, [id]);

  // Preload the cover image as soon as we know it, so the hero renders instantly.
  useEffect(() => {
    const cover = (property as any)?.cover_image || (property as any)?.images?.[0];
    if (!cover) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = cover;
    (link as any).fetchPriority = 'high';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, [property?.id]);

  const fetchBookedDates = async () => {
    if (!id) return;
    const dates: Date[] = [];
    const keys = new Set<string>();

    // Only get confirmed bookings — pending/unpaid are NOT real bookings
    //
    // IMPORTANT: we call the SECURITY DEFINER RPC `get_property_blocked_dates`
    // instead of selecting from `bookings` directly. The bookings table RLS
    // only lets the guest/host of a booking read its row, which means a
    // *different* viewer would see an empty list and the calendar would
    // appear wide open — causing double bookings. The RPC returns ONLY the
    // date range (no PII) so every viewer sees the same blocked nights.
    const { data } = await supabase.rpc('get_property_blocked_dates', {
      _property_id: id,
    });

    // Anchor every YYYY-MM-DD to the property's timezone so guests, hosts
    // and admins see the SAME blocked days regardless of viewer offset.
    //
    // We iterate calendar-day STRINGS (not Date instants) so DST shifts and
    // UTC-vs-local parsing can never desync a key. Each booking blocks the
    // check-in night through the day BEFORE check-out (check-out itself
    // stays bookable as the next guest's check-in).
    const tz = (property as any)?.timezone || DEFAULT_TZ;
    const addKey = (ymd: string) => {
      if (keys.has(ymd)) return;
      keys.add(ymd);
      // Keep `dates` populated for any consumer that still expects Date[]
      // (e.g. `bookedDates` prop on legacy widgets). Anchored to tz midnight.
      dates.push(parseDateInTz(ymd, tz));
    };

    if (data) {
      data.forEach((booking) => {
        const startKey = booking.check_in_date.slice(0, 10);
        const endKey = booking.check_out_date.slice(0, 10);
        // Iterate using the canonical YYYY-MM-DD calendar — increment by
        // one day in UTC then re-key in tz so DST never duplicates/skips.
        let cursorKey = startKey;
        let safety = 0;
        while (cursorKey < endKey && safety++ < 366 * 5) {
          addKey(cursorKey);
          const [y, m, d] = cursorKey.split('-').map(Number);
          const next = new Date(Date.UTC(y, m - 1, d + 1));
          cursorKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
        }
      });
    }

    // Also fetch manually blocked dates from property_availability
    const { data: availData } = await supabase
      .from('property_availability')
      .select('date')
      .eq('property_id', id)
      .eq('is_available', false);

    if (availData) {
      availData.forEach((entry) => {
        addKey(entry.date.slice(0, 10));
      });
    }

    setBookedDates(dates);
    setBookedDateKeys(keys);
  };

  // Initialize Leaflet map when property has coordinates and container is visible
  useEffect(() => {
    if (!property || !property.latitude || !property.longitude) return;

    const lat = Number(property.latitude);
    const lng = Number(property.longitude);
    let mapCreated = false;
    let cleanedUp = false;

    const defaultIcon = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
    });

    const initMap = () => {
      if (mapCreated || cleanedUp || !mapContainerRef.current) return;
      // Clean up previous map instance
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapContainerRef.current, {
        scrollWheelZoom: false,
        dragging: true,
        zoomControl: true,
      }).setView([lat, lng], 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      L.marker([lat, lng], { icon: defaultIcon }).addTo(map);

      L.circle([lat, lng], {
        radius: 500,
        color: 'hsl(var(--primary))',
        fillColor: 'hsl(var(--primary))',
        fillOpacity: 0.1,
        weight: 1,
      }).addTo(map);

      // Force multiple resizes to ensure tiles load
      setTimeout(() => map.invalidateSize(), 100);
      setTimeout(() => map.invalidateSize(), 500);
      setTimeout(() => map.invalidateSize(), 1000);

      mapInstanceRef.current = map;
      mapCreated = true;
    };

    // Poll for the container ref to be available (it's conditionally rendered)
    const pollInterval = setInterval(() => {
      if (cleanedUp) { clearInterval(pollInterval); return; }
      if (!mapContainerRef.current) return;
      clearInterval(pollInterval);

      // Use IntersectionObserver to init map when container scrolls into view
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setTimeout(initMap, 100);
            observer.disconnect();
          }
        },
        { threshold: 0.1 }
      );
      observer.observe(mapContainerRef.current);

      // Also try initializing after a delay in case it's already visible
      const fallbackTimer = setTimeout(initMap, 2000);

      // Store cleanup for observer/fallback
      cleanupRef.current = () => {
        observer.disconnect();
        clearTimeout(fallbackTimer);
      };
    }, 100);

    return () => {
      cleanedUp = true;
      clearInterval(pollInterval);
      cleanupRef.current?.();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [property]);

  const fetchProperty = async () => {
    setIsLoading(true);

    // Fetch property
    const { data: propertyData, error: propertyError } = await supabase
      .from('properties')
      .select('*')
      .eq('id', id)
      .single();

    if (propertyError || !propertyData) {
      navigate('/404');
      return;
    }

    setProperty(propertyData);

    // Fetch host profile
    const { data: hostData } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', propertyData.host_id)
      .single();

    if (hostData) {
      setHost(hostData);
    }

    // Fetch amenities
    const { data: amenitiesData } = await supabase
      .from('property_amenities')
      .select('amenities(name, icon, category)')
      .eq('property_id', id);

    if (amenitiesData) {
      setAmenities(
        amenitiesData
          .map((a: any) => a.amenities)
          .filter(Boolean)
      );
    }

    // Fetch reviews
    const { data: reviewsData } = await supabase
      .from('reviews')
      .select('*')
      .eq('property_id', id)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(50);

    if (reviewsData && reviewsData.length > 0) {
      // Fetch reviewer profiles
      const guestIds = [...new Set(reviewsData.map(r => r.guest_id))];
      const { data: guestProfiles } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', guestIds);
      const profileMap = new Map(guestProfiles?.map(p => [p.user_id, p]) || []);
      setReviews(reviewsData.map(r => ({ ...r, reviewer_profile: profileMap.get(r.guest_id) || null })));
    } else {
      setReviews([]);
    }

    // Fetch published mutual reviews (guest ratings of host/property)
    const { data: mutualData } = await supabase
      .from('mutual_reviews' as any)
      .select('*')
      .eq('property_id', id)
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (mutualData) {
      // Resolve reviewer profile based on reviewer_type:
      // guest reviews → guest profile; host reviews → host profile.
      const reviewerIds = [
        ...new Set(
          (mutualData as any[]).map((r) =>
            r.reviewer_type === 'host' ? r.host_id : r.guest_id,
          ),
        ),
      ];
      if (reviewerIds.length > 0) {
        const { data: mProfiles } = await supabase.from('profiles').select('*').in('user_id', reviewerIds);
        const mMap = new Map(mProfiles?.map(p => [p.user_id, p]) || []);
        setMutualReviews(
          (mutualData as any[]).map((r) => ({
            ...r,
            reviewer_profile:
              mMap.get(r.reviewer_type === 'host' ? r.host_id : r.guest_id) || null,
          })),
        );
      } else {
        setMutualReviews(mutualData as any[]);
      }
    }

    setIsLoading(false);
  };

  const checkFavorite = async () => {
    if (!user || !id) return;

    const { data } = await supabase
      .from('favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('property_id', id)
      .single();

    setIsFavorited(!!data);
  };

  const toggleFavorite = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }

    if (isFavorited) {
      await supabase
        .from('favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('property_id', id);
    } else {
      await supabase
        .from('favorites')
        .insert({ user_id: user.id, property_id: id! });
    }

    setIsFavorited(!isFavorited);
  };

  const handleBooking = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }

    // Block new bookings if listing is not active (suspended/paused/draft/pending/rejected).
    // Existing guests with prior bookings keep messaging via /messages independently.
    if (property && property.status !== 'active') {
      toast({
        title: 'Listing not bookable',
        description: 'This property is currently unavailable for new bookings. You can still message the host about an existing stay.',
        variant: 'destructive',
      });
      return;
    }

    // Block booking until the guest profile is 100% complete.
    if (!profileLoading && !isProfileComplete) {
      setShowIncompleteModal(true);
      return;
    }

    // Admin control: enforce email verification before booking.
    if (platformControls.security.force_email_verification && !user.email_confirmed_at) {
      toast({
        title: 'Verify your email first',
        description: 'The platform requires a verified email address before you can book. Check your inbox for the confirmation link.',
        variant: 'destructive',
      });
      return;
    }

    // Admin control: enforce phone verification before booking.
    if (platformControls.guest_rights.require_phone_verification && !profile?.phone) {
      toast({
        title: 'Phone number required',
        description: 'The platform requires a verified phone number before booking. Add one in Settings.',
        variant: 'destructive',
      });
      return;
    }

    if (!checkIn || !checkOut || !property) {
      toast({
        title: t('property.selectDates'),
        description: t('property.selectDatesDesc'),
        variant: 'destructive',
      });
      return;
    }

    setIsBooking(true);

    // Re-check availability against the server right before creating the booking
    // (prevents race conditions where someone else booked overlapping nights)
    const { data: conflicts } = await supabase
      .from('bookings')
      .select('check_in_date, check_out_date')
      .eq('property_id', property.id)
      .in('status', ['confirmed', 'in_progress', 'pending_host_approval'])
      .lt('check_in_date', format(checkOut, 'yyyy-MM-dd'))
      .gt('check_out_date', format(checkIn, 'yyyy-MM-dd'));

    if (conflicts && conflicts.length > 0) {
      toast({
        title: t('property.bookingFailed'),
        description: 'These dates were just booked by someone else. Please pick different dates.',
        variant: 'destructive',
      });
      setIsBooking(false);
      // Refresh blocked dates so the calendar updates
      fetchBookedDates();
      setDateRange({});
      return;
    }

    const numNights = differenceInDays(checkOut, checkIn);
    const nightlyRate = Number(property.price_per_night);
    const subtotal = nightlyRate * numNights;
    const cleaningFee = Number(property.cleaning_fee) || 0;
    const chargedTo = ((property as any).service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
    const bookingFees = platformSettings
      ? calculateFees(subtotal, platformSettings, chargedTo)
      : null;
    const bookingServiceFee = bookingFees?.serviceFeeWithTax ?? 0;
    const bookingGuestServiceFee = bookingFees?.guestServiceFee ?? 0;
    const totalPrice = subtotal + cleaningFee + bookingGuestServiceFee;

    // Create booking as pending (awaiting payment)
    const { data, error } = await supabase
      .from('bookings')
      .insert({
        property_id: property.id,
        guest_id: user.id,
        host_id: property.host_id,
        check_in_date: format(checkIn, 'yyyy-MM-dd'),
        check_out_date: format(checkOut, 'yyyy-MM-dd'),
        num_guests: parseInt(guests),
        nightly_rate: nightlyRate,
        num_nights: numNights,
        subtotal,
        cleaning_fee: cleaningFee,
        service_fee: bookingServiceFee,
        total_price: totalPrice,
        currency: property.currency || 'USD',
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      toast({
        title: t('property.bookingFailed'),
        description: error.message,
        variant: 'destructive',
      });
      setIsBooking(false);
      return;
    }

    // Don't block dates in availability for pending bookings — only block on successful payment (confirmed)
    // The dates will be blocked when payment succeeds and status changes to confirmed

    // Do NOT send message to host yet — only on successful payment
    // Do NOT auto-confirm — booking stays pending until payment succeeds

    // Redirect to Stripe Checkout for payment
    try {
      // Open custom Paystack checkout modal
      setCheckoutData({
        bookingId: data.id,
        propertyTitle: property.title,
        totalPrice,
        currency: property.currency || 'USD',
        numNights,
        checkIn: format(checkIn, 'MMM d, yyyy'),
        checkOut: format(checkOut, 'MMM d, yyyy'),
      });
      setShowCheckout(true);
      setIsBooking(false);
    } catch (stripeError) {
      // Fallback: keep as pending, let guest retry
      toast({
        title: 'Booking created',
        description: 'Payment could not be initiated. You can retry from the booking page.',
      });
      navigate(`/booking-confirmation/${data.id}`);
    }

    setIsBooking(false);
  };

  if (isLoading || !property) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="animate-pulse space-y-8">
            <div className="h-[60vh] bg-muted rounded-2xl" />
            <div className="h-8 bg-muted rounded w-1/2" />
            <div className="h-4 bg-muted rounded w-1/4" />
          </div>
        </div>
      </Layout>
    );
  }

  // While in host mode, the marketplace is OFF-LIMITS for OTHER listings.
  // A host CAN still view their OWN listing (read-only preview, no booking)
  // so they can see exactly what guests will see. Other listings are blocked
  // until they flip back to guest (Travelling) mode.
  const isOwnListing = !!user && property.host_id === user.id;
  if (isInHostMode && !isOwnListing) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16 text-center max-w-lg">
          <div className="w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-6">
            <Home className="w-10 h-10 text-amber-500" />
          </div>
          <h1 className="font-display text-2xl font-bold mb-3">Host Mode Active</h1>
          <p className="text-muted-foreground mb-6">
            You're currently in host mode. You can view and manage your own listings, but to browse or book other listings, switch to guest (Travelling) mode first.
          </p>
          <Button
            className="btn-primary gap-2"
            onClick={() => {
              setHostMode('guest');
              navigate('/');
            }}
          >
            Switch to Guest Mode
          </Button>
        </div>
      </Layout>
    );
  }

  const allImages = [
    ...(property.cover_image ? [property.cover_image] : []),
    ...(property.images || []),
  ];
  // Deduplicate and ensure at least a placeholder
  const images = allImages.length > 0
    ? [...new Set(allImages)]
    : ['/placeholder.svg'];

  const numNights = checkIn && checkOut ? differenceInDays(checkOut, checkIn) : 0;
  const nightlyRate = Number(property.price_per_night);
  const subtotal = nightlyRate * numNights;
  const cleaningFee = Number(property.cleaning_fee) || 0;
  const serviceFeeChargedTo = ((property as any).service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
  const isPropertyHost = user?.id === property.host_id;

  // Calculate fees using platform settings
  const fees = platformSettings && numNights > 0
    ? calculateFees(subtotal, platformSettings, serviceFeeChargedTo)
    : null;

  // Guest sees: subtotal + cleaning fee + their portion of service fee (inclusive of tax)
  const guestServiceFee = fees?.guestServiceFee ?? 0;
  const guestTotal = subtotal + cleaningFee + guestServiceFee;

  // For booking insertion we still need raw service fee
  const serviceFee = fees?.serviceFeeWithTax ?? 0;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Photo Gallery Grid */}
        <div className="relative rounded-2xl overflow-hidden mb-8">
          {images.length === 1 ? (
            <div
              className="aspect-[16/9] md:aspect-[21/9] cursor-pointer"
              onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }}
            >
              <img
                src={images[0]}
                alt={property.title}
                className="w-full h-full object-cover"
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
            </div>
          ) : images.length <= 4 ? (
            <div className="grid grid-cols-2 gap-1 aspect-[16/9] md:aspect-[21/9]">
              <div
                className="row-span-2 cursor-pointer relative overflow-hidden"
                onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }}
              >
                <img
                  src={images[0]}
                  alt={property.title}
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              </div>
              <div className="grid grid-rows-2 gap-1">
                {images.slice(1, 3).map((img, i) => (
                  <div
                    key={i}
                    className="cursor-pointer relative overflow-hidden"
                    onClick={() => { setLightboxIndex(i + 1); setLightboxOpen(true); }}
                  >
                    <img
                      src={img}
                      alt={`${property.title} ${i + 2}`}
                      className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 grid-rows-2 gap-1 aspect-[16/9] md:aspect-[21/9]">
              <div
                className="col-span-2 row-span-2 cursor-pointer relative overflow-hidden"
                onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }}
              >
                <img
                  src={images[0]}
                  alt={property.title}
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              </div>
              {images.slice(1, 5).map((img, i) => (
                <div
                  key={i}
                  className="cursor-pointer relative overflow-hidden"
                  onClick={() => { setLightboxIndex(i + 1); setLightboxOpen(true); }}
                >
                  <img
                    src={img}
                    alt={`${property.title} ${i + 2}`}
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                    decoding="async"
                  />
                  {i === 3 && images.length > 5 && (
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                      <span className="text-foreground font-semibold text-lg">+{images.length - 5} more</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="absolute top-4 right-4 flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="bg-background/80 backdrop-blur-sm"
              onClick={toggleFavorite}
            >
              <Heart className={`w-5 h-5 ${isFavorited ? 'fill-rating text-rating' : ''}`} />
            </Button>
            <Button variant="ghost" size="icon" className="bg-background/80 backdrop-blur-sm">
              <Share className="w-5 h-5" />
            </Button>
            {isPropertyHost && (
              <Button
                variant="ghost"
                size="icon"
                className="bg-background/80 backdrop-blur-sm"
                onClick={() => navigate(`/host/properties/${property.id}/edit`)}
                title="Edit property"
              >
                <Edit className="w-5 h-5" />
              </Button>
            )}
          </div>

          {/* Show All Photos Button */}
          {images.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm"
              onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }}
            >
              <Grid3X3 className="w-4 h-4 mr-2" />
              {t('property.showAllPhotos', { count: images.length })}
            </Button>
          )}
        </div>

        {/* Lightbox Modal */}
        <Dialog open={lightboxOpen} onOpenChange={(open) => {
          setLightboxOpen(open);
        }}>
          <DialogContent
            className="max-w-7xl w-[95vw] h-[95vh] p-0 bg-background border-none gap-0"
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                setLightboxIndex((i) => (i > 0 ? i - 1 : images.length - 1));
              } else if (e.key === 'ArrowRight') {
                setLightboxIndex((i) => (i < images.length - 1 ? i + 1 : 0));
              } else if (e.key === 'Escape') {
                setLightboxOpen(false);
              }
            }}
          >
            <div className="relative w-full h-full flex flex-col min-h-0">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                <span className="text-sm text-muted-foreground">
                  {lightboxIndex + 1} / {images.length}
                </span>
                <Button variant="ghost" size="icon" onClick={() => setLightboxOpen(false)}>
                  <X className="w-5 h-5" />
                </Button>
              </div>

              {/* Image */}
              <div className="flex-1 min-h-0 flex items-center justify-center relative overflow-hidden bg-black/95">
                <img
                  src={images[lightboxIndex]}
                  alt={`${property.title} ${lightboxIndex + 1}`}
                  className="max-w-full max-h-full w-auto h-auto object-contain"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                />
                {/* Warm browser cache for previous & next image so navigation is instant */}
                {images.length > 1 && (
                  <div className="hidden" aria-hidden="true">
                    <img src={images[(lightboxIndex + 1) % images.length]} alt="" decoding="async" />
                    <img src={images[(lightboxIndex - 1 + images.length) % images.length]} alt="" decoding="async" />
                  </div>
                )}
                {images.length > 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute left-4 top-1/2 -translate-y-1/2 bg-background/90 backdrop-blur-sm hover:bg-background h-12 w-12 rounded-full shadow-lg"
                      onClick={() => setLightboxIndex((i) => (i > 0 ? i - 1 : images.length - 1))}
                    >
                      <ChevronLeft className="w-7 h-7" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-4 top-1/2 -translate-y-1/2 bg-background/90 backdrop-blur-sm hover:bg-background h-12 w-12 rounded-full shadow-lg"
                      onClick={() => setLightboxIndex((i) => (i < images.length - 1 ? i + 1 : 0))}
                    >
                      <ChevronRight className="w-7 h-7" />
                    </Button>
                  </>
                )}
              </div>

              {/* Thumbnail Strip */}
              <div className="px-4 py-3 border-t border-border overflow-x-auto flex-shrink-0">
                <div className="flex gap-2 justify-center">
                  {images.map((img, i) => (
                    <button
                      key={i}
                      className={`w-16 h-12 rounded-md overflow-hidden flex-shrink-0 border-2 transition-colors ${
                        i === lightboxIndex ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                      onClick={() => setLightboxIndex(i)}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Header */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-primary/10 text-primary border-primary/30 capitalize">
                  {property.property_type}
                </Badge>
                {property.instant_booking ? (
                   <Badge className="bg-gold-dark text-foreground">
                    {t('property.instantBook')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                    Request to Book
                  </Badge>
                )}
              </div>

              <h1 className="font-display text-3xl md:text-4xl font-bold mb-2">
                {property.title}
              </h1>

              {/* Rating summary block — consistent across all pages */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
                <RatingSummary
                  rating={
                    property.average_rating && Number(property.average_rating) > 0
                      ? Number(property.average_rating)
                      : reviews.length > 0
                        ? reviews.reduce((s, r) => s + Number(r.overall_rating || 0), 0) / reviews.length
                        : 0
                  }
                  reviewCount={Number(property.total_reviews) || reviews.length}
                  size="md"
                  linkToReviews
                />
                <span className="text-rating/40 hidden md:inline" aria-hidden>·</span>
                <div className="flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  <span>{property.city}, {property.country}</span>
                </div>
              </div>
            </div>

            {/* Quick Info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="card-luxury text-center">
                <Users className="w-6 h-6 mx-auto mb-2 text-primary" />
                <div className="font-semibold">{property.max_guests}</div>
                <div className="text-sm text-muted-foreground">{t('property.guests')}</div>
              </div>
              <div className="card-luxury text-center">
                <Bed className="w-6 h-6 mx-auto mb-2 text-primary" />
                <div className="font-semibold">{property.bedrooms}</div>
                <div className="text-sm text-muted-foreground">{t('property.bedrooms')}</div>
              </div>
              <div className="card-luxury text-center">
                <Home className="w-6 h-6 mx-auto mb-2 text-primary" />
                <div className="font-semibold">{property.beds}</div>
                <div className="text-sm text-muted-foreground">{t('property.beds')}</div>
              </div>
              <div className="card-luxury text-center">
                <Bath className="w-6 h-6 mx-auto mb-2 text-primary" />
                <div className="font-semibold">{Number(property.bathrooms)}</div>
                <div className="text-sm text-muted-foreground">{t('property.bathrooms')}</div>
              </div>
            </div>

            {/* Host */}
            {host && (
              <div className="card-luxury">
                <div className="flex items-center gap-4">
                  <Avatar className="w-16 h-16">
                    <AvatarImage src={host.avatar_url || ''} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                      {host.full_name?.[0] || 'H'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="font-display text-lg font-semibold">
                      {t('property.hostedBy', { name: host.full_name || 'Host' })}
                    </h3>
                    {host.is_verified && (
                      <div className="flex items-center gap-1 text-primary text-sm">
                        <Shield className="w-4 h-4" />
                        {t('property.verifiedHost')}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="border-primary text-primary"
                    onClick={() => {
                      if (!user) {
                        navigate('/auth');
                        return;
                      }
                      navigate(`/messages?host=${property.host_id}`);
                    }}
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    {t('property.contact')}
                  </Button>
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <h2 className="font-display text-xl font-semibold mb-4">{t('property.aboutPlace')}</h2>
              <p className="text-muted-foreground whitespace-pre-line">
                {property.description || t('property.noDescription')}
              </p>
            </div>

            {/* Amenities - Grouped by Category */}
            <div>
              <h2 className="font-display text-xl font-semibold mb-5">{t('property.whatOffers')}</h2>
              {amenities.length > 0 ? (
                (() => {
                  const grouped = amenities.reduce<Record<string, typeof amenities>>((acc, a) => {
                    const cat = a.category || 'other';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(a);
                    return acc;
                  }, {});
                  return (
                    <div className="space-y-6">
                      {Object.entries(grouped).map(([category, items]) => (
                        <div key={category}>
                          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                            {categoryLabels[category] || category}
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {items.map((amenity, index) => {
                              const IconComponent = amenityIcons[amenity.icon] || Check;
                              return (
                                <div
                                  key={index}
                                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-primary/30 transition-colors"
                                >
                                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                    <IconComponent className="w-5 h-5 text-primary" />
                                  </div>
                                  <span className="text-sm font-medium text-foreground leading-tight">{amenity.name}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <p className="text-muted-foreground">{t('property.noAmenities')}</p>
              )}
            </div>

            <Separator />

            {/* House Rules */}
            <div>
              <h2 className="font-display text-xl font-semibold mb-4">{t('property.houseRules')}</h2>
              
              {/* Check-in/out and capacity - compact grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border border-border">
                  <DoorOpen className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">{t('property.checkIn')}</div>
                    <div className="text-sm font-medium text-foreground truncate">
                      {property.check_in_time ? format(new Date(`2000-01-01T${property.check_in_time}`), 'h:mm a') : '3:00 PM'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border border-border">
                  <DoorClosed className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">{t('property.checkOut')}</div>
                    <div className="text-sm font-medium text-foreground truncate">
                      {property.check_out_time ? format(new Date(`2000-01-01T${property.check_out_time}`), 'h:mm a') : '11:00 AM'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border border-border">
                  <Users className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">{t('property.maxGuests')}</div>
                    <div className="text-sm font-medium text-foreground">{property.max_guests}</div>
                  </div>
                </div>
                {property.min_nights && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border border-border">
                    <Clock className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted-foreground">{t('property.minStay')}</div>
                      <div className="text-sm font-medium text-foreground">{property.min_nights}n</div>
                    </div>
                  </div>
                )}
              </div>

              {/* House rules as compact chips */}
              {(property as any).house_rules && (property as any).house_rules.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(property as any).house_rules.map((rule: string, i: number) => {
                    const isPositive = rule.toLowerCase().includes('allowed') || rule.toLowerCase().includes('quiet');
                    const isNegative = rule.toLowerCase().startsWith('no ');
                    return (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
                          isNegative
                            ? 'bg-destructive/5 text-destructive border-destructive/20'
                            : isPositive
                            ? 'bg-green-500/5 text-green-600 dark:text-green-400 border-green-500/20'
                            : 'bg-muted text-muted-foreground border-border'
                        }`}
                      >
                        {isNegative ? <Ban className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                        {rule}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>




            {/* Location with Map */}
            <div>
              <h2 className="font-display text-xl font-semibold mb-4">{t('property.whereYoullBe')}</h2>
              {property.latitude && property.longitude ? (
                <div className="rounded-xl overflow-hidden border border-border">
                  <div ref={mapContainerRef} className="h-[350px] w-full" />
                  <div className="px-4 py-3 bg-card">
                    <div className="flex items-start gap-3">
                      <MapPin className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-foreground">{property.city}{property.state ? `, ${property.state}` : ''}, {property.country}</div>
                        <div className="text-sm text-muted-foreground mt-0.5">{property.address}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card-luxury">
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-medium text-foreground">{property.address}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {property.city}{property.state ? `, ${property.state}` : ''}, {property.country}
                        {property.postal_code ? ` ${property.postal_code}` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Cancellation Policy */}
            <div>
              <h2 className="font-display text-xl font-semibold mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                {t('property.cancellationPolicy')}
              </h2>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="border-green-500/30 bg-green-500/5">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Check className="w-4 h-4 text-green-500" />
                        <span className="font-semibold text-green-600">{t('property.fullRefund')}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t('property.fullRefundDesc')}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-yellow-500/30 bg-yellow-500/5">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-yellow-500" />
                        <span className="font-semibold text-yellow-600">{t('property.partialRefund')}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t('property.partialRefundDesc')}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-destructive/30 bg-destructive/5">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Ban className="w-4 h-4 text-destructive" />
                        <span className="font-semibold text-destructive">{t('property.noRefund')}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t('property.noRefundDesc')}
                      </p>
                    </CardContent>
                  </Card>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('property.refundNote')}
                </p>
              </div>
            </div>

            <Separator />

            {/* Reviews */}
            <div id="reviews">
              {/* Section header — formal & labeled */}
              <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Ratings & Reviews
                </p>
                <RatingSummary
                  rating={
                    property.average_rating && Number(property.average_rating) > 0
                      ? Number(property.average_rating)
                      : reviews.length > 0
                        ? reviews.reduce((s, r) => s + Number(r.overall_rating || 0), 0) / reviews.length
                        : 0
                  }
                  reviewCount={Number(property.total_reviews) || reviews.length}
                  size="lg"
                />
              </div>

              {/* Rating category breakdown bars */}
              {reviews.length > 0 && reviews.some(r => r.cleanliness_rating) && (
                <div className="mb-8">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Category breakdown
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3">
                  {[
                    { label: 'Cleanliness', key: 'cleanliness_rating' },
                    { label: 'Accuracy', key: 'accuracy_rating' },
                    { label: 'Communication', key: 'communication_rating' },
                    { label: 'Location', key: 'location_rating' },
                    { label: 'Check-in', key: 'checkin_rating' },
                    { label: 'Value', key: 'value_rating' },
                  ].map(({ label, key }) => {
                    const rated = reviews.filter(r => (r as any)[key] != null);
                    if (rated.length === 0) return null;
                    const avg = rated.reduce((sum, r) => sum + (Number((r as any)[key]) || 0), 0) / rated.length;
                    return (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <span className="text-sm text-foreground">{label}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 bg-accent rounded-full overflow-hidden">
                            <div
                              className="h-full bg-rating rounded-full transition-all"
                              style={{ width: `${(avg / 5) * 100}%` }}
                            />
                          </div>
                          <span className="text-sm font-bold text-rating w-6">{avg.toFixed(1)}</span>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}

              {/* Mutual Review Ratings (Guest ratings - SEO visible) */}

              {/* Individual guest reviews - prefer legacy reviews, fall back to guest mutual reviews */}
              {(() => {
                const guestMutual = mutualReviews.filter((r: any) => r.reviewer_type === 'guest');
                // Normalise both sources into a common shape so the card can render either.
                const combined =
                  reviews.length > 0
                    ? reviews.map((r) => ({
                        id: r.id,
                        created_at: r.created_at,
                        comment: r.comment,
                        overall_rating: Number(r.overall_rating || 0),
                        host_response: (r as any).host_response,
                        reviewer_profile: r.reviewer_profile,
                      }))
                    : guestMutual.map((r: any) => ({
                        id: r.id,
                        created_at: r.created_at,
                        comment: r.comment,
                        overall_rating: Number(r.overall_rating || 0),
                        host_response: null,
                        reviewer_profile: r.reviewer_profile,
                      }));
                return combined.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Guest reviews
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {combined.slice(0, 6).map((review: any) => {
                      const guest = review.reviewer_profile;
                      const guestName = guest?.full_name || 'Guest';
                      const guestInitial = guestName[0]?.toUpperCase() || 'G';
                      return (
                        <div key={review.id} className="space-y-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="w-10 h-10">
                              <AvatarImage src={guest?.avatar_url || ''} />
                              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                                {guestInitial}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm text-foreground">{guestName}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(review.created_at), 'MMMM yyyy')}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5">
                            {[...Array(5)].map((_, i) => (
                              <Star
                                key={i}
                                className={`w-3.5 h-3.5 ${
                                  i < Math.round(review.overall_rating)
                                    ? 'fill-rating text-rating'
                                    : 'text-muted-foreground/30'
                                }`}
                              />
                            ))}
                          </div>
                          {review.comment && (
                            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">
                              {review.comment}
                            </p>
                          )}
                          {review.host_response && (
                            <div className="mt-2 pl-4 border-l-2 border-primary/30 bg-muted/30 rounded-r-lg p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <MessageSquare className="w-3.5 h-3.5 text-primary" />
                                <span className="text-xs font-semibold text-foreground">Host response</span>
                              </div>
                              <p className="text-sm text-muted-foreground leading-relaxed">{review.host_response}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {combined.length > 6 && (
                    <Button
                      variant="outline"
                      className="mt-6 w-full md:w-auto"
                      onClick={() => setAllReviewsOpen(true)}
                    >
                      Show all {combined.length} reviews
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center py-10 rounded-xl border border-dashed border-rating/40 bg-rating/5">
                  <Star className="w-8 h-8 mx-auto fill-rating text-rating mb-2" />
                  <p className="text-base font-bold text-rating">New listing</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    No reviews yet — be the first to share your experience.
                  </p>
                </div>
                );
              })()}

              {/* Host feedback about guests (mutual reviews, host → guest) */}
              {mutualReviews.filter((r: any) => r.reviewer_type === 'host').length > 0 && (
                <div className="mt-10">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Host feedback about guests
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {mutualReviews
                      .filter((r: any) => r.reviewer_type === 'host')
                      .slice(0, 6)
                      .map((review: any) => {
                        const reviewer = review.reviewer_profile;
                        const reviewerName = reviewer?.full_name || 'Host';
                        const initial = reviewerName[0]?.toUpperCase() || 'H';
                        const rating = Number(review.overall_rating || 0);
                        return (
                          <div key={review.id} className="space-y-3">
                            <div className="flex items-center gap-3">
                              <Avatar className="w-10 h-10">
                                <AvatarImage src={reviewer?.avatar_url || ''} />
                                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                                  {initial}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium text-sm text-foreground">
                                  {reviewerName} <span className="text-xs text-muted-foreground font-normal">· Host</span>
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(review.created_at), 'MMMM yyyy')}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5">
                              {[...Array(5)].map((_, i) => (
                                <Star
                                  key={i}
                                  className={`w-3.5 h-3.5 ${
                                    i < Math.round(rating)
                                      ? 'fill-rating text-rating'
                                      : 'text-muted-foreground/30'
                                  }`}
                                />
                              ))}
                            </div>
                            {review.comment && (
                              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">
                                {review.comment}
                              </p>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* All Reviews Modal */}
              <Dialog open={allReviewsOpen} onOpenChange={setAllReviewsOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                  <div className="mb-6">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      All reviews
                    </p>
                    <RatingSummary
                      rating={
                        property.average_rating && Number(property.average_rating) > 0
                          ? Number(property.average_rating)
                          : reviews.length > 0
                            ? reviews.reduce((s, r) => s + Number(r.overall_rating || 0), 0) / reviews.length
                            : 0
                      }
                      reviewCount={reviews.length}
                      size="lg"
                    />
                  </div>
                  <div className="space-y-6">
                    {reviews.map((review) => {
                      const guest = review.reviewer_profile;
                      const guestName = guest?.full_name || 'Guest';
                      const guestInitial = guestName[0]?.toUpperCase() || 'G';
                      return (
                        <div key={review.id} className="space-y-3 pb-6 border-b border-border last:border-0">
                          <div className="flex items-center gap-3">
                            <Avatar className="w-10 h-10">
                              <AvatarImage src={guest?.avatar_url || ''} />
                              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                                {guestInitial}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm text-foreground">{guestName}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(review.created_at), 'MMMM yyyy')}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5">
                            {[...Array(5)].map((_, i) => (
                              <Star
                                key={i}
                                className={`w-3.5 h-3.5 ${
                                  i < review.overall_rating
                                    ? 'fill-rating text-rating'
                                    : 'text-muted-foreground/30'
                                }`}
                              />
                            ))}
                          </div>
                          {review.comment && (
                            <p className="text-sm text-muted-foreground leading-relaxed">{review.comment}</p>
                          )}
                          {review.host_response && (
                            <div className="mt-2 pl-4 border-l-2 border-primary/30 bg-muted/30 rounded-r-lg p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <MessageSquare className="w-3.5 h-3.5 text-primary" />
                                <span className="text-xs font-semibold text-foreground">Host response</span>
                              </div>
                              <p className="text-sm text-muted-foreground leading-relaxed">{review.host_response}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Booking Card */}
          <div className="lg:col-span-1">
            <Card className="card-luxury sticky top-24">
              <CardHeader>
                <CardTitle className="flex items-baseline gap-2">
                  <span className="font-display text-3xl text-rating font-extrabold">
                    ${nightlyRate}
                  </span>
                  <span className="text-rating font-normal">/ {t('property.night')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Same-day check-in eligibility hint — anchored to property TZ */}
                {(() => {
                  const tz = (property as any)?.timezone || DEFAULT_TZ;
                  const checkOutTime = (property as any)?.check_out_time || '11:00:00';
                  const cutoffLabel = format(
                    new Date(`2000-01-01T${String(checkOutTime).slice(0, 8)}`),
                    'h:mm a',
                  );
                  const tzNow = new Date(nowTick);
                  const todayKey = todayInTz(tz);
                  const isOpen = isSameDayCheckInOpen(checkOutTime, tz, tzNow);
                  const blockedToday = bookedDateKeys.has(todayKey);
                  const localTime = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz,
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(tzNow);
                  if (blockedToday) {
                    return (
                      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        Today is already booked at this property.
                      </div>
                    );
                  }
                  return isOpen ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground"
                    >
                      <span className="font-semibold text-primary">Same-day check-in open.</span>{' '}
                      You can book today (after {cutoffLabel} property time) and check out tomorrow at {cutoffLabel}.
                    </div>
                  ) : (
                    <div
                      role="status"
                      aria-live="polite"
                      className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                    >
                      Same-day check-in opens at <span className="font-medium text-foreground">{cutoffLabel}</span> property time
                      {' '}(currently {localTime}).
                    </div>
                  );
                })()}

                {/* Date Selection - Airbnb Style */}
                <div className="border border-border rounded-xl overflow-hidden">
                  <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <div className="grid grid-cols-2 divide-x divide-border">
                      <PopoverTrigger asChild>
                        <button className="text-left px-4 py-3 hover:bg-accent/50 transition-colors w-full">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-foreground">{t('property.checkIn')}</div>
                          <div className="text-sm text-muted-foreground mt-0.5">
                            {checkIn ? format(checkIn, 'M/d/yyyy') : t('property.addDate')}
                          </div>
                        </button>
                      </PopoverTrigger>
                      <PopoverTrigger asChild>
                        <button className="text-left px-4 py-3 hover:bg-accent/50 transition-colors w-full">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-foreground">{t('property.checkOut')}</div>
                          <div className="text-sm text-muted-foreground mt-0.5">
                            {checkOut ? format(checkOut, 'M/d/yyyy') : t('property.addDate')}
                          </div>
                        </button>
                      </PopoverTrigger>
                    </div>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="range"
                        showOutsideDays={false}
                        selected={checkIn ? { from: checkIn, to: checkOut } : undefined}
                        onDayClick={(day: Date) => {
                          if (!calendarDebug) return;
                          const y = day.getFullYear();
                          const m = String(day.getMonth() + 1).padStart(2, '0');
                          const d = String(day.getDate()).padStart(2, '0');
                          const viewerLocal = `${y}-${m}-${d}`;
                          const tz = (property as any)?.timezone || DEFAULT_TZ;
                          const propertyTzKey = dateKeyInTz(day, tz);
                          setDebugClickedKey({
                            viewerLocal,
                            propertyTz: propertyTzKey,
                            blocked: bookedDateKeys.has(viewerLocal),
                          });
                        }}
                        onSelect={(range: any, clickedDay: Date) => {
                          // Range cleared
                          if (!range?.from) {
                            setDateRange({});
                            return;
                          }
                          // Re-clicking the existing check-in (no checkout yet) clears
                          if (checkIn && !checkOut && range.from.getTime() === checkIn.getTime() && (!range.to || range.to.getTime() === checkIn.getTime())) {
                            setDateRange({});
                            return;
                          }
                          // Both dates selected and user clicks a new valid date AFTER check-in → update checkout
                          if (checkIn && checkOut && clickedDay) {
                            const ci = new Date(checkIn);
                            ci.setHours(0, 0, 0, 0);
                            const cd = new Date(clickedDay);
                            cd.setHours(0, 0, 0, 0);
                            if (cd.getTime() === ci.getTime()) {
                              // Re-clicked check-in → clear
                              setDateRange({});
                              return;
                            }
                            if (cd > ci) {
                              setDateRange({ from: checkIn, to: clickedDay });
                              setCalendarOpen(false);
                              return;
                            }
                            // Clicked before check-in → restart with new check-in
                            setDateRange({ from: clickedDay, to: undefined });
                            return;
                          }
                          // Same-day checkout invalid → keep as check-in only
                          if (range.from && range.to && range.from.getTime() === range.to.getTime()) {
                            setDateRange({ from: range.from, to: undefined });
                            return;
                          }
                          setDateRange({ from: range.from, to: range.to });
                          if (range.from && range.to) {
                            setCalendarOpen(false);
                          }
                        }}
                        numberOfMonths={isMobile ? 1 : 2}
                        disabled={(date) => {
                          const tz = (property as any)?.timezone || DEFAULT_TZ;
                          const todayKeyTz = todayInTz(tz);
                          // Build a viewer-local "today" anchored to property TZ for comparison
                          const [ty, tm, td] = todayKeyTz.split('-').map(Number);
                          const today = new Date(ty, tm - 1, td, 0, 0, 0, 0);
                          const d = new Date(date);
                          d.setHours(0, 0, 0, 0);
                          // Past dates (in property zone) always disabled
                          if (d < today) return true;
                          // Availability Settings (host-controlled) ----------------
                          // advance_notice → minimum lead time before check-in.
                          // availability_window → cap on how far in advance bookings open.
                          const settings = ((property as any)?.availability_settings ?? {}) as {
                            advance_notice?: string;
                            preparation_time?: string;
                            availability_window?: string;
                          };
                          const advanceMap: Record<string, number> = {
                            same_day: 0, '1_day': 1, '2_days': 2, '3_days': 3, '7_days': 7,
                          };
                          const minLeadDays = advanceMap[settings.advance_notice ?? 'same_day'] ?? 0;
                          if (minLeadDays > 0 && !checkIn) {
                            const earliest = new Date(today);
                            earliest.setDate(earliest.getDate() + minLeadDays);
                            if (d < earliest) return true;
                          }
                          const windowMonths = Number(settings.availability_window ?? '12');
                          if (Number.isFinite(windowMonths) && windowMonths > 0 && windowMonths < 24) {
                            const horizon = new Date(today);
                            horizon.setMonth(horizon.getMonth() + windowMonths);
                            if (d > horizon) return true;
                          }
                          // Same-day check-in: only allowed once the property's check-out
                          // time has passed in the property zone. Before then, today is
                          // still occupied by the previous night's stay window.
                          if (
                            d.getTime() === today.getTime() &&
                            !checkIn &&
                            minLeadDays === 0 &&
                            !isSameDayCheckInOpen((property as any)?.check_out_time, tz)
                          ) {
                            return true;
                          }

                          const isBlockedNight = isBlockedKey(d);

                          // Picking checkout phase: check-in chosen, no checkout yet
                          if (checkIn && !checkOut) {
                            const ci = new Date(checkIn);
                            ci.setHours(0, 0, 0, 0);
                            // Can't choose checkout before or same day as check-in
                            if (d <= ci) return true;
                            // Walk every night from check-in up to (d - 1). If any night is blocked,
                            // this checkout would cross an occupied night → disable it.
                            // The checkout day ITSELF can be a blocked night (turnover: leave that morning
                            // before the next guest arrives in the afternoon).
                            let cur = new Date(ci);
                            while (cur < d) {
                              const isNightBlocked = isBlockedKey(cur);
                              if (isNightBlocked) return true;
                              cur = addDays(cur, 1);
                            }
                            return false;
                          }

                          // Both check-in AND check-out selected: allow clicking any valid date AFTER check-in
                          // (with no blocked nights between) → that becomes the new checkout. Re-click check-in to clear.
                          if (checkIn && checkOut) {
                            const ci = new Date(checkIn);
                            ci.setHours(0, 0, 0, 0);
                            if (d.getTime() === ci.getTime()) return false;
                            if (d <= ci) return true;
                            // Walk nights from check-in up to d-1; if any blocked, disable
                            let cur = new Date(ci);
                            while (cur < d) {
                              const blocked = isBlockedKey(cur);
                              if (blocked) return true;
                              cur = addDays(cur, 1);
                            }
                            return false;
                          }

                          // Picking check-in phase (no check-in yet)
                          // A blocked night cannot be a check-in
                          return isBlockedNight;
                        }}
                        modifiers={{
                          booked: bookedDates,
                          // Highlight the single valid checkout when user is in "picking checkout" phase
                          // and the date sits on a booked night that's reachable as a turnover checkout
                          checkoutOnly: (date: Date) => {
                            if (!checkIn || checkOut) return false;
                            const d = new Date(date);
                            d.setHours(0, 0, 0, 0);
                            const ci = new Date(checkIn);
                            ci.setHours(0, 0, 0, 0);
                            if (d <= ci) return false;
                            const isBlockedNight = isBlockedKey(d);
                            if (!isBlockedNight) return false;
                            // All nights between check-in and d-1 must be free
                            let cur = new Date(ci);
                            while (cur < d) {
                              const blocked = isBlockedKey(cur);
                              if (blocked) return false;
                              cur = addDays(cur, 1);
                            }
                            return true;
                          },
                        }}
                        modifiersClassNames={{
                          booked: 'line-through text-muted-foreground opacity-50',
                          checkoutOnly: '!opacity-100 !no-underline ring-2 ring-primary text-foreground font-semibold rounded-md cursor-pointer',
                        }}
                        // Square, responsive day cells — they grow with the
                        // viewport but always stay 1:1 so the calendar reads
                        // cleanly on phones (no horizontal scroll on a 320px
                        // screen: 7 cols × 36px ≈ 252px) and feels generous on
                        // tablets/desktops (up to 56px).
                        classNames={{
                          months: 'flex flex-col sm:flex-row gap-4 sm:gap-6',
                          head_cell: 'text-muted-foreground rounded-md w-9 sm:w-12 md:w-14 font-normal text-[0.7rem] sm:text-[0.8rem]',
                          cell: 'h-9 w-9 sm:h-12 sm:w-12 md:h-14 md:w-14 text-center text-xs sm:text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20',
                          day: 'h-9 w-9 sm:h-12 sm:w-12 md:h-14 md:w-14 p-0 font-normal aria-selected:opacity-100 inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground',
                        }}
                        className="p-3 pointer-events-auto"
                      />
                      {(checkIn || checkOut) && (
                        <div className="flex justify-end px-3 pb-3">
                          <button
                            type="button"
                            onClick={() => setDateRange({})}
                            className="text-sm font-semibold text-foreground underline underline-offset-4 hover:text-primary transition-colors"
                          >
                            {t('property.clearDates', 'Clear dates')}
                          </button>
                        </div>
                      )}
                      {/* Calendar debug — keys + viewer offset, helps diagnose
                          "this date should be available" reports. */}
                      <div className="border-t border-border px-3 py-2 text-[11px]">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={calendarDebug}
                            onChange={(e) => setCalendarDebug(e.target.checked)}
                            className="h-3 w-3"
                          />
                          <span className="text-muted-foreground">Debug calendar</span>
                        </label>
                        {calendarDebug && (
                          <div className="mt-2 space-y-1 font-mono text-[10px]">
                            <div className="text-muted-foreground">
                              Property TZ:{' '}
                              <span className="text-foreground">{(property as any)?.timezone || DEFAULT_TZ}</span>
                            </div>
                            <div className="text-muted-foreground">
                              Viewer TZ:{' '}
                              <span className="text-foreground">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
                            </div>
                            <div className="text-muted-foreground">
                              Blocked keys ({bookedDateKeys.size}):{' '}
                              <span className="text-foreground break-all">
                                {Array.from(bookedDateKeys).sort().join(', ') || '—'}
                              </span>
                            </div>
                            {debugClickedKey && (
                              <div className="mt-1 rounded border border-border p-1.5 bg-muted/30">
                                <div>Last click — viewer local: <span className="text-foreground">{debugClickedKey.viewerLocal}</span></div>
                                <div>Last click — property TZ: <span className="text-foreground">{debugClickedKey.propertyTz}</span></div>
                                <div>Blocked: <span className={debugClickedKey.blocked ? 'text-destructive' : 'text-foreground'}>{String(debugClickedKey.blocked)}</span></div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Guests Selector */}
                  <div className="border-t border-border">
                    <button
                      className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
                      onClick={() => setGuestsOpen(!guestsOpen)}
                    >
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-foreground">{t('property.guests')}</div>
                        <div className="text-sm text-muted-foreground mt-0.5">
                          {totalGuests} {totalGuests === 1 ? 'guest' : 'guests'}
                          {infants > 0 && `, ${infants} infant${infants > 1 ? 's' : ''}`}
                          {pets > 0 && `, ${pets} pet${pets > 1 ? 's' : ''}`}
                        </div>
                      </div>
                      {guestsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </button>

                    {guestsOpen && (
                      <div className="px-4 pb-4 space-y-4">
                        <Separator />
                        {/* Adults */}
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-foreground">{t('guests.adults')}</div>
                            <div className="text-sm text-muted-foreground">{t('guests.adultsDesc')}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              onClick={() => setAdults(Math.max(1, adults - 1))}
                              disabled={adults <= 1}
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-6 text-center text-foreground">{adults}</span>
                            <button
                              className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              onClick={() => setAdults(adults + 1)}
                              disabled={totalGuests >= property.max_guests}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Children */}
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-foreground">{t('guests.children')}</div>
                            <div className="text-sm text-muted-foreground">{t('guests.childrenDesc')}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              onClick={() => setChildren(Math.max(0, children - 1))}
                              disabled={children <= 0}
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-6 text-center text-foreground">{children}</span>
                            <button
                              className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              onClick={() => setChildren(children + 1)}
                              disabled={totalGuests >= property.max_guests}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Infants */}
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-foreground">{t('guests.infants')}</div>
                            <div className="text-sm text-muted-foreground">{t('guests.infantsDesc')}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              onClick={() => setInfants(Math.max(0, infants - 1))}
                              disabled={infants <= 0}
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-6 text-center text-foreground">{infants}</span>
                            <button
                              className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              onClick={() => setInfants(infants + 1)}
                              disabled={infants >= 5}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Pets — only show if host allows pets */}
                        {(() => {
                          const rules = (property.house_rules || []).map((r: string) => r.toLowerCase());
                          const petsAllowed = rules.some((r: string) => r.includes('pets allowed') || r.includes('pet friendly'));
                          const petsForbidden = rules.some((r: string) => r === 'no pets' || r.includes('no pets'));
                          // Default: if neither rule set, treat as not allowed
                          const showPets = petsAllowed && !petsForbidden;
                          return (
                            <>
                              {showPets ? (
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="font-medium text-foreground">{t('guests.pets')}</div>
                                    <div className="text-sm text-muted-foreground underline cursor-pointer">{t('guests.petsDesc')}</div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <button
                                      className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                      onClick={() => setPets(Math.max(0, pets - 1))}
                                      disabled={pets <= 0}
                                    >
                                      <Minus className="w-3 h-3" />
                                    </button>
                                    <span className="w-6 text-center text-foreground">{pets}</span>
                                    <button
                                      className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                      onClick={() => setPets(pets + 1)}
                                      disabled={pets >= 5}
                                    >
                                      <Plus className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              <p className="text-xs text-muted-foreground">
                                This place has a maximum of {property.max_guests} guests, not including infants.
                                {!showPets && " Pets aren't allowed."}
                                {showPets && pets === 0 && " Please specify the number of pets."}
                              </p>
                            </>
                          );
                        })()}

                        <button
                          className="text-sm font-semibold underline text-foreground ml-auto block"
                          onClick={() => setGuestsOpen(false)}
                        >
                          {t('common.close')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Price Breakdown */}
                {numNights > 0 && fees && (
                  <div className="space-y-2 pt-4 border-t border-border">
                    <div className="flex justify-between text-sm">
                      <span>${nightlyRate} x {numNights} {t('property.nights')}</span>
                      <span>${subtotal.toFixed(2)}</span>
                    </div>
                    {cleaningFee > 0 && (
                      <div className="flex justify-between text-sm">
                        <span>{t('property.cleaningFee')}</span>
                        <span>${cleaningFee.toFixed(2)}</span>
                      </div>
                    )}

                    {isPropertyHost ? (
                      /* HOST sees full breakdown */
                      <>
                        {fees.hostServiceFee > 0 && (
                          <div className="flex justify-between text-sm text-destructive">
                            <span>{t('property.serviceFeeHost')}</span>
                            <span>−${fees.hostServiceFee.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm text-destructive">
                          <span>{t('property.commission')} ({platformSettings!.host_commission_percent}%)</span>
                          <span>−${fees.hostCommission.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-destructive">
                          <span className="pl-3">{t('property.taxOnCommission')} ({platformSettings!.host_tax_percent}%)</span>
                          <span>−${fees.hostCommissionTax.toFixed(2)}</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between font-semibold text-green-600">
                          <span>{t('property.netPayout')}</span>
                          <span>${(fees.hostPayout + cleaningFee).toFixed(2)}</span>
                        </div>
                      </>
                    ) : (
                      /* GUEST sees simplified view: service fee inclusive of tax */
                      <>
                        {guestServiceFee > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>{t('property.serviceFee')}</span>
                            <span>${guestServiceFee.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-semibold pt-2 border-t border-border">
                          <span>{t('property.totalPrice')}</span>
                          <span className="text-primary">${guestTotal.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {isPropertyHost ? (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 text-primary font-semibold text-sm">
                      <Home className="w-4 h-4" />
                      This is your listing
                    </div>
                    <p className="text-xs text-muted-foreground">You can't book your own property. Switch to traveller mode to browse other listings.</p>
                    <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => navigate(`/host/properties/${property.id}/edit`)}>
                      <Edit className="w-3.5 h-3.5" /> Edit Listing
                    </Button>
                  </div>
                ) : property.status !== 'active' ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-sm">
                      <Ban className="w-4 h-4" />
                      Not available for new bookings
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This listing is currently {property.status.replace('_', ' ')} and cannot be booked. If you have an existing reservation, you can still message the host below.
                    </p>
                  </div>
                ) : (
                  <Button
                    className="w-full btn-gold"
                    onClick={handleBooking}
                    disabled={isBooking || !checkIn || !checkOut}
                  >
                    {isBooking ? t('property.booking') : t('property.bookNow')}
                  </Button>
                )}

                {property.host_id !== user?.id && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => navigate(`/messages?host=${property.host_id}`)}
                  >
                    <MessageSquare className="w-4 h-4" />
                    {t('property.chatToEnquire')}
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <IncompleteProfileModal
        open={showIncompleteModal}
        onOpenChange={setShowIncompleteModal}
        missingFields={missingFields}
      />
      {checkoutData && (
        <CheckoutModal
          open={showCheckout}
          onOpenChange={setShowCheckout}
          bookingId={checkoutData.bookingId}
          propertyTitle={checkoutData.propertyTitle}
          totalPrice={checkoutData.totalPrice}
          currency={checkoutData.currency}
          numNights={checkoutData.numNights}
          checkIn={checkoutData.checkIn}
          checkOut={checkoutData.checkOut}
          onPaymentInitiated={(url) => { window.location.href = url; }}
        />
      )}
    </Layout>
  );
}