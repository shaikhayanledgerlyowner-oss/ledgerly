
-- Fix: restrict notification inserts to authenticated users only
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
CREATE POLICY "Authenticated users can insert notifications" ON public.notifications FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
