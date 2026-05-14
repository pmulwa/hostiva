import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/hooks/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

const EVENT_LABELS: Record<string, string> = {
  booking_confirmed: 'Booking confirmed',
  booking_request_pending: 'New booking request',
  booking_approved: 'Booking approved',
  booking_declined: 'Booking declined',
  payment_succeeded: 'Payment received',
  payment_failed: 'Payment failed',
  check_in_unlocked: 'Check-in unlocked',
  guest_checked_in: 'Guest checked in',
  payout_released: 'Payout released',
  review_request: 'Leave a review',
  cancellation: 'Cancellation',
  dispute_opened: 'Dispute opened',
  force_majeure_declared: 'Force majeure',
  strike_warning: 'Message warning',
  strike_blocked: 'Message blocked',
  strike_suspended: 'Account suspended',
  new_message: 'New message',
};

export function NotificationsBell() {
  const { items, unreadCount, markRead, markAllRead } = useNotifications();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center rounded-full">
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="h-7 text-xs gap-1">
              <CheckCheck className="w-3 h-3" /> Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[400px]">
          {items.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground p-8">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No notifications yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={cn(
                    'w-full text-left p-3 hover:bg-muted/50 transition-colors block',
                    !n.is_read && 'bg-primary/5',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{n.subject ?? EVENT_LABELS[n.event_type] ?? n.event_type}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}