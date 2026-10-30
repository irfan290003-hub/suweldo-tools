import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  cleanupObsoleteGeneratedArticles,
  GENERATOR_OWNERSHIP_MARKER,
} from '../scripts/generate-blog';

describe('cleanupObsoleteGeneratedArticles', () => {
  let tempTestDir: string;

  beforeEach(async () => {
    tempTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'suweldotools-blog-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempTestDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('safely removes an obsolete generated article when its slug is not in activeSlugs', async () => {
    const obsoleteSlug = 'how-to-compute-old-tax';
    const articleDir = path.join(tempTestDir, obsoleteSlug);
    await fs.mkdir(articleDir, { recursive: true });
    const indexPath = path.join(articleDir, 'index.html');
    await fs.writeFile(
      indexPath,
      `<!DOCTYPE html><html><head>${GENERATOR_OWNERSHIP_MARKER}<title>Old Post</title></head><body></body></html>`,
      'utf8'
    );

    const activeSlugs = new Set(['current-2026-tax-guide']);
    const removed = await cleanupObsoleteGeneratedArticles(tempTestDir, activeSlugs);

    assert.strictEqual(removed.length, 1);
    const dirExists = await fs
      .access(articleDir)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(dirExists, false, 'Obsolete article directory should be deleted');
  });

  it('preserves generated articles whose slugs are in activeSlugs', async () => {
    const activeSlug = '13th-month-pay-2026-guide';
    const articleDir = path.join(tempTestDir, activeSlug);
    await fs.mkdir(articleDir, { recursive: true });
    const indexPath = path.join(articleDir, 'index.html');
    await fs.writeFile(
      indexPath,
      `<!DOCTYPE html><html><head>${GENERATOR_OWNERSHIP_MARKER}<title>Active Guide</title></head><body></body></html>`,
      'utf8'
    );

    const activeSlugs = new Set([activeSlug]);
    const removed = await cleanupObsoleteGeneratedArticles(tempTestDir, activeSlugs);

    assert.strictEqual(removed.length, 0);
    const dirExists = await fs
      .access(articleDir)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(dirExists, true, 'Active article directory must be preserved');
  });

  it('preserves hand-maintained directories without GENERATOR_OWNERSHIP_MARKER', async () => {
    const handCraftedSlug = 'custom-static-page';
    const articleDir = path.join(tempTestDir, handCraftedSlug);
    await fs.mkdir(articleDir, { recursive: true });
    const indexPath = path.join(articleDir, 'index.html');
    await fs.writeFile(
      indexPath,
      '<!DOCTYPE html><html><head><title>Custom Source Page</title></head><body>Handcrafted</body></html>',
      'utf8'
    );

    const activeSlugs = new Set<string>();
    const removed = await cleanupObsoleteGeneratedArticles(tempTestDir, activeSlugs);

    assert.strictEqual(removed.length, 0);
    const dirExists = await fs
      .access(articleDir)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(dirExists, true, 'Hand-maintained page without marker must never be deleted');
  });

  it('preserves directories containing custom non-metadata files even if index.html has marker', async () => {
    const mixedSlug = 'article-with-custom-script';
    const articleDir = path.join(tempTestDir, mixedSlug);
    await fs.mkdir(articleDir, { recursive: true });
    await fs.writeFile(
      path.join(articleDir, 'index.html'),
      `<!DOCTYPE html><html><head>${GENERATOR_OWNERSHIP_MARKER}</head></html>`,
      'utf8'
    );
    await fs.writeFile(
      path.join(articleDir, 'custom-calculator.ts'),
      'export const compute = () => 42;',
      'utf8'
    );

    const activeSlugs = new Set<string>();
    const removed = await cleanupObsoleteGeneratedArticles(tempTestDir, activeSlugs);

    assert.strictEqual(removed.length, 0);
    const dirExists = await fs
      .access(articleDir)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(dirExists, true, 'Directory with user code must not be deleted');
  });

  it('successfully cleans up obsolete articles when auxiliary OS metadata files (.DS_Store, Thumbs.db) are present', async () => {
    const obsoleteSlug = 'temporary-test-with-metadata';
    const articleDir = path.join(tempTestDir, obsoleteSlug);
    await fs.mkdir(articleDir, { recursive: true });
    await fs.writeFile(
      path.join(articleDir, 'index.html'),
      `<!DOCTYPE html><html><head>${GENERATOR_OWNERSHIP_MARKER}<title>Test</title></head></html>`,
      'utf8'
    );
    await fs.writeFile(path.join(articleDir, '.DS_Store'), 'fake-ds-store-content', 'utf8');
    await fs.writeFile(path.join(articleDir, 'Thumbs.db'), 'fake-thumbs-content', 'utf8');

    const activeSlugs = new Set<string>();
    const removed = await cleanupObsoleteGeneratedArticles(tempTestDir, activeSlugs);

    assert.strictEqual(removed.length, 1);
    const dirExists = await fs
      .access(articleDir)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(dirExists, false, 'Directory with OS metadata and generated HTML should be cleanly removed');
  });

  it('safely cleans up the test article pattern emporary-faq-and-author-test-2026 when deleted from activeSlugs', async () => {
    const testArticleSlug = 'emporary-faq-and-author-test-2026';
    const articleDir = path.join(tempTestDir, testArticleSlug);
    await fs.mkdir(articleDir, { recursive: true });
    await fs.writeFile(
      path.join(articleDir, 'index.html'),
      `<!DOCTYPE html><html><head>${GENERATOR_OWNERSHIP_MARKER}<title>Temporary Test</title></head></html>`,
      'utf8'
    );

    // Active slugs only contains real published article
    const activeSlugs = new Set(['how-to-compute-philhealth-contribution-2026']);
    const removed = await cleanupObsoleteGeneratedArticles(tempTestDir, activeSlugs);

    assert.strictEqual(removed.length, 1);
    const dirExists = await fs
      .access(articleDir)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(dirExists, false, 'The deleted test article directory should be deleted');
  });
});
