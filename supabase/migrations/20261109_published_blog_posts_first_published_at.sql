-- ============================================================================
-- SuweldoTools — Expose first_published_at in public.published_blog_posts
-- ============================================================================
-- Purpose:
--   Safely updates `public.published_blog_posts` so the static blog generator
--   (`scripts/generate-blog.ts`) can read `first_published_at` while preserving:
--     1. All 18 existing columns in their exact original order and data types
--     2. The published filter (`bp.status = 'published' AND bp.published_at IS NOT NULL`)
--     3. Correlated subqueries for `alternate_en_slug` and `alternate_tl_slug`
--     4. `security_invoker = false` (PostgreSQL default view-owner security so
--        `anon` can read published rows via the view without direct table-level
--        `SELECT` privileges on `public.blog_posts`) and `SELECT` grants for
--        `anon` and `authenticated`.
--
-- Notes:
--   PostgreSQL `CREATE OR REPLACE VIEW` requires new columns to be appended at
--   the end of the column list. `first_published_at` is appended as column 19.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.published_blog_posts
WITH (security_invoker = false)
AS
SELECT
  bp.id,
  bp.group_id,
  bp.language,
  bp.title,
  bp.slug,
  bp.excerpt,
  bp.content,
  bp.seo_title,
  bp.meta_description,
  bp.featured_image_url,
  bp.featured_image_alt,
  bp.published_at,
  bp.created_at,
  bp.updated_at,
  (
    SELECT en_post.slug
    FROM public.blog_posts AS en_post
    WHERE en_post.group_id = bp.group_id
      AND en_post.language = 'en'
      AND en_post.status = 'published'
      AND en_post.published_at IS NOT NULL
    LIMIT 1
  ) AS alternate_en_slug,
  (
    SELECT tl_post.slug
    FROM public.blog_posts AS tl_post
    WHERE tl_post.group_id = bp.group_id
      AND tl_post.language = 'tl'
      AND tl_post.status = 'published'
      AND tl_post.published_at IS NOT NULL
    LIMIT 1
  ) AS alternate_tl_slug,
  bp.author_name,
  bp.faqs,
  bp.first_published_at
FROM public.blog_posts AS bp
WHERE bp.status = 'published'
  AND bp.published_at IS NOT NULL;

GRANT SELECT ON public.published_blog_posts TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
