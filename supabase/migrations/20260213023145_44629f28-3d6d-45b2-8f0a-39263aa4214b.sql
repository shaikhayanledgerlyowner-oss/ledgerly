
-- Add receiver_name and is_enabled to owner_payment_settings
ALTER TABLE public.owner_payment_settings 
  ADD COLUMN IF NOT EXISTS receiver_name text,
  ADD COLUMN IF NOT EXISTS is_enabled boolean DEFAULT false;

-- Add premium_plan and premium_since to user_profiles
ALTER TABLE public.user_profiles 
  ADD COLUMN IF NOT EXISTS premium_plan text,
  ADD COLUMN IF NOT EXISTS premium_since timestamp with time zone;

-- Add title and body to notifications
ALTER TABLE public.notifications 
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS body text;
