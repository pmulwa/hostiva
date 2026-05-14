import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Size = 'sm' | 'md' | 'lg';

interface RatingSummaryProps {
  rating?: number | string | null;
  reviewCount?: number | string | null;
  size?: Size;
  /** When true, the review count links to the in-page #reviews anchor. */
  linkToReviews?: boolean;
  className?: string;
}

/**
 * Unified "★ X.X · N reviews" / "★ New listing" summary used across
 * property cards, the property detail header and the reviews section.
 * Always renders in the coral "rating" red so guest, host and admin
 * surfaces stay visually consistent.
 */
export function RatingSummary({
  rating,
  reviewCount,
  size = 'sm',
  linkToReviews = false,
  className = '',
}: RatingSummaryProps) {
  const { t } = useTranslation();

  const numRating = Number(rating ?? 0);
  const numReviews = Number(reviewCount ?? 0);
  const hasRating = numRating > 0 && numReviews > 0;

  const sizing = {
    sm: { star: 'w-3.5 h-3.5', text: 'text-sm', gap: 'gap-1.5' },
    md: { star: 'w-4 h-4', text: 'text-base', gap: 'gap-2' },
    lg: { star: 'w-5 h-5', text: 'text-lg', gap: 'gap-2' },
  }[size];

  if (!hasRating) {
    return (
      <span
        className={`inline-flex items-center ${sizing.gap} text-rating font-bold ${sizing.text} ${className}`}
      >
        <Star className={`${sizing.star} fill-rating text-rating`} aria-hidden />
        <span>New listing</span>
      </span>
    );
  }

  const reviewLabel = `${numReviews} ${
    numReviews === 1
      ? t('property.review', { defaultValue: 'review' })
      : t('property.reviews', { defaultValue: 'reviews' })
  }`;

  return (
    <span
      className={`inline-flex items-center ${sizing.gap} text-rating font-bold ${sizing.text} ${className}`}
      aria-label={`Rated ${numRating.toFixed(1)} out of 5 from ${reviewLabel}`}
    >
      <Star className={`${sizing.star} fill-rating text-rating`} aria-hidden />
      <span>{numRating.toFixed(1)}</span>
      <span className="text-rating/70" aria-hidden>·</span>
      {linkToReviews ? (
        <a href="#reviews" className="underline-offset-2 hover:underline text-rating font-bold">
          {reviewLabel}
        </a>
      ) : (
        <span>{reviewLabel}</span>
      )}
    </span>
  );
}

export default RatingSummary;