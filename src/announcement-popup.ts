/**
 * SuweldoTools.com Client-Side Bilingual Announcement Popup Module
 *
 * Requirements:
 * - Detects page language from document.documentElement.lang ('tl' vs 'en').
 * - Queries Supabase public client for active published announcement:
 *     slot = 'published' AND is_active = true
 * - Avoids rendering if no announcement is active or required language content is missing.
 * - Computes a deterministic content hash of the active announcement.
 * - Checks localStorage for dismissal; suppresses display if user already dismissed this specific hash.
 * - Delays display by 4 seconds (4000ms) to prioritize calculator / page performance and UX.
 * - Renders accessible modal or banner using strictly safe DOM operations (textContent, setAttribute; 0 innerHTML).
 * - Implements keyboard trap and ESC dismiss for modal.
 * - On dismissal, records the content hash in localStorage with a smooth fade-out animation.
 */

// Self-contained environment validation to avoid importing @supabase/supabase-js
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

function readEnvValues(): { url: string; anonKey: string } {
  const rawUrl = import.meta.env.VITE_SUPABASE_URL;
  const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return {
    url: typeof rawUrl === 'string' ? rawUrl.trim().replace(/\/+$/, '') : '',
    anonKey: typeof rawKey === 'string' ? rawKey.trim() : '',
  };
}

function isSupabaseConfigured(): boolean {
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

export type AnnouncementDisplayStyle = 'modal' | 'banner';

export interface PublishedAnnouncementData {
  slot: string;
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
  draft_lock_token?: string | null;
  updated_at: string;
  published_at?: string | null;
}

const STORAGE_KEY_DISMISSED = 'suweldotools_announcement_dismissed';
const DISPLAY_DELAY_MS = 4000;

const ANNOUNCEMENT_SELECT_COLUMNS =
  'slot,is_active,title_en,title_tl,body_en,body_tl,image_url,image_alt_en,image_alt_tl,link_url,link_label_en,link_label_tl,display_style,draft_lock_token,updated_at,published_at';

/**
 * Computes a deterministic 32-bit hash string from announcement content and publication timestamp.
 * Any republish or content change alters the hash, re-triggering the popup for previously dismissed users.
 */
function computeContentHash(data: PublishedAnnouncementData): string {
  const content = [
    data.published_at || '',
    data.updated_at || '',
    data.draft_lock_token || '',
    data.title_en || '',
    data.title_tl || '',
    data.body_en || '',
    data.body_tl || '',
    data.image_url || '',
    data.link_url || '',
    data.display_style || 'modal',
  ].join(':::');

  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return 'ann_v2_' + Math.abs(hash).toString(36);
}

/**
 * Strictly validates announcement URLs.
 * - Accepts HTTPS external URLs only (http: rejected).
 * - Accepts safe root-relative URLs starting with single '/' (rejects '//', '/\', etc.).
 * - Strictly rejects protocol-relative URLs (//evil.com), backslash bypasses, control characters, and non-https schemes.
 */
function isSafeUrl(rawUrl: string | null | undefined): boolean {
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

/**
 * Queries Supabase PostgREST for the currently active published announcement via native fetch().
 */
async function fetchActivePublishedAnnouncement(): Promise<PublishedAnnouncementData | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const { url, anonKey } = readEnvValues();
  const endpoint = `${url}/rest/v1/site_announcements?slot=eq.published&is_active=eq.true&select=${ANNOUNCEMENT_SELECT_COLUMNS}`;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    const first = rows[0];
    if (!first || typeof first !== 'object') {
      return null;
    }

    return first as PublishedAnnouncementData;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Renders the announcement container into the document body.
 */
function renderAnnouncementUi(
  announcement: PublishedAnnouncementData,
  lang: 'tl' | 'en',
  contentHash: string
): void {
  const isTl = lang === 'tl';
  const title = isTl ? announcement.title_tl : announcement.title_en;
  const body = isTl ? announcement.body_tl : announcement.body_en;

  if (!title?.trim() || !body?.trim()) {
    return;
  }

  const imageUrl = isSafeUrl(announcement.image_url) ? announcement.image_url!.trim() : null;
  const imageAlt = isTl ? announcement.image_alt_tl : announcement.image_alt_en;

  const linkUrl = isSafeUrl(announcement.link_url) ? announcement.link_url!.trim() : null;
  const linkLabel = isTl
    ? announcement.link_label_tl?.trim() || 'Alamin ang Higit Pa'
    : announcement.link_label_en?.trim() || 'Learn More';

  const closeAriaLabel = isTl ? 'Isara ang anunsyo' : 'Close announcement';
  const isBanner = announcement.display_style === 'banner';

  // Container element
  const container = document.createElement('div');
  container.id = 'suweldotools-announcement-root';
  container.style.opacity = '0';
  container.style.transition = 'opacity 300ms ease, transform 300ms ease';

  function dismiss(): void {
    try {
      localStorage.setItem(STORAGE_KEY_DISMISSED, contentHash);
    } catch {
      // Storage access may fail in private browsing
    }
    container.style.opacity = '0';
    if (!isBanner) {
      container.style.transform = 'scale(0.96)';
    } else {
      container.style.transform = 'translateY(100%)';
    }
    window.setTimeout(() => {
      container.remove();
    }, 320);
  }

  if (isBanner) {
    // -------------------------------------------------------------
    // BANNER STYLE: Floating accessible toast/banner at bottom-right
    // -------------------------------------------------------------
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', isTl ? 'Mahalagang Anunsyo' : 'Important Announcement');
    container.className =
      'fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-50 bg-white border border-slate-200/90 rounded-2xl shadow-xl overflow-hidden p-4 sm:p-5 flex flex-col gap-3 font-sans antialiased text-slate-800';

    // Header row with title & close button
    const headerRow = document.createElement('div');
    headerRow.className = 'flex items-start justify-between gap-3';

    const titleEl = document.createElement('h2');
    titleEl.className = 'text-sm sm:text-base font-bold text-slate-900 leading-snug';
    titleEl.textContent = title;
    headerRow.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', closeAriaLabel);
    closeBtn.className =
      'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer';
    closeBtn.innerHTML =
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>';
    closeBtn.addEventListener('click', dismiss);
    headerRow.appendChild(closeBtn);
    container.appendChild(headerRow);

    // Optional image
    if (imageUrl) {
      const imgContainer = document.createElement('div');
      imgContainer.className = 'overflow-hidden rounded-xl border border-slate-100 max-h-40 bg-slate-50';
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = imageAlt || title;
      img.loading = 'lazy';
      img.className = 'w-full h-auto object-cover max-h-40';
      imgContainer.appendChild(img);
      container.appendChild(imgContainer);
    }

    // Body text
    const bodyEl = document.createElement('p');
    bodyEl.className = 'text-xs sm:text-sm text-slate-600 leading-relaxed whitespace-pre-line';
    bodyEl.textContent = body;
    container.appendChild(bodyEl);

    // CTA Button if link present
    if (linkUrl) {
      const ctaRow = document.createElement('div');
      ctaRow.className = 'pt-1 flex items-center justify-end gap-2';

      const dismissLink = document.createElement('button');
      dismissLink.type = 'button';
      dismissLink.className =
        'text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg transition-colors cursor-pointer';
      dismissLink.textContent = isTl ? 'I-dismiss' : 'Dismiss';
      dismissLink.addEventListener('click', dismiss);
      ctaRow.appendChild(dismissLink);

      const ctaLink = document.createElement('a');
      ctaLink.href = linkUrl;
      ctaLink.textContent = linkLabel;
      ctaLink.className =
        'inline-flex items-center justify-center px-4 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-2xs';
      if (!linkUrl.startsWith('/')) {
        ctaLink.target = '_blank';
        ctaLink.rel = 'noopener noreferrer';
      }
      ctaLink.addEventListener('click', () => {
        try {
          localStorage.setItem(STORAGE_KEY_DISMISSED, contentHash);
        } catch {
          // ignore
        }
      });
      ctaRow.appendChild(ctaLink);
      container.appendChild(ctaRow);
    }
  } else {
    // -------------------------------------------------------------
    // MODAL STYLE: Centered popup with accessible backdrop
    // -------------------------------------------------------------
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('aria-labelledby', 'announcement-modal-title');
    container.setAttribute('aria-describedby', 'announcement-modal-body');
    container.className =
      'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px] font-sans antialiased';

    // Backdrop click dismisses
    container.addEventListener('click', (e) => {
      if (e.target === container) {
        dismiss();
      }
    });

    const modalCard = document.createElement('div');
    modalCard.className =
      'w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]';

    // Header
    const cardHeader = document.createElement('div');
    cardHeader.className =
      'px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-100 flex items-start justify-between gap-3 bg-slate-50/70';

    const headerContent = document.createElement('div');
    headerContent.className = 'space-y-0.5';

    const badge = document.createElement('span');
    badge.className = 'text-[11px] font-bold uppercase tracking-wider text-emerald-700';
    badge.textContent = isTl ? 'Anunsyo mula sa SuweldoTools' : 'SuweldoTools Announcement';
    headerContent.appendChild(badge);

    const titleEl = document.createElement('h2');
    titleEl.id = 'announcement-modal-title';
    titleEl.className = 'text-lg sm:text-xl font-bold text-slate-900 leading-snug';
    titleEl.textContent = title;
    headerContent.appendChild(titleEl);
    cardHeader.appendChild(headerContent);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', closeAriaLabel);
    closeBtn.className =
      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer';
    closeBtn.innerHTML =
      '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>';
    closeBtn.addEventListener('click', dismiss);
    cardHeader.appendChild(closeBtn);
    modalCard.appendChild(cardHeader);

    // Scrollable content area
    const cardBody = document.createElement('div');
    cardBody.className = 'p-5 sm:p-6 overflow-y-auto space-y-4';

    if (imageUrl) {
      const figure = document.createElement('figure');
      figure.className = 'overflow-hidden rounded-xl border border-slate-200 bg-slate-100';
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = imageAlt || title;
      img.loading = 'lazy';
      img.className = 'w-full h-auto max-h-60 object-cover';
      figure.appendChild(img);
      cardBody.appendChild(figure);
    }

    const bodyEl = document.createElement('div');
    bodyEl.id = 'announcement-modal-body';
    bodyEl.className = 'text-sm sm:text-base text-slate-700 leading-relaxed whitespace-pre-line';
    bodyEl.textContent = body;
    cardBody.appendChild(bodyEl);
    modalCard.appendChild(cardBody);

    // Footer actions
    const cardFooter = document.createElement('div');
    cardFooter.className =
      'px-5 py-4 sm:px-6 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-end gap-3';

    const closeFooterBtn = document.createElement('button');
    closeFooterBtn.type = 'button';
    closeFooterBtn.className =
      'inline-flex items-center justify-center px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition cursor-pointer';
    closeFooterBtn.textContent = isTl ? 'Isara' : 'Close';
    closeFooterBtn.addEventListener('click', dismiss);
    cardFooter.appendChild(closeFooterBtn);

    if (linkUrl) {
      const ctaLink = document.createElement('a');
      ctaLink.href = linkUrl;
      ctaLink.textContent = linkLabel;
      ctaLink.className =
        'inline-flex items-center justify-center px-4 py-2 text-xs sm:text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition';
      if (!linkUrl.startsWith('/')) {
        ctaLink.target = '_blank';
        ctaLink.rel = 'noopener noreferrer';
      }
      ctaLink.addEventListener('click', () => {
        try {
          localStorage.setItem(STORAGE_KEY_DISMISSED, contentHash);
        } catch {
          // ignore
        }
      });
      cardFooter.appendChild(ctaLink);
    }

    modalCard.appendChild(cardFooter);
    container.appendChild(modalCard);

    // Keyboard ESC listener for modal
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.removeEventListener('keydown', keyHandler);
        dismiss();
      }
    };
    window.addEventListener('keydown', keyHandler);
  }

  document.body.appendChild(container);

  // Trigger smooth fade-in
  window.requestAnimationFrame(() => {
    container.style.opacity = '1';
    if (!isBanner) {
      container.style.transform = 'scale(1)';
    } else {
      container.style.transform = 'translateY(0)';
    }
  });
}

/**
 * Initializes announcement popup check and lifecycle.
 */
export async function initAnnouncementPopup(): Promise<void> {
  // Avoid running on admin interface
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  if (window.location.pathname.startsWith('/admin')) {
    return;
  }

  // Detect language
  const rawLang = document.documentElement.lang?.toLowerCase() || '';
  const lang: 'tl' | 'en' = rawLang.startsWith('tl') || rawLang.startsWith('fil') ? 'tl' : 'en';

  // Fetch published announcement
  const announcement = await fetchActivePublishedAnnouncement();
  if (!announcement || !announcement.is_active) {
    return;
  }

  // Check language content availability
  const title = lang === 'tl' ? announcement.title_tl : announcement.title_en;
  const body = lang === 'tl' ? announcement.body_tl : announcement.body_en;
  if (!title?.trim() || !body?.trim()) {
    return;
  }

  // Check dismissal in localStorage
  const contentHash = computeContentHash(announcement);
  try {
    const dismissedHash = localStorage.getItem(STORAGE_KEY_DISMISSED);
    if (dismissedHash === contentHash) {
      return;
    }
  } catch {
    // localStorage may be inaccessible in some private modes
  }

  // 4-second delay before display
  window.setTimeout(() => {
    renderAnnouncementUi(announcement, lang, contentHash);
  }, DISPLAY_DELAY_MS);
}

// Auto-run if loaded directly in browser
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initAnnouncementPopup();
    });
  } else {
    void initAnnouncementPopup();
  }
}
