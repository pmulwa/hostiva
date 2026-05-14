import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RatingSummary } from '@/components/property/RatingSummary';
import type { Database } from '@/integrations/supabase/types';

type Property = Database['public']['Tables']['properties']['Row'];

interface PropertyCardProps {
  property: Property;
  onFavorite?: () => void;
  isFavorited?: boolean;
}

export function PropertyCard({ property, onFavorite, isFavorited = false }: PropertyCardProps) {
  const { t } = useTranslation();
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: property.currency || 'USD', minimumFractionDigits: 0 }).format(price);
  };

  return (
    <div className="group">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl mb-3">
        <Link to={`/property/${property.id}`}>
          <img src={property.cover_image || '/placeholder.svg'} alt={property.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        </Link>
        <Button variant="ghost" size="icon" className="absolute top-3 right-3 w-8 h-8 rounded-full hover:bg-transparent" onClick={(e) => { e.preventDefault(); onFavorite?.(); }}>
          <Heart className={`w-5 h-5 transition-colors drop-shadow-md ${isFavorited ? 'fill-primary text-primary' : 'fill-black/30 text-white'}`} />
        </Button>
      </div>
      <Link to={`/property/${property.id}`}>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="font-display font-bold text-sm text-foreground">{property.city}, {property.country}</p>
            <RatingSummary
              rating={property.average_rating}
              reviewCount={(property as any).total_reviews}
              size="sm"
            />
          </div>
          <p className="text-sm text-muted-foreground line-clamp-1">{property.title}</p>
          <p className="text-sm text-muted-foreground">
            {property.bedrooms} {t('property.bedrooms').toLowerCase()} · {property.beds} {t('property.beds').toLowerCase()}
          </p>
          <div className="flex items-baseline gap-1 pt-1">
            <span className="font-display font-extrabold text-sm text-rating">{formatPrice(Number(property.price_per_night))}</span>
            <span className="text-sm text-rating">{t('propertyCard.night')}</span>
          </div>
        </div>
      </Link>
    </div>
  );
}