-- Add 'suspended' to property_status enum so admins can suspend listings
-- (kept distinct from 'inactive' which is host-paused)
ALTER TYPE public.property_status ADD VALUE IF NOT EXISTS 'suspended';