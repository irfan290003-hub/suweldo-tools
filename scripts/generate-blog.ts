import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import sanitizeHtml from 'sanitize-html';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Load local environment files without overriding existing process.env vars
dotenv.config({ path: path.join(PROJECT_ROOT, '.env.local'), quiet: true });
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

export const GENERATOR_OWNERSHIP_MARKER = '<!-- SUWELDOTOOLS_GENERATED_BLOG_POST -->';
const SITE_ORIGIN = 'https://suweldotools.com';
const VALID_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDER_URL = 'https://your-project-ref.supabase.co';
const PLACEHOLDER_ANON_KEY = 'your-public-anon-or-publishable-key';

export interface BlogFaqItem {
  question: string;
  answer: string;
}

export interface PublishedBlogPost {
  id: string;
  group_id: string;
  language: 'en' | 'tl';
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  seo_title: string | null;
  meta_description: string | null;
  featured_image_url: string | null;
  featured_image_alt: string | null;
  author_name?: string | null;
  faqs?: BlogFaqItem[] | null;
  published_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Filters and normalizes raw FAQ JSONB data into non-empty { question, answer } pairs.
 */
export function normalizePublishedFaqs(rawFaqs: unknown): BlogFaqItem[] {
  if (!Array.isArray(rawFaqs)) return [];
  const valid: BlogFaqItem[] = [];
  for (const item of rawFaqs) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const question = typeof rec.question === 'string' ? rec.question.trim() : '';
    const answer = typeof rec.answer === 'string' ? rec.answer.trim() : '';
    if (question && answer) {
      valid.push({ question, answer });
    }
  }
  return valid;
}

export interface GenerateBlogResult {
  status: 'generated' | 'skipped_unconfigured' | 'skipped_error';
  enCount: number;
  tlCount: number;
  generatedFiles: string[];
  removedFiles: string[];
  message: string;
}

/**
 * Escapes untrusted text for safe insertion into HTML text nodes and double/single-quoted attributes.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safely serializes an object for embedding inside <script type="application/ld+json">.
 * Escapes `<`, `>`, `&`, and line separators so `</script>` or HTML tags can never break out.
 */
export function serializeJsonLd(data: unknown, indentSpaces = 6): string {
  const json = JSON.stringify(data, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const pad = ' '.repeat(indentSpaces);
  return json
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');
}

/**
 * Validates that an image or resource URL is a safe http(s) URL or root-relative path.
 */
export function sanitizeHttpUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Converts a root-relative or absolute URL to a full canonical https://suweldotools.com URL.
 */
export function toAbsoluteSiteUrl(urlOrPath: string): string {
  if (urlOrPath.startsWith('https://') || urlOrPath.startsWith('http://')) {
    return urlOrPath;
  }
  const normalizedPath = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
  return `${SITE_ORIGIN}${normalizedPath}`;
}

/**
 * Formats an ISO timestamp into a human-readable date for English or Filipino readers.
 */
export function formatPublishedDate(
  isoString: string | null | undefined,
  language: 'en' | 'tl'
): { iso: string; display: string } {
  const fallbackIso = new Date().toISOString();
  if (!isoString) {
    return { iso: fallbackIso, display: '' };
  }
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return { iso: fallbackIso, display: '' };
  }
  const locale = language === 'tl' ? 'tl-PH' : 'en-PH';
  let display = '';
  try {
    display = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Manila',
    }).format(parsed);
  } catch {
    display = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(parsed);
  }
  return {
    iso: parsed.toISOString(),
    display,
  };
}

/**
 * Explicit allowlist options for sanitize-html.
 * Allows necessary article tags, tables, lists, links, and inline text formatting.
 * Rejects script, iframe, embed, object, form, event handlers (onclick, etc.),
 * and dangerous schemes (javascript:, data:).
 */
export const ARTICLE_SANITIZER_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h2', 'h3', 'h4',
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'ul', 'ol', 'li',
    'a',
    'code', 'pre', 'blockquote',
    'hr',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel', 'class'],
    th: ['colspan', 'rowspan', 'scope', 'class'],
    td: ['colspan', 'rowspan', 'scope', 'class'],
    table: ['class'],
    h2: ['class'],
    h3: ['class'],
    h4: ['class'],
    p: ['class'],
    ul: ['class'],
    ol: ['class'],
    li: ['class'],
    blockquote: ['class'],
    pre: ['class'],
    code: ['class'],
    hr: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto'],
  },
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.target === '_blank') {
        const existingRel = attribs.rel || '';
        const parts = existingRel.split(/\s+/).filter(Boolean);
        if (!parts.includes('noopener')) parts.push('noopener');
        if (!parts.includes('noreferrer')) parts.push('noreferrer');
        attribs.rel = parts.join(' ');
      }
      return { tagName, attribs };
    },
  },
};

/**
 * Safely renders article body content into semantic HTML headings, tables, lists,
 * links, and paragraphs. Supports both existing Markdown formatting and raw HTML
 * structures while strictly sanitizing output against XSS via sanitize-html.
 */
export function renderSafeArticleContent(rawContent: string): string {
  const normalized = String(rawContent || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  // Protect double newlines inside multi-line HTML block tags (table, pre, blockquote, ul, ol)
  // so they are not fragmented into broken paragraph chunks.
  const protectedText = normalized.replace(
    /<(table|pre|blockquote|ul|ol)\b[\s\S]*?<\/\1>/gi,
    (match) => match.replace(/\n{2,}/g, '\uE000')
  );

  const blocks = protectedText
    .split(/\n{2,}/)
    .map((block) => block.replace(/\uE000/g, '\n\n').trim())
    .filter(Boolean);

  const renderedBlocks = blocks.map((block) => {
    const lines = block.split('\n').map((line) => line.trim());

    // Single-line Markdown-style H2 / H3 / H4 headings
    if (lines.length === 1 && lines[0].startsWith('#### ')) {
      const headingText = lines[0].slice(5).trim();
      return `<h4 class="text-base sm:text-lg font-bold text-slate-900 mt-4 mb-2">${headingText}</h4>`;
    }
    if (lines.length === 1 && lines[0].startsWith('### ')) {
      const headingText = lines[0].slice(4).trim();
      return `<h3 class="text-lg sm:text-xl font-bold text-slate-900 mt-6 mb-2">${headingText}</h3>`;
    }
    if (lines.length === 1 && lines[0].startsWith('## ')) {
      const headingText = lines[0].slice(3).trim();
      return `<h2 class="text-xl sm:text-2xl font-bold text-slate-900 mt-8 mb-3">${headingText}</h2>`;
    }

    // Markdown horizontal rule (---, ***, ___)
    if (lines.length === 1 && /^(?:---|\*\*\*|___)$/.test(lines[0])) {
      return '<hr class="my-8 border-slate-200" />';
    }

    // Unordered list block (either standalone or preceded by text without blank line)
    const isAllUnordered =
      lines.length > 0 && lines.every((line) => /^[-*]\s+.+/.test(line));
    if (isAllUnordered) {
      const items = lines
        .map((line) => line.replace(/^[-*]\s+/, '').trim())
        .map((item) => `<li class="leading-relaxed">${item}</li>`)
        .join('\n              ');
      return `<ul class="list-disc pl-5 space-y-2 text-slate-700 my-4">\n              ${items}\n            </ul>`;
    }

    const firstUnorderedIdx = lines.findIndex((line) => /^[-*]\s+.+/.test(line));
    if (
      firstUnorderedIdx > 0 &&
      lines.slice(firstUnorderedIdx).every((line) => /^[-*]\s+.+/.test(line))
    ) {
      const pLines = lines.slice(0, firstUnorderedIdx).join('<br />\n              ');
      const listItems = lines
        .slice(firstUnorderedIdx)
        .map((line) => line.replace(/^[-*]\s+/, '').trim())
        .map((item) => `<li class="leading-relaxed">${item}</li>`)
        .join('\n              ');
      return `<p class="text-base text-slate-700 leading-relaxed my-4">\n              ${pLines}\n            </p>\n            <ul class="list-disc pl-5 space-y-2 text-slate-700 my-4">\n              ${listItems}\n            </ul>`;
    }

    // Ordered list block (either standalone or preceded by text without blank line)
    const isAllOrdered =
      lines.length > 0 && lines.every((line) => /^\d+\.\s+.+/.test(line));
    if (isAllOrdered) {
      const items = lines
        .map((line) => line.replace(/^\d+\.\s+/, '').trim())
        .map((item) => `<li class="leading-relaxed">${item}</li>`)
        .join('\n              ');
      return `<ol class="list-decimal pl-5 space-y-2 text-slate-700 my-4">\n              ${items}\n            </ol>`;
    }

    const firstOrderedIdx = lines.findIndex((line) => /^\d+\.\s+.+/.test(line));
    if (
      firstOrderedIdx > 0 &&
      lines.slice(firstOrderedIdx).every((line) => /^\d+\.\s+.+/.test(line))
    ) {
      const pLines = lines.slice(0, firstOrderedIdx).join('<br />\n              ');
      const listItems = lines
        .slice(firstOrderedIdx)
        .map((line) => line.replace(/^\d+\.\s+/, '').trim())
        .map((item) => `<li class="leading-relaxed">${item}</li>`)
        .join('\n              ');
      return `<p class="text-base text-slate-700 leading-relaxed my-4">\n              ${pLines}\n            </p>\n            <ol class="list-decimal pl-5 space-y-2 text-slate-700 my-4">\n              ${listItems}\n            </ol>`;
    }

    // Check if the block is already an HTML block element (starts with an allowed block tag)
    const isHtmlBlock = /^\s*<(table|thead|tbody|tfoot|tr|th|td|caption|h[2-4]|ul|ol|li|p|blockquote|pre|hr)\b/i.test(block);
    if (isHtmlBlock) {
      return block;
    }

    // Standard paragraph block: internal single line-breaks are converted to <br />
    const paragraphHtml = lines.join('<br />\n              ');
    return `<p class="text-base text-slate-700 leading-relaxed my-4">\n              ${paragraphHtml}\n            </p>`;
  });

  const assembledHtml = renderedBlocks.join('\n            ');
  return sanitizeHtml(assembledHtml, ARTICLE_SANITIZER_OPTIONS);
}

/**
 * Replaces content between deterministic HTML comment markers.
 */
function replaceBetweenMarkers(
  html: string,
  startMarker: string,
  endMarker: string,
  replacementInnerHtml: string,
  indent = '        '
): string {
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`Missing or invalid markers: ${startMarker} ... ${endMarker}`);
  }

  const before = html.slice(0, startIdx + startMarker.length);
  const after = html.slice(endIdx);

  if (!replacementInnerHtml.trim()) {
    return `${before}\n${indent}${after}`;
  }

  return `${before}\n${replacementInnerHtml}\n${indent}${after}`;
}

/**
 * Renders a single post card for the English or Filipino blog listing page.
 */
function renderListingPostCard(post: PublishedBlogPost, language: 'en' | 'tl'): string {
  const basePath = language === 'tl' ? '/tl/blog' : '/blog';
  const articlePath = `${basePath}/${post.slug}/`;
  const categoryLabel = language === 'tl' ? 'Gabay sa Payroll' : 'Payroll Guide';
  const readMoreLabel = language === 'tl' ? 'Basahin ang Artikulo' : 'Read Article';
  const { iso, display } = formatPublishedDate(post.published_at, language);

  const safeImageUrl = sanitizeHttpUrl(post.featured_image_url);
  const safeImageAlt = escapeHtml(post.featured_image_alt || post.title);

  const imageSection = safeImageUrl
    ? `            <a href="${articlePath}" class="block aspect-16/9 w-full bg-slate-100 overflow-hidden border-b border-slate-100">
              <img
                src="${escapeHtml(safeImageUrl)}"
                alt="${safeImageAlt}"
                width="640"
                height="360"
                loading="lazy"
                class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
              />
            </a>`
    : '';

  return `          <article class="group bg-white rounded-2xl border border-slate-200 shadow-2xs hover:shadow-md hover:border-emerald-300 transition flex flex-col overflow-hidden">
${imageSection ? `${imageSection}\n` : ''}            <div class="p-5 sm:p-6 flex-1 flex flex-col justify-between space-y-4">
              <div class="space-y-2.5">
                <div class="flex items-center gap-2 text-xs text-slate-500">
                  <span class="font-semibold uppercase tracking-wider text-emerald-700">${categoryLabel}</span>
                  <span aria-hidden="true">&middot;</span>
                  <time datetime="${escapeHtml(iso)}">${escapeHtml(display)}</time>
                </div>
                <h3 class="text-lg font-bold text-slate-900 group-hover:text-emerald-700 transition leading-snug">
                  <a href="${articlePath}">${escapeHtml(post.title)}</a>
                </h3>
                <p class="text-sm text-slate-600 leading-relaxed line-clamp-3">${escapeHtml(post.excerpt)}</p>
              </div>
              <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-emerald-700">
                <a href="${articlePath}" class="inline-flex items-center gap-1 hover:underline">
                  <span>${readMoreLabel}</span>
                  <span aria-hidden="true">&rarr;</span>
                </a>
              </div>
            </div>
          </article>`;
}

/**
 * Updates /blog/index.html or /tl/blog/index.html using deterministic markers.
 */
function buildUpdatedListingHtml(
  currentHtml: string,
  posts: PublishedBlogPost[],
  language: 'en' | 'tl'
): string {
  const isTl = language === 'tl';
  const blogUrl = isTl ? `${SITE_ORIGIN}/tl/blog/` : `${SITE_ORIGIN}/blog/`;
  const homeUrl = isTl ? `${SITE_ORIGIN}/tl/` : `${SITE_ORIGIN}/`;
  const inLanguage = isTl ? 'tl-PH' : 'en-PH';
  const blogName = isTl
    ? 'SuweldoTools Blog ng Sahod at Payroll sa Pilipinas'
    : 'SuweldoTools Philippine Payroll & Salary Guides Blog';
  const blogDescription = isTl
    ? 'Mga gabay at artikulo tungkol sa kompyutasyon ng sahod, kaltas sa SSS, PhilHealth, Pag-IBIG, BIR withholding tax, at 13th month pay sa Pilipinas.'
    : 'Educational payroll articles, statutory contribution breakdowns, and labor law computation guides for Filipino employees, freelancers, and HR teams.';

  const blogPostEntries = posts.map((post) => {
    const postUrl = `${blogUrl}${post.slug}/`;
    const safeImageUrl = sanitizeHttpUrl(post.featured_image_url);
    const customAuthorName = post.author_name?.trim() || '';
    const entry: Record<string, unknown> = {
      '@type': 'BlogPosting',
      '@id': `${postUrl}#article`,
      headline: post.seo_title || post.title,
      name: post.title,
      description: post.meta_description || post.excerpt,
      url: postUrl,
      mainEntityOfPage: postUrl,
      inLanguage,
      datePublished: new Date(post.published_at).toISOString(),
      dateModified: new Date(post.updated_at || post.published_at).toISOString(),
      author: customAuthorName
        ? {
            '@type': 'Person',
            name: customAuthorName,
          }
        : {
            '@type': 'Organization',
            '@id': `${SITE_ORIGIN}/#organization`,
            name: 'SuweldoTools',
            sameAs: [
              'https://www.facebook.com/profile.php?id=61595908386922',
              'https://www.instagram.com/suweldotools/',
              'https://www.youtube.com/@suweldotools',
            ],
          },
      publisher: {
        '@type': 'Organization',
        '@id': `${SITE_ORIGIN}/#organization`,
        name: 'SuweldoTools',
        url: `${SITE_ORIGIN}/`,
        logo: `${SITE_ORIGIN}/apple-touch-icon.png`,
        sameAs: [
          'https://www.facebook.com/profile.php?id=61595908386922',
          'https://www.instagram.com/suweldotools/',
          'https://www.youtube.com/@suweldotools',
        ],
      },
    };
    if (safeImageUrl) {
      entry.image = toAbsoluteSiteUrl(safeImageUrl);
    }
    return entry;
  });

  const jsonLdGraph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Blog',
        '@id': `${blogUrl}#blog`,
        name: blogName,
        url: blogUrl,
        inLanguage,
        description: blogDescription,
        publisher: {
          '@type': 'Organization',
          '@id': `${SITE_ORIGIN}/#organization`,
          name: 'SuweldoTools',
          url: `${SITE_ORIGIN}/`,
          logo: `${SITE_ORIGIN}/apple-touch-icon.png`,
          sameAs: [
            'https://www.facebook.com/profile.php?id=61595908386922',
            'https://www.instagram.com/suweldotools/',
            'https://www.youtube.com/@suweldotools',
          ],
        },
        blogPost: blogPostEntries,
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${blogUrl}#breadcrumb`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: homeUrl,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Blog',
            item: blogUrl,
          },
        ],
      },
    ],
  };

  const jsonLdBlock = `    <script type="application/ld+json">\n${serializeJsonLd(
    jsonLdGraph,
    6
  )}\n    </script>`;

  const countText = isTl
    ? `${posts.length} Nailathalang Post`
    : posts.length === 1
      ? '1 Published Post'
      : `${posts.length} Published Posts`;

  const countBadgeHtml = `          <span class="inline-flex items-center self-start sm:self-center text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
            ${countText}
          </span>`;

  const cardsHtml =
    posts.length > 0
      ? `        <div id="blog-posts-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">\n${posts
          .map((post) => renderListingPostCard(post, language))
          .join('\n')}\n        </div>`
      : '';

  let updated = replaceBetweenMarkers(
    currentHtml,
    '<!-- BLOG_JSON_LD_START -->',
    '<!-- BLOG_JSON_LD_END -->',
    jsonLdBlock,
    '    '
  );

  updated = replaceBetweenMarkers(
    updated,
    '<!-- BLOG_COUNT_BADGE_START -->',
    '<!-- BLOG_COUNT_BADGE_END -->',
    countBadgeHtml,
    '          '
  );

  updated = replaceBetweenMarkers(
    updated,
    '<!-- BLOG_POSTS_LIST_START -->',
    '<!-- BLOG_POSTS_LIST_END -->',
    cardsHtml,
    '        '
  );

  // Toggle hidden class on #blog-empty-state inside <!-- BLOG_EMPTY_STATE_START --> ... <!-- BLOG_EMPTY_STATE_END -->
  const emptyStartIdx = updated.indexOf('<!-- BLOG_EMPTY_STATE_START -->');
  const emptyEndIdx = updated.indexOf('<!-- BLOG_EMPTY_STATE_END -->');
  if (emptyStartIdx !== -1 && emptyEndIdx !== -1 && emptyEndIdx > emptyStartIdx) {
    const emptyBlock = updated.slice(emptyStartIdx, emptyEndIdx);
    const updatedEmptyBlock = emptyBlock.replace(
      /(<div\s+id="blog-empty-state"\s+class=")([^"]*)(")/,
      (_match, prefix: string, classList: string, suffix: string) => {
        const tokens = classList
          .split(/\s+/)
          .filter((token) => token && token !== 'hidden');
        if (posts.length > 0) {
          tokens.unshift('hidden');
        }
        return `${prefix}${tokens.join(' ')}${suffix}`;
      }
    );
    updated =
      updated.slice(0, emptyStartIdx) +
      updatedEmptyBlock +
      updated.slice(emptyEndIdx);
  }

  return updated;
}

/**
 * Generates full static HTML for a single English or Filipino blog article page.
 */
export function buildArticlePageHtml(
  post: PublishedBlogPost,
  siblingPost?: PublishedBlogPost
): string {
  const isTl = post.language === 'tl';
  const htmlLang = isTl ? 'tl-PH' : 'en-PH';
  const ogLocale = isTl ? 'tl_PH' : 'en_PH';

  const articlePath = isTl ? `/tl/blog/${post.slug}/` : `/blog/${post.slug}/`;
  const canonicalUrl = `${SITE_ORIGIN}${articlePath}`;
  const blogIndexPath = isTl ? '/tl/blog/' : '/blog/';
  const blogIndexUrl = `${SITE_ORIGIN}${blogIndexPath}`;
  const homePath = isTl ? '/tl/' : '/';
  const homeUrl = `${SITE_ORIGIN}${homePath}`;

  // Language switcher target: link to published sibling article only if it exists; otherwise link to other language's blog index
  const enTargetPath = isTl
    ? siblingPost
      ? `/blog/${siblingPost.slug}/`
      : '/blog/'
    : articlePath;
  const tlTargetPath = isTl
    ? articlePath
    : siblingPost
      ? `/tl/blog/${siblingPost.slug}/`
      : '/tl/blog/';

  // Hreflang tags: only emit sibling alternate URL when sibling is actually published
  const hreflangLines: string[] = [];
  if (isTl) {
    if (siblingPost) {
      const enSiblingUrl = `${SITE_ORIGIN}/blog/${siblingPost.slug}/`;
      hreflangLines.push(
        `    <link rel="alternate" hreflang="en-PH" href="${escapeHtml(enSiblingUrl)}" />`
      );
      hreflangLines.push(
        `    <link rel="alternate" hreflang="tl-PH" href="${escapeHtml(canonicalUrl)}" />`
      );
      hreflangLines.push(
        `    <link rel="alternate" hreflang="x-default" href="${escapeHtml(enSiblingUrl)}" />`
      );
    } else {
      hreflangLines.push(
        `    <link rel="alternate" hreflang="tl-PH" href="${escapeHtml(canonicalUrl)}" />`
      );
    }
  } else {
    hreflangLines.push(
      `    <link rel="alternate" hreflang="en-PH" href="${escapeHtml(canonicalUrl)}" />`
    );
    if (siblingPost) {
      const tlSiblingUrl = `${SITE_ORIGIN}/tl/blog/${siblingPost.slug}/`;
      hreflangLines.push(
        `    <link rel="alternate" hreflang="tl-PH" href="${escapeHtml(tlSiblingUrl)}" />`
      );
    }
    hreflangLines.push(
      `    <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonicalUrl)}" />`
    );
  }

  const pageTitle = post.seo_title?.trim() || `${post.title} — SuweldoTools`;
  const metaDescription = post.meta_description?.trim() || post.excerpt;
  const safeImageUrl = sanitizeHttpUrl(post.featured_image_url);
  const absoluteImageUrl = safeImageUrl ? toAbsoluteSiteUrl(safeImageUrl) : null;
  const safeImageAlt = post.featured_image_alt?.trim() || post.title;

  const { iso: publishedIso, display: publishedDisplay } = formatPublishedDate(
    post.published_at,
    post.language
  );
  const { iso: updatedIso, display: updatedDisplay } = formatPublishedDate(
    post.updated_at || post.published_at,
    post.language
  );

  const defaultOgImageUrl = isTl
    ? `${SITE_ORIGIN}/og-image-tl.png`
    : `${SITE_ORIGIN}/og-image-en.png`;
  const defaultOgImageAlt = isTl
    ? 'SuweldoTools — Libreng Calculator ng Sahod sa Pilipinas 2026'
    : 'SuweldoTools — Free Philippine Salary and Payroll Calculators 2026';

  let ogImageTags: string;
  let twitterImageTags: string;

  if (absoluteImageUrl) {
    const escapedImg = escapeHtml(absoluteImageUrl);
    const escapedAlt = escapeHtml(safeImageAlt);
    ogImageTags = `\n    <meta property="og:image" content="${escapedImg}" />\n    <meta property="og:image:secure_url" content="${escapedImg}" />\n    <meta property="og:image:alt" content="${escapedAlt}" />`;
    twitterImageTags = `\n    <meta name="twitter:image" content="${escapedImg}" />\n    <meta name="twitter:image:alt" content="${escapedAlt}" />`;
  } else {
    const escapedDefaultImg = escapeHtml(defaultOgImageUrl);
    const escapedDefaultAlt = escapeHtml(defaultOgImageAlt);
    ogImageTags = `\n    <meta property="og:image" content="${escapedDefaultImg}" />\n    <meta property="og:image:secure_url" content="${escapedDefaultImg}" />\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />\n    <meta property="og:image:type" content="image/png" />\n    <meta property="og:image:alt" content="${escapedDefaultAlt}" />`;
    twitterImageTags = `\n    <meta name="twitter:image" content="${escapedDefaultImg}" />\n    <meta name="twitter:image:alt" content="${escapedDefaultAlt}" />`;
  }
  const ogAlternateLocaleTag = siblingPost
    ? `\n    <meta property="og:locale:alternate" content="${isTl ? 'en_PH' : 'tl_PH'}" />`
    : '';

  const customAuthorName = post.author_name?.trim() || '';
  const displayAuthorName = customAuthorName || 'SuweldoTools';
  const visibleBylineText = isTl ? `Ni ${displayAuthorName}` : `By ${displayAuthorName}`;
  const validFaqs = normalizePublishedFaqs(post.faqs);

  const blogPostingJsonLd: Record<string, unknown> = {
    '@type': 'BlogPosting',
    '@id': `${canonicalUrl}#article`,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
    headline: post.seo_title?.trim() || post.title,
    name: post.title,
    description: metaDescription,
    url: canonicalUrl,
    inLanguage: htmlLang,
    datePublished: publishedIso,
    dateModified: updatedIso,
    author: customAuthorName
      ? {
          '@type': 'Person',
          name: customAuthorName,
        }
      : {
          '@type': 'Organization',
          '@id': `${SITE_ORIGIN}/#organization`,
          name: 'SuweldoTools',
          url: `${SITE_ORIGIN}/`,
          sameAs: [
            'https://www.facebook.com/profile.php?id=61595908386922',
            'https://www.instagram.com/suweldotools/',
            'https://www.youtube.com/@suweldotools',
          ],
        },
    publisher: {
      '@type': 'Organization',
      '@id': `${SITE_ORIGIN}/#organization`,
      name: 'SuweldoTools',
      url: `${SITE_ORIGIN}/`,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_ORIGIN}/apple-touch-icon.png`,
      },
      sameAs: [
        'https://www.facebook.com/profile.php?id=61595908386922',
        'https://www.instagram.com/suweldotools/',
        'https://www.youtube.com/@suweldotools',
      ],
    },
    isPartOf: {
      '@type': 'Blog',
      '@id': `${blogIndexUrl}#blog`,
      name: isTl
        ? 'SuweldoTools Blog ng Sahod at Payroll sa Pilipinas'
        : 'SuweldoTools Philippine Payroll & Salary Guides Blog',
      url: blogIndexUrl,
    },
  };

  if (absoluteImageUrl) {
    blogPostingJsonLd.image = {
      '@type': 'ImageObject',
      url: absoluteImageUrl,
      caption: safeImageAlt,
    };
  }

  if (siblingPost) {
    const siblingUrl = isTl
      ? `${SITE_ORIGIN}/blog/${siblingPost.slug}/`
      : `${SITE_ORIGIN}/tl/blog/${siblingPost.slug}/`;
    blogPostingJsonLd.workTranslation = {
      '@type': 'BlogPosting',
      '@id': `${siblingUrl}#article`,
      url: siblingUrl,
      inLanguage: isTl ? 'en-PH' : 'tl-PH',
    };
  }

  const jsonLdGraphItems: Array<Record<string, unknown>> = [
    blogPostingJsonLd,
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonicalUrl}#breadcrumb`,
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: homeUrl,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Blog',
          item: blogIndexUrl,
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: post.title,
          item: canonicalUrl,
        },
      ],
    },
  ];

  if (validFaqs.length > 0) {
    jsonLdGraphItems.push({
      '@type': 'FAQPage',
      '@id': `${canonicalUrl}#faq`,
      inLanguage: htmlLang,
      mainEntity: validFaqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    });
  }

  const jsonLdGraph = {
    '@context': 'https://schema.org',
    '@graph': jsonLdGraphItems,
  };

  const renderedBodyHtml = renderSafeArticleContent(post.content);

  const faqHeadingText = isTl
    ? 'Mga Madalas Itanong (FAQ)'
    : 'Frequently Asked Questions (FAQs)';

  const faqSectionHtml =
    validFaqs.length > 0
      ? `        <section aria-labelledby="article-faq-heading" class="mt-10 pt-8 border-t border-slate-200 space-y-4">
          <h2 id="article-faq-heading" class="text-xl sm:text-2xl font-bold text-slate-900">
            ${escapeHtml(faqHeadingText)}
          </h2>
          <div class="space-y-3">
${validFaqs
  .map(
    (faq) => `            <details class="group rounded-xl border border-slate-200 bg-slate-50/70 open:bg-white transition">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-sm sm:text-base font-semibold text-slate-900 select-none">
                <span>${escapeHtml(faq.question)}</span>
                <span class="text-emerald-700 transition-transform group-open:rotate-180 shrink-0" aria-hidden="true">&#9662;</span>
              </summary>
              <div class="px-4 sm:px-5 pb-4 pt-1 text-sm sm:text-base text-slate-600 leading-relaxed border-t border-slate-100">
                <p class="whitespace-pre-line">${escapeHtml(faq.answer)}</p>
              </div>
            </details>`
  )
  .join('\n')}
          </div>
        </section>\n\n`
      : '';

  const featuredImageFigureHtml = safeImageUrl
    ? `          <figure class="my-6 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            <img
              src="${escapeHtml(safeImageUrl)}"
              alt="${escapeHtml(safeImageAlt)}"
              width="960"
              height="540"
              class="w-full h-auto max-h-[460px] object-cover"
            />
          </figure>`
    : '';

  if (isTl) {
    const translationBannerHtml = siblingPost
      ? `            <div class="inline-flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
              <span class="font-semibold text-slate-700">Available in English:</span>
              <a href="${escapeHtml(enTargetPath)}" lang="en-PH" class="font-bold text-emerald-700 hover:underline inline-flex items-center gap-1">
                <span>${escapeHtml(siblingPost.title)}</span>
                <span aria-hidden="true">&rarr;</span>
              </a>
            </div>`
      : `            <div class="inline-flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
              <span>Naghahanap ng mga gabay sa Ingles?</span>
              <a href="/blog/" lang="en-PH" class="font-bold text-emerald-700 hover:underline inline-flex items-center gap-1">
                <span>Tingnan ang English Blog (/blog/)</span>
                <span aria-hidden="true">&rarr;</span>
              </a>
            </div>`;

    return `<!doctype html>
${GENERATOR_OWNERSHIP_MARKER}
<html lang="tl-PH" class="h-full bg-slate-50 text-slate-900">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="google" content="notranslate" />
    <title>${escapeHtml(pageTitle)}</title>
    <meta
      name="description"
      content="${escapeHtml(metaDescription)}"
    />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
${hreflangLines.join('\n')}

    <!-- Favicon & App Icons -->
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

    <!-- Open Graph Metadata -->
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:site_name" content="SuweldoTools" />
    <meta property="og:title" content="${escapeHtml(pageTitle)}" />
    <meta
      property="og:description"
      content="${escapeHtml(metaDescription)}"
    />
    <meta property="og:locale" content="${ogLocale}" />${ogAlternateLocaleTag}
    <meta property="article:published_time" content="${escapeHtml(publishedIso)}" />
    <meta property="article:modified_time" content="${escapeHtml(updatedIso)}" />${ogImageTags}

    <!-- Twitter Card Metadata -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
    <meta
      name="twitter:description"
      content="${escapeHtml(metaDescription)}"
    />${twitterImageTags}

    <!-- Stylesheet -->
    <link rel="stylesheet" href="/src/index.css" />

    <!-- Schema.org JSON-LD Structured Data -->
    <script type="application/ld+json">
${serializeJsonLd(jsonLdGraph, 6)}
    </script>

    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-E3Z696ZY0J"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('set', 'allow_google_signals', false);
      gtag('set', 'allow_ad_personalization_signals', false);
      gtag('config', 'G-E3Z696ZY0J');
    </script>
  </head>
  <body class="min-h-full flex flex-col font-sans antialiased text-slate-800 bg-slate-50 selection:bg-emerald-100 selection:text-emerald-900">
    <!-- Header / Navigation Bar -->
    <header class="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-3 sm:px-4 lg:px-4 xl:px-8 gap-2 sm:gap-3 xl:gap-4">
        <a href="/tl/" class="flex items-center gap-2 sm:gap-2.5 group min-w-0 shrink-0">
          <img
            src="/assets/aistudio/suweldotools-logo-icon_7c91e4ab.svg"
            alt="SuweldoTools logo"
            width="36"
            height="36"
            class="h-8 w-8 sm:h-9 sm:w-9 shrink-0 object-contain rounded-lg shadow-xs group-hover:opacity-95 transition"
          />
          <div class="flex flex-col min-w-0">
            <span class="text-base sm:text-lg font-bold tracking-tight text-slate-900 group-hover:text-emerald-700 transition leading-tight truncate">SuweldoTools</span>
            <span class="hidden min-[360px]:block text-[9px] sm:text-[10px] uppercase font-semibold tracking-tight sm:tracking-wider text-slate-500 leading-tight truncate">Philippines Payroll Utilities</span>
          </div>
        </a>

        <!-- Desktop Navigation (Hidden on all viewports for Filipino language) -->
        <nav aria-label="Pangunahing nabigasyon" class="hidden">
          <a href="/tl/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            Home
          </a>
          <a href="/tl/take-home-pay-calculator-philippines/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            Take-Home Pay
          </a>
          <a href="/tl/13th-month-pay-calculator/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            13th Month Pay
          </a>
          <a href="/tl/sss-contribution-table-2026/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            Talahanayan ng SSS 2026
          </a>
          <a href="/tl/philhealth-contribution-calculator/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            PhilHealth Contribution Calculator
          </a>
          <a href="/tl/blog/" class="py-1 text-emerald-600 font-semibold border-b-2 border-emerald-600 whitespace-nowrap" aria-current="page">
            Blog
          </a>
          <a href="/tl/about/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            Tungkol sa Amin
          </a>
          <a href="/tl/contact/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            Makipag-ugnayan
          </a>
        </nav>

        <!-- Desktop Language Selector (Hidden on all viewports for Filipino language) -->
        <div role="group" aria-label="Pagpili ng wika" translate="no" class="hidden">
          <a
            href="${escapeHtml(enTargetPath)}"
            data-lang-switch="en"
            lang="en-PH"
            aria-label="Lumipat sa wikang Ingles"
            class="px-2 xl:px-2.5 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition whitespace-nowrap"
          >
            English
          </a>
          <a
            href="${escapeHtml(tlTargetPath)}"
            data-lang-switch="tl"
            aria-current="page"
            aria-label="Kasalukuyang wika: Filipino"
            class="px-2 xl:px-2.5 py-1 rounded-lg bg-white text-emerald-700 shadow-2xs transition whitespace-nowrap"
          >
            Filipino
          </a>
        </div>

        <!-- Filipino Navigation Controls: Compact Language Switcher + Hamburger Button -->
        <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div role="group" aria-label="Pagpili ng wika" translate="no" class="inline-flex items-center rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 text-[11px] font-bold">
            <a
              href="${escapeHtml(enTargetPath)}"
              data-lang-switch="en"
              lang="en-PH"
              aria-label="Lumipat sa wikang Ingles"
              class="inline-flex min-h-[36px] min-w-[36px] items-center justify-center px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-emerald-700 transition"
            >
              EN
            </a>
            <a
              href="${escapeHtml(tlTargetPath)}"
              data-lang-switch="tl"
              aria-current="page"
              aria-label="Kasalukuyang wika: Filipino"
              class="inline-flex min-h-[36px] min-w-[36px] items-center justify-center px-2.5 py-1.5 rounded-lg bg-white text-emerald-700 shadow-2xs"
            >
              FIL
            </a>
          </div>

          <button
            type="button"
            id="mobile-menu-btn"
            data-mobile-menu-toggle
            aria-expanded="false"
            aria-controls="mobileNavigationPanel"
            aria-label="Buksan ang menu ng nabigasyon"
            class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-emerald-700 transition cursor-pointer"
          >
            <svg id="mobile-menu-icon-open" data-menu-icon="open" data-mobile-menu-open-icon class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <svg id="mobile-menu-icon-close" data-menu-icon="close" data-mobile-menu-close-icon class="hidden h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Mobile Navigation Backdrop Overlay -->
      <div
        id="mobileMenuBackdrop"
        data-mobile-menu-backdrop
        class="hidden fixed inset-0 top-16 bg-slate-900/40 backdrop-blur-xs z-40"
        aria-hidden="true"
      ></div>

      <!-- Mobile Navigation Panel -->
      <nav
        id="mobileNavigationPanel"
        data-mobile-menu
        aria-label="Mobile nabigasyon"
        class="hidden fixed inset-x-0 top-16 z-50 bg-white border-b border-slate-200 shadow-xl max-h-[calc(100vh-4rem)] max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain px-4 pt-3 pb-5 transition-all duration-200 ease-out"
      >
        <!-- Mobile Language Selector -->
        <div class="mb-3 pb-3 border-b border-slate-100">
          <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 px-1">
            Wika / Language
          </span>
          <div role="group" aria-label="Piliin ang wika" translate="no" class="grid grid-cols-2 gap-2">
            <a
              href="${escapeHtml(enTargetPath)}"
              data-lang-switch="en"
              lang="en-PH"
              class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200/80 transition"
            >
              <span>English</span>
            </a>
            <a
              href="${escapeHtml(tlTargetPath)}"
              data-lang-switch="tl"
              aria-current="page"
              class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold bg-emerald-600 text-white shadow-2xs transition"
            >
              <span>Filipino (Tagalog)</span>
              <span class="text-[10px] opacity-90">&#10003;</span>
            </a>
          </div>
        </div>

        <div class="flex flex-col space-y-1">
          <a
            href="/tl/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>Home</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/tl/take-home-pay-calculator-philippines/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>Take-Home Pay</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/tl/13th-month-pay-calculator/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>13th Month Pay</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/tl/sss-contribution-table-2026/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>Talahanayan ng SSS 2026</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/tl/philhealth-contribution-calculator/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>PhilHealth Contribution Calculator</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/tl/blog/"
            aria-current="page"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 transition"
          >
            <span>Blog</span>
            <span class="text-xs font-semibold text-emerald-600">Aktibo</span>
          </a>
          <a
            href="/tl/about/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>Tungkol sa Amin</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/tl/contact/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>Makipag-ugnayan</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
        </div>
      </nav>
    </header>

    <!-- Main Content Container -->
    <main class="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12 space-y-8 sm:space-y-10">
      <!-- Breadcrumbs -->
      <nav aria-label="Landas ng pahina">
        <ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-slate-500">
          <li>
            <a href="/tl/" class="hover:text-emerald-600 transition">Home</a>
          </li>
          <li class="text-slate-400">/</li>
          <li>
            <a href="/tl/blog/" class="hover:text-emerald-600 transition">Blog</a>
          </li>
          <li class="text-slate-400">/</li>
          <li class="font-medium text-slate-800 truncate max-w-[260px] sm:max-w-md" aria-current="page">${escapeHtml(post.title)}</li>
        </ol>
      </nav>

      <!-- Article Container -->
      <article class="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 md:p-10 shadow-2xs max-w-4xl mx-auto">
        <header class="space-y-4 pb-6 border-b border-slate-200">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span class="font-semibold uppercase tracking-wider text-emerald-700">Gabay sa Payroll</span>
              <span aria-hidden="true">&middot;</span>
              <time datetime="${escapeHtml(publishedIso)}">${escapeHtml(publishedDisplay)}</time>
              <span aria-hidden="true">&middot;</span>
              <span class="font-medium text-slate-700">${escapeHtml(visibleBylineText)}</span>
            </div>
${translationBannerHtml}
          </div>

          <h1 class="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
            ${escapeHtml(post.title)}
          </h1>

          <p class="text-base sm:text-lg text-slate-600 leading-relaxed">
            ${escapeHtml(post.excerpt)}
          </p>
        </header>

${featuredImageFigureHtml ? `${featuredImageFigureHtml}\n` : ''}        <div class="prose prose-slate max-w-none pt-4">
            ${renderedBodyHtml}
        </div>

${faqSectionHtml}        <footer class="mt-10 pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs text-slate-500">
          <div>
            <span>Huling na-update: <time datetime="${escapeHtml(updatedIso)}">${escapeHtml(updatedDisplay)}</time></span>
          </div>
          <a
            href="/tl/blog/"
            class="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:underline"
          >
            <span aria-hidden="true">&larr;</span>
            <span>Bumalik sa Lahat ng Artikulo sa Blog</span>
          </a>
        </footer>
      </article>

      <!-- Quick Links to Live Calculators -->
      <section aria-labelledby="blog-calculators-heading" class="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-2xs space-y-5">
        <div>
          <h2 id="blog-calculators-heading" class="text-base sm:text-lg font-bold text-slate-900">
            Gamitin ang Aming Libreng 2026 Philippine Payroll Calculators
          </h2>
          <p class="text-xs sm:text-sm text-slate-600 mt-1">
            Kailangan mo bang kuwentahin agad ang iyong sahod o kaltas? Piliin ang naaangkop na calculator sa ibaba.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <a
            href="/tl/take-home-pay-calculator-philippines/"
            class="group rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:bg-emerald-50/30 transition flex flex-col justify-between"
          >
            <div>
              <h3 class="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition">
                Take-Home Pay Calculator
              </h3>
              <p class="text-xs text-slate-600 mt-1 leading-relaxed">
                Kuwentahin ang buwanan at kinsenas na net pay matapos ang kaltas sa SSS, PhilHealth, Pag-IBIG, at BIR tax.
              </p>
            </div>
            <span class="mt-3 text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
              Kuwentahin ang Sahod &rarr;
            </span>
          </a>

          <a
            href="/tl/13th-month-pay-calculator/"
            class="group rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:bg-emerald-50/30 transition flex flex-col justify-between"
          >
            <div>
              <h3 class="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition">
                13th Month Pay Calculator
              </h3>
              <p class="text-xs text-slate-600 mt-1 leading-relaxed">
                Alamin ang iyong 13th month pay sa ilalim ng PD 851 at ang ₱90,000 BIR tax-exempt limit.
              </p>
            </div>
            <span class="mt-3 text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
              Kuwentahin ang 13th Month &rarr;
            </span>
          </a>

          <a
            href="/tl/sss-contribution-table-2026/"
            class="group rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:bg-emerald-50/30 transition flex flex-col justify-between"
          >
            <div>
              <h3 class="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition">
                Talahanayan ng SSS 2026
              </h3>
              <p class="text-xs text-slate-600 mt-1 leading-relaxed">
                Hanapin ang iyong Monthly Salary Credit (MSC), bahagi ng empleyado at employer, at WISP.
              </p>
            </div>
            <span class="mt-3 text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
              Tingnan ang SSS Table &rarr;
            </span>
          </a>

          <a
            href="/tl/philhealth-contribution-calculator/"
            class="group rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:bg-emerald-50/30 transition flex flex-col justify-between"
          >
            <div>
              <h3 class="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition">
                PhilHealth Calculator
              </h3>
              <p class="text-xs text-slate-600 mt-1 leading-relaxed">
                Kuwentahin ang 5% PhilHealth premium rate at ang 50/50 na hatian ng empleyado at employer.
              </p>
            </div>
            <span class="mt-3 text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
              Kuwentahin ang PhilHealth &rarr;
            </span>
          </a>
        </div>
      </section>
    </main>

    <!-- Footer Component -->
    <footer class="mt-12 sm:mt-16 border-t border-slate-200 bg-white text-slate-600 text-sm">
      <div class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div class="grid grid-cols-2 md:grid-cols-12 gap-x-6 gap-y-6 lg:gap-x-8 pb-8 border-b border-slate-100">
          <!-- Brand Section -->
          <div class="col-span-2 md:col-span-5 space-y-3">
            <a href="/tl/" class="inline-flex items-center gap-2.5 group rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">
              <img
                src="/assets/aistudio/suweldotools-logo-icon_7c91e4ab.svg"
                alt="SuweldoTools logo"
                width="32" height="32" class="h-8 w-8 shrink-0 object-contain rounded-md"
              />
              <span class="font-bold text-slate-900 text-base group-hover:text-emerald-700 transition">SuweldoTools</span>
            </a>
            <p class="text-xs sm:text-sm text-slate-500 max-w-sm leading-relaxed mt-1">
              Mabilis, tumpak, at mobile-friendly na mga salary tool at statutory contribution calculators para sa mga empleyadong Pilipino, freelancer, at HR professionals.
            </p>
            <p class="text-xs text-slate-400">
              Domain: <a href="https://suweldotools.com/tl/" class="text-slate-500 hover:text-emerald-700 hover:underline transition rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">suweldotools.com</a>
            </p>
          </div>

          <!-- Tools Section -->
          <div class="col-span-1 md:col-span-3 space-y-3">
            <p class="font-bold text-xs uppercase tracking-wider text-slate-900">Salary Tools</p>
            <ul class="space-y-2.5 text-xs sm:text-sm">
              <li>
                <a href="/tl/take-home-pay-calculator-philippines/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">Take-Home Pay Calculator</a>
              </li>
              <li>
                <a href="/tl/13th-month-pay-calculator/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">13th Month Pay Calculator</a>
              </li>
              <li>
                <a href="/tl/sss-contribution-table-2026/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">Talahanayan ng SSS 2026</a>
              </li>
              <li>
                <a href="/tl/philhealth-contribution-calculator/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">PhilHealth Contribution Calculator</a>
              </li>
            </ul>
          </div>

          <!-- Company Section -->
          <div class="col-span-1 md:col-span-2 space-y-3">
            <p class="font-bold text-xs uppercase tracking-wider text-slate-900">Kumpanya</p>
            <ul class="space-y-2.5 text-xs sm:text-sm">
              <li>
                <a href="/tl/blog/" class="text-emerald-700 font-semibold hover:underline transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1" aria-current="page">Blog</a>
              </li>
              <li>
                <a href="/tl/about/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">Tungkol sa Amin</a>
              </li>
              <li>
                <a href="/tl/contact/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">Makipag-ugnayan</a>
              </li>
            </ul>
          </div>

          <!-- Legal Section -->
          <div class="col-span-2 md:col-span-2 space-y-3">
            <p class="font-bold text-xs uppercase tracking-wider text-slate-900">Legal</p>
            <ul class="space-y-2.5 text-xs sm:text-sm">
              <li>
                <a href="/tl/privacy-policy/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">Patakaran sa Privacy</a>
              </li>
              <li>
                <a href="/tl/disclaimer/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">Disclaimer</a>
              </li>
            </ul>
          </div>
        </div>

                <!-- Follow Us Section -->
        <div class="py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p class="font-bold text-xs uppercase tracking-wider text-slate-900">Follow Us</p>
          <div class="flex items-center gap-2.5">
            <a
              href="https://www.facebook.com/profile.php?id=61595908386922"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1877F2] text-white shadow-xs transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-[#166fe5] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2] focus-visible:ring-offset-2"
              aria-label="Follow SuweldoTools on Facebook"
            >
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
              </svg>
            </a>
            <a
              href="https://www.instagram.com/suweldotools/"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-white shadow-xs transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:opacity-95 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dc2743] focus-visible:ring-offset-2"
              aria-label="Follow SuweldoTools on Instagram"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
              </svg>
            </a>
            <a
              href="https://www.youtube.com/@suweldotools"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FF0000] text-white shadow-xs transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-[#e60000] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF0000] focus-visible:ring-offset-2"
              aria-label="Subscribe to SuweldoTools on YouTube"
            >
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            </a>
            <a
              href="https://pin.it/4fRe9WNxE"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E60023] text-white shadow-xs transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-[#cc001f] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E60023] focus-visible:ring-offset-2"
              aria-label="Follow SuweldoTools on Pinterest"
            >
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 384 512" aria-hidden="true">
                <path d="M204 6.5C101.4 6.5 0 74.9 0 185.6C0 256 39.6 296 63.6 296c9.9 0 15.6-27.6 15.6-35.4c0-9.3-23.7-29.1-23.7-67.8c0-80.4 61.2-137.4 140.4-137.4c68.1 0 118.5 38.7 118.5 109.8c0 53.1-21.3 152.7-90.3 152.7c-24.9 0-46.2-18-46.2-43.8c0-37.8 26.4-74.4 26.4-113.4c0-66.2-93.9-54.2-93.9 25.8c0 16.8 2.1 35.4 9.6 50.7c-13.8 59.4-42 147.9-42 209.1c0 18.9 2.7 37.5 4.5 56.4c3.4 3.8 1.7 3.4 6.9 1.5c50.4-69 48.6-82.5 71.4-172.8c12.3 23.4 44.1 36 69.3 36c106.2 0 153.9-103.5 153.9-196.8C384 71.3 298.2 6.5 204 6.5" />
              </svg>
            </a>
          </div>
        </div>

        <div class="pt-5 text-center sm:text-left text-xs text-slate-500">
          <p>&copy; 2026 SuweldoTools. All rights reserved.</p>
        </div>
      </div>
    </footer>

    <!-- Mobile Navigation Script -->
    <script src="/js/mobile-nav.js" defer></script>
    <script type="module" src="/src/announcement-popup.ts"></script>
  </body>
</html>
`;
  }

  // English Article Page Template
  const translationBannerHtml = siblingPost
    ? `            <div class="inline-flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
              <span class="font-semibold text-slate-700">Basahin sa Filipino:</span>
              <a href="${escapeHtml(tlTargetPath)}" lang="tl-PH" class="font-bold text-emerald-700 hover:underline inline-flex items-center gap-1">
                <span>${escapeHtml(siblingPost.title)}</span>
                <span aria-hidden="true">&rarr;</span>
              </a>
            </div>`
    : `            <div class="inline-flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
              <span>Looking for Filipino guides?</span>
              <a href="/tl/blog/" lang="tl-PH" class="font-bold text-emerald-700 hover:underline inline-flex items-center gap-1">
                <span>View Filipino Blog (/tl/blog/)</span>
                <span aria-hidden="true">&rarr;</span>
              </a>
            </div>`;

  return `<!doctype html>
${GENERATOR_OWNERSHIP_MARKER}
<html lang="en-PH" class="h-full bg-slate-50 text-slate-900">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="google" content="notranslate" />
    <title>${escapeHtml(pageTitle)}</title>
    <meta
      name="description"
      content="${escapeHtml(metaDescription)}"
    />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
${hreflangLines.join('\n')}

    <!-- Favicon & App Icons -->
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

    <!-- Open Graph Metadata -->
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:site_name" content="SuweldoTools" />
    <meta property="og:title" content="${escapeHtml(pageTitle)}" />
    <meta
      property="og:description"
      content="${escapeHtml(metaDescription)}"
    />
    <meta property="og:locale" content="${ogLocale}" />${ogAlternateLocaleTag}
    <meta property="article:published_time" content="${escapeHtml(publishedIso)}" />
    <meta property="article:modified_time" content="${escapeHtml(updatedIso)}" />${ogImageTags}

    <!-- Twitter Card Metadata -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
    <meta
      name="twitter:description"
      content="${escapeHtml(metaDescription)}"
    />${twitterImageTags}

    <!-- Stylesheet -->
    <link rel="stylesheet" href="/src/index.css" />

    <!-- Schema.org JSON-LD Structured Data -->
    <script type="application/ld+json">
${serializeJsonLd(jsonLdGraph, 6)}
    </script>

    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-E3Z696ZY0J"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('set', 'allow_google_signals', false);
      gtag('set', 'allow_ad_personalization_signals', false);
      gtag('config', 'G-E3Z696ZY0J');
    </script>
  </head>
  <body class="min-h-full flex flex-col font-sans antialiased text-slate-800 bg-slate-50 selection:bg-emerald-100 selection:text-emerald-900">
    <!-- Header / Navigation Bar -->
    <header class="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-3 sm:px-4 lg:px-4 xl:px-8 gap-2 sm:gap-3 xl:gap-4">
        <a href="/" class="flex items-center gap-2 sm:gap-2.5 group min-w-0 shrink-0">
          <img
            src="/assets/aistudio/suweldotools-logo-icon_7c91e4ab.svg"
            alt="SuweldoTools logo"
            width="36"
            height="36"
            class="h-8 w-8 sm:h-9 sm:w-9 shrink-0 object-contain rounded-lg shadow-xs group-hover:opacity-95 transition"
          />
          <div class="flex flex-col min-w-0">
            <span class="text-base sm:text-lg font-bold tracking-tight text-slate-900 group-hover:text-emerald-700 transition leading-tight truncate">SuweldoTools</span>
            <span class="hidden min-[360px]:block text-[9px] sm:text-[10px] uppercase font-semibold tracking-tight sm:tracking-wider text-slate-500 leading-tight truncate">Philippines Payroll Utilities</span>
          </div>
        </a>

        <!-- Desktop Navigation (Hidden on all viewports) -->
        <nav aria-label="Main navigation" class="hidden">
          <a href="/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            Home
          </a>
          <a href="/take-home-pay-calculator-philippines/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            Take-Home Pay
          </a>
          <a href="/13th-month-pay-calculator/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            13th Month Pay
          </a>
          <a href="/sss-contribution-table-2026/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            SSS Table 2026
          </a>
          <a href="/philhealth-contribution-calculator/" class="text-[11px] lg:text-xs xl:text-[13px] tracking-tight py-1 hover:text-emerald-600 transition whitespace-nowrap">
            PhilHealth Contribution Calculator
          </a>
          <a href="/blog/" class="py-1 text-emerald-600 font-semibold border-b-2 border-emerald-600 whitespace-nowrap" aria-current="page">
            Blog
          </a>
          <a href="/about/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            About
          </a>
          <a href="/contact/" class="py-1 hover:text-emerald-600 transition whitespace-nowrap">
            Contact
          </a>
        </nav>

        <!-- Desktop Language Selector (Hidden on all viewports) -->
        <div role="group" aria-label="Language selector" translate="no" class="hidden">
          <a
            href="${escapeHtml(enTargetPath)}"
            data-lang-switch="en"
            aria-current="page"
            aria-label="Current language: English"
            class="px-2 xl:px-2.5 py-1 rounded-lg bg-white text-emerald-700 shadow-2xs transition whitespace-nowrap"
          >
            English
          </a>
          <a
            href="${escapeHtml(tlTargetPath)}"
            data-lang-switch="tl"
            lang="tl-PH"
            aria-label="Switch language to Filipino"
            class="px-2 xl:px-2.5 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition whitespace-nowrap"
          >
            Filipino
          </a>
        </div>

        <!-- English Navigation Controls: Compact Language Switcher + Hamburger Button -->
        <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div role="group" aria-label="Language selector" translate="no" class="inline-flex items-center rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 text-[11px] font-bold">
            <a
              href="${escapeHtml(enTargetPath)}"
              data-lang-switch="en"
              aria-current="page"
              aria-label="Current language: English"
              class="inline-flex min-h-[36px] min-w-[36px] items-center justify-center px-2.5 py-1.5 rounded-lg bg-white text-emerald-700 shadow-2xs"
            >
              EN
            </a>
            <a
              href="${escapeHtml(tlTargetPath)}"
              data-lang-switch="tl"
              lang="tl-PH"
              aria-label="Switch language to Filipino"
              class="inline-flex min-h-[36px] min-w-[36px] items-center justify-center px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-emerald-700 transition"
            >
              FIL
            </a>
          </div>

          <button
            type="button"
            id="mobile-menu-btn"
            data-mobile-menu-toggle
            aria-expanded="false"
            aria-controls="mobileNavigationPanel"
            aria-label="Open navigation menu"
            class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-emerald-700 transition cursor-pointer"
          >
            <svg id="mobile-menu-icon-open" data-menu-icon="open" data-mobile-menu-open-icon class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <svg id="mobile-menu-icon-close" data-menu-icon="close" data-mobile-menu-close-icon class="hidden h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Mobile Navigation Backdrop Overlay -->
      <div
        id="mobileMenuBackdrop"
        data-mobile-menu-backdrop
        class="hidden fixed inset-0 top-16 bg-slate-900/40 backdrop-blur-xs z-40"
        aria-hidden="true"
      ></div>

      <!-- Mobile Navigation Panel -->
      <nav
        id="mobileNavigationPanel"
        data-mobile-menu
        aria-label="Navigation menu"
        class="hidden fixed inset-x-0 top-16 z-50 bg-white border-b border-slate-200 shadow-xl max-h-[calc(100vh-4rem)] max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain px-4 pt-3 pb-5 transition-all duration-200 ease-out"
      >
        <!-- Mobile Language Selector -->
        <div class="mb-3 pb-3 border-b border-slate-100">
          <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 px-1">
            Language / Wika
          </span>
          <div role="group" aria-label="Select language" translate="no" class="grid grid-cols-2 gap-2">
            <a
              href="${escapeHtml(enTargetPath)}"
              data-lang-switch="en"
              aria-current="page"
              class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold bg-emerald-600 text-white shadow-2xs transition"
            >
              <span>English</span>
              <span class="text-[10px] opacity-90">&#10003;</span>
            </a>
            <a
              href="${escapeHtml(tlTargetPath)}"
              data-lang-switch="tl"
              lang="tl-PH"
              class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200/80 transition"
            >
              <span>Filipino (Tagalog)</span>
            </a>
          </div>
        </div>

        <div class="flex flex-col space-y-1">
          <a
            href="/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>Home</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/take-home-pay-calculator-philippines/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>Take-Home Pay</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/13th-month-pay-calculator/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>13th Month Pay</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/sss-contribution-table-2026/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>SSS Table 2026</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/philhealth-contribution-calculator/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>PhilHealth Contribution Calculator</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/blog/"
            aria-current="page"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 transition"
          >
            <span>Blog</span>
            <span class="text-xs font-semibold text-emerald-600">Active</span>
          </a>
          <a
            href="/about/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>About</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
          <a
            href="/contact/"
            class="flex min-h-[44px] items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
          >
            <span>Contact</span>
            <span class="text-xs text-slate-400">&rarr;</span>
          </a>
        </div>
      </nav>
    </header>

    <!-- Main Content Container -->
    <main class="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12 space-y-8 sm:space-y-10">
      <!-- Breadcrumbs -->
      <nav aria-label="Breadcrumb">
        <ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-slate-500">
          <li>
            <a href="/" class="hover:text-emerald-600 transition">Home</a>
          </li>
          <li class="text-slate-400">/</li>
          <li>
            <a href="/blog/" class="hover:text-emerald-600 transition">Blog</a>
          </li>
          <li class="text-slate-400">/</li>
          <li class="font-medium text-slate-800 truncate max-w-[260px] sm:max-w-md" aria-current="page">${escapeHtml(post.title)}</li>
        </ol>
      </nav>

      <!-- Article Container -->
      <article class="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 md:p-10 shadow-2xs max-w-4xl mx-auto">
        <header class="space-y-4 pb-6 border-b border-slate-200">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span class="font-semibold uppercase tracking-wider text-emerald-700">Payroll Guide</span>
              <span aria-hidden="true">&middot;</span>
              <time datetime="${escapeHtml(publishedIso)}">${escapeHtml(publishedDisplay)}</time>
              <span aria-hidden="true">&middot;</span>
              <span class="font-medium text-slate-700">${escapeHtml(visibleBylineText)}</span>
            </div>
${translationBannerHtml}
          </div>

          <h1 class="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
            ${escapeHtml(post.title)}
          </h1>

          <p class="text-base sm:text-lg text-slate-600 leading-relaxed">
            ${escapeHtml(post.excerpt)}
          </p>
        </header>

${featuredImageFigureHtml ? `${featuredImageFigureHtml}\n` : ''}        <div class="prose prose-slate max-w-none pt-4">
            ${renderedBodyHtml}
        </div>

${faqSectionHtml}        <footer class="mt-10 pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs text-slate-500">
          <div>
            <span>Last updated: <time datetime="${escapeHtml(updatedIso)}">${escapeHtml(updatedDisplay)}</time></span>
          </div>
          <a
            href="/blog/"
            class="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:underline"
          >
            <span aria-hidden="true">&larr;</span>
            <span>Back to All Blog Articles</span>
          </a>
        </footer>
      </article>

      <!-- Quick Links to Live Calculators -->
      <section aria-labelledby="blog-calculators-heading" class="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-2xs space-y-5">
        <div>
          <h2 id="blog-calculators-heading" class="text-base sm:text-lg font-bold text-slate-900">
            Explore Our Free 2026 Philippine Payroll Calculators
          </h2>
          <p class="text-xs sm:text-sm text-slate-600 mt-1">
            Need an immediate computation? Use our verified, client-side calculators below.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <a
            href="/take-home-pay-calculator-philippines/"
            class="group rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:bg-emerald-50/30 transition flex flex-col justify-between"
          >
            <div>
              <h3 class="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition">
                Take-Home Pay Calculator
              </h3>
              <p class="text-xs text-slate-600 mt-1 leading-relaxed">
                Compute net monthly and semi-monthly pay after SSS, PhilHealth, Pag-IBIG, and BIR tax.
              </p>
            </div>
            <span class="mt-3 text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
              Calculate Net Pay &rarr;
            </span>
          </a>

          <a
            href="/13th-month-pay-calculator/"
            class="group rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:bg-emerald-50/30 transition flex flex-col justify-between"
          >
            <div>
              <h3 class="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition">
                13th Month Pay Calculator
              </h3>
              <p class="text-xs text-slate-600 mt-1 leading-relaxed">
                Compute mandatory PD 851 13th month pay and the ₱90,000 BIR tax-exempt threshold.
              </p>
            </div>
            <span class="mt-3 text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
              Calculate 13th Month &rarr;
            </span>
          </a>

          <a
            href="/sss-contribution-table-2026/"
            class="group rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:bg-emerald-50/30 transition flex flex-col justify-between"
          >
            <div>
              <h3 class="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition">
                SSS Contribution Table 2026
              </h3>
              <p class="text-xs text-slate-600 mt-1 leading-relaxed">
                Look up your Monthly Salary Credit (MSC), employee share, employer share, and WISP.
              </p>
            </div>
            <span class="mt-3 text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
              View SSS Table &rarr;
            </span>
          </a>

          <a
            href="/philhealth-contribution-calculator/"
            class="group rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:bg-emerald-50/30 transition flex flex-col justify-between"
          >
            <div>
              <h3 class="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition">
                PhilHealth Calculator
              </h3>
              <p class="text-xs text-slate-600 mt-1 leading-relaxed">
                Compute the 5% PhilHealth premium rate and 50/50 employee-employer split.
              </p>
            </div>
            <span class="mt-3 text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
              Calculate PhilHealth &rarr;
            </span>
          </a>
        </div>
      </section>
    </main>

    <!-- Footer Component -->
    <footer class="mt-12 sm:mt-16 border-t border-slate-200 bg-white text-slate-600 text-sm">
      <div class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div class="grid grid-cols-2 md:grid-cols-12 gap-x-6 gap-y-6 lg:gap-x-8 pb-8 border-b border-slate-100">
          <!-- Brand Section -->
          <div class="col-span-2 md:col-span-5 space-y-3">
            <a href="/" class="inline-flex items-center gap-2.5 group rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">
              <img
                src="/assets/aistudio/suweldotools-logo-icon_7c91e4ab.svg"
                alt="SuweldoTools logo"
                width="32" height="32" class="h-8 w-8 shrink-0 object-contain rounded-md"
              />
              <span class="font-bold text-slate-900 text-base group-hover:text-emerald-700 transition">SuweldoTools</span>
            </a>
            <p class="text-xs sm:text-sm text-slate-500 max-w-sm leading-relaxed mt-1">
              Fast, accurate, mobile-friendly salary tools and statutory contribution calculators for Filipino employees, freelancers, and HR professionals.
            </p>
            <p class="text-xs text-slate-400">
              Domain: <a href="https://suweldotools.com/" class="text-slate-500 hover:text-emerald-700 hover:underline transition rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">suweldotools.com</a>
            </p>
          </div>

          <!-- Tools Section -->
          <div class="col-span-1 md:col-span-3 space-y-3">
            <p class="font-bold text-xs uppercase tracking-wider text-slate-900">Salary Tools</p>
            <ul class="space-y-2.5 text-xs sm:text-sm">
              <li>
                <a href="/take-home-pay-calculator-philippines/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">Take-Home Pay Calculator</a>
              </li>
              <li>
                <a href="/13th-month-pay-calculator/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">13th Month Pay Calculator</a>
              </li>
              <li>
                <a href="/sss-contribution-table-2026/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">SSS Contribution Table 2026</a>
              </li>
              <li>
                <a href="/philhealth-contribution-calculator/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">PhilHealth Contribution Calculator</a>
              </li>
            </ul>
          </div>

          <!-- Company Section -->
          <div class="col-span-1 md:col-span-2 space-y-3">
            <p class="font-bold text-xs uppercase tracking-wider text-slate-900">Company</p>
            <ul class="space-y-2.5 text-xs sm:text-sm">
              <li>
                <a href="/blog/" class="text-emerald-700 font-semibold hover:underline transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1" aria-current="page">Blog</a>
              </li>
              <li>
                <a href="/about/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">About Us</a>
              </li>
              <li>
                <a href="/contact/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">Contact</a>
              </li>
            </ul>
          </div>

          <!-- Legal Section -->
          <div class="col-span-2 md:col-span-2 space-y-3">
            <p class="font-bold text-xs uppercase tracking-wider text-slate-900">Legal</p>
            <ul class="space-y-2.5 text-xs sm:text-sm">
              <li>
                <a href="/privacy-policy/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">Privacy Policy</a>
              </li>
              <li>
                <a href="/disclaimer/" class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">Disclaimer</a>
              </li>
            </ul>
          </div>
        </div>

                <!-- Follow Us Section -->
        <div class="py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p class="font-bold text-xs uppercase tracking-wider text-slate-900">Follow Us</p>
          <div class="flex items-center gap-2.5">
            <a
              href="https://www.facebook.com/profile.php?id=61595908386922"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1877F2] text-white shadow-xs transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-[#166fe5] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2] focus-visible:ring-offset-2"
              aria-label="Follow SuweldoTools on Facebook"
            >
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
              </svg>
            </a>
            <a
              href="https://www.instagram.com/suweldotools/"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-white shadow-xs transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:opacity-95 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dc2743] focus-visible:ring-offset-2"
              aria-label="Follow SuweldoTools on Instagram"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
              </svg>
            </a>
            <a
              href="https://www.youtube.com/@suweldotools"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FF0000] text-white shadow-xs transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-[#e60000] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF0000] focus-visible:ring-offset-2"
              aria-label="Subscribe to SuweldoTools on YouTube"
            >
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            </a>
            <a
              href="https://pin.it/4fRe9WNxE"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E60023] text-white shadow-xs transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-[#cc001f] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E60023] focus-visible:ring-offset-2"
              aria-label="Follow SuweldoTools on Pinterest"
            >
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 384 512" aria-hidden="true">
                <path d="M204 6.5C101.4 6.5 0 74.9 0 185.6C0 256 39.6 296 63.6 296c9.9 0 15.6-27.6 15.6-35.4c0-9.3-23.7-29.1-23.7-67.8c0-80.4 61.2-137.4 140.4-137.4c68.1 0 118.5 38.7 118.5 109.8c0 53.1-21.3 152.7-90.3 152.7c-24.9 0-46.2-18-46.2-43.8c0-37.8 26.4-74.4 26.4-113.4c0-66.2-93.9-54.2-93.9 25.8c0 16.8 2.1 35.4 9.6 50.7c-13.8 59.4-42 147.9-42 209.1c0 18.9 2.7 37.5 4.5 56.4c3.4 3.8 1.7 3.4 6.9 1.5c50.4-69 48.6-82.5 71.4-172.8c12.3 23.4 44.1 36 69.3 36c106.2 0 153.9-103.5 153.9-196.8C384 71.3 298.2 6.5 204 6.5" />
              </svg>
            </a>
          </div>
        </div>

        <div class="pt-5 text-center sm:text-left text-xs text-slate-500">
          <p>&copy; 2026 SuweldoTools. All rights reserved.</p>
        </div>
      </div>
    </footer>

    <!-- Mobile Navigation Script -->
    <script src="/js/mobile-nav.js" defer></script>
    <script type="module" src="/src/announcement-popup.ts"></script>
  </body>
</html>
`;
}

const BLOG_ARTICLE_LOC_REGEX =
  /^https:\/\/suweldotools\.com\/(?:tl\/)?blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/;

/**
 * Escapes values for safe inclusion in XML elements and attributes.
 */
export function escapeXml(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Formats an ISO timestamp into a YYYY-MM-DD sitemap lastmod date.
 */
export function formatSitemapLastmod(isoString: string | null | undefined): string {
  if (isoString) {
    const parsed = new Date(isoString);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Builds a single <url> XML block for a published blog article.
 * Includes reciprocal xhtml:link hreflang alternates ONLY when both English and Filipino translations are published.
 */
function buildSitemapArticleUrlBlock(
  post: PublishedBlogPost,
  groupMap: Map<string, { en?: PublishedBlogPost; tl?: PublishedBlogPost }>
): { xml: string; loc: string; usesXhtmlNamespace: boolean } {
  const isTl = post.language === 'tl';
  const loc = isTl
    ? `${SITE_ORIGIN}/tl/blog/${post.slug}/`
    : `${SITE_ORIGIN}/blog/${post.slug}/`;
  const lastmod = formatSitemapLastmod(post.updated_at || post.published_at);

  const pair = post.group_id ? groupMap.get(post.group_id) : undefined;
  const hasPublishedPair = Boolean(pair?.en && pair?.tl);

  const alternateLines: string[] = [];
  if (hasPublishedPair && pair?.en && pair?.tl) {
    const enUrl = `${SITE_ORIGIN}/blog/${pair.en.slug}/`;
    const tlUrl = `${SITE_ORIGIN}/tl/blog/${pair.tl.slug}/`;
    alternateLines.push(
      `    <xhtml:link rel="alternate" hreflang="en-PH" href="${escapeXml(enUrl)}" />`,
      `    <xhtml:link rel="alternate" hreflang="tl-PH" href="${escapeXml(tlUrl)}" />`,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(enUrl)}" />`
    );
  }

  const lines = [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
    '    <changefreq>weekly</changefreq>',
    '    <priority>0.7</priority>',
    ...alternateLines,
    '  </url>',
  ];

  return {
    xml: lines.join('\n'),
    loc,
    usesXhtmlNamespace: hasPublishedPair,
  };
}

/**
 * Synchronizes /public/sitemap.xml with currently published blog articles while
 * preserving all non-blog and blog-index <url> entries untouched.
 */
export function buildSynchronizedSitemapXml(
  existingSitemapXml: string,
  enPosts: PublishedBlogPost[],
  tlPosts: PublishedBlogPost[],
  groupMap: Map<string, { en?: PublishedBlogPost; tl?: PublishedBlogPost }>
): string {
  const urlBlockRegex = /  <url>[\s\S]*?  <\/url>/g;
  const matchedBlocks = existingSitemapXml.match(urlBlockRegex) || [];

  const preservedBlocks: Array<{ loc: string; xml: string }> = [];
  const seenLocs = new Set<string>();
  let staticUsesXhtml = false;

  for (const block of matchedBlocks) {
    const locMatch = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/);
    const loc = locMatch ? locMatch[1].trim() : '';
    if (!loc) continue;

    // Strip any previously generated blog article URLs (/blog/{slug}/ or /tl/blog/{slug}/)
    if (BLOG_ARTICLE_LOC_REGEX.test(loc)) {
      continue;
    }

    if (seenLocs.has(loc)) continue;
    seenLocs.add(loc);
    if (block.includes('<xhtml:link')) {
      staticUsesXhtml = true;
    }
    preservedBlocks.push({ loc, xml: block });
  }

  let usesXhtmlNamespace = staticUsesXhtml;

  const enArticleBlocks: string[] = [];
  for (const post of enPosts) {
    const built = buildSitemapArticleUrlBlock(post, groupMap);
    if (seenLocs.has(built.loc)) continue;
    seenLocs.add(built.loc);
    if (built.usesXhtmlNamespace) usesXhtmlNamespace = true;
    enArticleBlocks.push(built.xml);
  }

  const tlArticleBlocks: string[] = [];
  for (const post of tlPosts) {
    const built = buildSitemapArticleUrlBlock(post, groupMap);
    if (seenLocs.has(built.loc)) continue;
    seenLocs.add(built.loc);
    if (built.usesXhtmlNamespace) usesXhtmlNamespace = true;
    tlArticleBlocks.push(built.xml);
  }

  const finalBlocks: string[] = [];
  let insertedEnArticles = false;
  let insertedTlArticles = false;

  for (const item of preservedBlocks) {
    finalBlocks.push(item.xml);
    if (item.loc === `${SITE_ORIGIN}/blog/` && !insertedEnArticles) {
      finalBlocks.push(...enArticleBlocks);
      insertedEnArticles = true;
    } else if (item.loc === `${SITE_ORIGIN}/tl/blog/` && !insertedTlArticles) {
      finalBlocks.push(...tlArticleBlocks);
      insertedTlArticles = true;
    }
  }

  if (!insertedEnArticles && enArticleBlocks.length > 0) {
    finalBlocks.push(...enArticleBlocks);
  }
  if (!insertedTlArticles && tlArticleBlocks.length > 0) {
    finalBlocks.push(...tlArticleBlocks);
  }

  const urlsetOpenTag = usesXhtmlNamespace
    ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
    : '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

  return `<?xml version="1.0" encoding="UTF-8"?>\n${urlsetOpenTag}\n${finalBlocks.join('\n')}\n</urlset>\n`;
}

/**
 * Harmless OS metadata / cache file names to ignore when verifying directory cleanliness.
 */
const OS_METADATA_FILES = new Set([
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
  'ehthumbs.db',
]);

/**
 * Removes obsolete generated article directories inside /blog or /tl/blog ONLY when:
 * 1. The child entry is a directory with a valid slug name.
 * 2. Its slug is not in activeSlugs.
 * 3. It contains index.html with GENERATOR_OWNERSHIP_MARKER.
 * 4. It contains no custom user code or subdirectories (only index.html and optional OS metadata).
 */
export async function cleanupObsoleteGeneratedArticles(
  blogBaseDir: string,
  activeSlugs: Set<string>
): Promise<string[]> {
  const removedFiles: string[] = [];
  let dirEntries;
  try {
    dirEntries = await fs.readdir(blogBaseDir, { withFileTypes: true });
  } catch {
    return removedFiles;
  }

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;
    const slugDirName = entry.name;

    if (!VALID_SLUG_REGEX.test(slugDirName)) continue;
    if (activeSlugs.has(slugDirName)) continue;

    const slugDirPath = path.join(blogBaseDir, slugDirName);
    let innerEntries: string[];
    try {
      innerEntries = await fs.readdir(slugDirPath);
    } catch {
      continue;
    }

    // Must contain index.html
    if (!innerEntries.includes('index.html')) {
      continue;
    }

    // Safety: ignore known OS metadata files, but refuse to delete directories with custom user files
    const nonMetadataEntries = innerEntries.filter(
      (name) => name !== 'index.html' && !OS_METADATA_FILES.has(name.toLowerCase())
    );
    if (nonMetadataEntries.length > 0) {
      continue;
    }

    const indexPath = path.join(slugDirPath, 'index.html');
    try {
      const content = await fs.readFile(indexPath, 'utf8');
      if (!content.includes(GENERATOR_OWNERSHIP_MARKER)) {
        continue;
      }

      await fs.unlink(indexPath);

      // Remove any harmless OS metadata files if present so rmdir succeeds
      for (const metaFile of innerEntries) {
        if (metaFile !== 'index.html' && OS_METADATA_FILES.has(metaFile.toLowerCase())) {
          try {
            await fs.unlink(path.join(slugDirPath, metaFile));
          } catch {
            // Ignore OS metadata unlink error
          }
        }
      }

      try {
        await fs.rmdir(slugDirPath);
      } catch {
        try {
          await fs.rm(slugDirPath, { recursive: true, force: true });
        } catch {
          // Ignore directory rmdir failure
        }
      }

      removedFiles.push(path.relative(PROJECT_ROOT, indexPath));
    } catch {
      // Ignore cleanup errors on individual directories
    }
  }

  return removedFiles;
}

/**
 * Validates public Supabase environment configuration.
 */
function getPublicSupabaseConfig(): { url: string; anonKey: string } | null {
  const rawUrl = (process.env.VITE_SUPABASE_URL || '').trim();
  const rawKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!rawUrl || !rawKey) return null;
  if (rawUrl === PLACEHOLDER_URL || rawKey === PLACEHOLDER_ANON_KEY) return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) {
      return null;
    }
  } catch {
    return null;
  }

  // Ensure a service_role key was never accidentally supplied in VITE_SUPABASE_ANON_KEY
  if (rawKey.toLowerCase().includes('service_role')) {
    return null;
  }

  return { url: rawUrl, anonKey: rawKey };
}

/**
 * Main generator entry point: fetches published posts from Supabase and writes static HTML + sitemap.xml.
 */
export async function generatePublicBlog(): Promise<GenerateBlogResult> {
  const config = getPublicSupabaseConfig();
  if (!config) {
    const message =
      '[generate-blog] ERROR: Supabase public environment variables (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) are missing or invalid. Refusing to overwrite static blog files or proceed with a stale build.';
    console.error(message);
    return {
      status: 'skipped_unconfigured',
      enCount: 0,
      tlCount: 0,
      generatedFiles: [],
      removedFiles: [],
      message,
    };
  }

  const supabase = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const basePublishedColumns =
    'id, group_id, language, title, slug, excerpt, content, seo_title, meta_description, featured_image_url, featured_image_alt, published_at, created_at, updated_at';

  let { data, error } = await supabase
    .from('published_blog_posts')
    .select(`${basePublishedColumns}, author_name, faqs`)
    .order('published_at', { ascending: false })
    .order('created_at', { ascending: false });

  // Backward-compatible fallback if public.published_blog_posts has not yet been updated to expose author_name and faqs
  if (error && error.code === '42703') {
    console.warn(
      '[generate-blog] WARNING: public.published_blog_posts does not yet expose author_name/faqs (code 42703). Falling back to base columns until the view is updated.'
    );
    const fallbackResult = await supabase
      .from('published_blog_posts')
      .select(basePublishedColumns)
      .order('published_at', { ascending: false })
      .order('created_at', { ascending: false });
    data = fallbackResult.data as typeof data;
    error = fallbackResult.error;
  }

  if (error || !Array.isArray(data)) {
    const errMsg = error ? `${error.message} (code: ${error.code || 'unknown'})` : 'Invalid response';
    const message = `[generate-blog] ERROR: Failed to fetch published_blog_posts from Supabase: ${errMsg}. Refusing to overwrite static blog files or proceed with a stale build.`;
    console.error(message);
    return {
      status: 'skipped_error',
      enCount: 0,
      tlCount: 0,
      generatedFiles: [],
      removedFiles: [],
      message,
    };
  }

  // Filter and validate published posts
  const validPosts: PublishedBlogPost[] = [];
  for (const row of data as PublishedBlogPost[]) {
    if (!row || typeof row !== 'object') continue;
    if (row.language !== 'en' && row.language !== 'tl') continue;
    const slug = String(row.slug || '').trim();
    if (!VALID_SLUG_REGEX.test(slug)) {
      console.warn(`[generate-blog] Skipping post with invalid slug "${slug}" (id: ${row.id})`);
      continue;
    }
    const rawAuthor = typeof row.author_name === 'string' ? row.author_name.trim() : '';
    validPosts.push({
      ...row,
      slug,
      title: String(row.title || '').trim(),
      excerpt: String(row.excerpt || '').trim(),
      content: String(row.content || ''),
      author_name: rawAuthor ? rawAuthor : null,
      faqs: normalizePublishedFaqs(row.faqs),
    });
  }

  const enPosts = validPosts.filter((post) => post.language === 'en');
  const tlPosts = validPosts.filter((post) => post.language === 'tl');

  // Pair translations by group_id ONLY when both sibling translations are published
  const groupMap = new Map<string, { en?: PublishedBlogPost; tl?: PublishedBlogPost }>();
  for (const post of validPosts) {
    if (!post.group_id) continue;
    const groupEntry = groupMap.get(post.group_id) || {};
    if (post.language === 'en' && !groupEntry.en) {
      groupEntry.en = post;
    } else if (post.language === 'tl' && !groupEntry.tl) {
      groupEntry.tl = post;
    }
    groupMap.set(post.group_id, groupEntry);
  }

  const generatedFiles: string[] = [];

  // 1. Update /blog/index.html
  const enIndexPath = path.join(PROJECT_ROOT, 'blog', 'index.html');
  const enCurrentIndexHtml = await fs.readFile(enIndexPath, 'utf8');
  const enUpdatedIndexHtml = buildUpdatedListingHtml(enCurrentIndexHtml, enPosts, 'en');
  await fs.writeFile(enIndexPath, enUpdatedIndexHtml, 'utf8');
  generatedFiles.push(path.relative(PROJECT_ROOT, enIndexPath));

  // 2. Update /tl/blog/index.html
  const tlIndexPath = path.join(PROJECT_ROOT, 'tl', 'blog', 'index.html');
  const tlCurrentIndexHtml = await fs.readFile(tlIndexPath, 'utf8');
  const tlUpdatedIndexHtml = buildUpdatedListingHtml(tlCurrentIndexHtml, tlPosts, 'tl');
  await fs.writeFile(tlIndexPath, tlUpdatedIndexHtml, 'utf8');
  generatedFiles.push(path.relative(PROJECT_ROOT, tlIndexPath));

  // 3. Generate individual English article pages at /blog/{slug}/index.html
  const activeEnSlugs = new Set<string>();
  for (const post of enPosts) {
    activeEnSlugs.add(post.slug);
    const siblingTl = post.group_id ? groupMap.get(post.group_id)?.tl : undefined;
    const articleDir = path.join(PROJECT_ROOT, 'blog', post.slug);
    const articleFilePath = path.join(articleDir, 'index.html');

    // Protect hand-maintained files if a directory already exists without our ownership marker
    try {
      const existingContent = await fs.readFile(articleFilePath, 'utf8');
      if (!existingContent.includes(GENERATOR_OWNERSHIP_MARKER)) {
        console.warn(
          `[generate-blog] Skipping ${path.relative(PROJECT_ROOT, articleFilePath)} because an existing file without generator ownership marker was found.`
        );
        continue;
      }
    } catch {
      // File does not exist yet — safe to create
    }

    await fs.mkdir(articleDir, { recursive: true });
    const articleHtml = buildArticlePageHtml(post, siblingTl);
    await fs.writeFile(articleFilePath, articleHtml, 'utf8');
    generatedFiles.push(path.relative(PROJECT_ROOT, articleFilePath));
  }

  // 4. Generate individual Filipino article pages at /tl/blog/{slug}/index.html
  const activeTlSlugs = new Set<string>();
  for (const post of tlPosts) {
    activeTlSlugs.add(post.slug);
    const siblingEn = post.group_id ? groupMap.get(post.group_id)?.en : undefined;
    const articleDir = path.join(PROJECT_ROOT, 'tl', 'blog', post.slug);
    const articleFilePath = path.join(articleDir, 'index.html');

    try {
      const existingContent = await fs.readFile(articleFilePath, 'utf8');
      if (!existingContent.includes(GENERATOR_OWNERSHIP_MARKER)) {
        console.warn(
          `[generate-blog] Skipping ${path.relative(PROJECT_ROOT, articleFilePath)} because an existing file without generator ownership marker was found.`
        );
        continue;
      }
    } catch {
      // File does not exist yet — safe to create
    }

    await fs.mkdir(articleDir, { recursive: true });
    const articleHtml = buildArticlePageHtml(post, siblingEn);
    await fs.writeFile(articleFilePath, articleHtml, 'utf8');
    generatedFiles.push(path.relative(PROJECT_ROOT, articleFilePath));
  }

  // 5. Clean up obsolete generator-owned article pages
  const removedEn = await cleanupObsoleteGeneratedArticles(
    path.join(PROJECT_ROOT, 'blog'),
    activeEnSlugs
  );
  const removedTl = await cleanupObsoleteGeneratedArticles(
    path.join(PROJECT_ROOT, 'tl', 'blog'),
    activeTlSlugs
  );
  const removedFiles = [...removedEn, ...removedTl];

  // 6. Synchronize /public/sitemap.xml
  const sitemapPath = path.join(PROJECT_ROOT, 'public', 'sitemap.xml');
  const existingSitemapXml = await fs.readFile(sitemapPath, 'utf8');
  const updatedSitemapXml = buildSynchronizedSitemapXml(
    existingSitemapXml,
    enPosts,
    tlPosts,
    groupMap
  );
  await fs.writeFile(sitemapPath, updatedSitemapXml, 'utf8');
  generatedFiles.push(path.relative(PROJECT_ROOT, sitemapPath));

  const message = `[generate-blog] Completed: ${enPosts.length} English post(s), ${tlPosts.length} Filipino post(s) generated, sitemap.xml synchronized (${removedFiles.length} obsolete file(s) cleaned up).`;
  console.log(message);

  return {
    status: 'generated',
    enCount: enPosts.length,
    tlCount: tlPosts.length,
    generatedFiles,
    removedFiles,
    message,
  };
}

// Execute when invoked directly via CLI (`tsx scripts/generate-blog.ts`)
const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectExecution) {
  generatePublicBlog()
    .then((result) => {
      if (result.status !== 'generated') {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error('[generate-blog] Unexpected error:', err);
      process.exitCode = 1;
    });
}

