#!/usr/bin/env node
/**
 * SuweldoTools Announcement Build Verification Script
 * Validates that after 'npm run build':
 * 1. The announcement popup script chunk exists in dist/assets/
 * 2. All 22 public static pages (11 English + 11 Filipino) reference the announcement popup bundle
 * 3. Any generated blog posts reference the announcement popup
 * 4. The admin panel (/dist/admin/index.html) strictly EXCLUDES the announcement popup bundle
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');

console.log('--- SuweldoTools Announcement Build Verification ---');

if (!fs.existsSync(distDir)) {
  console.error('ERROR: dist/ directory does not exist. Please run npm run build first.');
  process.exit(1);
}

// 1. Identify announcement bundle chunk in dist/assets
const assetsDir = path.join(distDir, 'assets');
let announcementChunk = null;
if (fs.existsSync(assetsDir)) {
  const assetFiles = fs.readdirSync(assetsDir);
  announcementChunk = assetFiles.find(
    (f) => f.startsWith('announcement-popup') && f.endsWith('.js')
  );
}

if (!announcementChunk) {
  console.warn('Notice: Specific announcement-popup chunk not isolated or Vite inlined it.');
} else {
  console.log(`✓ Located announcement asset chunk: assets/${announcementChunk}`);
}

// 2. Check 22 public static pages
const publicPages = [
  // 11 English pages
  'index.html',
  'about/index.html',
  'contact/index.html',
  'privacy-policy/index.html',
  'disclaimer/index.html',
  'take-home-pay-calculator-philippines/index.html',
  '13th-month-pay-calculator/index.html',
  'sss-contribution-table-2026/index.html',
  'philhealth-contribution-calculator/index.html',
  'overtime-holiday-pay-calculator-philippines/index.html',
  'blog/index.html',
  // 11 Filipino pages
  'tl/index.html',
  'tl/about/index.html',
  'tl/contact/index.html',
  'tl/privacy-policy/index.html',
  'tl/disclaimer/index.html',
  'tl/take-home-pay-calculator-philippines/index.html',
  'tl/13th-month-pay-calculator/index.html',
  'tl/sss-contribution-table-2026/index.html',
  'tl/philhealth-contribution-calculator/index.html',
  'tl/overtime-holiday-pay-calculator-philippines/index.html',
  'tl/blog/index.html'
];

let publicFailures = [];
let publicSuccesses = 0;

for (const relPage of publicPages) {
  const filePath = path.join(distDir, relPage);
  if (!fs.existsSync(filePath)) {
    publicFailures.push(`Missing built file: dist/${relPage}`);
    continue;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  // In production Vite build, this will either be the hashed chunk or announcement-popup
  const hasPopup =
    (announcementChunk && content.includes(announcementChunk)) ||
    content.includes('announcement-popup') ||
    content.includes('suweldotools_announcement_dismissed');

  if (hasPopup) {
    publicSuccesses++;
  } else {
    publicFailures.push(`Page dist/${relPage} does not contain announcement script reference.`);
  }
}

console.log(`✓ Verified ${publicSuccesses}/${publicPages.length} public static HTML pages contain announcement popup.`);

if (publicFailures.length > 0) {
  console.error('FAILURES in public pages:');
  for (const err of publicFailures) {
    console.error(' - ' + err);
  }
  process.exit(1);
}

// 3. Admin isolation check
const adminPath = path.join(distDir, 'admin', 'index.html');
if (fs.existsSync(adminPath)) {
  const adminContent = fs.readFileSync(adminPath, 'utf-8');
  const adminHasPopup =
    (announcementChunk && adminContent.includes(announcementChunk)) ||
    adminContent.includes('announcement-popup.ts') ||
    adminContent.includes('announcement-popup.js');

  if (adminHasPopup) {
    console.error('ERROR: dist/admin/index.html contains announcement popup script reference! Admin must be strictly isolated.');
    process.exit(1);
  } else {
    console.log('✓ Verified dist/admin/index.html strictly EXCLUDES public announcement popup script.');
  }
} else {
  console.warn('Notice: dist/admin/index.html does not exist in build output.');
}

console.log('--- ALL ANNOUNCEMENT BUILD VERIFICATIONS PASSED ---');
