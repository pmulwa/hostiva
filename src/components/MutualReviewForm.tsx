import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Star, Sparkles, MessageSquare, Shield, Bed, MapPin, ThumbsUp, ClipboardCheck, Home } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { getPlatformControls } from '@/hooks/usePlatformControls';
import { addDays } from 'date-fns';

interface MutualReviewFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  propertyId: string;
  guestId: string;
  hostId: string;
  checkOutDate: string;
  reviewWindowDays: number;
  reviewerType: 'guest' | 'host';
  targetName: string;
  onReviewSubmitted: () => void;
}

type RatingKey = string;

const GUEST_CATEGORIES = [
  { key: 'cleanliness_rating', label: 'Cleanliness', icon: Sparkles },
  { key: 'communication_rating', label: 'Host Communication', icon: MessageSquare },
  { key: 'security_rating', label: 'Security', icon: Shield },
  { key: 'beddings_rating', label: 'Beddings Cleanliness', icon: Bed },
  { key: 'location_rating', label: 'Location', icon: MapPin },
];

const HOST_CATEGORIES = [
  { key: 'cleanliness_rating', label: 'How Guest Left Facility', icon: Home },
  { key: 'beddings_rating', label: 'Cleanliness & Tidiness', icon: Sparkles },
  { key: 'communication_rating', label: 'Communication', icon: MessageSquare },
  { key: 'security_rating', label: 'Respect for Property', icon: Shield },
  { key: 'location_rating', label: 'Would You Recommend?', icon: ThumbsUp },
];

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          className="focus:outline-none transition-transform hover:scale-110"
        >
          <Star
            className={`w-6 h-6 transition-colors ${
              star <= (hover || value)
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-muted-foreground/30'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export function MutualReviewForm({
  open, onOpenChange, bookingId, propertyId, guestId, hostId,
  checkOutDate, reviewWindowDays, reviewerType, targetName, onReviewSubmitted,
}: MutualReviewFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comment, setComment] = useState('');

  const categories = reviewerType === 'guest' ? GUEST_CATEGORIES : HOST_CATEGORIES;

  const [ratings, setRatings] = useState<Record<string, number>>({
    cleanliness_rating: 0, communication_rating: 0, security_rating: 0,
    beddings_rating: 0, location_rating: 0,
  });

  const windowCloses = addDays(new Date(checkOutDate), reviewWindowDays);
  const isExpired = new Date() > windowCloses;

  const setRating = (key: string, value: number) => {
    setRatings((prev) => ({ ...prev, [key]: value }));
  };

  const allRated = categories.every(c => ratings[c.key] > 0);

  const calcOverall = () => {
    const vals = categories.map(c => ratings[c.key]).filter(v => v > 0);
    return vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
  };

  const handleSubmit = async () => {
    if (!user || !allRated) return;

    // Admin Controls: guest_rights.allow_reviews. The mutual review system
    // is gated by the same toggle as one-sided guest reviews.
    const controls = await getPlatformControls();
    if (controls.guest_rights.allow_reviews === false) {
      toast({
        title: 'Reviews disabled',
        description: 'Reviews are temporarily disabled by the platform. Please try again later.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    // Note: overall_rating is a GENERATED column in the DB — do NOT insert it.
    const { error } = await supabase.from('mutual_reviews' as any).insert({
      booking_id: bookingId,
      property_id: propertyId,
      guest_id: guestId,
      host_id: hostId,
      reviewer_type: reviewerType,
      location_rating: ratings.location_rating,
      security_rating: ratings.security_rating,
      cleanliness_rating: ratings.cleanliness_rating,
      beddings_rating: ratings.beddings_rating,
      communication_rating: ratings.communication_rating,
      comment: comment.trim() || null,
      review_window_closes_at: windowCloses.toISOString(),
    } as any);

    setIsSubmitting(false);

    if (error) {
      toast({
        title: 'Error',
        description: error.message.includes('duplicate')
          ? 'You have already submitted a review for this booking.'
          : error.message,
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Review submitted!', description: 'Your review will be visible once both parties have reviewed or the review window closes.' });
      onOpenChange(false);
      onReviewSubmitted();
      setComment('');
      setRatings({ cleanliness_rating: 0, communication_rating: 0, security_rating: 0, beddings_rating: 0, location_rating: 0 });
    }
  };

  if (isExpired) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Review Window Closed</DialogTitle>
            <DialogDescription>
              The {reviewWindowDays}-day review window has expired for this booking.
            </DialogDescription>
          </DialogHeader>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
            {reviewerType === 'guest' ? 'Rate This Property' : 'Rate Your Guest'}
          </DialogTitle>
          <DialogDescription className="text-base">
            {reviewerType === 'guest'
              ? <>Rate your experience at this property</>
              : <>Rate the performance of <span className="font-medium text-foreground">{targetName}</span></>
            }
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted/50 p-3 mb-2">
          <p className="text-xs text-muted-foreground">
            <strong>Blind review:</strong> Your rating will only be visible after both parties submit or the {reviewWindowDays}-day window closes.
          </p>
        </div>

        <div className="space-y-4 py-2">
          {categories.map(({ key, label, icon: Icon }) => (
            <div key={key} className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Icon className="w-4 h-4 text-muted-foreground" />
                {label}
                <span className="text-destructive">*</span>
              </Label>
              <StarRating value={ratings[key]} onChange={(v) => setRating(key, v)} />
            </div>
          ))}

          {allRated && (
            <div className="flex items-center justify-between bg-primary/5 rounded-lg p-3">
              <Label className="text-sm font-bold flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                Overall Rating
              </Label>
              <span className="text-lg font-bold text-primary">{calcOverall()}/5</span>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <Label htmlFor="mutual-review-comment" className="text-sm font-medium">
              Comment <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="mutual-review-comment"
              placeholder={reviewerType === 'guest' ? 'Tell others about this property...' : 'Share your experience with this guest...'}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              className="min-h-[100px] resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">{comment.length}/1000</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !allRated}>
            {isSubmitting ? 'Submitting...' : 'Submit Review'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
