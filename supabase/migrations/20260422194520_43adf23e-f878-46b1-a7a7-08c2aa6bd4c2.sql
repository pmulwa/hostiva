
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'pending_host_approval';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'in_progress';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'disputed';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'closed';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'no_show';
