import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as htmlparser2 from 'htmlparser2';

import {
  parseAndValidateBrandedImageRequest,
  buildSupabaseStorageObjectUrl,
  handleBrandedImageRequest,
} from '../functions/images/[[path]].ts';
import {
  buildBrandedBlogImageUrl,
  validateAndNormalizeFeaturedImageUrl,
  normalizeFeaturedImageUrlToBranded,
  normalizeBlogPostRecord,
  uploadAdminBlogImage,
} from '../src/lib/supabase.ts';
import {
  sanitizeHttpUrl,
  buildArticlePageHtml,
  renderListingPostCard,
  buildUpdatedListingHtml,
  type PublishedBlogPost,
} from '../scripts/generate-blog.ts';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Ensure DOMParser/document exist before requiring blog-admin.js
function ensureBasicDomForAdminRequire() {
  if (!(globalThis as any).DOMParser) {
    (globalThis as any).DOMParser = class {
      parseFromString(str: string) {
        const dom = htmlparser2.parseDocument(str);
        return { body: { firstChild: dom.children[0] || null } };
      }
    };
  }
  if (!(globalThis as any).document) {
    (globalThis as any).document = {
      implementation: {
        createHTMLDocument() {
          return {
            createElement() {
              return {
                setAttribute() {},
                getAttribute() {
                  return null;
                },
                appendChild() {},
                innerHTML: '',
              };
            },
            createTextNode() {
              return {};
            },
            createDocumentFragment() {
              return { appendChild() {} };
            },
          };
        },
      },
    };
  }
}

ensureBasicDomForAdminRequire();
const blogAdmin = require('../public/js/blog-admin.js');
const {
  validateAdminFeaturedImageUrl,
  resolveAdminPreviewImageSrc,
  getImageFileSignature,
} = blogAdmin;

describe('Phase 1 — Cloudflare Pages Function (/functions/images/[[path]].ts)', () => {
  it('1. accepts valid branded image paths (.webp, .png, .jpg, .jpeg) and maps to featured/YYYY-MM/filename.ext', () => {
    const webp = parseAndValidateBrandedImageRequest(
      'https://suweldotools.com/images/2026/11/take-home-pay.webp'
    );
    assert.equal(webp.ok, true);
    if (webp.ok) {
      assert.equal(webp.data.year, '2026');
      assert.equal(webp.data.month, '11');
      assert.equal(webp.data.filename, 'take-home-pay.webp');
      assert.equal(webp.data.contentType, 'image/webp');
      assert.equal(webp.data.objectPath, 'featured/2026-11/take-home-pay.webp');
      assert.equal(
        buildSupabaseStorageObjectUrl(webp.data),
        'https://otsdwsbaehwwlglxmnel.supabase.co/storage/v1/object/public/blog-images/featured/2026-11/take-home-pay.webp'
      );
    }

    const png = parseAndValidateBrandedImageRequest('/images/2026/01/sss-table_2026.png');
    assert.equal(png.ok, true);
    if (png.ok) {
      assert.equal(png.data.contentType, 'image/png');
      assert.equal(png.data.objectPath, 'featured/2026-01/sss-table_2026.png');
    }

    const jpg = parseAndValidateBrandedImageRequest('/images/2026/12/payroll-guide.jpg');
    assert.equal(jpg.ok, true);
    if (jpg.ok) {
      assert.equal(jpg.data.contentType, 'image/jpeg');
    }

    const jpeg = parseAndValidateBrandedImageRequest('/images/2026/06/final-pay.jpeg');
    assert.equal(jpeg.ok, true);
    if (jpeg.ok) {
      assert.equal(jpeg.data.contentType, 'image/jpeg');
    }
  });

  it('2. rejects invalid year and month values', () => {
    const invalidPaths = [
      '/images/26/11/take-home-pay.webp',
      '/images/1999/11/take-home-pay.webp',
      '/images/2105/11/take-home-pay.webp',
      '/images/abcd/11/take-home-pay.webp',
      '/images/2026/00/take-home-pay.webp',
      '/images/2026/13/take-home-pay.webp',
      '/images/2026/1/take-home-pay.webp',
      '/images/2026/111/take-home-pay.webp',
    ];
    for (const p of invalidPaths) {
      const res = parseAndValidateBrandedImageRequest(p);
      assert.equal(res.ok, false, `Expected invalid year/month path to be rejected: ${p}`);
    }
  });

  it('3. rejects path traversal, encoded traversal, backslashes, and malformed segment counts', () => {
    const maliciousPaths = [
      'https://suweldotools.com/images/2026/11/../secret.webp',
      'https://suweldotools.com/images/2026/11/..%2fsecret.webp',
      'https://suweldotools.com/images/2026/11/%2e%2e/secret.webp',
      'https://suweldotools.com/images/2026/11/take%2fhome.webp',
      'https://suweldotools.com/images/2026/11/take%5chome.webp',
      'https://suweldotools.com/images/2026/11/take\\home.webp',
      'https://suweldotools.com/images/2026//11/take-home-pay.webp',
      'https://suweldotools.com/images/2026/11/take..home.webp',
      'https://suweldotools.com/images/2026/11/sub/take-home-pay.webp',
      'https://suweldotools.com/images/2026/take-home-pay.webp',
      'https://suweldotools.com/images/2026/11/take-home-pay.webp%00.png',
    ];
    for (const p of maliciousPaths) {
      const res = parseAndValidateBrandedImageRequest(p);
      assert.equal(res.ok, false, `Expected traversal/malformed path to be rejected: ${p}`);
    }
  });

  it('4. rejects unsupported file extensions', () => {
    const unsupported = [
      '/images/2026/11/vector.svg',
      '/images/2026/11/anim.gif',
      '/images/2026/11/script.js',
      '/images/2026/11/page.html',
      '/images/2026/11/archive.zip',
      '/images/2026/11/a35f1aec-91d4-45ab-b71a-90b1c24701f6',
    ];
    for (const p of unsupported) {
      const res = parseAndValidateBrandedImageRequest(p);
      assert.equal(res.ok, false, `Expected unsupported extension to be rejected: ${p}`);
    }
  });

  it('5. returns clean 404 for missing Supabase objects (both 404 and Supabase 400 not_found)', async () => {
    const req = new Request('https://suweldotools.com/images/2026/11/missing-image.webp', {
      method: 'GET',
    });

    // Case A: Upstream returns 400 (Supabase Storage public endpoint behavior when object is missing)
    const res400 = await handleBrandedImageRequest(
      { request: req, params: { path: ['2026', '11', 'missing-image.webp'] } },
      async () =>
        new Response(
          JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
    );
    assert.equal(res400.status, 404);
    assert.equal(res400.headers.get('X-Content-Type-Options'), 'nosniff');
    const text400 = await res400.text();
    assert.equal(text400, 'Not Found');
    assert.doesNotMatch(text400, /statusCode/);

    // Case B: Upstream returns 404
    const res404 = await handleBrandedImageRequest(
      { request: req, params: { path: ['2026', '11', 'missing-image.webp'] } },
      async () => new Response('Not Found', { status: 404 })
    );
    assert.equal(res404.status, 404);
    assert.equal(res404.headers.get('X-Content-Type-Options'), 'nosniff');
  });

  it('6 & 7. supports GET and HEAD with correct MIME, cache headers, nosniff, and rejects POST/DELETE with 405', async () => {
    const fakeWebpBytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    let capturedUpstreamUrl = '';
    let capturedMethod = '';

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUpstreamUrl = String(input);
      capturedMethod = init?.method || 'GET';
      return new Response(fakeWebpBytes, {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(fakeWebpBytes.byteLength),
          ETag: '"webp-etag-123"',
        },
      });
    };

    // GET request
    const getReq = new Request('https://suweldotools.com/images/2026/11/take-home-pay.webp', {
      method: 'GET',
    });
    const getRes = await handleBrandedImageRequest(
      { request: getReq, params: { path: ['2026', '11', 'take-home-pay.webp'] } },
      mockFetch
    );
    assert.equal(getRes.status, 200);
    assert.equal(
      capturedUpstreamUrl,
      'https://otsdwsbaehwwlglxmnel.supabase.co/storage/v1/object/public/blog-images/featured/2026-11/take-home-pay.webp'
    );
    assert.equal(capturedMethod, 'GET');
    assert.equal(getRes.headers.get('Content-Type'), 'image/webp');
    assert.equal(getRes.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.equal(getRes.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(getRes.headers.get('ETag'), '"webp-etag-123"');
    const bodyBytes = new Uint8Array(await getRes.arrayBuffer());
    assert.deepEqual(bodyBytes, fakeWebpBytes);

    // HEAD request
    const headReq = new Request('https://suweldotools.com/images/2026/11/take-home-pay.webp', {
      method: 'HEAD',
    });
    const headRes = await handleBrandedImageRequest(
      { request: headReq, params: { path: ['2026', '11', 'take-home-pay.webp'] } },
      mockFetch
    );
    assert.equal(headRes.status, 200);
    assert.equal(capturedMethod, 'HEAD');
    assert.equal(headRes.headers.get('Content-Type'), 'image/webp');
    assert.equal(headRes.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.equal(headRes.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(await headRes.text(), '');

    // POST request -> 405 Method Not Allowed
    const postReq = new Request('https://suweldotools.com/images/2026/11/take-home-pay.webp', {
      method: 'POST',
    });
    const postRes = await handleBrandedImageRequest(
      { request: postReq, params: { path: ['2026', '11', 'take-home-pay.webp'] } },
      mockFetch
    );
    assert.equal(postRes.status, 405);
    assert.equal(postRes.headers.get('Allow'), 'GET, HEAD');
    assert.equal(postRes.headers.get('X-Content-Type-Options'), 'nosniff');
  });

  it('verifies public/_routes.json strictly isolates function invocations to /images/*', async () => {
    const routesRaw = await fs.readFile(path.join(PROJECT_ROOT, 'public', '_routes.json'), 'utf8');
    const routesJson = JSON.parse(routesRaw);
    assert.equal(routesJson.version, 1);
    assert.deepEqual(routesJson.include, ['/images/*']);
    assert.deepEqual(routesJson.exclude, []);
  });
});

describe('Phase 1 & 2 — Supabase Upload & Duplicate Filename Collision Retry', () => {
  it('8. uploads with clean filename first, and on 409 duplicate collision retries with unique suffix without overwriting', async () => {
    const attemptedPaths: string[] = [];
    const attemptedOptions: Array<{ cacheControl?: string; upsert?: boolean; contentType?: string }> = [];

    const mockSupabaseClient: any = {
      storage: {
        from(bucketName: string) {
          assert.equal(bucketName, 'blog-images');
          return {
            async upload(objectPath: string, _file: any, options: any) {
              attemptedPaths.push(objectPath);
              attemptedOptions.push(options);
              if (attemptedPaths.length === 1) {
                return {
                  data: null,
                  error: {
                    statusCode: '409',
                    error: 'Duplicate',
                    message: 'The resource already exists',
                  },
                };
              }
              return {
                data: { path: objectPath },
                error: null,
              };
            },
            getPublicUrl(objectPath: string) {
              return {
                data: {
                  publicUrl: `https://otsdwsbaehwwlglxmnel.supabase.co/storage/v1/object/public/blog-images/${objectPath}`,
                },
              };
            },
          };
        },
      },
    };

    const fakeFile = {
      name: 'Take Home Pay.webp',
      size: 12400,
      type: 'image/webp',
    } as unknown as File;

    const fixedDate = new Date('2026-11-08T04:00:00.000Z');
    const result = await uploadAdminBlogImage(fakeFile, {
      client: mockSupabaseClient,
      verifySession: async () => ({ status: 'authorized', userId: 'admin-uuid-1' }),
      now: fixedDate,
      randomHexGenerator: () => '9f8e7d6c',
    });

    assert.equal(result.status, 'ok');
    assert.equal(result.ok, true);
    assert.equal(attemptedPaths.length, 2);
    assert.equal(attemptedPaths[0], 'featured/2026-11/take-home-pay.webp');
    assert.equal(attemptedPaths[1], 'featured/2026-11/take-home-pay-9f8e7d6c.webp');
    assert.equal(attemptedOptions[0].upsert, false);
    assert.equal(attemptedOptions[1].upsert, false);
    assert.equal(attemptedOptions[1].contentType, 'image/webp');
    assert.equal(attemptedOptions[1].cacheControl, '31536000');

    if (result.status === 'ok') {
      assert.equal(
        result.publicUrl,
        'https://suweldotools.com/images/2026/11/take-home-pay-9f8e7d6c.webp'
      );
      assert.equal(result.objectPath, 'featured/2026-11/take-home-pay-9f8e7d6c.webp');
    }
  });

  it('builds branded URL on first attempt when no collision occurs', async () => {
    const mockSupabaseClient: any = {
      storage: {
        from() {
          return {
            async upload(objectPath: string) {
              return { data: { path: objectPath }, error: null };
            },
            getPublicUrl(objectPath: string) {
              return {
                data: {
                  publicUrl: `https://otsdwsbaehwwlglxmnel.supabase.co/storage/v1/object/public/blog-images/${objectPath}`,
                },
              };
            },
          };
        },
      },
    };

    const fakeFile = {
      name: 'take-home-pay.webp',
      size: 18500,
      type: 'image/webp',
    } as unknown as File;

    const result = await uploadAdminBlogImage(fakeFile, {
      client: mockSupabaseClient,
      verifySession: async () => ({ status: 'authorized', userId: 'admin-uuid-1' }),
      now: new Date('2026-11-08T04:00:00.000Z'),
    });

    assert.equal(result.status, 'ok');
    if (result.status === 'ok') {
      assert.equal(result.publicUrl, 'https://suweldotools.com/images/2026/11/take-home-pay.webp');
      assert.equal(result.objectPath, 'featured/2026-11/take-home-pay.webp');
    }
  });
});

describe('Phase 1 & 2 — URL Normalization, External URL Preservation & Blob/UUID Rejection', () => {
  it('11. preserves valid external image URLs and root-relative asset paths', () => {
    const extUrl = 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1200';
    assert.equal(sanitizeHttpUrl(extUrl), extUrl);
    assert.deepEqual(validateAndNormalizeFeaturedImageUrl(extUrl), {
      ok: true,
      url: extUrl,
    });
    assert.deepEqual(validateAdminFeaturedImageUrl(extUrl), {
      valid: true,
      normalizedUrl: extUrl,
      error: null,
    });

    const assetPath = '/assets/aistudio/mohammad_irfan_7a326ab4.webp';
    assert.equal(sanitizeHttpUrl(assetPath), assetPath);
    assert.deepEqual(validateAndNormalizeFeaturedImageUrl(assetPath), {
      ok: true,
      url: assetPath,
    });
  });

  it('12. normalizes existing Supabase /featured/YYYY-MM/filename.ext URLs to branded https://suweldotools.com/images/YYYY/MM/filename.ext', () => {
    const legacySupabaseUrl =
      'https://otsdwsbaehwwlglxmnel.supabase.co/storage/v1/object/public/blog-images/featured/2026-11/1794138000-a1b2c3d4-take-home-pay.webp';
    const expectedBranded =
      'https://suweldotools.com/images/2026/11/1794138000-a1b2c3d4-take-home-pay.webp';

    assert.equal(sanitizeHttpUrl(legacySupabaseUrl), expectedBranded);
    assert.deepEqual(validateAndNormalizeFeaturedImageUrl(legacySupabaseUrl), {
      ok: true,
      url: expectedBranded,
    });
    assert.deepEqual(validateAdminFeaturedImageUrl(legacySupabaseUrl), {
      valid: true,
      normalizedUrl: expectedBranded,
      error: null,
    });
    assert.equal(
      buildBrandedBlogImageUrl('featured/2026-11/take-home-pay.webp'),
      'https://suweldotools.com/images/2026/11/take-home-pay.webp'
    );
  });

  it('13. rejects blob: URLs, data: URLs, and stripped blob UUID remnants across generator, Supabase validator, and Admin validator', () => {
    const invalidUrls = [
      'blob:https://ais-dev-i34ftcktmgv3tfgd3eviol-439731515277.asia-east1.run.app/a35f1aec-91d4-45ab-b71a-90b1c24701f6',
      'https://ais-dev-i34ftcktmgv3tfgd3eviol-439731515277.asia-east1.run.app/a35f1aec-91d4-45ab-b71a-90b1c24701f6',
      '/a35f1aec-91d4-45ab-b71a-90b1c24701f6',
      'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
      'javascript:alert(1)',
      '//evil.com/image.webp',
      'https://suweldotools.com/images/2026/13/bad-month.webp',
      'https://suweldotools.com/images/2026/11/../traversal.webp',
      'https://suweldotools.com/images/2026/11/malware.exe',
    ];

    for (const bad of invalidUrls) {
      assert.equal(sanitizeHttpUrl(bad), null, `Generator should reject: ${bad}`);
      assert.equal(
        validateAndNormalizeFeaturedImageUrl(bad).ok,
        false,
        `Supabase validator should reject: ${bad}`
      );
      assert.equal(
        validateAdminFeaturedImageUrl(bad).valid,
        false,
        `Admin validator should reject: ${bad}`
      );
    }
  });

  it('resolves Admin preview image src to /images/YYYY/MM/filename.ext on localhost and AI Studio preview, and full branded URL on suweldotools.com', () => {
    const branded = 'https://suweldotools.com/images/2026/11/take-home-pay.webp';

    assert.equal(
      resolveAdminPreviewImageSrc(branded, 'localhost'),
      '/images/2026/11/take-home-pay.webp'
    );
    assert.equal(
      resolveAdminPreviewImageSrc(
        branded,
        'ais-dev-i34ftcktmgv3tfgd3eviol-439731515277.asia-east1.run.app'
      ),
      '/images/2026/11/take-home-pay.webp'
    );
    assert.equal(resolveAdminPreviewImageSrc(branded, 'suweldotools.com'), branded);
    assert.equal(resolveAdminPreviewImageSrc(branded, 'www.suweldotools.com'), branded);
  });
});

describe('Phase 2 — Admin Automatic Image Upload Before Publish / Save / Preview', () => {
  function createAdminDomHarness(options: {
    uploadResult?: any;
    initialImageUrl?: string;
    selectedFile?: any;
    initialPosts?: any[];
    sessionSnapshotJson?: string;
    blankInitialDom?: boolean;
  }) {
    const elements: Record<string, any> = {};
    const listeners: Record<string, Record<string, Function[]>> = {};

    function makeEl(id: string, initialValue = '') {
      const classSet = new Set<string>(['hidden']);
      const attrs: Record<string, string> = {};
      const el: any = {
        id,
        value: initialValue,
        disabled: false,
        textContent: '',
        innerHTML: '',
        className: '',
        files: [],
        classList: {
          add: (...tokens: string[]) => tokens.forEach((t) => classSet.add(t)),
          remove: (...tokens: string[]) => tokens.forEach((t) => classSet.delete(t)),
          contains: (t: string) => classSet.has(t),
        },
        setAttribute: (k: string, v: string) => {
          attrs[k] = String(v);
        },
        getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
        removeAttribute: (k: string) => {
          delete attrs[k];
        },
        addEventListener: (evt: string, fn: Function) => {
          if (!listeners[id]) listeners[id] = {};
          if (!listeners[id][evt]) listeners[id][evt] = [];
          listeners[id][evt].push(fn);
        },
        scrollIntoView: () => {},
        focus: () => {},
        reset: () => {},
      };
      elements[id] = el;
      return el;
    }

    const ids = [
      'blog-post-form',
      'post-language',
      'post-title',
      'post-slug',
      'slug-prefix-display',
      'post-author-name',
      'post-excerpt',
      'post-content',
      'post-seo-title',
      'post-meta-description',
      'post-image-url',
      'post-image-alt',
      'post-image-file-input',
      'btn-upload-image',
      'btn-upload-image-label',
      'btn-clear-image',
      'post-image-upload-status',
      'post-image-upload-status-title',
      'post-image-upload-status-body',
      'post-image-preview-card',
      'post-image-preview-img',
      'post-image-preview-error',
      'post-image-preview-badge',
      'post-image-preview-source',
      'post-image-preview-alt-summary',
      'btn-preview-post',
      'btn-close-preview',
      'btn-save-draft',
      'btn-save-draft-label',
      'btn-publish-post',
      'btn-publish-post-label',
      'editor-action-hint',
      'form-validation-summary',
      'form-validation-list',
      'form-validation-success',
      'form-crud-feedback',
      'form-crud-feedback-title',
      'form-crud-feedback-body',
      'section-post-preview',
      'preview-serp-url',
      'preview-serp-title',
      'preview-serp-description',
      'preview-article-lang',
      'preview-article-author',
      'preview-article-title',
      'preview-article-excerpt',
      'preview-article-content',
      'preview-article-faqs',
      'preview-image-container',
      'preview-image-element',
      'preview-image-url-text',
      'preview-image-alt-text',
      'posts-table-body',
      'dashboard-recent-posts-body',
    ];
    for (const id of ids) {
      makeEl(id);
    }

    if (options.blankInitialDom) {
      elements['post-language'].value = 'en';
      elements['post-title'].value = '';
      elements['post-slug'].value = '';
      elements['post-author-name'].value = 'Mohammad Irfan';
      elements['post-excerpt'].value = '';
      elements['post-content'].value = '';
      elements['post-seo-title'].value = '';
      elements['post-meta-description'].value = '';
      elements['post-image-url'].value = '';
      elements['post-image-alt'].value = '';
    } else {
      elements['post-language'].value = 'en';
      elements['post-title'].value = 'How to Compute Take-Home Pay in the Philippines';
      elements['post-slug'].value = 'how-to-compute-take-home-pay-philippines';
      elements['post-author-name'].value = 'Mohammad Irfan';
      elements['post-excerpt'].value = 'Step-by-step guide to computing Philippine take-home pay.';
      elements['post-content'].value = '<h2>Take-Home Pay Formula</h2>\n\n<p>Detailed guide.</p>';
      elements['post-seo-title'].value = 'How to Compute Take-Home Pay in the Philippines (2026)';
      elements['post-meta-description'].value =
        'Complete breakdown of SSS, PhilHealth, Pag-IBIG and withholding tax.';
      elements['post-image-url'].value = options.initialImageUrl || '';
      elements['post-image-alt'].value =
        'Formula: gross pay minus SSS, PhilHealth, Pag-IBIG and withholding tax equals take-home pay';
    }

    if (options.selectedFile) {
      elements['post-image-file-input'].files = [options.selectedFile];
    }

    let uploadCallCount = 0;
    const savedPayloads: any[] = [];
    const sessionStore: Record<string, string> = {};
    if (options.sessionSnapshotJson) {
      sessionStore['suweldotools_blog_admin_unsaved_editor_v1'] = options.sessionSnapshotJson;
    }

    const bridge = {
      isAdminVerified: () => true,
      uploadImage: async (_file: any) => {
        uploadCallCount++;
        return options.uploadResult;
      },
      savePost: async (payload: any) => {
        savedPayloads.push(payload);
        return {
          status: 'ok',
          isNew: false,
          post: {
            ...payload,
            id: '11111111-2222-3333-8444-555555555555',
            group_id: '66666666-7777-4888-9999-000000000000',
            updated_at: '2026-11-08T04:00:00.000Z',
            published_at: '2026-11-08T04:00:00.000Z',
          },
        };
      },
      fetchPosts: async () => ({ status: 'ok', posts: options.initialPosts || [] }),
    };

    const prevDoc = (globalThis as any).document;
    const prevWin = (globalThis as any).window;

    (globalThis as any).document = {
      ...prevDoc,
      getElementById: (id: string) => elements[id] || null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    (globalThis as any).window = {
      location: { hostname: 'localhost' },
      sessionStorage: {
        getItem: (k: string) => (k in sessionStore ? sessionStore[k] : null),
        setItem: (k: string, v: string) => {
          sessionStore[k] = String(v);
        },
        removeItem: (k: string) => {
          delete sessionStore[k];
        },
      },
      URL: {
        createObjectURL: () => 'blob:http://localhost:3000/fake-local-preview',
        revokeObjectURL: () => {},
      },
      __SUWELDOTOOLS_SUPABASE_ADMIN__: bridge,
      fetch: async () => ({
        status: 404,
        ok: false,
      }),
    };

    // Re-evaluate blog-admin.js against the mocked DOM
    const modulePath = require.resolve('../public/js/blog-admin.js');
    delete require.cache[modulePath];
    require('../public/js/blog-admin.js');

    return {
      elements,
      listeners,
      getUploadCallCount: () => uploadCallCount,
      savedPayloads,
      cleanup: () => {
        (globalThis as any).document = prevDoc;
        (globalThis as any).window = prevWin;
      },
    };
  }

  it('9 & 10. automatically uploads selected image before publishing and does not re-upload once uploaded', async () => {
    const selectedFile = {
      name: 'take-home-pay.webp',
      size: 24500,
      lastModified: 1700000000000,
      type: 'image/webp',
    };

    const harness = createAdminDomHarness({
      selectedFile,
      uploadResult: {
        status: 'ok',
        ok: true,
        publicUrl: 'https://suweldotools.com/images/2026/11/take-home-pay.webp',
        objectPath: 'featured/2026-11/take-home-pay.webp',
      },
    });

    try {
      // Trigger file change listener
      const changeFns = harness.listeners['post-image-file-input']?.change || [];
      assert.equal(changeFns.length, 1);
      changeFns[0]();

      // Now click Publish Post without clicking Upload Image first
      const publishFns = harness.listeners['btn-publish-post']?.click || [];
      assert.equal(publishFns.length, 1);
      publishFns[0]();

      // Wait for async upload + savePost
      await new Promise((r) => setTimeout(r, 30));

      assert.equal(harness.getUploadCallCount(), 1, 'Should upload selected image automatically');
      assert.equal(harness.savedPayloads.length, 1, 'Should save post after upload succeeds');
      assert.equal(
        harness.savedPayloads[0].featured_image_url,
        'https://suweldotools.com/images/2026/11/take-home-pay.webp'
      );
      assert.equal(
        harness.elements['post-image-url'].value,
        'https://suweldotools.com/images/2026/11/take-home-pay.webp'
      );

      // Clicking Publish Post a second time when no new file is selected must not upload again
      publishFns[0]();
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(harness.getUploadCallCount(), 1, 'Must not upload again after file was already uploaded');
      assert.equal(harness.savedPayloads.length, 2);
      assert.equal(
        harness.savedPayloads[1].featured_image_url,
        'https://suweldotools.com/images/2026/11/take-home-pay.webp'
      );
    } finally {
      harness.cleanup();
    }
  });

  it('9. blocks publishing when selected image upload fails', async () => {
    const selectedFile = {
      name: 'take-home-pay.webp',
      size: 24500,
      lastModified: 1700000000000,
      type: 'image/webp',
    };

    const harness = createAdminDomHarness({
      selectedFile,
      uploadResult: {
        status: 'error',
        ok: false,
        message: 'Upload rejected by Supabase Storage permissions.',
        error: 'Upload rejected by Supabase Storage permissions.',
      },
    });

    try {
      const changeFns = harness.listeners['post-image-file-input']?.change || [];
      changeFns[0]();

      const publishFns = harness.listeners['btn-publish-post']?.click || [];
      publishFns[0]();
      await new Promise((r) => setTimeout(r, 30));

      assert.equal(harness.getUploadCallCount(), 1);
      assert.equal(harness.savedPayloads.length, 0, 'Must NOT call savePost when image upload fails');
      assert.match(
        harness.elements['form-crud-feedback-title'].textContent,
        /Publish Stopped — Featured Image Upload Failed/
      );
      assert.match(
        harness.elements['form-crud-feedback-body'].textContent,
        /Upload rejected by Supabase Storage permissions/
      );
    } finally {
      harness.cleanup();
    }
  });

  it('normalizes exact legacy Supabase URL in normalizeBlogPostRecord(), loadDatabasePostIntoEditor(), and applyEditorSnapshotToDom() directly in #post-image-url input while preserving external URLs', async () => {
    const exactLegacyUrl =
      'https://otsdwsbaehwwlglxmnel.supabase.co/storage/v1/object/public/blog-images/featured/2026-11/1794138214691-4c41cf81-featured-take-home-pay.webp';
    const expectedBrandedUrl =
      'https://suweldotools.com/images/2026/11/1794138214691-4c41cf81-featured-take-home-pay.webp';
    const externalUrl = 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1200';

    // 1. Verify normalizeBlogPostRecord() in src/lib/supabase.ts
    assert.equal(normalizeFeaturedImageUrlToBranded(exactLegacyUrl), expectedBrandedUrl);
    assert.equal(normalizeFeaturedImageUrlToBranded(externalUrl), externalUrl);

    const normalizedDbPost = normalizeBlogPostRecord({
      id: '11111111-2222-4333-8444-555555555555',
      group_id: '66666666-7777-4888-9999-000000000000',
      language: 'en',
      title: 'How to Compute Take-Home Pay in the Philippines',
      slug: 'how-to-compute-take-home-pay-philippines',
      excerpt: 'Excerpt',
      content: '<p>Content</p>',
      seo_title: 'SEO Title',
      meta_description: 'Meta Description',
      featured_image_url: exactLegacyUrl,
      featured_image_alt: 'Alt text',
      author_name: 'Mohammad Irfan',
      faqs: [],
      status: 'published',
    });
    assert.equal(normalizedDbPost.featured_image_url, expectedBrandedUrl);

    const normalizedExternalPost = normalizeBlogPostRecord({
      id: '22222222-2222-4333-8444-555555555555',
      group_id: '66666666-7777-4888-9999-000000000000',
      language: 'en',
      title: 'External Image Post',
      slug: 'external-image-post',
      excerpt: 'Excerpt',
      content: '<p>Content</p>',
      seo_title: 'SEO Title',
      meta_description: 'Meta Description',
      featured_image_url: externalUrl,
      featured_image_alt: 'Alt text',
      author_name: 'Mohammad Irfan',
      faqs: [],
      status: 'draft',
    });
    assert.equal(normalizedExternalPost.featured_image_url, externalUrl);

    // 2. Verify loadDatabasePostIntoEditor() normalizes #post-image-url input field directly when loading an existing post
    const postWithLegacyUrl = {
      id: '11111111-2222-4333-8444-555555555555',
      group_id: '66666666-7777-4888-9999-000000000000',
      language: 'en',
      title: 'How to Compute Take-Home Pay in the Philippines',
      slug: 'how-to-compute-take-home-pay-philippines',
      excerpt: 'Learn how take-home pay is computed in the Philippines.',
      content: '<h2>Take-Home Pay Formula</h2><p>Body</p>',
      seo_title: 'How to Compute Take-Home Pay (Philippines) | SuweldoTools',
      meta_description: 'Meta description',
      featured_image_url: exactLegacyUrl,
      featured_image_alt:
        'Formula: gross pay minus SSS, PhilHealth, Pag-IBIG and withholding tax equals take-home pay',
      author_name: 'Mohammad Irfan',
      faqs: [],
      status: 'published',
      published_at: '2026-11-08T11:06:59.316Z',
      updated_at: '2026-11-08T11:43:58.435Z',
    };

    const postWithExternalUrl = {
      ...postWithLegacyUrl,
      id: '33333333-2222-4333-8444-555555555555',
      slug: 'external-image-guide',
      featured_image_url: externalUrl,
    };

    const loadHarness = createAdminDomHarness({
      blankInitialDom: true,
      initialPosts: [postWithLegacyUrl, postWithExternalUrl],
    });

    try {
      // Wait for initial loadPostsFromSupabase() promise to resolve
      await new Promise((r) => setTimeout(r, 20));

      const tableClickFns = loadHarness.listeners['posts-table-body']?.click || [];
      assert.equal(tableClickFns.length, 1);

      // Simulate clicking Edit on the post that has the legacy Supabase URL
      tableClickFns[0]({
        target: {
          closest: (selector: string) =>
            selector === 'button[data-action]'
              ? {
                  getAttribute: (attr: string) => {
                    if (attr === 'data-action') return 'edit-post';
                    if (attr === 'data-post-id') return postWithLegacyUrl.id;
                    return null;
                  },
                }
              : null,
        },
      });

      assert.equal(
        loadHarness.elements['post-image-url'].value,
        expectedBrandedUrl,
        'Admin #post-image-url input field itself must be normalized to branded URL when loading existing post'
      );
      assert.equal(
        loadHarness.elements['post-image-preview-img'].src,
        '/images/2026/11/1794138214691-4c41cf81-featured-take-home-pay.webp'
      );
    } finally {
      loadHarness.cleanup();
    }

    const externalLoadHarness = createAdminDomHarness({
      blankInitialDom: true,
      initialPosts: [postWithExternalUrl],
    });

    try {
      await new Promise((r) => setTimeout(r, 20));
      const tableClickFns = externalLoadHarness.listeners['posts-table-body']?.click || [];
      tableClickFns[0]({
        target: {
          closest: (selector: string) =>
            selector === 'button[data-action]'
              ? {
                  getAttribute: (attr: string) => {
                    if (attr === 'data-action') return 'edit-post';
                    if (attr === 'data-post-id') return postWithExternalUrl.id;
                    return null;
                  },
                }
              : null,
        },
      });
      assert.equal(
        externalLoadHarness.elements['post-image-url'].value,
        externalUrl,
        'Valid external HTTP(S) image URLs must be preserved in #post-image-url when loading existing post'
      );
    } finally {
      externalLoadHarness.cleanup();
    }

    // 3. Verify applyEditorSnapshotToDom() normalizes #post-image-url input field when restoring a sessionStorage draft snapshot
    const snapshotJson = JSON.stringify({
      editingPostId: null,
      editingGroupId: null,
      language: 'en',
      title: 'Unsaved Draft Post',
      slug: 'unsaved-draft-post',
      author_name: 'Mohammad Irfan',
      excerpt: 'Draft excerpt',
      content: '<p>Draft content</p>',
      seo_title: 'Draft SEO Title',
      meta_description: 'Draft Meta Description',
      featured_image_url: exactLegacyUrl,
      featured_image_alt: 'Draft image alt text',
      faqs: [],
      languageTouched: true,
    });

    const snapshotHarness = createAdminDomHarness({
      blankInitialDom: true,
      sessionSnapshotJson: snapshotJson,
    });

    try {
      assert.equal(
        snapshotHarness.elements['post-image-url'].value,
        expectedBrandedUrl,
        'Admin #post-image-url input field itself must be normalized to branded URL when restoring editor snapshot'
      );
      assert.equal(
        snapshotHarness.elements['post-image-preview-img'].src,
        '/images/2026/11/1794138214691-4c41cf81-featured-take-home-pay.webp'
      );
    } finally {
      snapshotHarness.cleanup();
    }
  });
});

describe('Testing Requirement 5 — Generated Blog HTML Uses Branded Image URLs Everywhere', () => {
  const samplePost: PublishedBlogPost = {
    id: 'a1111111-b222-4c33-8d44-e55555555555',
    group_id: 'f1111111-b222-4c33-8d44-e55555555555',
    language: 'en',
    title: 'How to Compute Take-Home Pay in the Philippines',
    slug: 'how-to-compute-take-home-pay-philippines',
    excerpt: 'Take-home pay is what you receive after SSS, PhilHealth, Pag-IBIG and withholding tax.',
    content:
      '<nav aria-label="Table of contents"><p><strong>Contents</strong></p><ul><li><a href="#formula">Take-Home Pay Formula</a></li></ul></nav>\n\n<h2 id="formula">Take-Home Pay Formula</h2>\n\n<p>Gross pay minus deductions equals net pay.</p>',
    seo_title: 'How to Compute Take-Home Pay in the Philippines (2026 Guide)',
    meta_description:
      'Take-home pay is what you receive after SSS, PhilHealth, Pag-IBIG and withholding tax.',
    // Provide a raw Supabase Storage featured path to verify automatic normalization across all 6 output locations
    featured_image_url:
      'https://otsdwsbaehwwlglxmnel.supabase.co/storage/v1/object/public/blog-images/featured/2026-11/take-home-pay.webp',
    featured_image_alt:
      'Formula: gross pay minus SSS, PhilHealth, Pag-IBIG and withholding tax equals take-home pay',
    author_name: 'Mohammad Irfan',
    faqs: [
      {
        question: 'How do I calculate my take-home pay?',
        answer: 'Deduct SSS, PhilHealth, Pag-IBIG and withholding tax from gross pay.',
      },
    ],
    published_at: '2026-11-08T11:06:59.316Z',
    created_at: '2026-11-08T10:00:00.000Z',
    updated_at: '2026-11-08T11:06:59.316Z',
  };

  const expectedBrandedUrl = 'https://suweldotools.com/images/2026/11/take-home-pay.webp';

  it('renders branded URL in Article featured image, OG image, Twitter image, and BlogPosting JSON-LD while preserving author and HTML formatting', () => {
    const articleHtml = buildArticlePageHtml(samplePost);

    // 1. Article featured image <figure><img ... />
    assert.match(
      articleHtml,
      new RegExp(`<figure[^>]*>[\\s\\S]*?<img[\\s\\S]*?src="${expectedBrandedUrl}"`),
      'Article <figure><img> must use branded URL'
    );

    // 2. Open Graph image tags
    assert.match(
      articleHtml,
      new RegExp(`<meta property="og:image" content="${expectedBrandedUrl}" \\/>`),
      'og:image must use branded URL'
    );
    assert.match(
      articleHtml,
      new RegExp(`<meta property="og:image:secure_url" content="${expectedBrandedUrl}" \\/>`),
      'og:image:secure_url must use branded URL'
    );

    // 3. Twitter Card image tag
    assert.match(
      articleHtml,
      new RegExp(`<meta name="twitter:image" content="${expectedBrandedUrl}" \\/>`),
      'twitter:image must use branded URL'
    );

    // 4. Article BlogPosting JSON-LD image.url
    assert.match(
      articleHtml,
      new RegExp(`"@type":\\s*"ImageObject",[\\s\\S]*?"url":\\s*"${expectedBrandedUrl}"`),
      'BlogPosting JSON-LD ImageObject must use branded URL'
    );

    // Verify no raw supabase.co storage URL remains
    assert.doesNotMatch(articleHtml, /supabase\.co\/storage/);

    // Verify existing author byline and HTML formatting features still work
    assert.match(
      articleHtml,
      /By <a href="\/authors\/mohammad-irfan\/" rel="author" class="font-semibold text-emerald-700 hover:underline">Mohammad Irfan<\/a>/
    );
    assert.match(articleHtml, /<nav aria-label="Table of contents">/);
    assert.match(articleHtml, /<h2 id="formula">Take-Home Pay Formula<\/h2>/);
  });

  it('renders branded URL in Blog listing cards and Listing JSON-LD', async () => {
    const cardHtml = renderListingPostCard(samplePost, 'en');
    assert.match(
      cardHtml,
      new RegExp(`src="${expectedBrandedUrl}"`),
      'Blog listing card <img> must use branded URL'
    );

    const currentBlogIndexHtml = await fs.readFile(
      path.join(PROJECT_ROOT, 'blog', 'index.html'),
      'utf8'
    );
    const updatedIndexHtml = buildUpdatedListingHtml(currentBlogIndexHtml, [samplePost], 'en');

    // 5. Blog listing card inside /blog/index.html
    assert.match(
      updatedIndexHtml,
      new RegExp(`<img[\\s\\S]*?src="${expectedBrandedUrl}"`),
      'Updated /blog/index.html card must use branded URL'
    );

    // 6. Listing JSON-LD blogPost[0].image
    assert.match(
      updatedIndexHtml,
      new RegExp(`"image":\\s*"${expectedBrandedUrl}"`),
      'Updated /blog/index.html JSON-LD must use branded URL'
    );
  });
});
