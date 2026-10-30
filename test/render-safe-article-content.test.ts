import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderSafeArticleContent } from '../scripts/generate-blog';

describe('renderSafeArticleContent', () => {
  it('renders a raw HTML table with headers and data rows as a table element', () => {
    const rawTable = `
<table class="min-w-full">
  <thead>
    <tr>
      <th scope="col" colspan="2">Salary Bracket</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>₱20,000</td>
      <td>₱3,000</td>
    </tr>
    <tr>
      <td>₱30,000</td>
      <td>₱4,500</td>
    </tr>
  </tbody>
</table>
`.trim();

    const result = renderSafeArticleContent(rawTable);
    assert.match(result, /<table/);
    assert.match(result, /<thead>\s*<tr>\s*<th scope="col" colspan="2">Salary Bracket<\/th>\s*<\/tr>\s*<\/thead>/);
    assert.match(result, /<tbody>\s*<tr>\s*<td>₱20,000<\/td>\s*<td>₱3,000<\/td>\s*<\/tr>/);
    assert.match(result, /<\/table>/);
    // Table must not be wrapped inside a <p> tag
    assert.doesNotMatch(result, /<p[^>]*>\s*<table/);
  });

  it('renders raw HTML headings as heading elements', () => {
    const input = `
<h2>Philippine Statutory Contributions</h2>

<h3>SSS Contribution Changes</h3>

<h4>Quarterly Reporting Notes</h4>
`.trim();

    const result = renderSafeArticleContent(input);
    assert.match(result, /<h2>Philippine Statutory Contributions<\/h2>/);
    assert.match(result, /<h3>SSS Contribution Changes<\/h3>/);
    assert.match(result, /<h4>Quarterly Reporting Notes<\/h4>/);
    // Headings must not be escaped into visible literal tags like &lt;h2&gt;
    assert.doesNotMatch(result, /&lt;h2&gt;/);
  });

  it('preserves safe HTTPS and relative links and keeps them clickable', () => {
    const input = `
Visit the <a href="https://suweldotools.com/blog/" title="SuweldoTools Blog" target="_blank">official blog</a>.

Or use our <a href="/take-home-pay-calculator-philippines/">Take-Home Pay Calculator</a> directly.
`.trim();

    const result = renderSafeArticleContent(input);
    assert.match(result, /<a href="https:\/\/suweldotools\.com\/blog\/" title="SuweldoTools Blog" target="_blank" rel="noopener noreferrer">official blog<\/a>/);
    assert.match(result, /<a href="\/take-home-pay-calculator-philippines\/">Take-Home Pay Calculator<\/a>/);
  });

  it('prevents script tags and event-handler attributes from executing', () => {
    const input = `
<script>alert("xss")</script>
<p onclick="alert('click')">Paragraph with action</p>
<img src="x" onerror="alert('error')" />
<a href="https://example.com" onmouseover="alert('hover')">Hover me</a>
`.trim();

    const result = renderSafeArticleContent(input);
    // <script> must be completely stripped
    assert.doesNotMatch(result, /<script/i);
    assert.doesNotMatch(result, /alert\("xss"\)/);
    // Event handlers must be removed
    assert.doesNotMatch(result, /onclick/i);
    assert.doesNotMatch(result, /onerror/i);
    assert.doesNotMatch(result, /onmouseover/i);
    // <img> is not in allowedTags, so it is stripped
    assert.doesNotMatch(result, /<img/i);
    // Content of safe elements should remain intact without dangerous attributes
    assert.match(result, /<p>Paragraph with action<\/p>/);
    assert.match(result, /<a href="https:\/\/example\.com">Hover me<\/a>/);
  });

  it('removes or neutralizes javascript: and data: links', () => {
    const input = `
<a href="javascript:alert(1)">Dangerous JS Link</a>
<a href="javascript:void(0)">Void Link</a>
<a href="data:text/html,<script>alert(1)</script>">Data URI Link</a>
<a href="//evil.com/phish">Protocol Relative Link</a>
`.trim();

    const result = renderSafeArticleContent(input);
    assert.doesNotMatch(result, /href="javascript:/i);
    assert.doesNotMatch(result, /href="data:/i);
    assert.doesNotMatch(result, /href="\/\//i);
    // Tag should be present without the unsafe href attribute
    assert.match(result, /<a>Dangerous JS Link<\/a>/);
    assert.match(result, /<a>Void Link<\/a>/);
    assert.match(result, /<a>Data URI Link<\/a>/);
    assert.match(result, /<a>Protocol Relative Link<\/a>/);
  });

  it('preserves existing Markdown headings, lists, and horizontal rules correctly', () => {
    const input = `
## Overview of 2026 Payroll Rules

### Employee Deductions

#### Important Notes

Here are the key deductions:
- Social Security System (SSS)
- PhilHealth National Health Insurance
* Pag-IBIG Fund Housing Contribution

Steps to compute:
1. Determine gross basic monthly pay.
2. Deduct mandatory statutory contributions.
3. Compute BIR withholding tax.

---
`.trim();

    const result = renderSafeArticleContent(input);
    assert.match(result, /<h2 class="text-xl sm:text-2xl font-bold text-slate-900 mt-8 mb-3">Overview of 2026 Payroll Rules<\/h2>/);
    assert.match(result, /<h3 class="text-lg sm:text-xl font-bold text-slate-900 mt-6 mb-2">Employee Deductions<\/h3>/);
    assert.match(result, /<h4 class="text-base sm:text-lg font-bold text-slate-900 mt-4 mb-2">Important Notes<\/h4>/);
    assert.match(result, /<ul class="list-disc pl-5 space-y-2 text-slate-700 my-4">/);
    assert.match(result, /<li class="leading-relaxed">Social Security System \(SSS\)<\/li>/);
    assert.match(result, /<ol class="list-decimal pl-5 space-y-2 text-slate-700 my-4">/);
    assert.match(result, /<li class="leading-relaxed">Determine gross basic monthly pay\.<\/li>/);
    assert.match(result, /<hr class="my-8 border-slate-200" \/>/);
  });

  it('escapes plain text characters properly without corrupting legitimate tags', () => {
    const input = `
Compare: Salary < ₱20,000 & Net Pay > ₱15,000 for employees.
`.trim();

    const result = renderSafeArticleContent(input);
    assert.match(result, /Salary &lt; ₱20,000 &amp; Net Pay &gt; ₱15,000/);
    assert.doesNotMatch(result, /< ₱20,000/);
  });

  it('handles mixed Markdown and HTML content smoothly', () => {
    const input = `
## 2026 Contribution Rates

Here is the statutory breakdown:

<table>
  <thead>
    <tr><th>Agency</th><th>Rate</th></tr>
  </thead>
  <tbody>
    <tr><td>SSS</td><td>15%</td></tr>
  </tbody>
</table>

Refer to the <a href="https://suweldotools.com/contact/">contact page</a> for assistance:
- Always confirm with your HR department.
- Check official DOLE bulletins.
`.trim();

    const result = renderSafeArticleContent(input);
    assert.match(result, /<h2 class="text-xl sm:text-2xl font-bold text-slate-900 mt-8 mb-3">2026 Contribution Rates<\/h2>/);
    assert.match(result, /<p class="text-base text-slate-700 leading-relaxed my-4">\s*Here is the statutory breakdown:\s*<\/p>/);
    assert.match(result, /<table>\s*<thead>\s*<tr><th>Agency<\/th><th>Rate<\/th><\/tr>\s*<\/thead>/);
    assert.match(result, /<a href="https:\/\/suweldotools\.com\/contact\/">contact page<\/a>/);
    assert.match(result, /<ul class="list-disc pl-5 space-y-2 text-slate-700 my-4">/);
    assert.match(result, /<li class="leading-relaxed">Always confirm with your HR department\.<\/li>/);
  });
});
