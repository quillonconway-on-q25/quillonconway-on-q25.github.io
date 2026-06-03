-- ─────────────────────────────────────────────────────────────────────────────
-- ON-Q25 Client Portal — Supabase Setup
-- Run this entire file in your Supabase project's SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. PROFILES (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     text,
  business_name text,
  is_admin      boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

-- Auto-create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. FILES
CREATE TABLE IF NOT EXISTS files (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  storage_path text NOT NULL,
  file_type    text,
  file_size    bigint,
  uploaded_at  timestamptz DEFAULT now()
);

-- 3. SCHEDULE ITEMS
CREATE TABLE IF NOT EXISTS schedule_items (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title          text NOT NULL,
  description    text,
  scheduled_date timestamptz,
  status         text DEFAULT 'upcoming' CHECK (status IN ('upcoming','completed','cancelled')),
  created_at     timestamptz DEFAULT now()
);

-- 4. MESSAGES
CREATE TABLE IF NOT EXISTS messages (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  content      text NOT NULL,
  author_id    uuid REFERENCES auth.users(id),
  is_from_admin boolean DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

-- 5. PROJECTS
CREATE TABLE IF NOT EXISTS projects (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  status      text DEFAULT 'in_progress'
              CHECK (status IN ('not_started','in_progress','review','complete')),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE files          ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects       ENABLE ROW LEVEL SECURITY;

-- Clients see/modify only their own rows
CREATE POLICY "own_profile"   ON profiles       FOR ALL USING (id = auth.uid());
CREATE POLICY "own_files"     ON files          FOR ALL USING (client_id = auth.uid());
CREATE POLICY "own_schedule"  ON schedule_items FOR ALL USING (client_id = auth.uid());
CREATE POLICY "own_messages"  ON messages       FOR ALL USING (client_id = auth.uid());
CREATE POLICY "own_projects"  ON projects       FOR ALL USING (client_id = auth.uid());

-- Admins see everything (set is_admin=true in profiles for your accounts)
CREATE POLICY "admin_profiles"  ON profiles       FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));
CREATE POLICY "admin_files"     ON files          FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));
CREATE POLICY "admin_schedule"  ON schedule_items FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));
CREATE POLICY "admin_messages"  ON messages       FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));
CREATE POLICY "admin_projects"  ON projects       FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- STORAGE BUCKET  (also do this in Dashboard → Storage → New bucket)
-- Name: client-files   |  Public: true  |  Max file size: 50MB
-- ─────────────────────────────────────────────────────────────────────────────
-- The bucket itself must be created via the Supabase Dashboard UI.
-- Then add this storage policy so authenticated users can upload:
--
-- Policy name: "Authenticated upload"
-- Allowed operation: INSERT
-- Target roles: authenticated
-- USING expression: (auth.uid()::text = (storage.foldername(name))[1])
