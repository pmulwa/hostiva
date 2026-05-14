import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface IncompleteProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missingFields: string[];
}

/**
 * Blocks an action (e.g. creating a booking) when the guest's profile is
 * not yet 100% complete. Lists the missing fields and sends the user to
 * /profile?missing=1 where the banner is highlighted automatically.
 */
export function IncompleteProfileModal({
  open,
  onOpenChange,
  missingFields,
}: IncompleteProfileModalProps) {
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-2">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
          </div>
          <DialogTitle className="text-center">
            Complete your profile to book
          </DialogTitle>
          <DialogDescription className="text-center">
            Hosts need a complete profile before accepting bookings. Please
            finish the required fields below — it only takes a minute.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900 mb-2">
            Missing information
          </p>
          <ul className="space-y-1.5">
            {missingFields.map((field) => (
              <li key={field} className="flex items-start gap-2 text-sm text-amber-900">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                {field}
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="sm:flex-1"
          >
            Not now
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              navigate('/profile?missing=1');
            }}
            className="btn-primary sm:flex-1"
          >
            Complete profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
