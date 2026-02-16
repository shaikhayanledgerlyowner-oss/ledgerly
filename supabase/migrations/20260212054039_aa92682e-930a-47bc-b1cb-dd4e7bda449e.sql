
-- Add display_name and avatar_url to user_profiles
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('branding', 'branding', true) ON CONFLICT (id) DO NOTHING;

-- Storage policies for avatars
CREATE POLICY "Avatar images are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Users can upload their own avatar" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update their own avatar" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own avatar" ON storage.objects FOR DELETE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for branding
CREATE POLICY "Branding images are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'branding');
CREATE POLICY "Users can upload their own branding" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'branding' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update their own branding" ON storage.objects FOR UPDATE USING (bucket_id = 'branding' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own branding" ON storage.objects FOR DELETE USING (bucket_id = 'branding' AND auth.uid()::text = (storage.foldername(name))[1]);
