import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { PropertyCard } from '@/components/property/PropertyCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Heart, Search, SlidersHorizontal, Grid3X3, LayoutList, LayoutGrid, Trash2, Share2, MapPin } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useViewMode } from '@/hooks/useViewMode';
import { useHostModeGuard } from '@/hooks/useHostModeGuard';
import type { Database } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';

type Property = Database['public']['Tables']['properties']['Row'];
type Favorite = Database['public']['Tables']['favorites']['Row'];

interface FavoriteWithProperty extends Favorite {
  properties: Property;
}

export default function Favorites() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Hosts in host mode cannot browse favorites — they must switch to guest
  // mode (Travelling) first. Persistent across reloads via the host-mode flag.
  useHostModeGuard('guest-only');

  const [favorites, setFavorites] = useState<FavoriteWithProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [viewMode, setViewMode] = useViewMode('favorites', 'grid', ['grid', 'list', 'card'] as const);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);

  const fetchFavorites = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('favorites')
      .select('*, properties(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setFavorites(data as unknown as FavoriteWithProperty[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    fetchFavorites();
  }, [user, navigate, fetchFavorites]);

  const handleRemoveFavorite = async (propertyId: string) => {
    if (!user) return;
    await supabase
      .from('favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('property_id', propertyId);

    setFavorites((prev) => prev.filter((f) => f.property_id !== propertyId));
    toast({ title: t('favorites.removed'), description: t('favorites.removedDesc') });
  };

  const handleBulkRemove = async () => {
    if (!user || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    await supabase
      .from('favorites')
      .delete()
      .eq('user_id', user.id)
      .in('property_id', ids);

    setFavorites((prev) => prev.filter((f) => !ids.includes(f.property_id)));
    setSelectedIds(new Set());
    setIsSelecting(false);
    toast({
      title: t('favorites.bulkRemoved'),
      description: t('favorites.bulkRemovedDesc', { count: ids.length }),
    });
  };

  const toggleSelect = (propertyId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(propertyId)) next.delete(propertyId);
      else next.add(propertyId);
      return next;
    });
  };

  const handleShare = async (property: Property) => {
    const url = `${window.location.origin}/property/${property.id}`;
    if (navigator.share) {
      await navigator.share({ title: property.title, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast({ title: t('favorites.linkCopied'), description: url });
    }
  };

  // Filter & sort
  const filtered = favorites
    .filter((f) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      const p = f.properties;
      return (
        p.title.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'price_low':
          return Number(a.properties.price_per_night) - Number(b.properties.price_per_night);
        case 'price_high':
          return Number(b.properties.price_per_night) - Number(a.properties.price_per_night);
        case 'rating':
          return Number(b.properties.average_rating || 0) - Number(a.properties.average_rating || 0);
        case 'oldest':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        default: // newest
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

  // Stats
  const totalSaved = favorites.length;
  const avgPrice =
    totalSaved > 0
      ? Math.round(favorites.reduce((s, f) => s + Number(f.properties.price_per_night), 0) / totalSaved)
      : 0;
  const cities = new Set(favorites.map((f) => f.properties.city));

  if (!user) return null;

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 py-8 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Heart className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="font-display text-2xl md:text-3xl font-extrabold">{t('favorites.title')}</h1>
                <p className="text-muted-foreground text-sm">{t('favorites.subtitle')}</p>
              </div>
            </div>
          </div>

          {totalSaved > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant={isSelecting ? 'default' : 'outline'}
                size="sm"
                className="rounded-full text-xs"
                onClick={() => {
                  setIsSelecting(!isSelecting);
                  setSelectedIds(new Set());
                }}
              >
                {isSelecting ? t('common.cancel') : t('favorites.select')}
              </Button>
              {isSelecting && selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="rounded-full text-xs gap-1"
                  onClick={handleBulkRemove}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('favorites.removeSelected', { count: selectedIds.size })}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Stats Cards */}
        {totalSaved > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-card border border-border rounded-2xl p-5 text-center">
              <Heart className="w-5 h-5 text-primary mx-auto mb-2" />
              <p className="font-display text-2xl font-extrabold">{totalSaved}</p>
              <p className="text-xs text-muted-foreground">{t('favorites.savedPlaces')}</p>
            </div>
            <div className="bg-card border border-border rounded-2xl p-5 text-center">
              <MapPin className="w-5 h-5 text-primary mx-auto mb-2" />
              <p className="font-display text-2xl font-extrabold">{cities.size}</p>
              <p className="text-xs text-muted-foreground">{t('favorites.destinations')}</p>
            </div>
            <div className="bg-card border border-border rounded-2xl p-5 text-center">
              <span className="text-primary text-lg font-extrabold block mb-1">$</span>
              <p className="font-display text-2xl font-extrabold">{avgPrice}</p>
              <p className="text-xs text-muted-foreground">{t('favorites.avgPrice')}</p>
            </div>
          </div>
        )}

        {/* Toolbar */}
        {totalSaved > 0 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('favorites.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 rounded-full bg-secondary/50 border-0 focus-visible:ring-primary"
              />
            </div>
            <div className="flex items-center gap-2">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[160px] rounded-full text-xs">
                  <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">{t('favorites.sortNewest')}</SelectItem>
                  <SelectItem value="oldest">{t('favorites.sortOldest')}</SelectItem>
                  <SelectItem value="price_low">{t('favorites.sortPriceLow')}</SelectItem>
                  <SelectItem value="price_high">{t('favorites.sortPriceHigh')}</SelectItem>
                  <SelectItem value="rating">{t('favorites.sortRating')}</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex border border-border rounded-full overflow-hidden">
                <button
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    'p-2 transition-colors',
                    viewMode === 'grid' ? 'bg-foreground text-background' : 'hover:bg-secondary'
                  )}
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'p-2 transition-colors',
                    viewMode === 'list' ? 'bg-foreground text-background' : 'hover:bg-secondary'
                  )}
                >
                  <LayoutList className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('card')}
                  title="Compact"
                  className={cn(
                    'p-2 transition-colors',
                    viewMode === 'card' ? 'bg-foreground text-background' : 'hover:bg-secondary'
                  )}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[4/3] bg-secondary rounded-xl mb-3" />
                <div className="h-4 bg-secondary rounded w-3/4 mb-2" />
                <div className="h-3 bg-secondary rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : totalSaved === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <Heart className="w-12 h-12 text-primary" />
            </div>
            <h2 className="font-display text-xl font-extrabold mb-2">{t('favorites.emptyTitle')}</h2>
            <p className="text-muted-foreground text-sm max-w-md mb-6">{t('favorites.emptyDesc')}</p>
            <Button onClick={() => navigate('/search')} className="btn-primary rounded-full">
              <Search className="w-4 h-4 mr-2" />
              {t('favorites.exploreNow')}
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          /* No search results */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="font-display text-lg font-bold mb-1">{t('favorites.noResults')}</h3>
            <p className="text-muted-foreground text-sm mb-4">{t('favorites.noResultsDesc')}</p>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setSearchQuery('')}>
              {t('favorites.clearSearch')}
            </Button>
          </div>
        ) : viewMode !== 'list' ? (
          /* Grid / Card View */
          <div className={cn(
            'grid',
            viewMode === 'card'
              ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'
              : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6'
          )}>
            {filtered.map((fav) => (
              <div key={fav.id} className="relative group">
                {isSelecting && (
                  <button
                    onClick={() => toggleSelect(fav.property_id)}
                    className={cn(
                      'absolute top-3 left-3 z-10 w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center',
                      selectedIds.has(fav.property_id)
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'bg-white/80 border-white/60 hover:border-primary'
                    )}
                  >
                    {selectedIds.has(fav.property_id) && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )}
                <PropertyCard
                  property={fav.properties}
                  isFavorited={true}
                  onFavorite={() => handleRemoveFavorite(fav.property_id)}
                />
                {/* Share button overlay */}
                <button
                  onClick={() => handleShare(fav.properties)}
                  className="absolute top-3 right-12 z-10 w-8 h-8 rounded-full bg-white/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white"
                >
                  <Share2 className="w-4 h-4 text-foreground" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="space-y-4">
            {filtered.map((fav) => {
              const p = fav.properties;
              return (
                <div
                  key={fav.id}
                  className="flex gap-4 bg-card border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => navigate(`/property/${p.id}`)}
                >
                  {isSelecting && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(fav.property_id);
                      }}
                      className={cn(
                        'self-center ml-4 w-6 h-6 rounded-full border-2 shrink-0 transition-all flex items-center justify-center',
                        selectedIds.has(fav.property_id)
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'border-border hover:border-primary'
                      )}
                    >
                      {selectedIds.has(fav.property_id) && (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  )}
                  <img
                    src={p.cover_image || '/placeholder.svg'}
                    alt={p.title}
                    className="w-40 h-32 md:w-56 md:h-40 object-cover shrink-0"
                  />
                  <div className="flex-1 py-4 pr-4 flex flex-col justify-between min-w-0">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-display font-bold text-sm truncate">{p.title}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {p.city}, {p.country}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShare(p);
                            }}
                            className="w-8 h-8 rounded-full hover:bg-secondary flex items-center justify-center transition-colors"
                          >
                            <Share2 className="w-4 h-4 text-muted-foreground" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFavorite(fav.property_id);
                            }}
                            className="w-8 h-8 rounded-full hover:bg-secondary flex items-center justify-center transition-colors"
                          >
                            <Heart className="w-4 h-4 fill-primary text-primary" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {p.bedrooms} {t('property.bedrooms').toLowerCase()} · {p.beds} {t('property.beds').toLowerCase()} · {p.bathrooms} {t('property.bathrooms').toLowerCase()}
                      </p>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-baseline gap-1">
                        <span className="font-display font-extrabold text-sm text-rating">
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: p.currency || 'USD',
                            minimumFractionDigits: 0,
                          }).format(Number(p.price_per_night))}
                        </span>
                        <span className="text-xs text-rating">{t('propertyCard.night')}</span>
                      </div>
                      {p.average_rating && Number(p.average_rating) > 0 && (
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-primary">★</span>
                          <span className="font-medium">{Number(p.average_rating).toFixed(1)}</span>
                          {p.total_reviews && p.total_reviews > 0 && (
                            <span className="text-muted-foreground">({p.total_reviews})</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
