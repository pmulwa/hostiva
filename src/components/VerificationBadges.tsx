import { Shield, Phone, CreditCard, Building, Mail, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type VerificationStatus = {
  email: boolean;
  phone: boolean;
  governmentId: boolean;
  workEmail: boolean;
  isHost: boolean;
  isSuperhost?: boolean;
};

interface VerificationBadgesProps {
  status: VerificationStatus;
  size?: 'sm' | 'md' | 'lg';
  showLabels?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { icon: 'w-3 h-3', badge: 'text-[10px] px-1.5 py-0', gap: 'gap-1' },
  md: { icon: 'w-3.5 h-3.5', badge: 'text-xs px-2 py-0.5', gap: 'gap-1.5' },
  lg: { icon: 'w-4 h-4', badge: 'text-sm px-2.5 py-1', gap: 'gap-2' },
};

export default function VerificationBadges({ status, size = 'md', showLabels = true, className }: VerificationBadgesProps) {
  const s = sizeMap[size];

  const verifiedCount = [status.email, status.phone, status.governmentId, status.workEmail].filter(Boolean).length;

  if (verifiedCount === 0) return null;

  const items = [
    { key: 'identity', verified: status.governmentId, icon: Shield, label: 'ID Verified', color: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800' },
    { key: 'email', verified: status.email, icon: Mail, label: 'Email', color: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800' },
    { key: 'phone', verified: status.phone, icon: Phone, label: 'Phone', color: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800' },
    { key: 'work', verified: status.workEmail, icon: Building, label: 'Work', color: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800' },
  ].filter(i => i.verified);

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex flex-wrap items-center', s.gap, className)}>
        {/* Overall verified badge when 2+ verifications */}
        {verifiedCount >= 2 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  s.badge,
                  'bg-primary/10 text-primary border-primary/20 font-semibold',
                  s.gap
                )}
              >
                <CheckCircle2 className={s.icon} />
                {showLabels && 'Verified'}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{verifiedCount} verifications completed</p>
            </TooltipContent>
          </Tooltip>
        )}

        {items.map(item => (
          <Tooltip key={item.key}>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(s.badge, item.color, s.gap)}
              >
                <item.icon className={s.icon} />
                {showLabels && item.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{item.label} verified</p>
            </TooltipContent>
          </Tooltip>
        ))}

        {status.isHost && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  s.badge,
                  'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800 font-semibold',
                  s.gap
                )}
              >
                <Shield className={s.icon} />
                {showLabels && (status.isSuperhost ? 'Superhost' : 'Host')}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{status.isSuperhost ? 'Superhost — top-rated host' : 'Verified host'}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
