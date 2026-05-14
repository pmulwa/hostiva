import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Star, Sparkles, MessageSquare, Shield, Bed, MapPin, ThumbsUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { getPlatformControls } from '@/hooks/usePlatformControls';

interface ReviewFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  propertyId: string;
  hostId: string;
  propertyTitle: string;
  onReviewSubmitted: () => void;
}

type RatingKey = 'overall_rating' | 'cleanliness_rating' | 'communication_rating' | 'location_rating' | 'security_rating' | 'beddings_rating' | 'recommend_rating';

const GUEST_RATING_CATEGORIES: { key: RatingKey; label: string; icon: any; required?: boolean }[] = [
  { key: 'cleanliness_rating', label: 'Cleanliness', icon: Sparkles },
  { key: 'communication_rating', label: 'Host Communication', icon: MessageSquare },
  { key: 'security_rating', label: 'Security', icon: Shield },
  { key: 'beddings_rating', label: 'Beddings Cleanliness', icon: Bed },
  { key: 'location_rating', label: 'Location', icon: MapPin },
  { key: 'recommend_rating', label: 'Would You Recommend?', icon: ThumbsUp },
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

export function ReviewForm({
  open,
  onOpenChange,
  bookingId,
  propertyId,
  hostId,
  propertyTitle,
  onReviewSubmitted,
}: ReviewFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comment, setComment] = useState('');
  const [ratings, setRatings] = useState<Record<RatingKey, number>>({
    overall_rating: 0,
    cleanliness_rating: 0,
    communication_rating: 0,
    location_rating: 0,
    security_rating: 0,
    beddings_rating: 0,
    recommend_rating: 0,
  });

  const setRating = (key: RatingKey, value: number) => {
    setRatings((prev) => ({ ...prev, [key]: value }));
  };

  const allRated = GUEST_RATING_CATEGORIES.every(c => ratings[c.key] > 0);

  // Calculate overall as average of all categories
  const calcOverall = () => {
    const vals = GUEST_RATING_CATEGORIES.map(c => ratings[c.key]).filter(v => v > 0);
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };

  const handleSubmit = async () => {
    if (!user || !allRated) return;

    // Admin Controls: guest_rights.allow_reviews. When the platform disables
    // reviews, block submission and show a clear explanation.
    const controls = await getPlatformControls();
    if (controls.guest_rights.allow_reviews === false) {
      toast({
        title: 'Reviews disabled',
        description: 'Reviews are temporarily disabled by the platform. Please try again later.',
        variant: 'destructive',
      });
      return;
    }

    const overall = calcOverall();
    setIsSubmitting(true);
    const { error } = await supabase.from('reviews').insert({
      booking_id: bookingId,
      property_id: propertyId,
      host_id: hostId,
      guest_id: user.id,
      overall_rating: overall,
      cleanliness_rating: ratings.cleanliness_rating,
      communication_rating: ratings.communication_rating,
      location_rating: ratings.location_rating,
      accuracy_rating: ratings.security_rating, // map security to accuracy column
      checkin_rating: ratings.beddings_rating,   // map beddings to checkin column
      value_rating: ratings.recommend_rating,    // map recommend to value column
      comment: comment.trim() || null,
    });

    setIsSubmitting(false);

    if (error) {
      toast({
        title: 'Error',
        description: error.message.includes('duplicate') ? 'You have already reviewed this booking.' : error.message,
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Review submitted!', description: 'Thank you for rating this property.' });
      onOpenChange(false);
      onReviewSubmitted();
      setComment('');
      setRatings({ overall_rating: 0, cleanliness_rating: 0, communication_rating: 0, location_rating: 0, security_rating: 0, beddings_rating: 0, recommend_rating: 0 });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
            Rate This Property
          </DialogTitle>
          <DialogDescription className="text-base">
            Share your experience at <span className="font-medium text-foreground">{propertyTitle}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {GUEST_RATING_CATEGORIES.map(({ key, label, icon: Icon }) => (
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
            <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
              <Label className="text-sm font-bold flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                Overall Rating
              </Label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} className={`w-5 h-5 ${star <= calcOverall() ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`} />
                ))}
                <span className="text-sm font-bold ml-2">{calcOverall()}/5</span>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <Label htmlFor="review-comment" className="text-sm font-medium">
              Comment <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="review-comment"
              placeholder="Tell other guests about your experience with this property..."
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
