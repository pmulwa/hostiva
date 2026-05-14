import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { PropertyCard } from '@/components/property/PropertyCard';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useFavorites } from '@/hooks/useFavorites';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import {
  Search, MapPin, Calendar, Users, Heart, MessageSquare, ChevronRight,
  ChevronsRight, SlidersHorizontal,
  Minus, Plus, PawPrint,
} from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

import heroImage from '@/assets/hero-living-room.jpg';
import hostBanner from '@/assets/host-home-banner.jpg';
import destNY from '@/assets/dest-newyork.jpg';
import destMiami from '@/assets/dest-miami.jpg';
import destLA from '@/assets/dest-losangeles.jpg';
import destParis from '@/assets/dest-paris.jpg';

type Property = Database['public']['Tables']['properties']['Row'];

export default function Index() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, isHost } = useAuth();
  const { favoriteIds, toggleFavorite } = useFavorites();
  const [properties, setProperties] = useState<Property[]>([]);
  const [searchLocation, setSearchLocation] = useState('');
  const [activeCategory, setActiveCategory] = useState('trending');
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [adults, setAdults] = useState(0);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [pets, setPets] = useState(0);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);

  const totalGuests = adults + children;
  // Translation strings already include {{count}} (e.g. "1 guest" / "2 guests"), so do NOT prepend the number.
  const guestsLabel = totalGuests > 0
    ? `${totalGuests > 1 ? t('guests.guest_plural', { count: totalGuests }) : t('guests.guest', { count: totalGuests })}${infants > 0 ? `, ${infants > 1 ? t('guests.infant_plural', { count: infants }) : t('guests.infant', { count: infants })}` : ''}${pets > 0 ? `, ${pets > 1 ? t('guests.pet_plural', { count: pets }) : t('guests.pet', { count: pets })}` : ''}`
    : '';

  // Location autocomplete (OpenStreetMap Nominatim — global, no API key)
  const [locationSuggestions, setLocationSuggestions] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionsAbort = useRef<AbortController | null>(null);
  const suggestionsTimer = useRef<number | null>(null);
  const locationBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const q = searchLocation.trim();
    if (suggestionsTimer.current) window.clearTimeout(suggestionsTimer.current);
    if (q.length < 2) { setLocationSuggestions([]); return; }
    suggestionsTimer.current = window.setTimeout(async () => {
      try {
        suggestionsAbort.current?.abort();
        const ctrl = new AbortController();
        suggestionsAbort.current = ctrl;
        setSuggestionsLoading(true);
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=8&q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal, headers: { 'Accept-Language': 'en' } }
        );
        const json = await res.json();
        setLocationSuggestions(Array.isArray(json) ? json : []);
      } catch (_) { /* aborted or offline */ }
      finally { setSuggestionsLoading(false); }
    }, 250);
    return () => { if (suggestionsTimer.current) window.clearTimeout(suggestionsTimer.current); };
  }, [searchLocation]);

  // Close suggestions on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (locationBoxRef.current && !locationBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const datesLabel = dateRange?.from
    ? dateRange.to
      ? `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d')}`
      : format(dateRange.from, 'MMM d')
    : '';

  // key = display category; types = property_type enums to match; keywords = title/desc/city words to match
  // Use colored emoji icons (Airbnb-style) instead of monochrome lucide glyphs.
  const categories: Array<{
    emoji: string; key: string;
    types?: Array<Database['public']['Enums']['property_type']>;
    keywords?: string[];
  }> = [
    { emoji: '🏖️', key: 'beachfront',     keywords: ['beach', 'ocean', 'sea', 'coast', 'shore'] },
    { emoji: '🏡', key: 'cabins',         types: ['cabin'] },
    { emoji: '🔥', key: 'trending' }, // no filter — show all top-rated
    { emoji: '🌾', key: 'countryside',    keywords: ['countryside', 'rural', 'farm', 'village', 'meadow'] },
    { emoji: '🏊', key: 'amazingPools',   keywords: ['pool', 'swimming'] },
    { emoji: '🏝️', key: 'islands',        keywords: ['island', 'tropical'] },
    { emoji: '🌊', key: 'lakefront',      keywords: ['lake', 'lakefront', 'lakeside'] },
    { emoji: '🏞️', key: 'nationalParks',  keywords: ['park', 'forest', 'wilderness', 'reserve'] },
    { emoji: '🎨', key: 'design',         keywords: ['design', 'designer', 'modern', 'architect'] },
    { emoji: '🏰', key: 'castles',        keywords: ['castle', 'palace', 'manor'] },
    { emoji: '❄️', key: 'arctic',         keywords: ['arctic', 'snow', 'ski', 'igloo'] },
    { emoji: '⛺', key: 'camping',        keywords: ['tent', 'camp', 'camping', 'glamping'] },
    { emoji: '🕳️', key: 'caves',          keywords: ['cave', 'cavern', 'grotto'] },
    { emoji: '🛖', key: 'domes',          keywords: ['dome', 'geodesic'] },
    { emoji: '🚜', key: 'farms',          keywords: ['farm', 'ranch', 'barn', 'agro'] },
    { emoji: '⛵', key: 'houseboat',      keywords: ['boat', 'houseboat', 'yacht'] },
  ];

  const destinations = [
    { nameKey: 'newYork', subKey: 'newYorkSub', image: destNY },
    { nameKey: 'miami', subKey: 'miamiSub', image: destMiami },
    { nameKey: 'losAngeles', subKey: 'losAngelesSub', image: destLA },
    { nameKey: 'paris', subKey: 'parisSub', image: destParis },
  ];

  // Redirect to host dashboard if in host mode
  useEffect(() => {
    if (user && isHost && localStorage.getItem('hostly_mode') === 'host') {
      navigate('/host/dashboard', { replace: true });
    }
  }, [user, isHost, navigate]);

  useEffect(() => {
    const fetchProperties = async () => {
      // Pull a wider pool so the category filter has enough to show
      const { data } = await supabase
        .from('properties')
        .select('*')
        .eq('status', 'active')
        .order('average_rating', { ascending: false })
        .limit(48);
      if (data) setProperties(data);
    };
    fetchProperties();
  }, []);

  // Filter the homepage grid by the selected category
  const filteredProperties = (() => {
    const cat = categories.find((c) => c.key === activeCategory);
    if (!cat || activeCategory === 'trending') return properties.slice(0, 8);
    return properties.filter((p) => {
      if (cat.types && cat.types.includes(p.property_type)) return true;
      if (cat.keywords && cat.keywords.length) {
        const hay = `${p.title ?? ''} ${p.description ?? ''} ${p.city ?? ''} ${p.country ?? ''}`.toLowerCase();
        return cat.keywords.some((k) => hay.includes(k));
      }
      return false;
    }).slice(0, 8);
  })();

  const handleSearch = (overrideLocation?: string) => {
    const params = new URLSearchParams();
    const loc = (overrideLocation ?? searchLocation).trim();
    if (loc) params.set('location', loc);
    // Map the active category to a property_type when one exists
    const cat = categories.find((c) => c.key === activeCategory);
    if (cat?.types && cat.types[0]) params.set('type', cat.types[0]);
    navigate(`/search?${params.toString()}`);
  };

  return (
    <Layout>
      {/* === Welcome Section (logged-in users) === */}
      {user && profile && (
        <section className="container mx-auto px-4 md:px-6 pt-8 pb-4">
          <h2 className="font-display text-2xl md:text-3xl font-extrabold mb-1">
            {t('welcome.title', { name: profile.full_name || 'Traveler' })}
          </h2>
          <p className="text-muted-foreground text-sm mb-6">{t('welcome.dashboard')}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { icon: Search, label: t('welcome.explore'), sub: t('welcome.findStay'), to: '/search', color: 'bg-blue-50 text-blue-600' },
              { icon: Calendar, label: t('welcome.myTrips'), sub: t('welcome.upcoming', { count: 0 }), to: '/bookings', color: 'bg-emerald-50 text-emerald-600' },
              { icon: MessageSquare, label: t('header.messages'), sub: t('welcome.unread', { count: 0 }), to: '/messages', color: 'bg-teal-50 text-teal-600' },
              { icon: Heart, label: t('header.favorites'), sub: t('welcome.saved', { count: 0 }), to: '/favorites', color: 'bg-pink-light text-primary' },
            ].map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="bg-card border border-border rounded-2xl p-5 hover:shadow-lg transition-all group text-center"
              >
                <div className={`w-12 h-12 ${item.color} rounded-full flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform`}>
                  <item.icon className="w-5 h-5" />
                </div>
                <p className="font-display font-bold text-sm">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.sub}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* === Hero Section === */}
      <section className="relative w-full">
        <div className="relative h-[500px] md:h-[600px] overflow-hidden">
          <img
            src={heroImage}
            alt="Luxury living room"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <h1 className="font-display text-4xl md:text-6xl font-extrabold text-white mb-2 leading-tight">
              {t('hero.title')}
            </h1>
            <p className="font-display text-3xl md:text-5xl font-extrabold mb-4" style={{ color: '#FF6B6B' }}>
              {t('hero.subtitle')}
            </p>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="font-display text-lg md:text-2xl font-semibold italic text-white mb-3 tracking-wide drop-shadow-md"
            >
              Stay. Relax. Belong.
            </motion.p>
            <p className="text-white/90 text-base md:text-lg mb-8 max-w-lg">
              {t('hero.description')}
            </p>

            {/* Search Bar */}
            <div className="search-bar w-full max-w-2xl">
              <div ref={locationBoxRef} className="relative flex-1 flex items-center gap-2 px-5 py-3">
                <MapPin className="w-5 h-5 text-primary shrink-0" />
                <input
                  type="text"
                  placeholder={t('header.whereTo')}
                  value={searchLocation}
                  onChange={(e) => { setSearchLocation(e.target.value); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  className="bg-transparent outline-none w-full text-sm placeholder:text-muted-foreground"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                {showSuggestions && (searchLocation.trim().length >= 2) && (
                  <div className="absolute left-0 right-0 top-full mt-2 bg-card border border-border rounded-xl shadow-xl z-50 max-h-80 overflow-auto text-left">
                    {suggestionsLoading && locationSuggestions.length === 0 && (
                      <div className="px-4 py-3 text-sm text-muted-foreground">Searching places…</div>
                    )}
                    {!suggestionsLoading && locationSuggestions.length === 0 && (
                      <div className="px-4 py-3 text-sm text-muted-foreground">No matches found</div>
                    )}
                    {locationSuggestions.map((s, i) => (
                      <button
                        key={`${s.lat}-${s.lon}-${i}`}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const primary = s.display_name.split(',').slice(0, 2).join(',').trim();
                          setSearchLocation(primary);
                          setShowSuggestions(false);
                          handleSearch(primary);
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-secondary flex items-start gap-2 text-sm border-b border-border last:border-0"
                      >
                        <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span className="line-clamp-2 text-foreground">{s.display_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Dates Popover */}
              <Popover open={datesOpen} onOpenChange={setDatesOpen}>
                <PopoverTrigger asChild>
                  <button className="hidden md:flex items-center gap-2 px-5 py-3 text-sm text-muted-foreground hover:bg-secondary/50 rounded-lg transition-colors cursor-pointer">
                    <Calendar className="w-5 h-5 text-primary shrink-0" />
                    <span className={cn(datesLabel && 'text-foreground font-medium')}>
                      {datesLabel || t('hero.checkInOut')}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="center" sideOffset={12}>
                  <CalendarComponent
                    mode="range"
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                    showOutsideDays={false}
                    disabled={(date) => date < new Date()}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>

              {/* Guests Popover */}
              <Popover open={guestsOpen} onOpenChange={setGuestsOpen}>
                <PopoverTrigger asChild>
                  <button className="hidden md:flex items-center gap-2 px-5 py-3 text-sm text-muted-foreground hover:bg-secondary/50 rounded-lg transition-colors cursor-pointer">
                    <Users className="w-5 h-5 text-primary shrink-0" />
                    <span className={cn(guestsLabel && 'text-foreground font-medium')}>
                      {guestsLabel || t('header.guests')}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end" sideOffset={12}>
                  <div className="p-5 space-y-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">{t('guests.adults')}</p>
                        <p className="text-xs text-muted-foreground">{t('guests.adultsDesc')}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setAdults(Math.max(0, adults - 1))} className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed" disabled={adults === 0}><Minus className="w-3.5 h-3.5" /></button>
                        <span className="w-6 text-center text-sm font-medium">{adults}</span>
                        <button onClick={() => setAdults(adults + 1)} className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-foreground transition-colors"><Plus className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">{t('guests.children')}</p>
                        <p className="text-xs text-muted-foreground">{t('guests.childrenDesc')}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setChildren(Math.max(0, children - 1))} className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed" disabled={children === 0}><Minus className="w-3.5 h-3.5" /></button>
                        <span className="w-6 text-center text-sm font-medium">{children}</span>
                        <button onClick={() => setChildren(children + 1)} className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-foreground transition-colors"><Plus className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">{t('guests.infants')}</p>
                        <p className="text-xs text-muted-foreground">{t('guests.infantsDesc')}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setInfants(Math.max(0, infants - 1))} className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed" disabled={infants === 0}><Minus className="w-3.5 h-3.5" /></button>
                        <span className="w-6 text-center text-sm font-medium">{infants}</span>
                        <button onClick={() => setInfants(infants + 1)} className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-foreground transition-colors"><Plus className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">{t('guests.pets')}</p>
                        <p className="text-xs text-muted-foreground">{t('guests.petsDesc')}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setPets(Math.max(0, pets - 1))} className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed" disabled={pets === 0}><Minus className="w-3.5 h-3.5" /></button>
                        <span className="w-6 text-center text-sm font-medium">{pets}</span>
                        <button onClick={() => setPets(pets + 1)} className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-foreground transition-colors"><Plus className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              <button
                onClick={() => handleSearch()}
                className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shrink-0 m-1.5 hover:brightness-95 transition-all"
              >
                <Search className="w-5 h-5 text-primary-foreground" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* === Categories Strip === */}
      <section className="border-b border-border bg-background sticky top-[72px] z-40">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex items-center gap-1 overflow-x-auto py-4 scrollbar-hide">
            {categories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className={`category-chip shrink-0 ${activeCategory === cat.key ? 'active' : ''}`}
              >
                <span
                  className="text-2xl leading-none select-none"
                  style={{ fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}
                  aria-hidden="true"
                >
                  {cat.emoji}
                </span>
                <span className="text-xs font-medium whitespace-nowrap">{t(`categories.${cat.key}`)}</span>
              </button>
            ))}
            <div className="shrink-0 ml-2">
              <Button variant="outline" size="sm" className="rounded-lg flex items-center gap-2 text-xs font-medium">
                <SlidersHorizontal className="w-4 h-4" />
                {t('categories.filters')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* === Popular Stays === */}
      <section className="container mx-auto px-4 md:px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-xl md:text-2xl font-extrabold">{t('sections.popularStays')}</h2>
          <Link to="/search" className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            {t('sections.viewAll')} <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {filteredProperties.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredProperties.map((property) => (
              <PropertyCard
                key={property.id}
                property={property}
                isFavorited={favoriteIds.has(property.id)}
                onFavorite={() => {
                  if (!user) { navigate('/auth'); return; }
                  toggleFavorite(property.id);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-secondary/50 rounded-2xl">
            <Search className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              {properties.length === 0
                ? t('sections.noProperties')
                : `No "${t(`categories.${activeCategory}`)}" stays yet — try another category.`}
            </p>
            <Button onClick={() => navigate('/become-host')} className="btn-primary rounded-full mt-4">
              {t('sections.listProperty')}
            </Button>
          </div>
        )}
      </section>

      {/* === Popular Destinations === */}
      <section className="container mx-auto px-4 md:px-6 py-10">
        <h2 className="font-display text-xl md:text-2xl font-extrabold mb-6">{t('sections.popularDestinations')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {destinations.map((dest) => (
            <Link
              key={dest.nameKey}
              to={`/search?location=${encodeURIComponent(t(`destinations.${dest.nameKey}`))}`}
              className="flex items-center gap-3 hover:bg-secondary rounded-xl p-3 transition-colors"
            >
              <img
                src={dest.image}
                alt={t(`destinations.${dest.nameKey}`)}
                className="w-14 h-14 rounded-xl object-cover shrink-0"
              />
              <div>
                <p className="font-display font-bold text-sm">{t(`destinations.${dest.nameKey}`)}</p>
                <p className="text-xs text-muted-foreground">{t(`destinations.${dest.subKey}`)}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* === Host Your Home Banner === */}
      <section className="container mx-auto px-4 md:px-6 py-6">
        <div className="relative rounded-2xl overflow-hidden h-64 md:h-80">
          <img src={hostBanner} alt={t('sections.hostHome')} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-center px-8 md:px-12">
            <h2 className="font-display text-2xl md:text-3xl font-extrabold text-white mb-2">
              {t('sections.hostHome')}
            </h2>
            <p className="text-white/80 text-sm mb-4">{t('sections.earnMoney')}</p>
            <Link to="/become-host">
              <Button variant="outline" className="bg-white text-slate-900 border-white hover:bg-white/90 rounded-full font-semibold">
                {t('sections.seeMore')}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* === Gift Cards + Questions About Hosting === */}
      <section className="container mx-auto px-4 md:px-6 py-6 pb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-primary rounded-2xl p-8 md:p-10 text-primary-foreground">
            <h3 className="font-display text-xl md:text-2xl font-extrabold mb-2">{t('sections.giftCards')}</h3>
            <p className="text-primary-foreground/80 text-sm mb-5">{t('sections.giftCardsDesc')}</p>
            <Button variant="outline" size="sm" className="bg-transparent border-primary-foreground text-primary-foreground hover:bg-primary-foreground/10 rounded-full font-semibold">
              {t('sections.search')}
            </Button>
          </div>

          <div className="bg-secondary rounded-2xl p-8 md:p-10">
            <h3 className="font-display text-xl md:text-2xl font-extrabold mb-2">{t('sections.hostingQuestions')}</h3>
            <p className="text-muted-foreground text-sm mb-5">{t('sections.askSuperhost')}</p>
            <Button variant="outline" size="sm" className="rounded-full font-semibold">
              {t('sections.seeMore')}
            </Button>
          </div>
        </div>
      </section>
    </Layout>
  );
}
