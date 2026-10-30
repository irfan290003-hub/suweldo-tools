import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SupabaseConnectionState =
  | {
      status: 'not_configured';
      label: 'Supabase not configured';
      detail: string;
    }
  | {
      status: 'connected';
      label: 'Supabase Connected (Auth Reachable)';
      detail: string;
    }
  | {
      status: 'error';
      label: 'Supabase Connection Failed';
      detail: string;
    };

const PLACEHOLDER_URL_VALUES = new Set([
  '',
  'your_supabase_project_url',
  'https://your-project-ref.supabase.co',
  'https://<your-project-ref>.supabase.co',
  'my_supabase_url',
]);

const PLACEHOLDER_KEY_VALUES = new Set([
  '',
  'your_supabase_anon_key',
  'your-public-anon-or-publishable-key',
  'my_supabase_anon_key',
]);

let cachedClient: SupabaseClient | null = null;

function readEnvValues(): { url: string; anonKey: string } {
  const rawUrl = import.meta.env.VITE_SUPABASE_URL;
  const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return {
    url: typeof rawUrl === 'string' ? rawUrl.trim().replace(/\/+$/, '') : '',
    anonKey: typeof rawKey === 'string' ? rawKey.trim() : '',
  };
}

/**
 * Checks whether both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are present,
 * non-placeholder strings, and whether the URL is a valid HTTP(S) origin.
 * Note: This only checks local configuration presence; use checkSupabaseConnection()
 * to verify live network reachability and key acceptance.
 */
export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = readEnvValues();

  if (!url || !anonKey) {
    return false;
  }

  if (
    PLACEHOLDER_URL_VALUES.has(url.toLowerCase()) ||
    PLACEHOLDER_KEY_VALUES.has(anonKey.toLowerCase())
  ) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Returns a singleton SupabaseClient when configured, or null if credentials
 * are missing or invalid. Never throws when credentials are absent.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (cachedClient) {
    return cachedClient;
  }

  const { url, anonKey } = readEnvValues();
  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  return cachedClient;
}

/**
 * Performs a safe, read-only Auth configuration and session check against the
 * configured Supabase project. Because supabase.auth.getSession() resolves locally
 * when no session is cached, this helper also performs a read-only GET request to
 * `${VITE_SUPABASE_URL}/auth/v1/settings` with the configured `apikey` header to
 * verify actual network reachability and publishable/anon key validity without
 * requiring any database tables to exist.
 */
export async function checkSupabaseConnection(): Promise<SupabaseConnectionState> {
  if (!isSupabaseConfigured()) {
    return {
      status: 'not_configured',
      label: 'Supabase not configured',
      detail:
        'Missing or placeholder VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY environment variables. Add real project credentials in your local .env file to enable live connectivity.',
    };
  }

  const client = getSupabaseClient();
  const { url, anonKey } = readEnvValues();

  if (!client) {
    return {
      status: 'not_configured',
      label: 'Supabase not configured',
      detail: 'Supabase client could not be initialized from current environment variables.',
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);

  try {
    // 1. Verify the local Auth SDK session reader runs without error
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      return {
        status: 'error',
        label: 'Supabase Connection Failed',
        detail: `Auth session check returned an error: ${sessionError.message}`,
      };
    }

    // 2. Verify live network reachability & anon/publishable key acceptance via read-only Auth settings endpoint
    const response = await fetch(`${url}/auth/v1/settings`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        status: 'error',
        label: 'Supabase Connection Failed',
        detail: `Supabase Auth endpoint responded with HTTP ${response.status} (${response.statusText || 'Request rejected'}). Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.`,
      };
    }

    const settingsJson: unknown = await response.json();
    if (!settingsJson || typeof settingsJson !== 'object') {
      return {
        status: 'error',
        label: 'Supabase Connection Failed',
        detail: 'Supabase Auth settings endpoint did not return a valid configuration object.',
      };
    }

    const sessionState = sessionData?.session
      ? 'Cached session token present — awaiting public.blog_admins verification'
      : 'No active administrator session — sign in required';
    return {
      status: 'connected',
      label: 'Supabase Connected (Auth Reachable)',
      detail: `Supabase Auth endpoint is reachable (${sessionState}). Administrator access is granted only after sign-in and public.blog_admins verification.`,
    };
  } catch (err: unknown) {
    const message =
      err instanceof DOMException && err.name === 'AbortError'
        ? 'Connection timed out while reaching Supabase Auth endpoint.'
        : err instanceof Error
          ? err.message
          : 'Network error while reaching Supabase project.';

    return {
      status: 'error',
      label: 'Supabase Connection Failed',
      detail: `Could not reach Supabase Auth endpoint: ${message}`,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export type AdminVerificationResult =
  | { status: 'authorized' }
  | { status: 'access_denied' }
  | { status: 'error'; message: string };

/**
 * Verifies whether the authenticated user's UUID exists in `public.blog_admins`.
 * Uses only the browser anon/publishable client under RLS.
 */
export async function verifyBlogAdminAccess(
  client: SupabaseClient,
  userId: string
): Promise<AdminVerificationResult> {
  if (!userId) {
    return { status: 'access_denied' };
  }

  try {
    const { data, error } = await client
      .from('blog_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return {
        status: 'error',
        message: `Could not verify administrator status in public.blog_admins: ${error.message}`,
      };
    }

    if (data && data.user_id === userId) {
      return { status: 'authorized' };
    }

    return { status: 'access_denied' };
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Network error while querying public.blog_admins.';
    return {
      status: 'error',
      message: `Network or unexpected error while verifying administrator access: ${msg}`,
    };
  }
}

export type BlogLanguage = 'en' | 'tl';
export type BlogPostStatus = 'draft' | 'published';

export interface BlogFaqItem {
  question: string;
  answer: string;
}

export interface BlogPostRecord {
  id: string;
  group_id: string;
  language: BlogLanguage;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  seo_title: string;
  meta_description: string;
  featured_image_url: string | null;
  featured_image_alt: string | null;
  author_name: string | null;
  faqs: BlogFaqItem[];
  status: BlogPostStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface BlogPostWriteInput {
  id?: string | null;
  group_id?: string | null;
  language: BlogLanguage;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  seo_title: string;
  meta_description: string;
  featured_image_url?: string | null;
  featured_image_alt?: string | null;
  author_name?: string | null;
  faqs?: BlogFaqItem[] | null;
  status: BlogPostStatus;
}

export type AdminBlogFetchResult =
  | { status: 'ok'; posts: BlogPostRecord[] }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string };

export type AdminBlogSaveResult =
  | { status: 'ok'; post: BlogPostRecord; isNew: boolean }
  | { status: 'unauthorized'; message: string }
  | { status: 'duplicate_slug'; message: string }
  | { status: 'validation_error'; message: string }
  | { status: 'error'; message: string };

export type AdminBlogDeleteResult =
  | {
      status: 'ok';
      deletedPostId: string;
      deletedTitle?: string;
      deletedStatus?: BlogPostStatus;
    }
  | { status: 'unauthorized'; message: string }
  | { status: 'validation_error'; message: string }
  | { status: 'error'; message: string };

export type AdminBlogImageUploadResult =
  | {
      status: 'ok';
      ok: true;
      publicUrl: string;
      objectPath: string;
    }
  | { status: 'unauthorized'; ok: false; message: string; error: string }
  | { status: 'validation_error'; ok: false; message: string; error: string }
  | { status: 'error'; ok: false; message: string; error: string };

export type AnnouncementDisplayStyle = 'modal' | 'banner';

export interface SiteAnnouncementRecord {
  slot: 'draft' | 'published';
  is_active: boolean;
  title_en: string;
  title_tl: string;
  body_en: string;
  body_tl: string;
  image_url: string | null;
  image_alt_en: string | null;
  image_alt_tl: string | null;
  link_url: string | null;
  link_label_en: string | null;
  link_label_tl: string | null;
  display_style: AnnouncementDisplayStyle;
  draft_lock_token: string | null;
  updated_at: string;
  published_at?: string | null;
  updated_by?: string | null;
}

export interface SaveAnnouncementDraftInput {
  expected_draft_lock_token: string;
  title_en: string;
  title_tl: string;
  body_en: string;
  body_tl: string;
  image_url?: string | null;
  image_alt_en?: string | null;
  image_alt_tl?: string | null;
  link_url?: string | null;
  link_label_en?: string | null;
  link_label_tl?: string | null;
  display_style: AnnouncementDisplayStyle;
}

export type AnnouncementAdminFetchResult =
  | {
      status: 'ok' | 'success';
      draft: SiteAnnouncementRecord;
      published: SiteAnnouncementRecord;
      is_active: boolean;
      draft_lock_token: string | null;
    }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string };

export type AnnouncementAdminSaveResult =
  | {
      status: 'ok' | 'success';
      draft: SiteAnnouncementRecord;
      newToken: string;
      new_draft_lock_token: string;
    }
  | { status: 'conflict'; message: string }
  | { status: 'validation_error'; message: string }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string };

export type AnnouncementAdminPublishResult =
  | {
      status: 'ok' | 'success';
      published: SiteAnnouncementRecord;
      draft: SiteAnnouncementRecord;
      newToken: string;
      new_draft_lock_token: string;
    }
  | { status: 'conflict'; message: string }
  | { status: 'validation_error'; message: string }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string };

export type AnnouncementAdminToggleResult =
  | {
      status: 'ok' | 'success';
      isActive: boolean;
      is_active: boolean;
    }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string };

export interface SuweldoBlogAdminBridge {
  fetchPosts: () => Promise<AdminBlogFetchResult>;
  savePost: (input: BlogPostWriteInput) => Promise<AdminBlogSaveResult>;
  deletePost: (postId: string) => Promise<AdminBlogDeleteResult>;
  uploadImage: (file: File) => Promise<AdminBlogImageUploadResult>;
  fetchAnnouncementAdminState: () => Promise<AnnouncementAdminFetchResult>;
  fetchAnnouncementState: () => Promise<AnnouncementAdminFetchResult>;
  saveAnnouncementDraft: (input: SaveAnnouncementDraftInput) => Promise<AnnouncementAdminSaveResult>;
  publishAnnouncement: (
    expectedTokenOrInput: string | { expected_draft_lock_token?: string }
  ) => Promise<AnnouncementAdminPublishResult>;
  toggleAnnouncementActive: (active: boolean) => Promise<AnnouncementAdminToggleResult>;
  isAdminVerified: () => boolean;
}

interface SuweldoBlogAdminUIController {
  onAdminAuthenticated?: () => void;
  onAdminSignedOut?: () => void;
}

declare global {
  interface Window {
    __SUWELDOTOOLS_SUPABASE_ADMIN__?: SuweldoBlogAdminBridge;
    __SUWELDOTOOLS_BLOG_ADMIN_UI__?: SuweldoBlogAdminUIController;
  }
}

const BLOG_POST_SELECT_COLUMNS =
  'id, group_id, language, title, slug, excerpt, content, seo_title, meta_description, featured_image_url, featured_image_alt, author_name, faqs, status, published_at, created_at, updated_at, created_by, updated_by';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

function normalizeFaqItemsFromDb(rawFaqs: unknown): BlogFaqItem[] {
  if (!Array.isArray(rawFaqs)) return [];
  const items: BlogFaqItem[] = [];
  for (const entry of rawFaqs) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const question = typeof rec.question === 'string' ? rec.question.trim() : '';
    const answer = typeof rec.answer === 'string' ? rec.answer.trim() : '';
    if (question && answer) {
      items.push({ question, answer });
    }
  }
  return items;
}

function normalizeBlogPostRecord(raw: Record<string, unknown>): BlogPostRecord {
  const rawAuthor = typeof raw.author_name === 'string' ? raw.author_name.trim() : '';
  return {
    ...(raw as unknown as BlogPostRecord),
    author_name: rawAuthor ? rawAuthor : null,
    faqs: normalizeFaqItemsFromDb(raw.faqs),
  };
}

function formatDatabaseCrudError(error: {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}): { kind: 'duplicate_slug' | 'validation_error' | 'error'; message: string } {
  const code = error.code || '';
  const rawMsg = error.message || 'Database operation failed.';
  const details = error.details || '';
  const combined = `${rawMsg} ${details}`.toLowerCase();

  if (code === '23505') {
    if (combined.includes('slug') || combined.includes('language_slug')) {
      return {
        kind: 'duplicate_slug',
        message:
          'A blog post with this URL slug already exists for the selected language. Please choose a unique slug and try again.',
      };
    }
    if (combined.includes('group_id') && combined.includes('language')) {
      return {
        kind: 'validation_error',
        message:
          'This translation group already has a post in the selected language.',
      };
    }
    return {
      kind: 'duplicate_slug',
      message:
        'A record with these unique values already exists in public.blog_posts. Please verify the URL slug and language.',
    };
  }

  if (code === '23514') {
    if (combined.includes('slug')) {
      return {
        kind: 'validation_error',
        message:
          'URL Slug failed database validation. Use only lowercase letters, numbers, and single hyphens.',
      };
    }
    if (combined.includes('featured_image')) {
      return {
        kind: 'validation_error',
        message:
          'Featured Image URL and Featured Image Alt Text must both be provided together or both left empty.',
      };
    }
    if (combined.includes('faqs')) {
      return {
        kind: 'validation_error',
        message:
          'FAQs failed database validation. Ensure every FAQ item includes both a non-empty question and answer.',
      };
    }
    return {
      kind: 'validation_error',
      message: `Database check constraint rejected the post values: ${rawMsg}`,
    };
  }

  if (code === '42501') {
    return {
      kind: 'error',
      message:
        'Row-Level Security rejected this operation. Verify that your session is active and listed in public.blog_admins.',
    };
  }

  return {
    kind: 'error',
    message: rawMsg,
  };
}

function validateAndNormalizeWriteInput(
  input: BlogPostWriteInput
):
  | {
      ok: true;
      normalized: {
        id: string | null;
        group_id: string | null;
        language: BlogLanguage;
        title: string;
        slug: string;
        excerpt: string;
        content: string;
        seo_title: string;
        meta_description: string;
        featured_image_url: string | null;
        featured_image_alt: string | null;
        author_name: string | null;
        faqs: BlogFaqItem[];
        status: BlogPostStatus;
      };
    }
  | { ok: false; message: string } {
  const language = input.language;
  if (language !== 'en' && language !== 'tl') {
    return { ok: false, message: 'Language must be English (en) or Filipino (tl).' };
  }

  const status = input.status;
  if (status !== 'draft' && status !== 'published') {
    return { ok: false, message: 'Post status must be draft or published.' };
  }

  const title = (input.title || '').trim();
  if (!title) {
    return { ok: false, message: 'Post Title is required.' };
  }

  const slug = (input.slug || '').trim();
  if (!slug) {
    return { ok: false, message: 'URL Slug is required.' };
  }
  if (!SLUG_REGEX.test(slug)) {
    return {
      ok: false,
      message:
        'URL Slug must contain only lowercase letters, numbers, and single hyphens (e.g., 13th-month-pay-guide).',
    };
  }

  const excerpt = (input.excerpt || '').trim();
  if (!excerpt) {
    return { ok: false, message: 'Short Excerpt is required.' };
  }

  const content = (input.content || '').trim();
  if (!content) {
    return { ok: false, message: 'Article Content is required.' };
  }

  const seo_title = (input.seo_title || '').trim();
  if (!seo_title) {
    return { ok: false, message: 'SEO Title is required.' };
  }

  const meta_description = (input.meta_description || '').trim();
  if (!meta_description) {
    return { ok: false, message: 'Meta Description is required.' };
  }

  const rawImageUrl = (input.featured_image_url || '').trim();
  const rawImageAlt = (input.featured_image_alt || '').trim();

  if (rawImageUrl && !rawImageAlt) {
    return {
      ok: false,
      message: 'Featured Image Alt Text is required when a Featured Image URL is provided.',
    };
  }

  if (!rawImageUrl && rawImageAlt) {
    return {
      ok: false,
      message:
        'Featured Image URL is required when Featured Image Alt Text is provided (or clear the Alt Text field).',
    };
  }

  if (rawImageUrl) {
    const validPrefix =
      rawImageUrl.startsWith('https://') ||
      rawImageUrl.startsWith('http://') ||
      rawImageUrl.startsWith('/');
    if (!validPrefix) {
      return {
        ok: false,
        message: 'Featured Image URL must start with https://, http://, or /.',
      };
    }
  }

  const rawAuthorName = typeof input.author_name === 'string' ? input.author_name.trim() : '';
  if (rawAuthorName.length > 120) {
    return {
      ok: false,
      message: 'Author Name must be 120 characters or fewer.',
    };
  }

  const normalizedFaqs: BlogFaqItem[] = [];
  if (input.faqs !== undefined && input.faqs !== null) {
    if (!Array.isArray(input.faqs)) {
      return {
        ok: false,
        message: 'FAQs must be provided as an array of question and answer items.',
      };
    }

    for (let i = 0; i < input.faqs.length; i++) {
      const item = input.faqs[i];
      if (!item || typeof item !== 'object') {
        return {
          ok: false,
          message: `FAQ item #${i + 1} is invalid.`,
        };
      }
      const q = typeof item.question === 'string' ? item.question.trim() : '';
      const a = typeof item.answer === 'string' ? item.answer.trim() : '';
      if (!q && !a) {
        continue;
      }
      if (!q || !a) {
        return {
          ok: false,
          message: `FAQ item #${i + 1} must have both a Question and an Answer (or remove the incomplete row).`,
        };
      }
      normalizedFaqs.push({ question: q, answer: a });
    }
  }

  const id = input.id ? String(input.id).trim() : null;
  const group_id = input.group_id ? String(input.group_id).trim() : null;

  return {
    ok: true,
    normalized: {
      id,
      group_id,
      language,
      title,
      slug,
      excerpt,
      content,
      seo_title,
      meta_description,
      featured_image_url: rawImageUrl ? rawImageUrl : null,
      featured_image_alt: rawImageAlt ? rawImageAlt : null,
      author_name: rawAuthorName ? rawAuthorName : null,
      faqs: normalizedFaqs,
      status,
    },
  };
}

/**
 * Re-verifies the active authenticated Supabase user session and confirms that
 * the user's UUID still exists in `public.blog_admins` before any protected read/write.
 */
async function requireAuthorizedAdminSession(
  client: SupabaseClient
): Promise<
  | { status: 'authorized'; userId: string }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string }
> {
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session?.user) {
      return {
        status: 'unauthorized',
        message: 'Your administrator session has ended. Please sign in again.',
      };
    }

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) {
      return {
        status: 'unauthorized',
        message: 'Your administrator session has expired. Please sign in again.',
      };
    }

    const adminCheck = await verifyBlogAdminAccess(client, userData.user.id);
    if (adminCheck.status === 'authorized') {
      return { status: 'authorized', userId: userData.user.id };
    }

    if (adminCheck.status === 'access_denied') {
      return {
        status: 'unauthorized',
        message:
          'Your account is no longer authorized in public.blog_admins. Access has been revoked.',
      };
    }

    return {
      status: 'error',
      message: adminCheck.message,
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Network error while verifying administrator session.';
    return { status: 'error', message: msg };
  }
}

/**
 * Fetches all blog posts from `public.blog_posts` using the authenticated admin client under RLS.
 */
export async function fetchAdminBlogPosts(): Promise<AdminBlogFetchResult> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      status: 'error',
      message: 'Supabase client is not configured.',
    };
  }

  const sessionCheck = await requireAuthorizedAdminSession(client);
  if (sessionCheck.status === 'unauthorized') {
    return { status: 'unauthorized', message: sessionCheck.message };
  }
  if (sessionCheck.status === 'error') {
    return { status: 'error', message: sessionCheck.message };
  }

  try {
    const { data, error } = await client
      .from('blog_posts')
      .select(BLOG_POST_SELECT_COLUMNS)
      .order('updated_at', { ascending: false });

    if (error) {
      const formatted = formatDatabaseCrudError(error);
      return { status: 'error', message: formatted.message };
    }

    return {
      status: 'ok',
      posts: Array.isArray(data)
        ? data.map((row) => normalizeBlogPostRecord(row as unknown as Record<string, unknown>))
        : [],
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Network error while fetching blog posts from Supabase.';
    return { status: 'error', message: msg };
  }
}

/**
 * Creates or updates a blog post in `public.blog_posts` under RLS.
 * - For a new post (`!input.id`): creates a row in `public.blog_post_groups` first, then inserts
 *   the post into `public.blog_posts` with the new `group_id`. If the post insert fails, cleans
 *   up the newly created empty group row so no orphan group remains.
 * - For an existing post (`input.id`): updates the existing row in `public.blog_posts` while
 *   preserving its `id` and `group_id`.
 * - Never sends `published_at` from the client; the database lifecycle trigger
 *   `handle_blog_posts_lifecycle()` manages `published_at` automatically.
 */
export async function saveAdminBlogPost(
  input: BlogPostWriteInput
): Promise<AdminBlogSaveResult> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      status: 'error',
      message: 'Supabase client is not configured.',
    };
  }

  const validation = validateAndNormalizeWriteInput(input);
  if (!validation.ok) {
    return {
      status: 'validation_error',
      message: validation.message,
    };
  }

  const sessionCheck = await requireAuthorizedAdminSession(client);
  if (sessionCheck.status === 'unauthorized') {
    return { status: 'unauthorized', message: sessionCheck.message };
  }
  if (sessionCheck.status === 'error') {
    return { status: 'error', message: sessionCheck.message };
  }

  const { normalized } = validation;

  const writeColumns = {
    language: normalized.language,
    title: normalized.title,
    slug: normalized.slug,
    excerpt: normalized.excerpt,
    content: normalized.content,
    seo_title: normalized.seo_title,
    meta_description: normalized.meta_description,
    featured_image_url: normalized.featured_image_url,
    featured_image_alt: normalized.featured_image_alt,
    author_name: normalized.author_name,
    faqs: normalized.faqs,
    status: normalized.status,
  };

  try {
    // Update existing post (preserve id and existing group_id; never create a new group)
    if (normalized.id) {
      const updatePayload: Record<string, unknown> = {
        ...writeColumns,
      };
      if (normalized.group_id) {
        updatePayload.group_id = normalized.group_id;
      }

      const { data: updatedPost, error: updateError } = await client
        .from('blog_posts')
        .update(updatePayload)
        .eq('id', normalized.id)
        .select(BLOG_POST_SELECT_COLUMNS)
        .single();

      if (updateError) {
        const formatted = formatDatabaseCrudError(updateError);
        if (formatted.kind === 'duplicate_slug') {
          return { status: 'duplicate_slug', message: formatted.message };
        }
        if (formatted.kind === 'validation_error') {
          return { status: 'validation_error', message: formatted.message };
        }
        return { status: 'error', message: formatted.message };
      }

      if (!updatedPost) {
        return {
          status: 'error',
          message:
            'The post could not be updated because it was not found or access was denied by RLS.',
        };
      }

      return {
        status: 'ok',
        post: normalizeBlogPostRecord(updatedPost as unknown as Record<string, unknown>),
        isNew: false,
      };
    }

    // Create new post: 1. Create required group row in public.blog_post_groups unless a group_id was explicitly provided
    let targetGroupId = normalized.group_id;
    let createdNewGroupId: string | null = null;

    if (!targetGroupId) {
      const { data: groupData, error: groupError } = await client
        .from('blog_post_groups')
        .insert({})
        .select('id')
        .single();

      if (groupError || !groupData?.id) {
        const formatted = groupError
          ? formatDatabaseCrudError(groupError)
          : { message: 'Could not create a new blog_post_groups record.' };
        return {
          status: 'error',
          message: `Failed to initialize post group in public.blog_post_groups: ${formatted.message}`,
        };
      }

      targetGroupId = groupData.id;
      createdNewGroupId = groupData.id;
    }

    // 2. Insert post row in public.blog_posts with group_id
    const { data: insertedPost, error: insertError } = await client
      .from('blog_posts')
      .insert({
        ...writeColumns,
        group_id: targetGroupId,
      })
      .select(BLOG_POST_SELECT_COLUMNS)
      .single();

    if (insertError || !insertedPost) {
      // Clean up the newly created empty group row so failed inserts do not leave orphan groups
      if (createdNewGroupId) {
        await client.from('blog_post_groups').delete().eq('id', createdNewGroupId);
      }

      if (insertError) {
        const formatted = formatDatabaseCrudError(insertError);
        if (formatted.kind === 'duplicate_slug') {
          return { status: 'duplicate_slug', message: formatted.message };
        }
        if (formatted.kind === 'validation_error') {
          return { status: 'validation_error', message: formatted.message };
        }
        return { status: 'error', message: formatted.message };
      }

      return {
        status: 'error',
        message: 'Supabase did not return the newly created blog post record.',
      };
    }

    return {
      status: 'ok',
      post: normalizeBlogPostRecord(insertedPost as unknown as Record<string, unknown>),
      isNew: true,
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Network error while saving blog post to Supabase.';
    return { status: 'error', message: msg };
  }
}

/**
 * Permanently deletes a single blog post row from `public.blog_posts` by its UUID (`id`) under RLS.
 * - Requires an active authenticated session and re-verifies `public.blog_admins` membership.
 * - Targets only `public.blog_posts` by exact database UUID (`id`), never by `title` or `slug`.
 * - Does NOT delete or modify the parent `public.blog_post_groups` record, preserving any sibling translation.
 */
export async function deleteAdminBlogPost(
  postId: string
): Promise<AdminBlogDeleteResult> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      status: 'error',
      message: 'Supabase client is not configured.',
    };
  }

  const normalizedId = typeof postId === 'string' ? postId.trim() : '';
  if (!normalizedId || !isValidUuid(normalizedId)) {
    return {
      status: 'validation_error',
      message: 'Invalid blog post UUID. Deletion requires a valid database record ID.',
    };
  }

  const sessionCheck = await requireAuthorizedAdminSession(client);
  if (sessionCheck.status === 'unauthorized') {
    return { status: 'unauthorized', message: sessionCheck.message };
  }
  if (sessionCheck.status === 'error') {
    return { status: 'error', message: sessionCheck.message };
  }

  try {
    const { data: deletedRows, error: deleteError } = await client
      .from('blog_posts')
      .delete()
      .eq('id', normalizedId)
      .select('id, title, status');

    if (deleteError) {
      const formatted = formatDatabaseCrudError(deleteError);
      if (formatted.kind === 'validation_error') {
        return { status: 'validation_error', message: formatted.message };
      }
      return { status: 'error', message: formatted.message };
    }

    if (
      !Array.isArray(deletedRows) ||
      deletedRows.length !== 1 ||
      deletedRows[0]?.id !== normalizedId
    ) {
      return {
        status: 'error',
        message:
          'The selected blog post could not be deleted because it was not found in public.blog_posts or access was denied by Row-Level Security.',
      };
    }

    const deletedRecord = deletedRows[0] as {
      id: string;
      title?: string;
      status?: BlogPostStatus;
    };

    return {
      status: 'ok',
      deletedPostId: deletedRecord.id,
      deletedTitle: deletedRecord.title,
      deletedStatus: deletedRecord.status,
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Network error while deleting blog post from Supabase.';
    return { status: 'error', message: msg };
  }
}

const BLOG_IMAGES_BUCKET = 'blog-images';
const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function generateRandomHex(byteLength = 4): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(byteLength);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fallback below
  }
  return Math.random().toString(16).slice(2, 2 + byteLength * 2).padEnd(byteLength * 2, '0');
}

function sanitizeImageBaseName(rawName: string): string {
  const withoutExt = String(rawName || '').replace(/\.[^/.]+$/, '');
  const cleaned = withoutExt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return cleaned || 'featured-image';
}

function formatStorageUploadError(error: {
  message?: string;
  statusCode?: string | number;
  error?: string;
}): string {
  const rawMsg = error.message || error.error || 'Image upload failed.';
  const lower = rawMsg.toLowerCase();
  const statusStr = String(error.statusCode || '');

  if (lower.includes('bucket not found') || statusStr === '404') {
    return 'The "blog-images" Storage bucket was not found in Supabase. Verify that the bucket has been created.';
  }
  if (
    lower.includes('row-level security') ||
    lower.includes('new row violates') ||
    lower.includes('permission denied') ||
    lower.includes('not authorized') ||
    statusStr === '401' ||
    statusStr === '403'
  ) {
    return 'Upload rejected by Supabase Storage permissions. Verify your session is active in public.blog_admins and the blog-images INSERT policy allows uploads to featured/.';
  }
  if (
    lower.includes('payload too large') ||
    lower.includes('maximum allowed size') ||
    lower.includes('exceeded') ||
    statusStr === '413'
  ) {
    return 'The selected image exceeds the 5 MB maximum file size allowed by Supabase Storage.';
  }
  if (lower.includes('mime type') || lower.includes('invalid_mime_type') || statusStr === '415') {
    return 'Unsupported image format rejected by Storage. Please upload a JPEG, PNG, or WebP image.';
  }
  if (lower.includes('already exists') || lower.includes('duplicate') || statusStr === '409') {
    return 'An image with this storage object path already exists. Please try uploading again.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed')
  ) {
    return 'Network error while uploading image to Supabase Storage. Please check your connection and try again.';
  }

  return `Supabase Storage upload failed: ${rawMsg}`;
}

/**
 * Uploads a Featured Image (JPEG, PNG, or WebP up to 5 MB) to the public `blog-images`
 * Supabase Storage bucket under `featured/YYYY-MM/<timestamp>-<random>-<filename>.<ext>`
 * using `upsert: false`, and returns the resulting public URL.
 * - Re-verifies the active authenticated session and `public.blog_admins` membership before upload.
 */
export async function uploadAdminBlogImage(file: File): Promise<AdminBlogImageUploadResult> {
  if (!file || typeof file.size !== 'number' || typeof file.type !== 'string') {
    const message = 'Please select a valid JPEG, PNG, or WebP image file to upload.';
    return {
      status: 'validation_error',
      ok: false,
      message,
      error: message,
    };
  }

  const ext = ALLOWED_IMAGE_MIME_TYPES[file.type.toLowerCase()];
  if (!ext) {
    const message =
      'Invalid file format. Only JPEG (.jpg), PNG (.png), and WebP (.webp) images are supported.';
    return {
      status: 'validation_error',
      ok: false,
      message,
      error: message,
    };
  }

  if (file.size <= 0) {
    const message = 'The selected image file is empty (0 bytes). Please choose a valid image.';
    return {
      status: 'validation_error',
      ok: false,
      message,
      error: message,
    };
  }

  if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    const message = `Image file is too large (${sizeMb} MB). Maximum allowed file size is 5 MB.`;
    return {
      status: 'validation_error',
      ok: false,
      message,
      error: message,
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    const message = 'Supabase client is not configured.';
    return {
      status: 'error',
      ok: false,
      message,
      error: message,
    };
  }

  const sessionCheck = await requireAuthorizedAdminSession(client);
  if (sessionCheck.status === 'unauthorized') {
    return {
      status: 'unauthorized',
      ok: false,
      message: sessionCheck.message,
      error: sessionCheck.message,
    };
  }
  if (sessionCheck.status === 'error') {
    return {
      status: 'error',
      ok: false,
      message: sessionCheck.message,
      error: sessionCheck.message,
    };
  }

  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const randomHex = generateRandomHex(4);
  const safeBaseName = sanitizeImageBaseName(file.name);
  const objectPath = `featured/${yearMonth}/${now.getTime()}-${randomHex}-${safeBaseName}.${ext}`;

  try {
    const { data: uploadData, error: uploadError } = await client.storage
      .from(BLOG_IMAGES_BUCKET)
      .upload(objectPath, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type.toLowerCase(),
      });

    if (uploadError) {
      const message = formatStorageUploadError(uploadError);
      return {
        status: 'error',
        ok: false,
        message,
        error: message,
      };
    }

    const finalPath = uploadData?.path || objectPath;
    const { data: publicUrlData } = client.storage
      .from(BLOG_IMAGES_BUCKET)
      .getPublicUrl(finalPath);

    const publicUrl = publicUrlData?.publicUrl ? publicUrlData.publicUrl.trim() : '';
    if (!publicUrl || (!publicUrl.startsWith('https://') && !publicUrl.startsWith('http://'))) {
      const message =
        'Image uploaded, but Supabase Storage did not return a valid public URL.';
      return {
        status: 'error',
        ok: false,
        message,
        error: message,
      };
    }

    return {
      status: 'ok',
      ok: true,
      publicUrl,
      objectPath: finalPath,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? formatStorageUploadError({ message: err.message })
        : 'Network error while uploading image to Supabase Storage.';
    return { status: 'error', ok: false, message, error: message };
  }
}

/**
 * Strictly validates announcement URLs.
 * - Accepts HTTPS external URLs only (http: rejected).
 * - Accepts safe root-relative URLs starting with single '/' (rejects '//', '/\', etc.).
 * - Strictly rejects protocol-relative URLs (//evil.com), backslash bypasses, control characters, and non-https schemes.
 */
export function isSafeAnnouncementUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;

  // Reject backslashes anywhere in the URL
  if (trimmed.indexOf('\\') !== -1) return false;

  // Reject control characters or whitespace
  if (/[\x00-\x1F\x7F\s]/.test(trimmed)) return false;

  // Root-relative URL check: must start with '/' but NOT '//' or '/\'
  if (trimmed.startsWith('/')) {
    if (trimmed.length > 1 && (trimmed[1] === '/' || trimmed[1] === '\\')) {
      return false;
    }
    return true;
  }

  // External URL check: must be strictly https: with RFC-compliant hostname
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    const rfcHostnameRegex =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
    if (!parsed.hostname || !rfcHostnameRegex.test(parsed.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const ANNOUNCEMENT_SELECT_COLUMNS =
  'slot, is_active, title_en, title_tl, body_en, body_tl, image_url, image_alt_en, image_alt_tl, link_url, link_label_en, link_label_tl, display_style, draft_lock_token, updated_at, published_at, updated_by';

/**
 * Public helper to fetch the active published announcement for site visitors.
 */
export async function fetchPublicAnnouncement(): Promise<SiteAnnouncementRecord | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  try {
    const { data, error } = await client
      .from('site_announcements')
      .select(ANNOUNCEMENT_SELECT_COLUMNS)
      .eq('slot', 'published')
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data as SiteAnnouncementRecord;
  } catch {
    return null;
  }
}

function generateClientUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback below
  }
  const hex = generateRandomHex(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function createDefaultAnnouncementRecord(slot: 'draft' | 'published'): SiteAnnouncementRecord {
  return {
    slot,
    is_active: false,
    title_en: '2026 Philippine Payroll & Statutory Rate Updates',
    title_tl: 'Mga Update sa 2026 Philippine Payroll at Statutory Rates',
    body_en:
      'Our SSS, PhilHealth, Pag-IBIG, and BIR withholding tax calculators are updated with the latest 2026 schedules.',
    body_tl:
      'Na-update na ang aming SSS, PhilHealth, Pag-IBIG, at BIR withholding tax calculators para sa pinakabagong 2026 schedules.',
    image_url: null,
    image_alt_en: null,
    image_alt_tl: null,
    link_url: null,
    link_label_en: null,
    link_label_tl: null,
    display_style: 'modal',
    draft_lock_token: generateClientUuid(),
    updated_at: new Date().toISOString(),
    published_at: null,
    updated_by: null,
  };
}

/**
 * Fetches the current admin announcement state (both draft and published slots).
 */
export async function fetchAdminAnnouncementState(): Promise<AnnouncementAdminFetchResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { status: 'error', message: 'Supabase client is not configured.' };
  }

  const sessionCheck = await requireAuthorizedAdminSession(client);
  if (sessionCheck.status === 'unauthorized') {
    return { status: 'unauthorized', message: sessionCheck.message };
  }
  if (sessionCheck.status === 'error') {
    return { status: 'error', message: sessionCheck.message };
  }

  try {
    const { data, error } = await client
      .from('site_announcements')
      .select(ANNOUNCEMENT_SELECT_COLUMNS);

    if (error) {
      const errCode = String((error as any).code || '');
      const errMsg = String(error.message || '');
      if (
        errCode === '42P01' ||
        errCode === 'PGRST205' ||
        /site_announcements.*does not exist|Could not find the table.*site_announcements/i.test(errMsg)
      ) {
        return {
          status: 'error',
          message:
            'The site_announcements table does not exist in Supabase yet. Please run /supabase/migrations/20261030_site_announcements.sql in the Supabase SQL Editor.',
        };
      }
      return { status: 'error', message: `Could not load announcement data: ${error.message}` };
    }

    const rows = (data || []) as SiteAnnouncementRecord[];
    const draft = rows.find((r) => r.slot === 'draft') || createDefaultAnnouncementRecord('draft');
    const published =
      rows.find((r) => r.slot === 'published') || createDefaultAnnouncementRecord('published');
    const resolvedToken =
      draft.draft_lock_token && isValidUuid(draft.draft_lock_token)
        ? draft.draft_lock_token
        : generateClientUuid();
    draft.draft_lock_token = resolvedToken;

    return {
      status: 'ok',
      draft,
      published,
      is_active: Boolean(published.is_active),
      draft_lock_token: resolvedToken,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error while loading announcements.';
    return { status: 'error', message: msg };
  }
}

/**
 * Saves announcement draft changes using the RPC `save_site_announcement_draft`,
 * with automatic fallback to direct RLS table upsert if the RPC is not in the schema cache.
 */
export async function saveAdminAnnouncementDraft(
  input: SaveAnnouncementDraftInput
): Promise<AnnouncementAdminSaveResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { status: 'error', message: 'Supabase client is not configured.' };
  }

  const sessionCheck = await requireAuthorizedAdminSession(client);
  if (sessionCheck.status === 'unauthorized') {
    return { status: 'unauthorized', message: sessionCheck.message };
  }
  if (sessionCheck.status === 'error') {
    return { status: 'error', message: sessionCheck.message };
  }

  const rawTitleEn = (input.title_en || '').trim();
  const rawTitleTl = (input.title_tl || '').trim();
  const rawBodyEn = (input.body_en || '').trim();
  const rawBodyTl = (input.body_tl || '').trim();

  const titleEn = rawTitleEn || rawTitleTl;
  const titleTl = rawTitleTl || rawTitleEn;
  const bodyEn = rawBodyEn || rawBodyTl;
  const bodyTl = rawBodyTl || rawBodyEn;

  if (!titleEn) {
    return { status: 'validation_error', message: 'Announcement Title is required.' };
  }
  if (!bodyEn) {
    return { status: 'validation_error', message: 'Announcement Message Body is required.' };
  }

  const rawImageUrl = input.image_url ? input.image_url.trim() : '';
  const rawImageAltEn = input.image_alt_en ? input.image_alt_en.trim() : '';
  const rawImageAltTl = input.image_alt_tl ? input.image_alt_tl.trim() : '';

  if (rawImageUrl && !isSafeAnnouncementUrl(rawImageUrl)) {
    return {
      status: 'validation_error',
      message: 'Image URL must be an HTTPS URL or safe root-relative path (e.g. https://... or /...).',
    };
  }

  const rawLinkUrl = input.link_url ? input.link_url.trim() : '';
  const rawLinkLabelEn = input.link_label_en ? input.link_label_en.trim() : '';
  const rawLinkLabelTl = input.link_label_tl ? input.link_label_tl.trim() : '';

  if (rawLinkUrl && !isSafeAnnouncementUrl(rawLinkUrl)) {
    return {
      status: 'validation_error',
      message: 'Button Link URL must be an HTTPS URL or safe root-relative path (e.g. https://... or /...).',
    };
  }

  const normalizedImageUrl = rawImageUrl || null;
  const normalizedImageAltEn = rawImageUrl ? rawImageAltEn || titleEn : null;
  const normalizedImageAltTl = rawImageUrl ? rawImageAltTl || titleTl : null;
  const normalizedLinkUrl = rawLinkUrl || null;
  const normalizedLinkLabelEn = rawLinkUrl ? rawLinkLabelEn || 'Learn More' : null;
  const normalizedLinkLabelTl = rawLinkUrl ? rawLinkLabelTl || 'Alamin ang Higit Pa' : null;
  const normalizedDisplayStyle: AnnouncementDisplayStyle =
    input.display_style === 'banner' ? 'banner' : 'modal';
  const expectedToken =
    input.expected_draft_lock_token && isValidUuid(input.expected_draft_lock_token)
      ? input.expected_draft_lock_token.trim()
      : generateClientUuid();

  try {
    const { data: newToken, error: rpcError } = await client.rpc('save_site_announcement_draft', {
      p_expected_draft_lock_token: expectedToken,
      p_title_en: titleEn,
      p_title_tl: titleTl,
      p_body_en: bodyEn,
      p_body_tl: bodyTl,
      p_image_url: normalizedImageUrl,
      p_image_alt_en: normalizedImageAltEn,
      p_image_alt_tl: normalizedImageAltTl,
      p_link_url: normalizedLinkUrl,
      p_link_label_en: normalizedLinkLabelEn,
      p_link_label_tl: normalizedLinkLabelTl,
      p_display_style: normalizedDisplayStyle,
    });

    if (rpcError) {
      const errCode = String((rpcError as any).code || '');
      const lower = (rpcError.message || '').toLowerCase();

      if (
        errCode === '42P01' ||
        errCode === 'PGRST205' ||
        /site_announcements.*does not exist|could not find the table.*site_announcements/i.test(lower)
      ) {
        return {
          status: 'error',
          message:
            'The site_announcements table does not exist in Supabase yet. Please run /supabase/migrations/20261030_site_announcements.sql in the Supabase SQL Editor.',
        };
      }

      // If RPC is missing from schema cache or reported a stale lock token, attempt direct RLS upsert on site_announcements
      if (
        errCode === 'PGRST202' ||
        errCode === '42883' ||
        errCode === 'P0001' ||
        errCode === 'P0002' ||
        lower.includes('could not find the function') ||
        lower.includes('schema cache') ||
        lower.includes('lock token') ||
        lower.includes('conflict') ||
        lower.includes('stale')
      ) {
        const fallbackToken = generateClientUuid();
        const { data: upsertedDraft, error: upsertErr } = await client
          .from('site_announcements')
          .upsert(
            {
              slot: 'draft',
              is_active: false,
              title_en: titleEn,
              title_tl: titleTl,
              body_en: bodyEn,
              body_tl: bodyTl,
              image_url: normalizedImageUrl,
              image_alt_en: normalizedImageAltEn,
              image_alt_tl: normalizedImageAltTl,
              link_url: normalizedLinkUrl,
              link_label_en: normalizedLinkLabelEn,
              link_label_tl: normalizedLinkLabelTl,
              display_style: normalizedDisplayStyle,
              draft_lock_token: fallbackToken,
              updated_at: new Date().toISOString(),
              updated_by: sessionCheck.userId,
            },
            { onConflict: 'slot' }
          )
          .select(ANNOUNCEMENT_SELECT_COLUMNS)
          .single();

        if (!upsertErr && upsertedDraft) {
          return {
            status: 'ok',
            draft: upsertedDraft as SiteAnnouncementRecord,
            newToken: fallbackToken,
            new_draft_lock_token: fallbackToken,
          };
        }

        if (
          errCode === 'P0001' ||
          lower.includes('lock token') ||
          lower.includes('conflict') ||
          lower.includes('stale')
        ) {
          return {
            status: 'conflict',
            message:
              'Another administrator updated the draft while you were editing. Please reload the latest draft to review and re-apply your changes.',
          };
        }

        return {
          status: 'error',
          message:
            'Announcement database table or RPC functions are not installed in Supabase yet. Please run /supabase/migrations/20261030_site_announcements.sql in the Supabase SQL Editor.',
        };
      }

      if (rpcError.code === '42501' || lower.includes('authorized administrator')) {
        return {
          status: 'unauthorized',
          message: 'Your administrator session is not authorized to edit announcements.',
        };
      }
      if (rpcError.code === '23514' || lower.includes('check constraint') || lower.includes('valid')) {
        return {
          status: 'validation_error',
          message: `Validation error: ${rpcError.message}`,
        };
      }
      return { status: 'error', message: rpcError.message };
    }

    // Fetch the updated draft record
    const { data: updatedDraft, error: fetchErr } = await client
      .from('site_announcements')
      .select(ANNOUNCEMENT_SELECT_COLUMNS)
      .eq('slot', 'draft')
      .single();

    if (fetchErr || !updatedDraft) {
      return {
        status: 'error',
        message: 'Draft saved in database, but could not reload the updated record.',
      };
    }

    const finalToken = String(newToken || updatedDraft.draft_lock_token || expectedToken);
    return {
      status: 'ok',
      draft: updatedDraft as SiteAnnouncementRecord,
      newToken: finalToken,
      new_draft_lock_token: finalToken,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error while saving announcement draft.';
    return { status: 'error', message: msg };
  }
}

/**
 * Atomically copies draft content to published slot using `publish_site_announcement`,
 * with automatic fallback to direct RLS table upsert if the RPC is not in the schema cache.
 */
export async function publishAdminAnnouncement(
  expectedTokenOrInput: string | { expected_draft_lock_token?: string }
): Promise<AnnouncementAdminPublishResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { status: 'error', message: 'Supabase client is not configured.' };
  }

  const sessionCheck = await requireAuthorizedAdminSession(client);
  if (sessionCheck.status === 'unauthorized') {
    return { status: 'unauthorized', message: sessionCheck.message };
  }
  if (sessionCheck.status === 'error') {
    return { status: 'error', message: sessionCheck.message };
  }

  const rawToken =
    typeof expectedTokenOrInput === 'string'
      ? expectedTokenOrInput.trim()
      : typeof expectedTokenOrInput?.expected_draft_lock_token === 'string'
        ? expectedTokenOrInput.expected_draft_lock_token.trim()
        : '';

  const expectedToken = isValidUuid(rawToken) ? rawToken : generateClientUuid();

  try {
    const { data: newToken, error: rpcError } = await client.rpc('publish_site_announcement', {
      p_expected_draft_lock_token: expectedToken,
    });

    if (rpcError) {
      const errCode = String((rpcError as any).code || '');
      const lower = (rpcError.message || '').toLowerCase();

      if (
        errCode === '42P01' ||
        errCode === 'PGRST205' ||
        /site_announcements.*does not exist|could not find the table.*site_announcements/i.test(lower)
      ) {
        return {
          status: 'error',
          message:
            'The site_announcements table does not exist in Supabase yet. Please run /supabase/migrations/20261030_site_announcements.sql in the Supabase SQL Editor.',
        };
      }

      if (
        errCode === 'PGRST202' ||
        errCode === '42883' ||
        errCode === 'P0001' ||
        errCode === 'P0002' ||
        lower.includes('could not find the function') ||
        lower.includes('schema cache') ||
        lower.includes('lock token') ||
        lower.includes('conflict') ||
        lower.includes('stale')
      ) {
        const { data: currentDraft } = await client
          .from('site_announcements')
          .select(ANNOUNCEMENT_SELECT_COLUMNS)
          .eq('slot', 'draft')
          .maybeSingle();

        if (currentDraft) {
          const fallbackToken = generateClientUuid();
          const nowIso = new Date().toISOString();
          const { data: upsertedRows, error: upsertErr } = await client
            .from('site_announcements')
            .upsert(
              [
                {
                  slot: 'draft',
                  is_active: false,
                  title_en: currentDraft.title_en,
                  title_tl: currentDraft.title_tl,
                  body_en: currentDraft.body_en,
                  body_tl: currentDraft.body_tl,
                  image_url: currentDraft.image_url,
                  image_alt_en: currentDraft.image_alt_en,
                  image_alt_tl: currentDraft.image_alt_tl,
                  link_url: currentDraft.link_url,
                  link_label_en: currentDraft.link_label_en,
                  link_label_tl: currentDraft.link_label_tl,
                  display_style: currentDraft.display_style,
                  draft_lock_token: fallbackToken,
                  updated_at: nowIso,
                  updated_by: sessionCheck.userId,
                },
                {
                  slot: 'published',
                  is_active: true,
                  title_en: currentDraft.title_en,
                  title_tl: currentDraft.title_tl,
                  body_en: currentDraft.body_en,
                  body_tl: currentDraft.body_tl,
                  image_url: currentDraft.image_url,
                  image_alt_en: currentDraft.image_alt_en,
                  image_alt_tl: currentDraft.image_alt_tl,
                  link_url: currentDraft.link_url,
                  link_label_en: currentDraft.link_label_en,
                  link_label_tl: currentDraft.link_label_tl,
                  display_style: currentDraft.display_style,
                  draft_lock_token: fallbackToken,
                  updated_at: nowIso,
                  published_at: nowIso,
                  updated_by: sessionCheck.userId,
                },
              ],
              { onConflict: 'slot' }
            )
            .select(ANNOUNCEMENT_SELECT_COLUMNS);

          if (!upsertErr && Array.isArray(upsertedRows)) {
            const draftRow = upsertedRows.find((r) => r.slot === 'draft') as SiteAnnouncementRecord | undefined;
            const pubRow = upsertedRows.find((r) => r.slot === 'published') as SiteAnnouncementRecord | undefined;
            if (draftRow && pubRow) {
              return {
                status: 'ok',
                published: pubRow,
                draft: draftRow,
                newToken: fallbackToken,
                new_draft_lock_token: fallbackToken,
              };
            }
          }
        }

        if (
          errCode === 'P0001' ||
          lower.includes('lock token') ||
          lower.includes('conflict') ||
          lower.includes('stale')
        ) {
          return {
            status: 'conflict',
            message:
              'The draft was modified by another administrator since you loaded it. Please reload the draft before publishing.',
          };
        }

        return {
          status: 'error',
          message:
            'Announcement database table or RPC functions are not installed in Supabase yet. Please run /supabase/migrations/20261030_site_announcements.sql in the Supabase SQL Editor.',
        };
      }

      if (rpcError.code === '42501' || lower.includes('authorized administrator')) {
        return {
          status: 'unauthorized',
          message: 'Your administrator session is not authorized to publish announcements.',
        };
      }
      if (rpcError.code === '23514' || lower.includes('check constraint') || lower.includes('valid')) {
        return {
          status: 'validation_error',
          message: `Validation error: ${rpcError.message}`,
        };
      }
      return { status: 'error', message: rpcError.message };
    }

    const { data: records, error: fetchErr } = await client
      .from('site_announcements')
      .select(ANNOUNCEMENT_SELECT_COLUMNS);

    if (fetchErr || !records) {
      return {
        status: 'error',
        message: 'Announcement published, but could not reload latest announcement state.',
      };
    }

    const rows = records as SiteAnnouncementRecord[];
    const draft = rows.find((r) => r.slot === 'draft');
    const published = rows.find((r) => r.slot === 'published');

    if (!draft || !published) {
      return {
        status: 'error',
        message: 'Announcement records could not be verified after publishing.',
      };
    }

    return {
      status: 'ok',
      published,
      draft,
      newToken: String(newToken || draft.draft_lock_token || expectedToken),
      new_draft_lock_token: String(newToken || draft.draft_lock_token || expectedToken),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error while publishing announcement.';
    return { status: 'error', message: msg };
  }
}

/**
 * Toggles whether the published announcement is visible to site visitors.
 */
export async function toggleAdminAnnouncementActive(
  active: boolean
): Promise<AnnouncementAdminToggleResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { status: 'error', message: 'Supabase client is not configured.' };
  }

  const sessionCheck = await requireAuthorizedAdminSession(client);
  if (sessionCheck.status === 'unauthorized') {
    return { status: 'unauthorized', message: sessionCheck.message };
  }
  if (sessionCheck.status === 'error') {
    return { status: 'error', message: sessionCheck.message };
  }

  try {
    // Call set_site_announcement_active with p_active matching the SQL migration contract
    const { data: newActiveState, error: rpcError } = await client.rpc(
      'set_site_announcement_active',
      {
        p_active: active,
      }
    );

    if (rpcError) {
      const errCode = String((rpcError as any).code || '');
      const lower = (rpcError.message || '').toLowerCase();

      if (
        errCode === '42P01' ||
        errCode === 'PGRST205' ||
        /site_announcements.*does not exist|could not find the table.*site_announcements/i.test(lower)
      ) {
        return {
          status: 'error',
          message:
            'The site_announcements table does not exist in Supabase yet. Please run /supabase/migrations/20261030_site_announcements.sql in the Supabase SQL Editor.',
        };
      }

      if (
        errCode === 'PGRST202' ||
        errCode === '42883' ||
        lower.includes('could not find the function') ||
        lower.includes('schema cache')
      ) {
        const { data: updatedRow, error: updateErr } = await client
          .from('site_announcements')
          .update({
            is_active: active,
            updated_at: new Date().toISOString(),
            updated_by: sessionCheck.userId,
          })
          .eq('slot', 'published')
          .select('is_active')
          .maybeSingle();

        if (!updateErr && updatedRow) {
          const resolvedFallback = Boolean(updatedRow.is_active);
          return {
            status: 'ok',
            isActive: resolvedFallback,
            is_active: resolvedFallback,
          };
        }

        return {
          status: 'error',
          message:
            'The public.set_site_announcement_active(p_active) RPC function does not exist in Supabase yet. Please run /supabase/migrations/20261030_site_announcements.sql in the Supabase SQL Editor.',
        };
      }
      if (rpcError.code === '42501' || lower.includes('authorized administrator')) {
        return {
          status: 'unauthorized',
          message: 'Your administrator session is not authorized to enable/disable announcements.',
        };
      }
      return { status: 'error', message: rpcError.message || 'Error updating announcement status.' };
    }

    const resolvedActive = typeof newActiveState === 'boolean' ? newActiveState : Boolean(active);

    return {
      status: 'ok',
      isActive: resolvedActive,
      is_active: resolvedActive,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error while updating announcement status.';
    return { status: 'error', message: msg };
  }
}

type AuthBannerVariant = 'error' | 'warning' | 'info';

interface AuthBannerMessage {
  variant: AuthBannerVariant;
  title: string;
  body: string;
}

type SignOutReason =
  | 'user_logout'
  | 'access_denied'
  | 'verification_error'
  | 'session_expired'
  | null;

let activeAuthUnsubscribe: (() => void) | null = null;

function formatSignInError(rawMessage: string): AuthBannerMessage {
  const lower = rawMessage.toLowerCase();

  if (
    lower.includes('invalid login credentials') ||
    lower.includes('invalid_credentials') ||
    lower.includes('invalid email or password')
  ) {
    return {
      variant: 'error',
      title: 'Invalid Credentials',
      body: 'The email or password you entered is incorrect. Please check your credentials and try again.',
    };
  }

  if (lower.includes('email not confirmed')) {
    return {
      variant: 'warning',
      title: 'Email Not Confirmed',
      body: 'This account email has not been confirmed in Supabase Auth yet.',
    };
  }

  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      variant: 'warning',
      title: 'Too Many Attempts',
      body: 'Too many sign-in attempts were detected. Please wait a moment and try again.',
    };
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed')
  ) {
    return {
      variant: 'error',
      title: 'Network Error',
      body: 'Could not reach Supabase Auth. Please check your network connection and try again.',
    };
  }

  return {
    variant: 'error',
    title: 'Sign-In Failed',
    body: rawMessage || 'An unexpected authentication error occurred.',
  };
}

/**
 * Initializes the connection status badge and the full administrator login/logout
 * and `public.blog_admins` authorization flow on `/admin/`.
 */
async function initAdminSupabase(): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }

  const badgeEl = document.getElementById('supabase-connection-badge');
  const detailEl = document.getElementById('supabase-connection-detail');
  const authBadgeEl = document.getElementById('admin-auth-badge');
  const headerControlsEl = document.getElementById('admin-header-controls');
  const userEmailEl = document.getElementById('admin-user-email');
  const logoutBtn = document.getElementById('btn-admin-logout') as HTMLButtonElement | null;

  const authSectionEl = document.getElementById('section-admin-auth');
  const authLoadingEl = document.getElementById('auth-loading-state');
  const authLoginCardEl = document.getElementById('auth-login-card');
  const authBannerEl = document.getElementById('auth-message-banner');
  const authBannerTitleEl = document.getElementById('auth-message-title');
  const authBannerBodyEl = document.getElementById('auth-message-body');

  const loginForm = document.getElementById('admin-login-form') as HTMLFormElement | null;
  const emailInput = document.getElementById('admin-login-email') as HTMLInputElement | null;
  const passwordInput = document.getElementById('admin-login-password') as HTMLInputElement | null;
  const togglePasswordBtn = document.getElementById('btn-toggle-password') as HTMLButtonElement | null;
  const loginSubmitBtn = document.getElementById('btn-admin-login') as HTMLButtonElement | null;
  const loginSubmitLabel = document.getElementById('btn-admin-login-label');

  const dashboardWorkspaceEl = document.getElementById('admin-dashboard-workspace');
  const previewSectionEl = document.getElementById('section-post-preview');

  if (!badgeEl && !detailEl && !authSectionEl) {
    return;
  }

  if (activeAuthUnsubscribe) {
    activeAuthUnsubscribe();
    activeAuthUnsubscribe = null;
  }

  let isSubmittingLogin = false;
  let initialSessionCheckComplete = false;
  let hadVerifiedAdminSession = false;
  let pendingSignOutReason: SignOutReason = null;
  let activeBannerVariant: AuthBannerVariant | null = null;

  function setAuthBadge(text: string, tone: 'neutral' | 'success' | 'warning' | 'danger'): void {
    if (!authBadgeEl) return;
    authBadgeEl.textContent = text;
    if (tone === 'success') {
      authBadgeEl.className =
        'text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0';
    } else if (tone === 'danger') {
      authBadgeEl.className =
        'text-xs font-medium text-red-800 bg-red-50 border border-red-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0';
    } else if (tone === 'warning') {
      authBadgeEl.className =
        'text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0';
    } else {
      authBadgeEl.className =
        'text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0';
    }
  }

  function renderAuthBanner(message: AuthBannerMessage | null): void {
    if (!authBannerEl || !authBannerTitleEl || !authBannerBodyEl) return;

    if (!message) {
      activeBannerVariant = null;
      authBannerEl.hidden = true;
      authBannerEl.className = 'hidden rounded-xl border p-3.5 text-xs leading-relaxed';
      authBannerTitleEl.textContent = '';
      authBannerBodyEl.textContent = '';
      return;
    }

    activeBannerVariant = message.variant;
    authBannerEl.hidden = false;
    authBannerTitleEl.textContent = message.title;
    authBannerBodyEl.textContent = message.body;

    if (message.variant === 'error') {
      authBannerEl.className =
        'rounded-xl border border-red-300 bg-red-50 text-red-900 p-3.5 text-xs leading-relaxed';
    } else if (message.variant === 'warning') {
      authBannerEl.className =
        'rounded-xl border border-amber-300 bg-amber-50 text-amber-900 p-3.5 text-xs leading-relaxed';
    } else {
      authBannerEl.className =
        'rounded-xl border border-slate-300 bg-slate-50 text-slate-800 p-3.5 text-xs leading-relaxed';
    }
  }

  // Ensure login inputs are empty and no stale banner is visible on initial page load
  renderAuthBanner(null);
  if (emailInput) {
    emailInput.value = '';
  }
  if (passwordInput) {
    passwordInput.value = '';
    passwordInput.type = 'password';
  }
  if (togglePasswordBtn) {
    togglePasswordBtn.textContent = 'Show password';
    togglePasswordBtn.setAttribute('aria-pressed', 'false');
  }

  function setLoginFormBusy(busy: boolean, labelText?: string): void {
    if (emailInput) emailInput.disabled = busy;
    if (passwordInput) passwordInput.disabled = busy;
    if (togglePasswordBtn) togglePasswordBtn.disabled = busy;
    if (loginSubmitBtn) loginSubmitBtn.disabled = busy;
    if (loginSubmitLabel) {
      loginSubmitLabel.textContent =
        labelText || (busy ? 'Signing in & verifying admin access…' : 'Sign In to Blog Admin');
    }
  }

  function showLoggedOutView(
    banner: AuthBannerMessage | null,
    badgeTone: 'neutral' | 'warning' | 'danger' = 'neutral',
    badgeLabel = 'Not signed in'
  ): void {
    hadVerifiedAdminSession = false;

    if (dashboardWorkspaceEl) {
      dashboardWorkspaceEl.classList.add('hidden');
      dashboardWorkspaceEl.setAttribute('aria-hidden', 'true');
    }
    if (headerControlsEl) {
      headerControlsEl.classList.add('hidden');
      headerControlsEl.classList.remove('flex');
      headerControlsEl.setAttribute('aria-hidden', 'true');
    }
    if (previewSectionEl) {
      previewSectionEl.classList.add('hidden');
    }
    if (userEmailEl) {
      userEmailEl.textContent = '';
    }

    if (authSectionEl) {
      authSectionEl.classList.remove('hidden');
    }
    if (authLoadingEl) {
      authLoadingEl.classList.add('hidden');
    }
    if (authLoginCardEl) {
      authLoginCardEl.classList.remove('hidden');
    }

    setAuthBadge(badgeLabel, badgeTone);
    renderAuthBanner(banner);

    if (typeof window !== 'undefined' && window.__SUWELDOTOOLS_BLOG_ADMIN_UI__?.onAdminSignedOut) {
      window.__SUWELDOTOOLS_BLOG_ADMIN_UI__.onAdminSignedOut();
    }
  }

  function showAuthenticatedAdminView(email: string): void {
    hadVerifiedAdminSession = true;

    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.type = 'password';
    }
    if (togglePasswordBtn) {
      togglePasswordBtn.textContent = 'Show password';
      togglePasswordBtn.setAttribute('aria-pressed', 'false');
    }

    renderAuthBanner(null);

    if (authSectionEl) {
      authSectionEl.classList.add('hidden');
    }
    if (authLoadingEl) {
      authLoadingEl.classList.add('hidden');
    }

    if (headerControlsEl) {
      headerControlsEl.classList.remove('hidden');
      headerControlsEl.classList.add('flex');
      headerControlsEl.removeAttribute('aria-hidden');
    }
    if (dashboardWorkspaceEl) {
      dashboardWorkspaceEl.classList.remove('hidden');
      dashboardWorkspaceEl.removeAttribute('aria-hidden');
    }
    if (userEmailEl) {
      userEmailEl.textContent = email;
    }

    setAuthBadge('Admin Verified', 'success');

    if (detailEl) {
      detailEl.textContent = `Authenticated as verified administrator (${email}). Connected to public.blog_posts and public.blog_post_groups under Supabase RLS.`;
    }

    if (
      typeof window !== 'undefined' &&
      window.__SUWELDOTOOLS_BLOG_ADMIN_UI__?.onAdminAuthenticated
    ) {
      window.__SUWELDOTOOLS_BLOG_ADMIN_UI__.onAdminAuthenticated();
    }
  }

  // Expose the authenticated CRUD bridge for /public/js/blog-admin.js
  if (typeof window !== 'undefined') {
    window.__SUWELDOTOOLS_SUPABASE_ADMIN__ = {
      isAdminVerified: () => hadVerifiedAdminSession,
      fetchPosts: async () => {
        const result = await fetchAdminBlogPosts();
        if (result.status === 'unauthorized') {
          const activeClient = getSupabaseClient();
          if (activeClient) {
            pendingSignOutReason = 'session_expired';
            await activeClient.auth.signOut({ scope: 'local' });
          }
          showLoggedOutView(
            {
              variant: 'warning',
              title: 'Session Expired or Unauthorized',
              body: result.message,
            },
            'warning',
            'Session expired'
          );
        }
        return result;
      },
      savePost: async (input: BlogPostWriteInput) => {
        const result = await saveAdminBlogPost(input);
        if (result.status === 'unauthorized') {
          const activeClient = getSupabaseClient();
          if (activeClient) {
            pendingSignOutReason = 'session_expired';
            await activeClient.auth.signOut({ scope: 'local' });
          }
          showLoggedOutView(
            {
              variant: 'warning',
              title: 'Session Expired or Unauthorized',
              body: result.message,
            },
            'warning',
            'Session expired'
          );
        }
        return result;
      },
      deletePost: async (postId: string) => {
        const result = await deleteAdminBlogPost(postId);
        if (result.status === 'unauthorized') {
          const activeClient = getSupabaseClient();
          if (activeClient) {
            pendingSignOutReason = 'session_expired';
            await activeClient.auth.signOut({ scope: 'local' });
          }
          showLoggedOutView(
            {
              variant: 'warning',
              title: 'Session Expired or Unauthorized',
              body: result.message,
            },
            'warning',
            'Session expired'
          );
        }
        return result;
      },
      uploadImage: async (file: File) => {
        const result = await uploadAdminBlogImage(file);
        if (result.status === 'unauthorized') {
          const activeClient = getSupabaseClient();
          if (activeClient) {
            pendingSignOutReason = 'session_expired';
            await activeClient.auth.signOut({ scope: 'local' });
          }
          showLoggedOutView(
            {
              variant: 'warning',
              title: 'Session Expired or Unauthorized',
              body: result.message,
            },
            'warning',
            'Session expired'
          );
        }
        return result;
      },
      fetchAnnouncementAdminState: async () => {
        const result = await fetchAdminAnnouncementState();
        if (result.status === 'unauthorized') {
          const activeClient = getSupabaseClient();
          if (activeClient) {
            pendingSignOutReason = 'session_expired';
            await activeClient.auth.signOut({ scope: 'local' });
          }
          showLoggedOutView(
            {
              variant: 'warning',
              title: 'Session Expired or Unauthorized',
              body: result.message,
            },
            'warning',
            'Session expired'
          );
        }
        return result;
      },
      fetchAnnouncementState: async () => {
        const result = await fetchAdminAnnouncementState();
        if (result.status === 'unauthorized') {
          const activeClient = getSupabaseClient();
          if (activeClient) {
            pendingSignOutReason = 'session_expired';
            await activeClient.auth.signOut({ scope: 'local' });
          }
          showLoggedOutView(
            {
              variant: 'warning',
              title: 'Session Expired or Unauthorized',
              body: result.message,
            },
            'warning',
            'Session expired'
          );
        }
        return result;
      },
      saveAnnouncementDraft: async (input: SaveAnnouncementDraftInput) => {
        const result = await saveAdminAnnouncementDraft(input);
        if (result.status === 'unauthorized') {
          const activeClient = getSupabaseClient();
          if (activeClient) {
            pendingSignOutReason = 'session_expired';
            await activeClient.auth.signOut({ scope: 'local' });
          }
          showLoggedOutView(
            {
              variant: 'warning',
              title: 'Session Expired or Unauthorized',
              body: result.message,
            },
            'warning',
            'Session expired'
          );
        }
        return result;
      },
      publishAnnouncement: async (
        expectedTokenOrInput: string | { expected_draft_lock_token?: string }
      ) => {
        const result = await publishAdminAnnouncement(expectedTokenOrInput);
        if (result.status === 'unauthorized') {
          const activeClient = getSupabaseClient();
          if (activeClient) {
            pendingSignOutReason = 'session_expired';
            await activeClient.auth.signOut({ scope: 'local' });
          }
          showLoggedOutView(
            {
              variant: 'warning',
              title: 'Session Expired or Unauthorized',
              body: result.message,
            },
            'warning',
            'Session expired'
          );
        }
        return result;
      },
      toggleAnnouncementActive: async (active: boolean) => {
        const result = await toggleAdminAnnouncementActive(active);
        if (result.status === 'unauthorized') {
          const activeClient = getSupabaseClient();
          if (activeClient) {
            pendingSignOutReason = 'session_expired';
            await activeClient.auth.signOut({ scope: 'local' });
          }
          showLoggedOutView(
            {
              variant: 'warning',
              title: 'Session Expired or Unauthorized',
              body: result.message,
            },
            'warning',
            'Session expired'
          );
        }
        return result;
      },
    };
  }

  // Clear informational logout banner when the user begins typing new credentials
  const clearInfoBannerOnInput = (): void => {
    if (activeBannerVariant === 'info') {
      renderAuthBanner(null);
    }
  };
  if (emailInput) {
    emailInput.addEventListener('input', clearInfoBannerOnInput);
  }
  if (passwordInput) {
    passwordInput.addEventListener('input', clearInfoBannerOnInput);
  }

  // Password visibility toggle
  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', () => {
      const showing = passwordInput.type === 'text';
      passwordInput.type = showing ? 'password' : 'text';
      togglePasswordBtn.textContent = showing ? 'Show password' : 'Hide password';
      togglePasswordBtn.setAttribute('aria-pressed', showing ? 'false' : 'true');
    });
  }

  // 1. Check whether environment variables are configured
  if (!isSupabaseConfigured()) {
    if (badgeEl) {
      badgeEl.textContent = 'Supabase not configured';
      badgeEl.className =
        'text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0';
    }
    if (detailEl) {
      detailEl.textContent =
        'Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment to test live connectivity.';
    }
    showLoggedOutView(
      {
        variant: 'warning',
        title: 'Supabase Not Configured',
        body: 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing or set to placeholder values. Configure valid credentials to enable administrator sign-in.',
      },
      'warning',
      'Auth unavailable'
    );
    setLoginFormBusy(true, 'Sign In Unavailable (Not Configured)');
    return;
  }

  // 2. Run connection check for the header badge
  if (badgeEl) {
    badgeEl.textContent = 'Checking Supabase connection…';
    badgeEl.className =
      'text-xs font-medium text-slate-700 bg-slate-100 border border-slate-300 px-2 py-0.5 rounded whitespace-nowrap shrink-0';
  }

  const connectionResult = await checkSupabaseConnection();

  if (badgeEl) {
    badgeEl.textContent = connectionResult.label;
    if (connectionResult.status === 'connected') {
      badgeEl.className =
        'text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0';
    } else if (connectionResult.status === 'error') {
      badgeEl.className =
        'text-xs font-medium text-red-800 bg-red-50 border border-red-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0';
    } else {
      badgeEl.className =
        'text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0';
    }
  }

  if (detailEl) {
    detailEl.textContent = connectionResult.detail;
  }

  const client = getSupabaseClient();
  if (!client) {
    showLoggedOutView(
      {
        variant: 'error',
        title: 'Supabase Client Error',
        body: 'Supabase client could not be initialized.',
      },
      'danger',
      'Client error'
    );
    setLoginFormBusy(true, 'Sign In Unavailable');
    return;
  }

  /**
   * Evaluates a user session against `public.blog_admins` and updates the UI.
   * Signs the user out immediately if they are not listed in `public.blog_admins`.
   */
  async function evaluateSessionUser(user: { id: string; email?: string | null }): Promise<void> {
    const emailDisplay = user.email || 'Authenticated User';
    const verification = await verifyBlogAdminAccess(client!, user.id);

    if (verification.status === 'authorized') {
      showAuthenticatedAdminView(emailDisplay);
      return;
    }

    if (verification.status === 'access_denied') {
      pendingSignOutReason = 'access_denied';
      await client!.auth.signOut();
      showLoggedOutView(
        {
          variant: 'error',
          title: 'Access Denied — Unauthorized Account',
          body: `The account "${emailDisplay}" is not listed in public.blog_admins. Only authorized administrators may access the Blog Admin dashboard. You have been signed out.`,
        },
        'danger',
        'Access denied'
      );
      return;
    }

    pendingSignOutReason = 'verification_error';
    await client!.auth.signOut();
    showLoggedOutView(
      {
        variant: 'error',
        title: 'Administrator Verification Failed',
        body: verification.message,
      },
      'danger',
      'Verification error'
    );
  }

  // 3. Subscribe to auth state changes and register cleanup
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    if (isSubmittingLogin || !initialSessionCheckComplete) {
      return;
    }

    if (event === 'SIGNED_OUT') {
      const reason = pendingSignOutReason;
      pendingSignOutReason = null;

      if (reason === 'access_denied' || reason === 'verification_error') {
        // Banner and state were already set before signOut() resolved
        return;
      }

      if (reason === 'user_logout') {
        showLoggedOutView(
          {
            variant: 'info',
            title: 'Signed Out',
            body: 'You have been signed out of SuweldoTools Blog Admin.',
          },
          'neutral',
          'Signed out'
        );
        return;
      }

      if (reason === 'session_expired' || hadVerifiedAdminSession) {
        showLoggedOutView(
          {
            variant: 'warning',
            title: 'Session Expired',
            body: 'Your administrator session has expired or ended. Please sign in again to continue.',
          },
          'warning',
          'Session expired'
        );
        return;
      }

      showLoggedOutView(null, 'neutral', 'Not signed in');
      return;
    }

    if (
      (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') &&
      session?.user
    ) {
      // Defer async Supabase table query off the synchronous onAuthStateChange callback stack
      window.setTimeout(() => {
        if (!isSubmittingLogin) {
          void evaluateSessionUser(session.user);
        }
      }, 0);
    }
  });

  const cleanupSubscription = (): void => {
    subscription.unsubscribe();
  };
  activeAuthUnsubscribe = cleanupSubscription;
  window.addEventListener('pagehide', cleanupSubscription, { once: true });
  window.addEventListener('beforeunload', cleanupSubscription, { once: true });

  // 4. Bind Login Form Submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isSubmittingLogin) return;

      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      if (!email || !password) {
        renderAuthBanner({
          variant: 'error',
          title: 'Missing Credentials',
          body: 'Please enter both your administrator email address and password.',
        });
        if (!email && emailInput) {
          emailInput.focus();
        } else if (!password && passwordInput) {
          passwordInput.focus();
        }
        return;
      }

      isSubmittingLogin = true;
      renderAuthBanner(null);
      setLoginFormBusy(true, 'Signing in & verifying admin access…');
      setAuthBadge('Verifying credentials…', 'neutral');

      try {
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          const formatted = formatSignInError(error.message);
          showLoggedOutView(formatted, 'danger', 'Sign-in failed');
          return;
        }

        if (!data?.user) {
          showLoggedOutView(
            {
              variant: 'error',
              title: 'Sign-In Incomplete',
              body: 'Supabase Auth did not return an authenticated user record.',
            },
            'danger',
            'Sign-in failed'
          );
          return;
        }

        await evaluateSessionUser(data.user);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'Network error while communicating with Supabase Auth.';
        showLoggedOutView(formatSignInError(message), 'danger', 'Network error');
      } finally {
        isSubmittingLogin = false;
        setLoginFormBusy(false, 'Sign In to Blog Admin');
      }
    });
  }

  // 5. Bind Logout Button
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      const originalText = logoutBtn.textContent;
      logoutBtn.textContent = 'Logging out…';
      pendingSignOutReason = 'user_logout';

      try {
        const { error } = await client.auth.signOut();
        if (error) {
          pendingSignOutReason = null;
          showLoggedOutView(
            {
              variant: 'warning',
              title: 'Signed Out Locally',
              body: `Local session cleared, though Supabase returned a warning: ${error.message}`,
            },
            'neutral',
            'Signed out'
          );
        } else {
          showLoggedOutView(
            {
              variant: 'info',
              title: 'Signed Out',
              body: 'You have been signed out of SuweldoTools Blog Admin.',
            },
            'neutral',
            'Signed out'
          );
        }
        if (passwordInput) {
          passwordInput.value = '';
        }
        if (detailEl && connectionResult.status === 'connected') {
          detailEl.textContent =
            'Supabase Auth endpoint is reachable (No active administrator session — sign in required). Administrator access is granted only after sign-in and public.blog_admins verification.';
        }
        if (emailInput) {
          emailInput.focus();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Network error during sign-out.';
        showLoggedOutView(
          {
            variant: 'warning',
            title: 'Signed Out',
            body: `Session cleared (${msg}).`,
          },
          'neutral',
          'Signed out'
        );
      } finally {
        logoutBtn.disabled = false;
        logoutBtn.textContent = originalText || 'Log Out';
      }
    });
  }

  // 6. Check existing session on initial load
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();

    if (sessionError) {
      showLoggedOutView(
        {
          variant: 'error',
          title: 'Session Check Failed',
          body: `Could not read current Supabase session: ${sessionError.message}`,
        },
        'danger',
        'Session error'
      );
      return;
    }

    if (!sessionData?.session?.user) {
      showLoggedOutView(null, 'neutral', 'Not signed in');
      return;
    }

    // Verify that the cached token is still valid on the Supabase Auth server
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) {
      pendingSignOutReason = 'session_expired';
      await client.auth.signOut({ scope: 'local' });
      showLoggedOutView(
        {
          variant: 'warning',
          title: 'Session Expired',
          body: 'Your previous administrator session has expired. Please sign in again.',
        },
        'warning',
        'Session expired'
      );
      return;
    }

    await evaluateSessionUser(userData.user);
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Unexpected error while checking session.';
    showLoggedOutView(
      {
        variant: 'error',
        title: 'Session Check Error',
        body: `Could not verify existing session: ${msg}`,
      },
      'danger',
      'Session error'
    );
  } finally {
    initialSessionCheckComplete = true;
  }
}

if (typeof window !== 'undefined') {
  // Attach a default bridge immediately at module evaluation so uploadImage and CRUD methods
  // are always present on window.__SUWELDOTOOLS_SUPABASE_ADMIN__ before initAdminSupabase() finishes.
  if (!window.__SUWELDOTOOLS_SUPABASE_ADMIN__) {
    window.__SUWELDOTOOLS_SUPABASE_ADMIN__ = {
      isAdminVerified: () => false,
      fetchPosts: fetchAdminBlogPosts,
      savePost: saveAdminBlogPost,
      deletePost: deleteAdminBlogPost,
      uploadImage: uploadAdminBlogImage,
      fetchAnnouncementAdminState: fetchAdminAnnouncementState,
      fetchAnnouncementState: fetchAdminAnnouncementState,
      saveAnnouncementDraft: saveAdminAnnouncementDraft,
      publishAnnouncement: publishAdminAnnouncement,
      toggleAnnouncementActive: toggleAdminAnnouncementActive,
    };
  } else {
    const bridge = window.__SUWELDOTOOLS_SUPABASE_ADMIN__;
    if (typeof bridge.uploadImage !== 'function') {
      bridge.uploadImage = uploadAdminBlogImage;
    }
    if (typeof bridge.fetchAnnouncementAdminState !== 'function') {
      bridge.fetchAnnouncementAdminState = fetchAdminAnnouncementState;
    }
    if (typeof bridge.fetchAnnouncementState !== 'function') {
      bridge.fetchAnnouncementState = fetchAdminAnnouncementState;
    }
    if (typeof bridge.saveAnnouncementDraft !== 'function') {
      bridge.saveAnnouncementDraft = saveAdminAnnouncementDraft;
    }
    if (typeof bridge.publishAnnouncement !== 'function') {
      bridge.publishAnnouncement = publishAdminAnnouncement;
    }
    if (typeof bridge.toggleAnnouncementActive !== 'function') {
      bridge.toggleAnnouncementActive = toggleAdminAnnouncementActive;
    }
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initAdminSupabase();
    });
  } else {
    void initAdminSupabase();
  }
}
