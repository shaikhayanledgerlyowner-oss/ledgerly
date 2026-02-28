
-- Create a function that inserts a notification to the owner securely
CREATE OR REPLACE FUNCTION public.notify_owner_purchase(
  p_email text,
  p_plan text,
  p_amount integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT id INTO v_owner_id FROM public.user_profiles WHERE role = 'OWNER' LIMIT 1;
  IF v_owner_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, payload)
    VALUES (v_owner_id, 'purchase_request', jsonb_build_object('email', p_email, 'plan', p_plan, 'amount', p_amount));
  END IF;
END;
$$;
