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
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  filename           text NOT NULL,
  storage_path       text NOT NULL,
  file_type          text,
  file_size          bigint,
  uploaded_by_admin  boolean NOT NULL DEFAULT false,
  approval_status    text CHECK (approval_status IN ('pending','approved','changes_requested')),
  approval_note      text,
  uploaded_at        timestamptz DEFAULT now()
);

-- ── Migration: add approval columns to existing files table ───────────────────
-- ALTER TABLE files ADD COLUMN IF NOT EXISTS uploaded_by_admin boolean NOT NULL DEFAULT false;
-- ALTER TABLE files ADD COLUMN IF NOT EXISTS approval_status text CHECK (approval_status IN ('pending','approved','changes_requested'));
-- ALTER TABLE files ADD COLUMN IF NOT EXISTS approval_note text;
-- ─────────────────────────────────────────────────────────────────────────────

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
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  content       text NOT NULL,
  author_id     uuid REFERENCES auth.users(id),
  is_from_admin boolean DEFAULT false,
  is_read       boolean NOT NULL DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

-- ── Migration: add is_read to existing messages table ──────────────────────────
-- Run this if the table already exists:
--   ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;
--   UPDATE messages SET is_read = true WHERE created_at < now(); -- mark old messages read
-- ────────────────────────────────────────────────────────────────────────────────

-- 5. INVOICES
CREATE TABLE IF NOT EXISTS invoices (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  amount      numeric(10,2) NOT NULL,
  status      text DEFAULT 'due' CHECK (status IN ('due','overdue','paid')),
  due_date    date,
  pdf_url     text,
  notes       text,
  created_at  timestamptz DEFAULT now()
);

-- 6. PROJECTS
CREATE TABLE IF NOT EXISTS projects (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  status      text DEFAULT 'in_progress'
              CHECK (status IN ('not_started','in_progress','review','complete')),
  due_date    date,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ── Migration: add due_date and progress to existing projects table ───────────
-- ALTER TABLE projects ADD COLUMN IF NOT EXISTS due_date date;
-- ALTER TABLE projects ADD COLUMN IF NOT EXISTS progress integer DEFAULT NULL CHECK (progress >= 0 AND progress <= 100);
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE files          ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects       ENABLE ROW LEVEL SECURITY;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Clients see/modify only their own rows
CREATE POLICY "own_profile"   ON profiles       FOR ALL USING (id = auth.uid());
CREATE POLICY "own_files"     ON files          FOR ALL USING (client_id = auth.uid());
CREATE POLICY "own_schedule"  ON schedule_items FOR ALL USING (client_id = auth.uid());
CREATE POLICY "own_messages"  ON messages       FOR ALL USING (client_id = auth.uid());
CREATE POLICY "own_projects"  ON projects       FOR ALL USING (client_id = auth.uid());
CREATE POLICY "own_invoices"  ON invoices       FOR ALL USING (client_id = auth.uid());

-- Admins see everything (set is_admin=true in profiles for your accounts)
CREATE POLICY "admin_profiles"  ON profiles       FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));
CREATE POLICY "admin_files"     ON files          FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));
CREATE POLICY "admin_schedule"  ON schedule_items FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));
CREATE POLICY "admin_messages"  ON messages       FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));
CREATE POLICY "admin_projects"  ON projects       FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));
CREATE POLICY "admin_invoices"  ON invoices       FOR ALL USING ((SELECT is_admin FROM profiles WHERE id = auth.uid()));

-- ── Migration: add invoices table to existing project ─────────────────────────
-- Run this if tables already exist:
--   CREATE TABLE IF NOT EXISTS invoices ( ... ) -- see above
--   ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY ... -- see above
-- ────────────────────────────────────────────────────────────────────────────────

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
