import { useState, useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { PropertyCard } from '@/components/property/PropertyCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { Search as SearchIcon, Filter, MapPin, Grid, List, LayoutGrid, X, Wifi, Car, Waves, Droplets, Dumbbell, CookingPot, Wind, Tv, Flame, WashingMachine } from 'lucide-react';
import { useViewMode } from '@/hooks/useViewMode';
import type { Database } from '@/integrations/supabase/types';

type Property = Database['public']['Tables']['properties']['Row'];
type PropertyType = Database['public']['Enums']['property_type'];

const propertyTypeKeys: PropertyType[] = ['apartment','house','villa','cabin','cottage','loft','studio','penthouse','resort','hotel'];

const amenityFilters = [
  { id: 'wifi', label: 'WiFi', icon: Wifi },
  { id: 'pool', label: 'Pool', icon: Waves },
  { id: 'parking', label: 'Parking', icon: Car },
  { id: 'kitchen', label: 'Kitchen', icon: CookingPot },
  { id: 'ac', label: 'A/C', icon: Wind },
  { id: 'tv', label: 'TV', icon: Tv },
  { id: 'gym', label: 'Gym', icon: Dumbbell },
  { id: 'hottub', label: 'Hot tub', icon: Droplets },
  { id: 'heating', label: 'Heating', icon: Flame },
  { id: 'washer', label: 'Washer', icon: WashingMachine },
];

export default function SearchPage() {
  const { t } = useTranslation();
  const { user, isHost } = useAuth();
  const navigate = useNavigate();
  const { favoriteIds, toggleFavorite } = useFavorites();

  // Redirect to host dashboard if in host mode
  const isInHostMode = isHost && localStorage.getItem('hostly_mode') === 'host';
  useEffect(() => {
    if (isInHostMode) {
      navigate('/host/dashboard', { replace: true });
    }
  }, [isInHostMode, navigate]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useViewMode('search', 'grid', ['grid', 'list', 'card'] as const);

  const [location, setLocation] = useState(searchParams.get('location') || '');
  const [propertyType, setPropertyType] = useState<string>(searchParams.get('type') || 'all');
  const [priceRange, setPriceRange] = useState([0, 5000]);
  const [guests, setGuests] = useState<string>(searchParams.get('guests') || 'any');
  const [bedrooms, setBedrooms] = useState<string>(searchParams.get('bedrooms') || 'any');
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>(() => {
    const param = searchParams.get('amenities');
    return param ? param.split(',') : [];
  });

  useEffect(() => { fetchProperties(); }, [searchParams]);

  const fetchProperties = async () => {
    setIsLoading(true);
    let query = supabase.from('properties').select('*').eq('status', 'active');
    const locationParam = searchParams.get('location');
    if (locationParam) query = query.or(`city.ilike.%${locationParam}%,country.ilike.%${locationParam}%`);
    const typeParam = searchParams.get('type');
    if (typeParam) query = query.eq('property_type', typeParam as PropertyType);
    const minPrice = searchParams.get('minPrice');
    const maxPrice = searchParams.get('maxPrice');
    if (minPrice) query = query.gte('price_per_night', parseInt(minPrice));
    if (maxPrice) query = query.lte('price_per_night', parseInt(maxPrice));
    const guestsParam = searchParams.get('guests');
    if (guestsParam) query = query.gte('max_guests', parseInt(guestsParam));
    const bedroomsParam = searchParams.get('bedrooms');
    if (bedroomsParam) query = query.gte('bedrooms', parseInt(bedroomsParam));
    const { data, error } = await query.order('created_at', { ascending: false });
    if (!error && data) {
      const amenitiesParam = searchParams.get('amenities');
      if (amenitiesParam) {
        const requiredAmenities = amenitiesParam.split(',');
        // Fetch property_amenities join + amenities names to filter client-side
        const propertyIds = data.map(p => p.id);
        const { data: paData } = await supabase
          .from('property_amenities')
          .select('property_id, amenities(name)')
          .in('property_id', propertyIds);
        
        const propertyAmenityMap = new Map<string, Set<string>>();
        if (paData) {
          for (const row of paData as any[]) {
            const pid = row.property_id;
            if (!propertyAmenityMap.has(pid)) propertyAmenityMap.set(pid, new Set());
            const name = row.amenities?.name?.toLowerCase().replace(/[\s/]+/g, '_');
            if (name) propertyAmenityMap.get(pid)!.add(name);
          }
        }
        const filtered = data.filter(p => {
          const amenities = propertyAmenityMap.get(p.id);
          if (!amenities) return false;
          return requiredAmenities.every(a => amenities.has(a));
        });
        setProperties(filtered);
      } else {
        setProperties(data);
      }
    }
    setIsLoading(false);
  };

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (location) params.set('location', location);
    if (propertyType && propertyType !== 'all') params.set('type', propertyType);
    if (priceRange[0] > 0) params.set('minPrice', priceRange[0].toString());
    if (priceRange[1] < 5000) params.set('maxPrice', priceRange[1].toString());
    if (guests && guests !== 'any') params.set('guests', guests);
    if (bedrooms && bedrooms !== 'any') params.set('bedrooms', bedrooms);
    if (selectedAmenities.length > 0) params.set('amenities', selectedAmenities.join(','));
    setSearchParams(params);
  };

  const clearFilters = () => {
    setLocation(''); setPropertyType('all'); setPriceRange([0, 5000]); setGuests('any'); setBedrooms('any'); setSelectedAmenities([]); setSearchParams({});
  };

  const toggleAmenity = (id: string) => {
    setSelectedAmenities(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  const activeFiltersCount = [location, propertyType && propertyType !== 'all', priceRange[0] > 0 || priceRange[1] < 5000, guests && guests !== 'any', bedrooms && bedrooms !== 'any', selectedAmenities.length > 0].filter(Boolean).length;

  const FilterContent = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium">{t('search.location')}</label>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t('search.locationPlaceholder')} value={location} onChange={(e) => setLocation(e.target.value)} className="pl-10" />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t('search.propertyType')}</label>
        <Select value={propertyType} onValueChange={setPropertyType}>
          <SelectTrigger><SelectValue placeholder={t('search.allTypes')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('search.allTypes')}</SelectItem>
            {propertyTypeKeys.map((type) => (
              <SelectItem key={type} value={type}>{t(`propertyTypes.${type}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-4">
        <label className="text-sm font-medium">{t('search.priceRange')}: ${priceRange[0]} - ${priceRange[1]}+</label>
        <Slider value={priceRange} onValueChange={setPriceRange} min={0} max={5000} step={50} />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t('search.minGuests')}</label>
        <Select value={guests} onValueChange={setGuests}>
          <SelectTrigger><SelectValue placeholder={t('search.any')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('search.any')}</SelectItem>
            {[1,2,4,6,8,10,12].map((num) => (
              <SelectItem key={num} value={num.toString()}>{t('search.guests', { count: num })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t('search.minBedrooms')}</label>
        <Select value={bedrooms} onValueChange={setBedrooms}>
          <SelectTrigger><SelectValue placeholder={t('search.any')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('search.any')}</SelectItem>
            {[1,2,3,4,5,6].map((num) => (
              <SelectItem key={num} value={num.toString()}>{t('search.bedrooms', { count: num })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Amenities</label>
        <div className="flex flex-wrap gap-2">
          {amenityFilters.map(({ id, label, icon: Icon }) => {
            const isSelected = selectedAmenities.includes(id);
            return (
              <button
                key={id}
                onClick={() => toggleAmenity(id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-foreground border-border hover:border-primary/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-3 pt-4">
        <Button variant="outline" onClick={clearFilters} className="flex-1">{t('search.clearAll')}</Button>
        <Button onClick={applyFilters} className="flex-1 btn-gold">{t('search.applyFilters')}</Button>
      </div>
    </div>
  );

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold mb-2">
              {location ? t('search.propertiesIn', { location }) : t('search.title')}
            </h1>
            <p className="text-muted-foreground">
              {t('search.propertiesFound', { count: properties.length })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="md:hidden">
                  <Filter className="w-4 h-4 mr-2" />{t('search.filters')}
                  {activeFiltersCount > 0 && <Badge className="ml-2 bg-primary text-primary-foreground">{activeFiltersCount}</Badge>}
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader><SheetTitle>{t('search.filters')}</SheetTitle></SheetHeader>
                <div className="mt-6"><FilterContent /></div>
              </SheetContent>
            </Sheet>
            <div className="flex items-center border border-border rounded-lg overflow-hidden">
              <Button variant={viewMode === 'grid' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('grid')} className={viewMode === 'grid' ? 'bg-primary' : ''}><Grid className="w-4 h-4" /></Button>
              <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('list')} className={viewMode === 'list' ? 'bg-primary' : ''}><List className="w-4 h-4" /></Button>
              <Button variant={viewMode === 'card' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('card')} className={viewMode === 'card' ? 'bg-primary' : ''} title="Compact"><LayoutGrid className="w-4 h-4" /></Button>
            </div>
          </div>
        </div>
        <div className="flex gap-8">
          <aside className="hidden md:block w-72 flex-shrink-0">
            <div className="bg-card border border-border rounded-xl p-6 sticky top-24">
              <h3 className="font-display text-lg font-semibold mb-6 flex items-center justify-between">
                {t('search.filters')}
                {activeFiltersCount > 0 && <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground"><X className="w-4 h-4 mr-1" />{t('search.clear')}</Button>}
              </h3>
              <FilterContent />
            </div>
          </aside>
          <div className="flex-1">
            {(() => {
              const gridClass =
                viewMode === 'card'
                  ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                  : viewMode === 'list'
                    ? 'grid-cols-1'
                    : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3';
              const gap = viewMode === 'card' ? 'gap-4' : 'gap-6';
              return isLoading ? (
              <div className={`grid ${gap} ${gridClass}`}>
                {[...Array(6)].map((_, i) => (<div key={i} className="bg-card border border-border rounded-xl p-6 animate-pulse"><div className="aspect-[4/3] bg-muted rounded-lg mb-4" /><div className="h-4 bg-muted rounded w-3/4 mb-2" /><div className="h-4 bg-muted rounded w-1/2" /></div>))}
              </div>
            ) : properties.length > 0 ? (
              <div className={`grid ${gap} ${gridClass}`}>
                {properties.map((property) => (
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
              <div className="bg-card border border-border rounded-xl text-center py-16">
                <SearchIcon className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">{t('search.noProperties')}</h3>
                <p className="text-muted-foreground mb-6">{t('search.adjustFilters')}</p>
                <Button onClick={clearFilters} className="btn-primary rounded-full">{t('search.clearFilters')}</Button>
              </div>
            );
            })()}
          </div>
        </div>
      </div>
    </Layout>
  );
}