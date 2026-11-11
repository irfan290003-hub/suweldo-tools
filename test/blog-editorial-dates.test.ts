import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as htmlparser2 from 'htmlparser2';

import {
  buildBlogPostWritePayload,
  formatUtcIsoToManilaDateTimeLocal,
  normalizeBlogPostRecord,
  parseManilaDateTimeInputToUtcIso,
  resolveEditorialUpdateTimestamp,
  validateAndNormalizeWriteInput,
  type BlogPostWriteInput,
} from '../src/lib/supabase.ts';

import {
  buildArticlePageHtml,
  buildSynchronizedSitemapXml,
  buildUpdatedListingHtml,
  formatPublishedDate,
  formatSitemapLastmod,
  renderSafeArticleContent,
  resolveArticleEditorialDates,
  type PublishedBlogPost,
} from '../scripts/generate-blog.ts';

const require = createRequire(import.meta.url);

function setupTestDomEnvironment() {
  function createInertDocument(html: string) {
    const handlerDom = htmlparser2.parseDocument(html, {
      recognizeSelfClosing: true,
      lowerCaseTags: false,
    });

    function convert(hNode: any): any {
      if (hNode.type === 'text') {
        return {
          nodeType: 3,
          nodeValue: hNode.data,
          nextSibling: null,
        };
      }
      if (hNode.type === 'tag' || hNode.type === 'script' || hNode.type === 'style') {
        const el: any = {
          nodeType: 1,
          tagName: hNode.name.toUpperCase(),
          attributes: Object.entries(hNode.attribs || {}).map(([name, value]) => ({
            name,
            value: String(value),
          })),
          firstChild: null,
          nextSibling: null,
        };
        let prevChild: any = null;
        for (const childH of hNode.children || []) {
          const c = convert(childH);
          if (c) {
            if (!el.firstChild) el.firstChild = c;
            if (prevChild) prevChild.nextSibling = c;
            prevChild = c;
          }
        }
        return el;
      }
      return null;
    }

    const root: any = {
      nodeType: 1,
      tagName: 'BODY',
      firstChild: null,
    };
    let prev: any = null;
    for (const ch of handlerDom.children) {
      const c = convert(ch);
      if (c) {
        if (!root.firstChild) root.firstChild = c;
        if (prev) prev.nextSibling = c;
        prev = c;
      }
    }
    return { body: root };
  }

  function createCleanDoc() {
    function serialize(node: any): string {
      if (!node) return '';
      if (node.nodeType === 3) {
        return (node.nodeValue || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }
      if (node.nodeType === 11) {
        let s = '';
        let c = node.firstChild;
        while (c) {
          s += serialize(c);
          c = c.nextSibling;
        }
        return s;
      }
      if (node.nodeType === 1) {
        const tag = node.tagName.toLowerCase();
        let attrs = '';
        for (const a of node.attributes) {
          attrs += ' ' + a.name + '="' + a.value.replace(/"/g, '&quot;') + '"';
        }
        if (['br', 'hr', 'img'].includes(tag)) {
          return '<' + tag + attrs + ' />';
        }
        let inner = '';
        let c = node.firstChild;
        while (c) {
          inner += serialize(c);
          c = c.nextSibling;
        }
        return '<' + tag + attrs + '>' + inner + '</' + tag + '>';
      }
      return '';
    }

    const doc: any = {
      createElement(tagName: string) {
        const el: any = {
          nodeType: 1,
          tagName: tagName.toUpperCase(),
          attributes: [] as { name: string; value: string }[],
          firstChild: null,
          nextSibling: null,
          setAttribute(name: string, value: any) {
            const idx = this.attributes.findIndex(
              (a: any) => a.name.toLowerCase() === name.toLowerCase()
            );
            if (idx !== -1) {
              this.attributes[idx].value = String(value);
            } else {
              this.attributes.push({ name: name.toLowerCase(), value: String(value) });
            }
          },
          getAttribute(name: string) {
            const found = this.attributes.find(
              (a: any) => a.name.toLowerCase() === name.toLowerCase()
            );
            return found ? found.value : null;
          },
          appendChild(child: any) {
            if (!child) return child;
            if (child.nodeType === 11) {
              let c = child.firstChild;
              while (c) {
                const next = c.nextSibling;
                c.nextSibling = null;
                this.appendChild(c);
                c = next;
              }
              return child;
            }
            if (!this.firstChild) {
              this.firstChild = child;
            } else {
              let cur = this.firstChild;
              while (cur.nextSibling) cur = cur.nextSibling;
              cur.nextSibling = child;
            }
            child.nextSibling = null;
            return child;
          },
          get innerHTML() {
            let s = '';
            let c = this.firstChild;
            while (c) {
              s += serialize(c);
              c = c.nextSibling;
            }
            return s;
          },
        };
        return el;
      },
      createTextNode(val: any) {
        return {
          nodeType: 3,
          nodeValue: String(val),
          nextSibling: null,
        };
      },
      createDocumentFragment() {
        const frag = this.createElement('FRAGMENT');
        frag.nodeType = 11;
        return frag;
      },
    };
    return doc;
  }

  (globalThis as any).DOMParser = class {
    parseFromString(str: string) {
      return createInertDocument(str);
    }
  };

  (globalThis as any).document = {
    implementation: {
      createHTMLDocument() {
        return createCleanDoc();
      },
    },
  };
}

setupTestDomEnvironment();

const adminRenderer = require('../public/js/blog-admin.js') as {
  renderSafeAdminArticleContent: (content: string) => string;
  parseAdminManilaDateTimeToUtcIso: (rawInput: string) => {
    valid: boolean;
    utcIso: string | null;
    error: string | null;
  };
  formatUtcIsoToManilaInput: (isoString: string) => string;
  formatAdminPublicArticleDate: (isoString: string, language?: string) => string;
  resolveAdminPreviewEditorialDates: (params: {
    language?: string;
    firstPublishedAt?: string | null;
    publishedAt?: string | null;
    updatedAt?: string | null;
    updateDateMode?: string;
    customUpdatedAt?: string;
    nowIso?: string;
  }) => {
    isPublished: boolean;
    isMeaningfullyUpdated: boolean;
    authorHref: string;
    headerLabel: string;
    modeBadgeText: string;
    effectivePublishedIso?: string;
    effectiveUpdatedIso?: string;
  };
};

function makeBasePost(overrides: Partial<PublishedBlogPost> = {}): PublishedBlogPost {
  return {
    id: 'post-editorial-1',
    group_id: 'group-take-home-1',
    language: 'en',
    title: 'How to Compute Take-Home Pay in the Philippines (2026)',
    slug: 'how-to-compute-take-home-pay-philippines',
    seo_title: 'How to Compute Take-Home Pay in the Philippines (2026) | SuweldoTools',
    meta_description: 'Step-by-step guide to computing monthly take-home pay in the Philippines for 2026.',
    excerpt: 'Learn how to compute your monthly net take-home pay after SSS, PhilHealth, Pag-IBIG, and BIR withholding tax.',
    content: '<h2>Step 1: Know Your Gross Pay</h2><p>Start with your basic monthly salary.</p>',
    featured_image_url: 'https://suweldotools.com/images/2026/11/featured-take-home-pay-bba6254b.webp',
    featured_image_alt: 'Take-home pay breakdown chart for Philippine employees',
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-08T04:00:00.000Z',
    updated_at: '2026-11-08T04:00:00.000Z',
    created_at: '2026-11-08T03:30:00.000Z',
    faqs: [],
    ...overrides,
  };
}

function makeValidWriteInput(overrides: Partial<BlogPostWriteInput> = {}): BlogPostWriteInput {
  return {
    title: 'How to Compute Take-Home Pay in the Philippines',
    slug: 'how-to-compute-take-home-pay-philippines',
    language: 'en',
    group_id: '11111111-2222-4333-8444-555555555555',
    seo_title: 'How to Compute Take-Home Pay in the Philippines',
    meta_description: 'Step-by-step Philippine payroll deduction guide.',
    excerpt: 'Step-by-step Philippine payroll deduction guide.',
    content: '<p>Body content here.</p>',
    featured_image_url: 'https://suweldotools.com/images/2026/11/featured-take-home-pay-bba6254b.webp',
    featured_image_alt: 'Take-home pay guide',
    status: 'published',
    faqs: [],
    ...overrides,
  };
}

test('1. New draft has no published date and never sends client published_at or first_published_at', () => {
  const input = makeValidWriteInput({
    status: 'draft',
    first_published_at: null,
    published_at: null,
    update_date_mode: 'keep',
  });

  const built = buildBlogPostWritePayload(input);
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal('first_published_at' in built.payload, false);
    assert.equal('published_at' in built.payload, false);
    assert.equal('updated_at' in built.payload, false);
  }

  const previewDates = adminRenderer.resolveAdminPreviewEditorialDates({
    language: 'en',
    firstPublishedAt: null,
    publishedAt: null,
    updatedAt: null,
    updateDateMode: 'keep',
    customUpdatedAt: '',
  });
  assert.equal(previewDates.isPublished, false);
  assert.match(previewDates.headerLabel, /Not yet published/i);
});

test('2. First publish sets original and current published date to the same timestamp (unchanged state)', () => {
  const post = makeBasePost({
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-08T04:00:00.000Z',
    updated_at: '2026-11-08T04:00:00.000Z',
  });

  const dates = resolveArticleEditorialDates(post);
  assert.equal(dates.originalPublishedIso, '2026-11-08T04:00:00.000Z');
  assert.equal(dates.effectiveModifiedIso, '2026-11-08T04:00:00.000Z');
  assert.equal(dates.isMeaningfullyUpdated, false);
});

test('3. Minor edit in keep mode omits updated_at from update payload', () => {
  const input = makeValidWriteInput({
    id: 'post-editorial-1',
    status: 'published',
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-08T04:00:00.000Z',
    update_date_mode: 'keep',
  });

  const built = buildBlogPostWritePayload(input, {
    existingFirstPublishedAt: '2026-11-08T04:00:00.000Z',
    existingPublishedAt: '2026-11-08T04:00:00.000Z',
  });

  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal('updated_at' in built.payload, false);
    assert.equal('first_published_at' in built.payload, false);
    assert.equal('published_at' in built.payload, false);
  }
});

test('4. Meaningful update in now mode sends a new updated_at timestamp', () => {
  const fixedNow = new Date('2026-11-12T09:15:30.000Z');
  const input = makeValidWriteInput({
    id: 'post-editorial-1',
    status: 'published',
    update_date_mode: 'now',
  });

  const built = buildBlogPostWritePayload(input, {
    existingFirstPublishedAt: '2026-11-08T04:00:00.000Z',
    existingPublishedAt: '2026-11-08T04:00:00.000Z',
    nowDate: fixedNow,
  });

  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.payload.updated_at, '2026-11-12T09:15:30.000Z');
    assert.equal('first_published_at' in built.payload, false);
    assert.equal('published_at' in built.payload, false);
  }
});

test('5. Meaningful update in custom mode converts Asia/Manila to UTC ISO and sends it in updated_at', () => {
  // 2026-11-15 14:30 Asia/Manila (+08:00) == 2026-11-15T06:30:00.000Z
  const parsed = parseManilaDateTimeInputToUtcIso('2026-11-15T14:30');
  assert.deepEqual(parsed, { ok: true, utcIso: '2026-11-15T06:30:00.000Z' });
  assert.equal(formatUtcIsoToManilaDateTimeLocal('2026-11-15T06:30:00.000Z'), '2026-11-15T14:30');

  const adminParsed = adminRenderer.parseAdminManilaDateTimeToUtcIso('2026-11-15T14:30');
  assert.equal(adminParsed.valid, true);
  assert.equal(adminParsed.utcIso, '2026-11-15T06:30:00.000Z');
  assert.equal(adminRenderer.formatUtcIsoToManilaInput('2026-11-15T06:30:00.000Z'), '2026-11-15T14:30');

  const input = makeValidWriteInput({
    id: 'post-editorial-1',
    status: 'published',
    update_date_mode: 'custom',
    custom_updated_at: '2026-11-15T14:30',
  });

  const built = buildBlogPostWritePayload(input, {
    existingFirstPublishedAt: '2026-11-08T04:00:00.000Z',
    existingPublishedAt: '2026-11-08T04:00:00.000Z',
  });

  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.payload.updated_at, '2026-11-15T06:30:00.000Z');
  }
});

test('6. Custom update date earlier than first_published_at is rejected', () => {
  // first_published_at is 2026-11-08T04:00:00.000Z (12:00 Manila)
  // Custom date 2026-11-08T10:00 Manila is 2026-11-08T02:00:00.000Z (2 hours earlier)
  const resolved = resolveEditorialUpdateTimestamp({
    mode: 'custom',
    customUpdatedAt: '2026-11-08T10:00',
    firstPublishedAt: '2026-11-08T04:00:00.000Z',
    publishedAt: '2026-11-08T04:00:00.000Z',
  });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) {
    assert.match(resolved.message, /cannot be earlier than the original Published Date/i);
  }

  const input = makeValidWriteInput({
    id: 'post-editorial-1',
    status: 'published',
    update_date_mode: 'custom',
    custom_updated_at: '2026-11-08T10:00',
  });
  const built = buildBlogPostWritePayload(input, {
    existingFirstPublishedAt: '2026-11-08T04:00:00.000Z',
    existingPublishedAt: '2026-11-08T04:00:00.000Z',
  });
  assert.equal(built.ok, false);
});

test('7. Published -> Draft -> Published preserves first_published_at over later published_at', () => {
  // Republished later on Nov 10, but original publication was Nov 8 and updated_at was kept at Nov 8
  const republishedUnchanged = makeBasePost({
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-10T08:00:00.000Z',
    updated_at: '2026-11-08T04:00:00.000Z',
  });
  const datesUnchanged = resolveArticleEditorialDates(republishedUnchanged);
  assert.equal(datesUnchanged.originalPublishedIso, '2026-11-08T04:00:00.000Z');
  assert.equal(datesUnchanged.effectiveModifiedIso, '2026-11-08T04:00:00.000Z');
  assert.equal(datesUnchanged.isMeaningfullyUpdated, false);

  // Republished and meaningfully updated on Nov 12
  const republishedUpdated = makeBasePost({
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-10T08:00:00.000Z',
    updated_at: '2026-11-12T06:00:00.000Z',
  });
  const datesUpdated = resolveArticleEditorialDates(republishedUpdated);
  assert.equal(datesUpdated.originalPublishedIso, '2026-11-08T04:00:00.000Z');
  assert.equal(datesUpdated.effectiveModifiedIso, '2026-11-12T06:00:00.000Z');
  assert.equal(datesUpdated.isMeaningfullyUpdated, true);
});

test('8. Archived status is preserved and not mislabeled as Draft', () => {
  const normalized = normalizeBlogPostRecord({
    id: 'post-archived-1',
    title: 'Archived Post',
    slug: 'archived-post',
    language: 'en',
    group_id: '11111111-2222-4333-8444-555555555555',
    seo_title: 'Archived Post',
    meta_description: 'Desc',
    excerpt: 'Excerpt',
    content: '<p>Archived content</p>',
    featured_image_url: '',
    featured_image_alt: '',
    status: 'archived',
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: null,
    updated_at: '2026-11-08T04:00:00.000Z',
    created_at: '2026-11-08T03:00:00.000Z',
    faqs: [],
  });
  assert.equal(normalized.status, 'archived');
  assert.equal(normalized.first_published_at, '2026-11-08T04:00:00.000Z');

  const validated = validateAndNormalizeWriteInput(makeValidWriteInput({ status: 'archived' }));
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.normalized.status, 'archived');
  }

  const adminHtml = fs.readFileSync(path.resolve(process.cwd(), 'admin/index.html'), 'utf8');
  assert.match(adminHtml, /<option value="archived">Archived<\/option>/);
});

test('9. Unchanged English article displays Published: [Date] · By Mohammad Irfan and omits duplicate footer Last updated', () => {
  const post = makeBasePost({
    language: 'en',
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-08T04:00:00.000Z',
    updated_at: '2026-11-08T04:00:00.000Z',
  });
  const html = buildArticlePageHtml(post);
  const expectedDisplay = formatPublishedDate('2026-11-08T04:00:00.000Z', 'en').display;

  assert.match(
    html,
    new RegExp(
      `<span>Published: <time datetime="2026-11-08T04:00:00\\.000Z">${expectedDisplay}<\\/time><\\/span>[\\s\\S]*?&middot;[\\s\\S]*?By <a href="\\/authors\\/mohammad-irfan\\/"[^>]*>Mohammad Irfan<\\/a>`
    )
  );
  assert.doesNotMatch(html, /Last Updated:/);
  assert.doesNotMatch(html, /Last updated:\s*<time/);
});

test('10. Meaningfully updated English article displays Last Updated: [Date] · By Mohammad Irfan and footer shows Published + Last updated', () => {
  const post = makeBasePost({
    language: 'en',
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-08T04:00:00.000Z',
    updated_at: '2026-11-15T06:30:00.000Z',
  });
  const html = buildArticlePageHtml(post);
  const expectedPubDisplay = formatPublishedDate('2026-11-08T04:00:00.000Z', 'en').display;
  const expectedUpdDisplay = formatPublishedDate('2026-11-15T06:30:00.000Z', 'en').display;

  assert.match(
    html,
    new RegExp(
      `<span>Last Updated: <time datetime="2026-11-15T06:30:00\\.000Z">${expectedUpdDisplay}<\\/time><\\/span>[\\s\\S]*?&middot;[\\s\\S]*?By <a href="\\/authors\\/mohammad-irfan\\/"[^>]*>Mohammad Irfan<\\/a>`
    )
  );
  assert.match(
    html,
    new RegExp(`Published: <time datetime="2026-11-08T04:00:00\\.000Z">${expectedPubDisplay}<\\/time>`)
  );
  assert.match(
    html,
    new RegExp(`Last updated: <time datetime="2026-11-15T06:30:00\\.000Z">${expectedUpdDisplay}<\\/time>`)
  );
});

test('11. Unchanged Filipino article displays Inilathala: [Date] · Ni Mohammad Irfan', () => {
  const post = makeBasePost({
    language: 'tl',
    slug: 'paano-kompyutin-ang-take-home-pay-pilipinas',
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-08T04:00:00.000Z',
    updated_at: '2026-11-08T04:00:00.000Z',
  });
  const html = buildArticlePageHtml(post);
  const expectedDisplay = formatPublishedDate('2026-11-08T04:00:00.000Z', 'tl').display;

  assert.match(
    html,
    new RegExp(
      `<span>Inilathala: <time datetime="2026-11-08T04:00:00\\.000Z">${expectedDisplay}<\\/time><\\/span>[\\s\\S]*?&middot;[\\s\\S]*?Ni <a href="\\/tl\\/authors\\/mohammad-irfan\\/"[^>]*>Mohammad Irfan<\\/a>`
    )
  );
  assert.doesNotMatch(html, /Huling Na-update:/);
  assert.doesNotMatch(html, /Huling na-update:\s*<time/);
});

test('12. Meaningfully updated Filipino article displays Huling Na-update: [Date] · Ni Mohammad Irfan', () => {
  const post = makeBasePost({
    language: 'tl',
    slug: 'paano-kompyutin-ang-take-home-pay-pilipinas',
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-08T04:00:00.000Z',
    updated_at: '2026-11-15T06:30:00.000Z',
  });
  const html = buildArticlePageHtml(post);
  const expectedPubDisplay = formatPublishedDate('2026-11-08T04:00:00.000Z', 'tl').display;
  const expectedUpdDisplay = formatPublishedDate('2026-11-15T06:30:00.000Z', 'tl').display;

  assert.match(
    html,
    new RegExp(
      `<span>Huling Na-update: <time datetime="2026-11-15T06:30:00\\.000Z">${expectedUpdDisplay}<\\/time><\\/span>[\\s\\S]*?&middot;[\\s\\S]*?Ni <a href="\\/tl\\/authors\\/mohammad-irfan\\/"[^>]*>Mohammad Irfan<\\/a>`
    )
  );
  assert.match(
    html,
    new RegExp(`Inilathala: <time datetime="2026-11-08T04:00:00\\.000Z">${expectedPubDisplay}<\\/time>`)
  );
  assert.match(
    html,
    new RegExp(`Huling na-update: <time datetime="2026-11-15T06:30:00\\.000Z">${expectedUpdDisplay}<\\/time>`)
  );
});

test('13. Author name links to /authors/mohammad-irfan/ (EN) and /tl/authors/mohammad-irfan/ (TL) in both generator and admin preview', () => {
  const enPost = makeBasePost({ language: 'en' });
  const tlPost = makeBasePost({ language: 'tl', slug: 'paano-kompyutin-ang-take-home-pay-pilipinas' });

  const enHtml = buildArticlePageHtml(enPost);
  const tlHtml = buildArticlePageHtml(tlPost);

  assert.match(enHtml, /href="\/authors\/mohammad-irfan\/"/);
  assert.match(tlHtml, /href="\/tl\/authors\/mohammad-irfan\/"/);

  const adminEn = adminRenderer.resolveAdminPreviewEditorialDates({
    language: 'en',
    firstPublishedAt: '2026-11-08T04:00:00.000Z',
    publishedAt: '2026-11-08T04:00:00.000Z',
    updatedAt: '2026-11-08T04:00:00.000Z',
    updateDateMode: 'keep',
    customUpdatedAt: '',
  });
  const adminTl = adminRenderer.resolveAdminPreviewEditorialDates({
    language: 'tl',
    firstPublishedAt: '2026-11-08T04:00:00.000Z',
    publishedAt: '2026-11-08T04:00:00.000Z',
    updatedAt: '2026-11-08T04:00:00.000Z',
    updateDateMode: 'keep',
    customUpdatedAt: '',
  });

  assert.equal(adminEn.authorHref, '/authors/mohammad-irfan/');
  assert.equal(adminTl.authorHref, '/tl/authors/mohammad-irfan/');
});

test('14. JSON-LD datePublished and dateModified match visible editorial state on article and listing pages', () => {
  const unchangedPost = makeBasePost({
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-10T04:00:00.000Z',
    updated_at: '2026-11-08T04:00:00.000Z',
  });
  const unchangedHtml = buildArticlePageHtml(unchangedPost);
  assert.match(unchangedHtml, /"datePublished":\s*"2026-11-08T04:00:00\.000Z"/);
  assert.match(unchangedHtml, /"dateModified":\s*"2026-11-08T04:00:00\.000Z"/);

  const updatedPost = makeBasePost({
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-10T04:00:00.000Z',
    updated_at: '2026-11-15T06:30:00.000Z',
  });
  const updatedHtml = buildArticlePageHtml(updatedPost);
  assert.match(updatedHtml, /"datePublished":\s*"2026-11-08T04:00:00\.000Z"/);
  assert.match(updatedHtml, /"dateModified":\s*"2026-11-15T06:30:00\.000Z"/);

  const listingTemplate = fs.readFileSync(path.resolve(process.cwd(), 'blog/index.html'), 'utf8');
  const updatedListing = buildUpdatedListingHtml(listingTemplate, [updatedPost], 'en');
  assert.match(updatedListing, /"datePublished":\s*"2026-11-08T04:00:00\.000Z"/);
  assert.match(updatedListing, /"dateModified":\s*"2026-11-15T06:30:00\.000Z"/);
});

test('15. Open Graph article:published_time and article:modified_time match visible editorial state', () => {
  const unchangedPost = makeBasePost({
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-10T04:00:00.000Z',
    updated_at: '2026-11-08T04:00:00.000Z',
  });
  const unchangedHtml = buildArticlePageHtml(unchangedPost);
  assert.match(unchangedHtml, /<meta property="article:published_time" content="2026-11-08T04:00:00\.000Z"\s*\/>/);
  assert.match(unchangedHtml, /<meta property="article:modified_time" content="2026-11-08T04:00:00\.000Z"\s*\/>/);

  const updatedPost = makeBasePost({
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-10T04:00:00.000Z',
    updated_at: '2026-11-15T06:30:00.000Z',
  });
  const updatedHtml = buildArticlePageHtml(updatedPost);
  assert.match(updatedHtml, /<meta property="article:published_time" content="2026-11-08T04:00:00\.000Z"\s*\/>/);
  assert.match(updatedHtml, /<meta property="article:modified_time" content="2026-11-15T06:30:00\.000Z"\s*\/>/);
});

test('16. Sitemap <lastmod> matches meaningful modification state in Asia/Manila', () => {
  // 2026-11-08T18:00:00.000Z is 2026-11-09 02:00:00 in Asia/Manila
  assert.equal(formatSitemapLastmod('2026-11-08T18:00:00.000Z'), '2026-11-09');

  const baseSitemapXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    '    <loc>https://suweldotools.com/blog/</loc>',
    '    <lastmod>2026-11-01</lastmod>',
    '  </url>',
    '</urlset>',
  ].join('\n');

  const unchangedPost = makeBasePost({
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-10T04:00:00.000Z',
    updated_at: '2026-11-08T04:00:00.000Z',
  });
  const unchangedSitemap = buildSynchronizedSitemapXml(baseSitemapXml, [unchangedPost], [], new Map());
  assert.match(
    unchangedSitemap,
    /<loc>https:\/\/suweldotools\.com\/blog\/how-to-compute-take-home-pay-philippines\/<\/loc>\s*<lastmod>2026-11-08<\/lastmod>/
  );

  const updatedPost = makeBasePost({
    first_published_at: '2026-11-08T04:00:00.000Z',
    published_at: '2026-11-10T04:00:00.000Z',
    updated_at: '2026-11-15T06:30:00.000Z',
  });
  const updatedSitemap = buildSynchronizedSitemapXml(baseSitemapXml, [updatedPost], [], new Map());
  assert.match(
    updatedSitemap,
    /<loc>https:\/\/suweldotools\.com\/blog\/how-to-compute-take-home-pay-philippines\/<\/loc>\s*<lastmod>2026-11-15<\/lastmod>/
  );
});

test('17. Standalone Last updated: [Month Year] · By Mohammad Irfan placeholder is removed in both public and admin content renderers', () => {
  const htmlWithPlaceholder = [
    '<!-- Optional visible freshness line: keep ONLY if your page template does not already display one -->',
    '<p><small>Last updated: <time datetime="YYYY-MM">[Month Year]</time> &middot; By Mohammad Irfan</small></p>',
    '<p><small>Huling na-update: <time datetime="YYYY-MM">[Buwan Taon]</time> &middot; Ni Mohammad Irfan</small></p>',
    '<h2>Real Heading</h2>',
    '<p>This real paragraph mentioning Last updated: [Month Year] inside a full sentence is preserved because it is not the standalone placeholder block.</p>',
  ].join('\n');

  const publicRendered = renderSafeArticleContent(htmlWithPlaceholder);
  assert.doesNotMatch(publicRendered, /Optional visible freshness line/i);
  assert.doesNotMatch(publicRendered, /\[Month Year\]\s*(?:·|&middot;)\s*By Mohammad Irfan/i);
  assert.doesNotMatch(publicRendered, /\[Buwan Taon\]\s*(?:·|&middot;)\s*Ni Mohammad Irfan/i);
  assert.match(publicRendered, /<h2>Real Heading<\/h2>/);
  assert.match(publicRendered, /This real paragraph mentioning Last updated/);

  const adminRendered = adminRenderer.renderSafeAdminArticleContent(htmlWithPlaceholder);
  assert.doesNotMatch(adminRendered, /Optional visible freshness line/i);
  assert.doesNotMatch(adminRendered, /\[Month Year\]\s*(?:·|&middot;)\s*By Mohammad Irfan/i);
  assert.doesNotMatch(adminRendered, /\[Buwan Taon\]\s*(?:·|&middot;)\s*Ni Mohammad Irfan/i);
  assert.match(adminRendered, /<h2>Real Heading<\/h2>/);
  assert.match(adminRendered, /This real paragraph mentioning Last updated/);

  const markdownPlaceholder = [
    'Last updated: [Month Year] · By Mohammad Irfan',
    '',
    '## Genuine Section',
    '',
    'Real article body text.',
  ].join('\n');

  const publicMd = renderSafeArticleContent(markdownPlaceholder);
  const adminMd = adminRenderer.renderSafeAdminArticleContent(markdownPlaceholder);
  assert.doesNotMatch(publicMd, /By Mohammad Irfan/);
  assert.doesNotMatch(adminMd, /By Mohammad Irfan/);
  assert.match(publicMd, /<h2[^>]*>Genuine Section<\/h2>/);
  assert.match(adminMd, /<h2[^>]*>Genuine Section<\/h2>/);
});
