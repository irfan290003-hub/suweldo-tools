-- =============================================================================
-- SuweldoTools.com — Bilingual Site Announcement Popup Migration
-- File: /supabase/migrations/20261030_site_announcements.sql
-- Target: Supabase PostgreSQL (PostgreSQL 15+)
--
-- NOTES:
--   - Safe, idempotent migration (uses IF NOT EXISTS / CREATE OR REPLACE).
--   - Contains no destructive statements, so Supabase SQL Editor runs it
--     cleanly without warnings.
--   - Both seeded announcement slots ('draft' and 'published') start with
--     is_active = false so no announcement is shown automatically.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. TABLE CREATION & CONSTRAINTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.site_announcements (
  slot text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  title_en text NOT NULL,
  title_tl text NOT NULL,
  body_en text NOT NULL,
  body_tl text NOT NULL,
  image_url text NULL,
  image_alt_en text NULL,
  image_alt_tl text NULL,
  link_url text NULL,
  link_label_en text NULL,
  link_label_tl text NULL,
  display_style text NOT NULL DEFAULT 'modal',
  draft_lock_token uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  published_at timestamptz NULL,
  updated_by uuid NULL,

  CONSTRAINT site_announcements_pkey
    PRIMARY KEY (slot),

  CONSTRAINT site_announcements_slot_check
    CHECK (slot IN ('draft', 'published')),

  CONSTRAINT site_announcements_display_style_check
    CHECK (display_style IN ('modal', 'banner')),

  CONSTRAINT site_announcements_draft_inactive_check
    CHECK (slot <> 'draft' OR is_active = false),

  CONSTRAINT site_announcements_title_en_check
    CHECK (pg_catalog.char_length(pg_catalog.btrim(title_en)) BETWEEN 1 AND 200),

  CONSTRAINT site_announcements_title_tl_check
    CHECK (pg_catalog.char_length(pg_catalog.btrim(title_tl)) BETWEEN 1 AND 200),

  CONSTRAINT site_announcements_body_en_check
    CHECK (pg_catalog.char_length(pg_catalog.btrim(body_en)) BETWEEN 1 AND 2000),

  CONSTRAINT site_announcements_body_tl_check
    CHECK (pg_catalog.char_length(pg_catalog.btrim(body_tl)) BETWEEN 1 AND 2000),

  CONSTRAINT site_announcements_updated_by_fkey
    FOREIGN KEY (updated_by)
    REFERENCES auth.users (id)
    ON DELETE SET NULL
);

-- =============================================================================
-- 2. INITIAL SEED ROWS (INACTIVE BY DEFAULT)
-- =============================================================================
INSERT INTO public.site_announcements (
  slot,
  is_active,
  title_en,
  title_tl,
  body_en,
  body_tl,
  image_url,
  image_alt_en,
  image_alt_tl,
  link_url,
  link_label_en,
  link_label_tl,
  display_style,
  draft_lock_token,
  updated_at,
  published_at,
  updated_by
)
VALUES
  (
    'draft',
    false,
    '2026 Philippine Payroll & Statutory Rate Updates',
    'Mga Update sa 2026 Philippine Payroll at Statutory Rates',
    'Our SSS, PhilHealth, Pag-IBIG, and BIR withholding tax calculators are updated with the latest 2026 schedules.',
    'Na-update na ang aming SSS, PhilHealth, Pag-IBIG, at BIR withholding tax calculators para sa pinakabagong 2026 schedules.',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'modal',
    pg_catalog.gen_random_uuid(),
    pg_catalog.now(),
    NULL,
    NULL
  ),
  (
    'published',
    false,
    '2026 Philippine Payroll & Statutory Rate Updates',
    'Mga Update sa 2026 Philippine Payroll at Statutory Rates',
    'Our SSS, PhilHealth, Pag-IBIG, and BIR withholding tax calculators are updated with the latest 2026 schedules.',
    'Na-update na ang aming SSS, PhilHealth, Pag-IBIG, at BIR withholding tax calculators para sa pinakabagong 2026 schedules.',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'modal',
    pg_catalog.gen_random_uuid(),
    pg_catalog.now(),
    NULL,
    NULL
  )
ON CONFLICT (slot) DO NOTHING;

-- =============================================================================
-- 3. ROW LEVEL SECURITY (RLS) & POLICIES
-- =============================================================================
ALTER TABLE public.site_announcements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'site_announcements'
       AND policyname = 'site_announcements_public_read_active_published'
  ) THEN
    CREATE POLICY site_announcements_public_read_active_published
      ON public.site_announcements
      FOR SELECT
      TO anon, authenticated
      USING (slot = 'published' AND is_active = true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'site_announcements'
       AND policyname = 'site_announcements_admin_read_all'
  ) THEN
    CREATE POLICY site_announcements_admin_read_all
      ON public.site_announcements
      FOR SELECT
      TO authenticated
      USING (public.is_blog_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'site_announcements'
       AND policyname = 'site_announcements_admin_write_all'
  ) THEN
    CREATE POLICY site_announcements_admin_write_all
      ON public.site_announcements
      FOR ALL
      TO authenticated
      USING (public.is_blog_admin())
      WITH CHECK (public.is_blog_admin());
  END IF;
END
$$;

-- =============================================================================
-- 4. ADMIN RPC FUNCTIONS
-- =============================================================================

-- 4A. Save Draft Announcement
CREATE OR REPLACE FUNCTION public.save_site_announcement_draft(
  p_expected_draft_lock_token uuid,
  p_title_en text,
  p_title_tl text,
  p_body_en text,
  p_body_tl text,
  p_image_url text DEFAULT NULL,
  p_image_alt_en text DEFAULT NULL,
  p_image_alt_tl text DEFAULT NULL,
  p_link_url text DEFAULT NULL,
  p_link_label_en text DEFAULT NULL,
  p_link_label_tl text DEFAULT NULL,
  p_display_style text DEFAULT 'modal'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_token uuid := pg_catalog.gen_random_uuid();
  v_title_en text;
  v_title_tl text;
  v_body_en text;
  v_body_tl text;
  v_image_url text;
  v_image_alt_en text;
  v_image_alt_tl text;
  v_link_url text;
  v_link_label_en text;
  v_link_label_tl text;
  v_display_style text;
BEGIN
  IF NOT COALESCE(public.is_blog_admin(), false) THEN
    RAISE EXCEPTION 'Access denied: caller is not an authorized administrator.'
      USING ERRCODE = '42501';
  END IF;

  v_title_en := COALESCE(pg_catalog.btrim(p_title_en), '');
  v_title_tl := COALESCE(pg_catalog.btrim(p_title_tl), '');
  v_body_en := COALESCE(pg_catalog.btrim(p_body_en), '');
  v_body_tl := COALESCE(pg_catalog.btrim(p_body_tl), '');

  IF v_title_en = '' AND v_title_tl <> '' THEN
    v_title_en := v_title_tl;
  ELSIF v_title_tl = '' AND v_title_en <> '' THEN
    v_title_tl := v_title_en;
  END IF;

  IF v_body_en = '' AND v_body_tl <> '' THEN
    v_body_en := v_body_tl;
  ELSIF v_body_tl = '' AND v_body_en <> '' THEN
    v_body_tl := v_body_en;
  END IF;

  IF v_title_en = '' OR v_body_en = '' THEN
    RAISE EXCEPTION 'Validation error: Announcement title and message body are required.'
      USING ERRCODE = '23514';
  END IF;

  v_image_url := NULLIF(pg_catalog.btrim(COALESCE(p_image_url, '')), '');
  IF v_image_url IS NOT NULL THEN
    v_image_alt_en := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_image_alt_en, '')), ''), v_title_en);
    v_image_alt_tl := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_image_alt_tl, '')), ''), v_title_tl);
  ELSE
    v_image_alt_en := NULL;
    v_image_alt_tl := NULL;
  END IF;

  v_link_url := NULLIF(pg_catalog.btrim(COALESCE(p_link_url, '')), '');
  IF v_link_url IS NOT NULL THEN
    v_link_label_en := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_link_label_en, '')), ''), 'Learn More');
    v_link_label_tl := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_link_label_tl, '')), ''), 'Alamin ang Higit Pa');
  ELSE
    v_link_label_en := NULL;
    v_link_label_tl := NULL;
  END IF;

  v_display_style := CASE
    WHEN pg_catalog.btrim(COALESCE(p_display_style, '')) = 'banner' THEN 'banner'
    ELSE 'modal'
  END;

  INSERT INTO public.site_announcements (
    slot,
    is_active,
    title_en,
    title_tl,
    body_en,
    body_tl,
    image_url,
    image_alt_en,
    image_alt_tl,
    link_url,
    link_label_en,
    link_label_tl,
    display_style,
    draft_lock_token,
    updated_at,
    updated_by
  )
  VALUES (
    'draft',
    false,
    v_title_en,
    v_title_tl,
    v_body_en,
    v_body_tl,
    v_image_url,
    v_image_alt_en,
    v_image_alt_tl,
    v_link_url,
    v_link_label_en,
    v_link_label_tl,
    v_display_style,
    v_new_token,
    pg_catalog.now(),
    auth.uid()
  )
  ON CONFLICT (slot) DO UPDATE
    SET is_active = false,
        title_en = EXCLUDED.title_en,
        title_tl = EXCLUDED.title_tl,
        body_en = EXCLUDED.body_en,
        body_tl = EXCLUDED.body_tl,
        image_url = EXCLUDED.image_url,
        image_alt_en = EXCLUDED.image_alt_en,
        image_alt_tl = EXCLUDED.image_alt_tl,
        link_url = EXCLUDED.link_url,
        link_label_en = EXCLUDED.link_label_en,
        link_label_tl = EXCLUDED.link_label_tl,
        display_style = EXCLUDED.display_style,
        draft_lock_token = EXCLUDED.draft_lock_token,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;

  RETURN v_new_token;
END
$$;

-- 4B. Publish Announcement
CREATE OR REPLACE FUNCTION public.publish_site_announcement(
  p_expected_draft_lock_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.site_announcements%ROWTYPE;
  v_new_token uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
  v_actor uuid := auth.uid();
BEGIN
  IF NOT COALESCE(public.is_blog_admin(), false) THEN
    RAISE EXCEPTION 'Access denied: caller is not an authorized administrator.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_draft
    FROM public.site_announcements AS sa
   WHERE sa.slot = 'draft'
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement draft slot is missing from public.site_announcements.'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.site_announcements AS sa
     SET draft_lock_token = v_new_token,
         updated_at = v_now,
         updated_by = v_actor
   WHERE sa.slot = 'draft';

  INSERT INTO public.site_announcements (
    slot,
    is_active,
    title_en,
    title_tl,
    body_en,
    body_tl,
    image_url,
    image_alt_en,
    image_alt_tl,
    link_url,
    link_label_en,
    link_label_tl,
    display_style,
    draft_lock_token,
    updated_at,
    published_at,
    updated_by
  )
  VALUES (
    'published',
    true,
    v_draft.title_en,
    v_draft.title_tl,
    v_draft.body_en,
    v_draft.body_tl,
    v_draft.image_url,
    v_draft.image_alt_en,
    v_draft.image_alt_tl,
    v_draft.link_url,
    v_draft.link_label_en,
    v_draft.link_label_tl,
    v_draft.display_style,
    v_new_token,
    v_now,
    v_now,
    v_actor
  )
  ON CONFLICT (slot) DO UPDATE
    SET is_active = true,
        title_en = EXCLUDED.title_en,
        title_tl = EXCLUDED.title_tl,
        body_en = EXCLUDED.body_en,
        body_tl = EXCLUDED.body_tl,
        image_url = EXCLUDED.image_url,
        image_alt_en = EXCLUDED.image_alt_en,
        image_alt_tl = EXCLUDED.image_alt_tl,
        link_url = EXCLUDED.link_url,
        link_label_en = EXCLUDED.link_label_en,
        link_label_tl = EXCLUDED.link_label_tl,
        display_style = EXCLUDED.display_style,
        draft_lock_token = EXCLUDED.draft_lock_token,
        updated_at = EXCLUDED.updated_at,
        published_at = EXCLUDED.published_at,
        updated_by = EXCLUDED.updated_by;

  RETURN v_new_token;
END
$$;

-- 4C. Toggle Active Status
CREATE OR REPLACE FUNCTION public.set_site_announcement_active(
  p_active boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated_active boolean;
BEGIN
  IF NOT COALESCE(public.is_blog_admin(), false) THEN
    RAISE EXCEPTION 'Access denied: caller is not an authorized administrator.'
      USING ERRCODE = '42501';
  END IF;

  IF p_active IS NULL THEN
    RAISE EXCEPTION 'Validation error: p_active boolean parameter cannot be null.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.site_announcements AS sa
     SET is_active = p_active,
         updated_at = pg_catalog.now(),
         updated_by = auth.uid()
   WHERE sa.slot = 'published'
  RETURNING sa.is_active INTO v_updated_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement published slot is missing from public.site_announcements.'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_updated_active;
END
$$;

-- =============================================================================
-- 5. GRANTS & SCHEMA CACHE RELOAD
-- =============================================================================
REVOKE ALL PRIVILEGES ON TABLE public.site_announcements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.site_announcements TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.site_announcements TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.save_site_announcement_draft(
  uuid, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_site_announcement_draft(
  uuid, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.publish_site_announcement(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.publish_site_announcement(uuid)
  TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.set_site_announcement_active(boolean)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_site_announcement_active(boolean)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
