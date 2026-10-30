import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as htmlparser2 from 'htmlparser2';

const require = createRequire(import.meta.url);

// In Node/Bun test environments, provide a standard inert DOMParser and createHTMLDocument shim
// matching browser behavior using htmlparser2 (already installed via sanitize-html dependency).
function setupTestDomEnvironment() {
  function createInertDocument(html: string) {
    const handlerDom = htmlparser2.parseDocument(html, {
      recognizeSelfClosing: true,
      lowerCaseTags: false
    });

    function convert(hNode: any): any {
      if (hNode.type === 'text') {
        return {
          nodeType: 3,
          nodeValue: hNode.data,
          nextSibling: null
        };
      }
      if (hNode.type === 'tag' || hNode.type === 'script' || hNode.type === 'style') {
        const el: any = {
          nodeType: 1,
          tagName: hNode.name.toUpperCase(),
          attributes: Object.entries(hNode.attribs || {}).map(([name, value]) => ({
            name,
            value: String(value)
          })),
          firstChild: null,
          nextSibling: null
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
      firstChild: null
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
          }
        };
        return el;
      },
      createTextNode(val: any) {
        return {
          nodeType: 3,
          nodeValue: String(val),
          nextSibling: null
        };
      },
      createDocumentFragment() {
        const frag = this.createElement('FRAGMENT');
        frag.nodeType = 11;
        return frag;
      }
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
      }
    }
  };
}

// Initialize environment before importing blog-admin module
setupTestDomEnvironment();
const blogAdmin = require('../public/js/blog-admin.js');
const { renderSafeAdminArticleContent, isSafePreviewUrl, sanitizeAdminHtml } = blogAdmin;

describe('Admin Preview renderSafeAdminArticleContent', () => {
  it('Scenario 1: renders a raw HTML table and headings without tag escaping', () => {
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

    const result = renderSafeAdminArticleContent(rawTable);
    assert.match(result, /<table/);
    assert.match(result, /<thead>\s*<tr>\s*<th scope="col" colspan="2">Salary Bracket<\/th>\s*<\/tr>\s*<\/thead>/);
    assert.match(result, /<tbody>\s*<tr>\s*<td>₱20,000<\/td>\s*<td>₱3,000<\/td>\s*<\/tr>/);
    assert.match(result, /<\/table>/);
    // Table must not be wrapped inside a <p> tag
    assert.doesNotMatch(result, /<p[^>]*>\s*<table/);
    // Headings must not be escaped into visible literal &lt;table&gt;
    assert.doesNotMatch(result, /&lt;table&gt;/);

    const rawHeadings = `
<h2>Philippine Statutory Contributions</h2>

<h3>SSS Contribution Changes</h3>

<h4>Quarterly Reporting Notes</h4>
`.trim();

    const headingResult = renderSafeAdminArticleContent(rawHeadings);
    assert.match(headingResult, /<h2>Philippine Statutory Contributions<\/h2>/);
    assert.match(headingResult, /<h3>SSS Contribution Changes<\/h3>/);
    assert.match(headingResult, /<h4>Quarterly Reporting Notes<\/h4>/);
    assert.doesNotMatch(headingResult, /&lt;h2&gt;/);
  });

  it('Scenario 2: preserves safe HTTPS and relative links with rel="noopener noreferrer" on target="_blank"', () => {
    const input = `
Visit the <a href="https://suweldotools.com/blog/" title="SuweldoTools Blog" target="_blank">official blog</a>.

Or use our <a href="/take-home-pay-calculator-philippines/">Take-Home Pay Calculator</a> directly.
`.trim();

    const result = renderSafeAdminArticleContent(input);
    assert.match(
      result,
      /<a href="https:\/\/suweldotools\.com\/blog\/" title="SuweldoTools Blog" target="_blank" rel="noopener noreferrer">official blog<\/a>/
    );
    assert.match(result, /<a href="\/take-home-pay-calculator-philippines\/">Take-Home Pay Calculator<\/a>/);
  });

  it('Scenario 3: strips script tags and active event-handler attributes (onclick, onerror, onmouseover)', () => {
    const input = `
<script>alert("xss")</script>
<p onclick="alert('click')">Paragraph with action</p>
<img src="x" onerror="alert('error')" />
<a href="https://example.com" onmouseover="alert('hover')">Hover me</a>
`.trim();

    const result = renderSafeAdminArticleContent(input);
    // <script> must be completely stripped
    assert.doesNotMatch(result, /<script/i);
    assert.doesNotMatch(result, /alert\("xss"\)/);
    // Event handlers must be removed
    assert.doesNotMatch(result, /onclick/i);
    assert.doesNotMatch(result, /onerror/i);
    assert.doesNotMatch(result, /onmouseover/i);
    // <img> is not in allowed preview tags, so it is stripped
    assert.doesNotMatch(result, /<img/i);
    // Content of safe elements should remain intact without dangerous attributes
    assert.match(result, /Paragraph with action/);
    assert.match(result, /<a href="https:\/\/example\.com">Hover me<\/a>/);
  });

  it('Scenario 4: blocks javascript:, data:, and protocol-relative // URLs', () => {
    const input = `
<a href="javascript:alert(1)">Dangerous JS Link</a>
<a href="javascript:void(0)">Void Link</a>
<a href="data:text/html,<script>alert(1)</script>">Data URI Link</a>
<a href="//evil.com/phish">Protocol Relative Link</a>
`.trim();

    const result = renderSafeAdminArticleContent(input);
    assert.doesNotMatch(result, /href="javascript:/i);
    assert.doesNotMatch(result, /href="data:/i);
    assert.doesNotMatch(result, /href="\/\//i);
    // The tag is preserved safely without the unsafe href attribute
    assert.match(result, /<a>Dangerous JS Link<\/a>/);
    assert.match(result, /<a>Void Link<\/a>/);
    assert.match(result, /<a>Data URI Link<\/a>/);
    assert.match(result, /<a>Protocol Relative Link<\/a>/);

    // Direct url validation checks
    assert.equal(isSafePreviewUrl('https://suweldotools.com'), true);
    assert.equal(isSafePreviewUrl('/blog/'), true);
    assert.equal(isSafePreviewUrl('mailto:support@suweldotools.com'), true);
    assert.equal(isSafePreviewUrl('javascript:alert(1)'), false);
    assert.equal(isSafePreviewUrl('data:text/html,abc'), false);
    assert.equal(isSafePreviewUrl('//evil.com/phish'), false);
    assert.equal(isSafePreviewUrl('\\\\evil.com\\phish'), false);
  });

  it('Scenario 5: preserves existing Markdown headings, lists, and horizontal rules', () => {
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

    const result = renderSafeAdminArticleContent(input);
    assert.match(
      result,
      /<h2 class="text-xl sm:text-2xl font-bold text-slate-900 mt-8 mb-3">Overview of 2026 Payroll Rules<\/h2>/
    );
    assert.match(
      result,
      /<h3 class="text-lg sm:text-xl font-bold text-slate-900 mt-6 mb-2">Employee Deductions<\/h3>/
    );
    assert.match(
      result,
      /<h4 class="text-base sm:text-lg font-bold text-slate-900 mt-4 mb-2">Important Notes<\/h4>/
    );
    assert.match(result, /<ul class="list-disc pl-5 space-y-2 text-slate-700 my-4">/);
    assert.match(result, /<li class="leading-relaxed">Social Security System \(SSS\)<\/li>/);
    assert.match(result, /<ol class="list-decimal pl-5 space-y-2 text-slate-700 my-4">/);
    assert.match(result, /<li class="leading-relaxed">Determine gross basic monthly pay\.<\/li>/);
    assert.match(result, /<hr class="my-8 border-slate-200" \/>/);
  });

  it('Scenario 6: escapes plain text characters properly without corrupting legitimate tags', () => {
    const input = `
Compare: Salary < ₱20,000 & Net Pay > ₱15,000 for employees.
`.trim();

    const result = renderSafeAdminArticleContent(input);
    assert.match(result, /Salary &lt; ₱20,000 &amp; Net Pay &gt; ₱15,000/);
    assert.doesNotMatch(result, /< ₱20,000/);
  });
});
