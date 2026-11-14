import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

import {
  handleRegenerateBlogRequest,
  extractBearerToken,
  resolveSupabaseServerConfig,
  resolveDeployHookUrl,
  type PagesRegenerateBlogEnv,
} from '../functions/__suweldotools/regenerate-blog.ts';

import {
  buildArticlePageHtml,
  renderListingPostCard,
  type PublishedBlogPost,
} from '../scripts/generate-blog.ts';

const require = createRequire(import.meta.url);
const blogAdminHelpers = require('../public/js/blog-admin.js');

const PROJECT_ROOT = process.cwd();

const TEST_ENV: PagesRegenerateBlogEnv = {
  VITE_SUPABASE_URL: 'https://otsdwsbaehwwlglxmnel.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'test-public-anon-key-12345',
  CLOUDFLARE_DEPLOY_HOOK_URL:
    'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/secret-hook-token-99999',
};

const VALID_ADMIN_USER_ID = 'a1b2c3d4-e5f6-4789-89ab-cdef01234567';
const NON_ADMIN_USER_ID = 'b2c3d4e5-f6a7-4890-9abc-def012345678';

describe('PHASE 1 — Production Cloudflare Pages Function: POST /__suweldotools/regenerate-blog', () => {
  it('1. rejects non-POST HTTP methods (GET, PUT, DELETE) with 405 Method Not Allowed', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'HEAD']) {
      const req = new Request('https://suweldotools.com/__suweldotools/regenerate-blog', {
        method,
      });
      const res = await handleRegenerateBlogRequest({ request: req, env: TEST_ENV });
      assert.equal(res.status, 405);
      assert.equal(res.headers.get('Allow'), 'POST');
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.status, 'method_not_allowed');
      assert.equal(body.deploymentTriggered, false);
    }
  });

  it('2. rejects unauthenticated requests (missing or malformed Authorization Bearer token) with 401', async () => {
    const reqNoAuth = new Request('https://suweldotools.com/__suweldotools/regenerate-blog', {
      method: 'POST',
    });
    const resNoAuth = await handleRegenerateBlogRequest({ request: reqNoAuth, env: TEST_ENV });
    assert.equal(resNoAuth.status, 401);
    const bodyNoAuth = await resNoAuth.json();
    assert.equal(bodyNoAuth.ok, false);
    assert.equal(bodyNoAuth.status, 'unauthorized');
    assert.equal(bodyNoAuth.deploymentTriggered, false);

    const reqInvalidToken = new Request(
      'https://suweldotools.com/__suweldotools/regenerate-blog',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer expired-or-invalid-jwt' },
      }
    );

    const mockFetchInvalidToken: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/v1/user')) {
        return new Response(JSON.stringify({ message: 'Invalid JWT' }), { status: 401 });
      }
      throw new Error('Unexpected fetch call: ' + url);
    };

    const resInvalidToken = await handleRegenerateBlogRequest(
      { request: reqInvalidToken, env: TEST_ENV },
      mockFetchInvalidToken
    );
    assert.equal(resInvalidToken.status, 401);
    const bodyInvalidToken = await resInvalidToken.json();
    assert.equal(bodyInvalidToken.ok, false);
    assert.equal(bodyInvalidToken.status, 'unauthorized');
    assert.equal(bodyInvalidToken.deploymentTriggered, false);
  });

  it('3. rejects authenticated non-admin users (not in public.blog_admins) with 403 Forbidden', async () => {
    let deployHookCalled = false;

    const mockFetchNonAdmin: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/v1/user')) {
        return new Response(
          JSON.stringify({ id: NON_ADMIN_USER_ID, email: 'user@example.com' }),
          { status: 200 }
        );
      }
      if (url.includes('/rest/v1/blog_admins')) {
        // RLS returns empty array for non-admin user
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('deploy_hooks')) {
        deployHookCalled = true;
      }
      throw new Error('Unexpected fetch call: ' + url);
    };

    const req = new Request('https://suweldotools.com/__suweldotools/regenerate-blog', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-user-token-not-admin' },
    });

    const res = await handleRegenerateBlogRequest(
      { request: req, env: TEST_ENV },
      mockFetchNonAdmin
    );
    assert.equal(res.status, 403);
    assert.equal(deployHookCalled, false);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.status, 'rejected');
    assert.equal(body.deploymentTriggered, false);
  });

  it('4. returns 503 missing_config when CLOUDFLARE_DEPLOY_HOOK_URL is not configured', async () => {
    const mockFetchAdmin: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/v1/user')) {
        return new Response(
          JSON.stringify({ id: VALID_ADMIN_USER_ID, email: 'admin@suweldotools.com' }),
          { status: 200 }
        );
      }
      if (url.includes('/rest/v1/blog_admins')) {
        return new Response(JSON.stringify([{ user_id: VALID_ADMIN_USER_ID }]), { status: 200 });
      }
      throw new Error('Unexpected fetch call: ' + url);
    };

    const req = new Request('https://suweldotools.com/__suweldotools/regenerate-blog', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });

    const envWithoutHook: PagesRegenerateBlogEnv = {
      VITE_SUPABASE_URL: TEST_ENV.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: TEST_ENV.VITE_SUPABASE_ANON_KEY,
      CLOUDFLARE_DEPLOY_HOOK_URL: '',
    };

    const res = await handleRegenerateBlogRequest(
      { request: req, env: envWithoutHook },
      mockFetchAdmin
    );
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.status, 'missing_config');
    assert.equal(body.deploymentTriggered, false);
  });

  it('5. triggers Cloudflare Pages Deploy Hook for verified blog_admins user and never leaks hook URL', async () => {
    const calledUrls: string[] = [];

    const mockFetchSuccess: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      calledUrls.push(url);

      if (url.endsWith('/auth/v1/user')) {
        return new Response(
          JSON.stringify({ id: VALID_ADMIN_USER_ID, email: 'admin@suweldotools.com' }),
          { status: 200 }
        );
      }
      if (url.includes('/rest/v1/blog_admins')) {
        return new Response(JSON.stringify([{ user_id: VALID_ADMIN_USER_ID }]), { status: 200 });
      }
      if (url === TEST_ENV.CLOUDFLARE_DEPLOY_HOOK_URL) {
        assert.equal(init?.method, 'POST');
        return new Response(
          JSON.stringify({
            success: true,
            result: { id: 'cf-deployment-id-123' },
          }),
          { status: 200 }
        );
      }
      throw new Error('Unexpected fetch call: ' + url);
    };

    const req = new Request('https://suweldotools.com/__suweldotools/regenerate-blog', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });

    const res = await handleRegenerateBlogRequest(
      { request: req, env: TEST_ENV },
      mockFetchSuccess
    );
    assert.equal(res.status, 202);
    assert.equal(calledUrls.length, 3);
    assert.equal(calledUrls[2], TEST_ENV.CLOUDFLARE_DEPLOY_HOOK_URL);

    const rawText = await res.text();
    // Secret deploy hook URL must NEVER appear in response body
    assert.equal(rawText.includes('secret-hook-token-99999'), false);
    assert.equal(rawText.includes('deploy_hooks'), false);

    const body = JSON.parse(rawText);
    assert.equal(body.ok, true);
    assert.equal(body.status, 'deployment_triggered');
    assert.equal(body.deploymentTriggered, true);
    assert.equal(body.regeneratedImmediately, false);
  });

  it('6. handles deploy hook 429/409 (deployment_running) and 500 (trigger_failed) accurately', async () => {
    const createMockFetchWithHookStatus = (hookHttpStatus: number): typeof fetch => {
      return async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: VALID_ADMIN_USER_ID }), { status: 200 });
        }
        if (url.includes('/rest/v1/blog_admins')) {
          return new Response(JSON.stringify([{ user_id: VALID_ADMIN_USER_ID }]), { status: 200 });
        }
        if (url === TEST_ENV.CLOUDFLARE_DEPLOY_HOOK_URL) {
          return new Response('Hook status test', { status: hookHttpStatus });
        }
        throw new Error('Unexpected URL: ' + url);
      };
    };

    const req1 = new Request('https://suweldotools.com/__suweldotools/regenerate-blog', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });
    const resRunning = await handleRegenerateBlogRequest(
      { request: req1, env: TEST_ENV },
      createMockFetchWithHookStatus(429)
    );
    assert.equal(resRunning.status, 202);
    const bodyRunning = await resRunning.json();
    assert.equal(bodyRunning.ok, false);
    assert.equal(bodyRunning.status, 'deployment_running');
    assert.equal(bodyRunning.deploymentTriggered, false);

    const req2 = new Request('https://suweldotools.com/__suweldotools/regenerate-blog', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });
    const resFailed = await handleRegenerateBlogRequest(
      { request: req2, env: TEST_ENV },
      createMockFetchWithHookStatus(500)
    );
    assert.equal(resFailed.status, 502);
    const bodyFailed = await resFailed.json();
    assert.equal(bodyFailed.ok, false);
    assert.equal(bodyFailed.status, 'trigger_failed');
    assert.equal(bodyFailed.deploymentTriggered, false);
  });

  it('7. frontend classifyRegenerationResponse and formatRegenerationFeedbackForAdmin distinguish all 6 production states + local dev', () => {
    const { classifyRegenerationResponse, formatRegenerationFeedbackForAdmin } = blogAdminHelpers;

    // 1. Deployment successfully triggered
    const triggered = classifyRegenerationResponse(202, {
      ok: true,
      status: 'deployment_triggered',
      message: 'Triggered',
    });
    assert.equal(triggered.ok, true);
    assert.equal(triggered.status, 'deployment_triggered');
    assert.equal(triggered.deploymentTriggered, true);
    assert.equal(triggered.regeneratedImmediately, false);
    const msgTriggered = formatRegenerationFeedbackForAdmin('Post Published', 'Saved.', triggered);
    assert.equal(msgTriggered.variant, 'success');
    assert.match(msgTriggered.title, /Production Deployment Triggered/);

    // 2. Local dev server immediate generation
    const localGen = classifyRegenerationResponse(200, {
      ok: true,
      enCount: 2,
      tlCount: 2,
      message: 'Generated locally',
    });
    assert.equal(localGen.ok, true);
    assert.equal(localGen.status, 'generated');
    assert.equal(localGen.regeneratedImmediately, true);

    // 3. Deployment request rejected (403)
    const rejected = classifyRegenerationResponse(403, {
      ok: false,
      status: 'rejected',
      message: 'Not in blog_admins',
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.status, 'rejected');
    const msgRejected = formatRegenerationFeedbackForAdmin('Post Published', 'Saved.', rejected);
    assert.equal(msgRejected.variant, 'warning');
    assert.match(msgRejected.title, /Deployment Request Rejected/);

    // 4. Authentication failure (401)
    const unauth = classifyRegenerationResponse(401, {
      ok: false,
      status: 'unauthorized',
      message: 'Invalid token',
    });
    assert.equal(unauth.ok, false);
    assert.equal(unauth.status, 'unauthorized');
    const msgUnauth = formatRegenerationFeedbackForAdmin('Post Published', 'Saved.', unauth);
    assert.equal(msgUnauth.variant, 'warning');
    assert.match(msgUnauth.title, /Authentication Failure/);

    // 5. Configuration missing (503)
    const missingCfg = classifyRegenerationResponse(503, {
      ok: false,
      status: 'missing_config',
      message: 'CLOUDFLARE_DEPLOY_HOOK_URL missing',
    });
    assert.equal(missingCfg.ok, false);
    assert.equal(missingCfg.status, 'missing_config');
    const msgMissing = formatRegenerationFeedbackForAdmin('Post Published', 'Saved.', missingCfg);
    assert.equal(msgMissing.variant, 'warning');
    assert.match(msgMissing.title, /Configuration Missing/);

    // 6. Deployment still running (429 / deployment_running)
    const running = classifyRegenerationResponse(202, {
      ok: false,
      status: 'deployment_running',
      message: 'Already building',
    });
    assert.equal(running.ok, false);
    assert.equal(running.status, 'deployment_running');
    const msgRunning = formatRegenerationFeedbackForAdmin('Post Published', 'Saved.', running);
    assert.equal(msgRunning.variant, 'warning');
    assert.match(msgRunning.title, /Deployment Still Running/);

    // 7. Deployment trigger failure (502)
    const failed = classifyRegenerationResponse(502, {
      ok: false,
      status: 'trigger_failed',
      message: 'Upstream error',
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.status, 'trigger_failed');
    const msgFailed = formatRegenerationFeedbackForAdmin('Post Published', 'Saved.', failed);
    assert.equal(msgFailed.variant, 'warning');
    assert.match(msgFailed.title, /Deployment Trigger Failure/);
  });
});

describe('PHASE 2 — Admin Live Link in All Posts Table', () => {
  it('1. builds correct public URLs for English (/blog/{slug}/) and Filipino (/tl/blog/{slug}/) posts with safe slug encoding', () => {
    const { buildPublicPostUrl, renderAdminPublishOrLiveActionHtml } = blogAdminHelpers;

    assert.equal(
      buildPublicPostUrl({
        language: 'en',
        slug: 'how-to-compute-13th-month-pay-philippines',
      }),
      '/blog/how-to-compute-13th-month-pay-philippines/'
    );

    assert.equal(
      buildPublicPostUrl({
        language: 'tl',
        slug: 'paano-kuwentahin-ang-13th-month-pay-sa-pilipinas',
      }),
      '/tl/blog/paano-kuwentahin-ang-13th-month-pay-sa-pilipinas/'
    );

    const enLiveHtml = renderAdminPublishOrLiveActionHtml({
      id: '11111111-2222-4333-8444-555555555555',
      language: 'en',
      slug: 'how-to-compute-13th-month-pay-philippines',
      status: 'published',
    });

    assert.match(enLiveHtml, /<a href="\/blog\/how-to-compute-13th-month-pay-philippines\/"/);
    assert.match(enLiveHtml, /target="_blank"/);
    assert.match(enLiveHtml, /rel="noopener noreferrer"/);
    assert.match(enLiveHtml, /View Live/);

    const tlLiveHtml = renderAdminPublishOrLiveActionHtml({
      id: '38b6b31c-64dd-408c-bdfe-9732b5e323ef',
      language: 'tl',
      slug: 'paano-kuwentahin-ang-13th-month-pay-sa-pilipinas',
      status: 'published',
    });

    assert.match(
      tlLiveHtml,
      /<a href="\/tl\/blog\/paano-kuwentahin-ang-13th-month-pay-sa-pilipinas\/"/
    );
    assert.match(tlLiveHtml, /target="_blank"/);
    assert.match(tlLiveHtml, /rel="noopener noreferrer"/);
    assert.match(tlLiveHtml, /View Live/);

    // Draft post still renders Publish button
    const draftHtml = renderAdminPublishOrLiveActionHtml({
      id: '22222222-3333-4444-8555-666666666666',
      language: 'en',
      slug: 'draft-slug',
      status: 'draft',
    });
    assert.match(draftHtml, /data-action="publish-row"/);
    assert.match(draftHtml, />Publish<\/button>/);
  });
});

describe('PHASE 3 — Prevent Accidental Post Overwriting', () => {
  it('1. blocks in-place language change when editing an existing post unless explicitly confirmed or converted to a new translation post', () => {
    const { evaluateEditorOverwriteGuard } = blogAdminHelpers;

    const existingEnglishPost = {
      id: '99999999-8888-4777-8666-555555555555',
      group_id: 'b4d0d844-c14f-4a42-a3c1-d07fc833ea28',
      language: 'en',
      title: 'How to Compute 13th Month Pay in the Philippines',
      slug: 'how-to-compute-13th-month-pay-philippines',
      status: 'published',
    };

    // Editing the English post while keeping language = 'en' is allowed
    const sameLangCheck = evaluateEditorOverwriteGuard(
      existingEnglishPost,
      { language: 'en' },
      false
    );
    assert.equal(sameLangCheck.blocked, false);

    // Changing language to 'tl' while existingEnglishPost is loaded in edit mode is BLOCKED by default
    const crossLangCheck = evaluateEditorOverwriteGuard(
      existingEnglishPost,
      { language: 'tl' },
      false
    );
    assert.equal(crossLangCheck.blocked, true);
    assert.equal(crossLangCheck.reason, 'language_mismatch_on_existing_post');
    assert.equal(crossLangCheck.originalLanguage, 'en');
    assert.equal(crossLangCheck.targetLanguage, 'tl');
    assert.equal(crossLangCheck.groupId, 'b4d0d844-c14f-4a42-a3c1-d07fc833ea28');
    assert.match(crossLangCheck.message, /Switch to New Translation Post/);

    // Creating a new counterpart translation (editingPostRecord is null, id is null) is allowed
    const newTranslationCheck = evaluateEditorOverwriteGuard(null, { language: 'tl' }, false);
    assert.equal(newTranslationCheck.blocked, false);

    // Explicit opt-in confirmation allows intentional in-place language change
    const confirmedCheck = evaluateEditorOverwriteGuard(
      existingEnglishPost,
      { language: 'tl' },
      true
    );
    assert.equal(confirmedCheck.blocked, false);
  });

  it('2. verifies /admin/index.html contains the editor mode indicator banner, translation buttons, and overwrite protection warning', async () => {
    const adminHtml = await fs.readFile(path.join(PROJECT_ROOT, 'admin', 'index.html'), 'utf8');
    assert.match(adminHtml, /id="editor-mode-indicator-banner"/);
    assert.match(adminHtml, /id="btn-editor-create-translation"/);
    assert.match(adminHtml, /id="btn-editor-start-new-post"/);
    assert.match(adminHtml, /id="editor-language-mismatch-warning"/);
    assert.match(adminHtml, /id="btn-convert-to-new-translation"/);
    assert.match(adminHtml, /id="form-crud-feedback-actions"/);
  });
});

describe('PHASE 5 — Static Blog Generation for Published English & Filipino Posts', () => {
  it('generates both English (/blog/) and Filipino (/tl/blog/) listing cards and article HTML pages with correct hreflang alternates', () => {
    const sampleEnPost: PublishedBlogPost = {
      id: '11111111-1111-4111-8111-111111111111',
      group_id: 'b4d0d844-c14f-4a42-a3c1-d07fc833ea28',
      language: 'en',
      title: 'How to Compute 13th Month Pay in the Philippines',
      slug: 'how-to-compute-13th-month-pay-philippines',
      author_name: 'KuyaTax',
      excerpt: 'Step-by-step guide to computing 13th month pay under Presidential Decree No. 851.',
      content: '<h2>How 13th Month Pay Works</h2><p>Formula and examples.</p>',
      seo_title: 'How to Compute 13th Month Pay in the Philippines (2026 Guide)',
      meta_description: 'Learn how to calculate your 13th month pay in the Philippines.',
      featured_image_url: 'https://suweldotools.com/images/2026/11/featured-13th-month-pay.webp',
      featured_image_alt: '13th Month Pay Philippines Guide',
      faqs: [],
      first_published_at: '2026-11-14T09:51:00.000Z',
      published_at: '2026-11-14T09:51:00.000Z',
      created_at: '2026-11-14T09:51:00.000Z',
      updated_at: '2026-11-14T09:51:00.000Z',
    };

    const sampleTlPost: PublishedBlogPost = {
      id: '38b6b31c-64dd-408c-bdfe-9732b5e323ef',
      group_id: 'b4d0d844-c14f-4a42-a3c1-d07fc833ea28',
      language: 'tl',
      title: 'Paano Kuwentahin ang 13th Month Pay sa Pilipinas',
      slug: 'paano-kuwentahin-ang-13th-month-pay-sa-pilipinas',
      author_name: 'KuyaTax',
      excerpt: 'Kompletong gabay sa pagkuwenta ng 13th month pay sa Pilipinas.',
      content: '<h2>Paano Kuwentahin ang 13th Month Pay</h2><p>Pormula at halimbawa.</p>',
      seo_title: 'Paano Kuwentahin ang 13th Month Pay sa Pilipinas (2026)',
      meta_description: 'Alamin kung paano kuwentahin ang iyong 13th month pay sa Pilipinas.',
      featured_image_url:
        'https://suweldotools.com/images/2026/11/featured-13th-month-pay-tl-28a79a3d.webp',
      featured_image_alt: 'Gabay sa 13th Month Pay sa Pilipinas',
      faqs: [],
      first_published_at: '2026-11-14T10:01:19.123585+00:00',
      published_at: '2026-11-14T10:01:19.123585+00:00',
      created_at: '2026-11-14T10:01:19.123585+00:00',
      updated_at: '2026-11-14T10:01:19.123585+00:00',
    };

    const enListingCard = renderListingPostCard(sampleEnPost, 'en');
    assert.match(enListingCard, /How to Compute 13th Month Pay in the Philippines/);
    assert.match(enListingCard, /\/blog\/how-to-compute-13th-month-pay-philippines\//);

    const tlListingCard = renderListingPostCard(sampleTlPost, 'tl');
    assert.match(tlListingCard, /Paano Kuwentahin ang 13th Month Pay sa Pilipinas/);
    assert.match(tlListingCard, /\/tl\/blog\/paano-kuwentahin-ang-13th-month-pay-sa-pilipinas\//);

    const enArticleHtml = buildArticlePageHtml(sampleEnPost, sampleTlPost);
    assert.match(
      enArticleHtml,
      /hreflang="tl-PH" href="https:\/\/suweldotools\.com\/tl\/blog\/paano-kuwentahin-ang-13th-month-pay-sa-pilipinas\/"/
    );

    const tlArticleHtml = buildArticlePageHtml(sampleTlPost, sampleEnPost);
    assert.match(
      tlArticleHtml,
      /hreflang="en-PH" href="https:\/\/suweldotools\.com\/blog\/how-to-compute-13th-month-pay-philippines\/"/
    );
  });
});
