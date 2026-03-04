
-- Create roles enum
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('OWNER', 'CUSTOMER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 1) user_profiles
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'CUSTOMER',
  is_premium boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.user_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.user_profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Owner can read all profiles for verification
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'OWNER'
  )
$$;

CREATE POLICY "Owner can read all profiles" ON public.user_profiles FOR SELECT USING (public.is_owner());

-- 2) user_branding
CREATE TABLE IF NOT EXISTS public.user_branding (
  user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  business_name text,
  address text,
  phone text,
  email text,
  logo_url text,
  signature_url text,
  country_code text DEFAULT 'IN',
  currency_code text DEFAULT 'INR'
);
ALTER TABLE public.user_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own branding" ON public.user_branding FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3) invoices
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'invoice',
  doc_no text,
  customer_name text,
  customer_address text,
  customer_phone text,
  items jsonb DEFAULT '[]'::jsonb,
  totals jsonb DEFAULT '{}'::jsonb,
  currency_code text DEFAULT 'INR',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own invoices" ON public.invoices FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4) purchase_requests
CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  plan text NOT NULL,
  amount integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  txn_id text,
  screenshot_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own purchase requests" ON public.purchase_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own purchase requests" ON public.purchase_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner reads all purchase requests" ON public.purchase_requests FOR SELECT USING (public.is_owner());
CREATE POLICY "Owner updates purchase requests" ON public.purchase_requests FOR UPDATE USING (public.is_owner());

-- 5) user_tables
CREATE TABLE IF NOT EXISTS public.user_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tables" ON public.user_tables FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6) user_columns
CREATE TABLE IF NOT EXISTS public.user_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.user_tables(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'text',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own columns" ON public.user_columns FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_tables WHERE id = table_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_tables WHERE id = table_id AND user_id = auth.uid()));

-- 7) user_rows
CREATE TABLE IF NOT EXISTS public.user_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.user_tables(id) ON DELETE CASCADE,
  row_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own rows" ON public.user_rows FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_tables WHERE id = table_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_tables WHERE id = table_id AND user_id = auth.uid()));

-- 8) reminders
CREATE TABLE IF NOT EXISTS public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  reminder_time text DEFAULT '09:00',
  enabled boolean DEFAULT true,
  message text DEFAULT 'Your daily entry is pending.',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own reminders" ON public.reminders FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 9) notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'system',
  payload jsonb DEFAULT '{}'::jsonb,
  is_read boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Owner reads own notifications" ON public.notifications FOR SELECT USING (public.is_owner() AND auth.uid() = user_id);
CREATE POLICY "System can insert notifications" ON public.notifications FOR INSERT WITH CHECK (true);

-- 10) owner_payment_settings
CREATE TABLE IF NOT EXISTS public.owner_payment_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  upi_id text,
  paypal_email text,
  razorpay_key_id text,
  razorpay_key_secret text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.owner_payment_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only owner manages payment settings" ON public.owner_payment_settings FOR ALL USING (public.is_owner() AND auth.uid() = owner_id) WITH CHECK (public.is_owner() AND auth.uid() = owner_id);

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN NEW.email = 'shaikhayan.ledgerlyowner@gmail.com' THEN 'OWNER' ELSE 'CUSTOMER' END
  );
  
  INSERT INTO public.user_branding (user_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
