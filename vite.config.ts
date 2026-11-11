import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {handleBrandedImageRequest} from './functions/images/[[path]].ts';
import {generatePublicBlog} from './scripts/generate-blog.ts';

export default defineConfig(() => {
  const rootDir = typeof import.meta.dirname !== 'undefined' ? import.meta.dirname : process.cwd();
  let activeBlogSyncPromise: Promise<unknown> | null = null;
  let lastBlogSyncAt = 0;

  const syncStaticBlogPages = async (force = false) => {
    const now = Date.now();
    if (!force && lastBlogSyncAt > 0 && now - lastBlogSyncAt < 2000) {
      if (activeBlogSyncPromise) {
        await activeBlogSyncPromise;
      }
      return;
    }
    if (!activeBlogSyncPromise) {
      activeBlogSyncPromise = generatePublicBlog()
        .then((res) => {
          if (res.status === 'generated') {
            lastBlogSyncAt = Date.now();
          }
          return res;
        })
        .catch((err) => {
          console.error('[vite-blog-sync] Failed to regenerate static blog pages:', err);
          return null;
        })
        .finally(() => {
          activeBlogSyncPromise = null;
        });
    }
    return activeBlogSyncPromise;
  };

  const mpaCleanUrlPlugin = {
    name: 'mpa-clean-url-rewrite',
    configureServer(server: {middlewares: {use: (fn: (req: {url?: string; method?: string; headers?: Record<string, string | string[] | undefined>}, res: any, next: () => void) => void) => void}}) {
      // Initial sync when dev server starts so static /blog/ and /tl/blog/ pages match Supabase
      void syncStaticBlogPages(true);

      server.middlewares.use(async (req, res, next) => {
        if (req.url) {
          const [pathname, search] = req.url.split('?');

          if (pathname === '/images' || pathname.startsWith('/images/')) {
            const reqHeaders = new Headers();
            if (req.headers) {
              for (const [key, val] of Object.entries(req.headers)) {
                if (typeof val === 'string') {
                  reqHeaders.set(key, val);
                } else if (Array.isArray(val)) {
                  reqHeaders.set(key, val.join(', '));
                }
              }
            }
            const method = (req.method || 'GET').toUpperCase();
            const fullReqUrl = `https://suweldotools.com${req.url}`;
            const webReq = new Request(fullReqUrl, {
              method,
              headers: reqHeaders,
            });

            const proxyRes = await handleBrandedImageRequest({
              request: webReq,
              env: {
                VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
                VITE_SUPABASE_BLOG_IMAGES_BUCKET: process.env.VITE_SUPABASE_BLOG_IMAGES_BUCKET,
              },
            });

            res.statusCode = proxyRes.status;
            proxyRes.headers.forEach((value, key) => {
              res.setHeader(key, value);
            });

            if (method === 'HEAD' || !proxyRes.body) {
              res.end();
              return;
            }

            const arrayBuffer = await proxyRes.arrayBuffer();
            res.end(Buffer.from(arrayBuffer));
            return;
          }

          if (pathname === '/__suweldotools/regenerate-blog' && req.method === 'POST') {
            const result = (await syncStaticBlogPages(true)) as {
              status?: string;
              enCount?: number;
              tlCount?: number;
              removedFiles?: string[];
              message?: string;
            } | null;
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                ok: Boolean(result && result.status === 'generated'),
                status: result?.status ?? 'error',
                enCount: result?.enCount ?? 0,
                tlCount: result?.tlCount ?? 0,
                removedCount: result?.removedFiles?.length ?? 0,
                message: result?.message ?? '',
              })
            );
            return;
          }

          const isPublicBlogRoute =
            pathname === '/blog' ||
            pathname === '/blog/' ||
            pathname.startsWith('/blog/') ||
            pathname === '/tl/blog' ||
            pathname === '/tl/blog/' ||
            pathname.startsWith('/tl/blog/');
          const isHtmlRoute = !path.extname(pathname) || pathname.endsWith('/index.html');

          if (isPublicBlogRoute && isHtmlRoute) {
            const normalizedDir = pathname.endsWith('/index.html')
              ? pathname.slice(0, -'/index.html'.length)
              : pathname.replace(/\/+$/, '');
            const targetIndexHtml = path.join(rootDir, normalizedDir, 'index.html');
            const missingArticleFile = !fs.existsSync(targetIndexHtml);
            await syncStaticBlogPages(missingArticleFile);
          }

          if (pathname && !pathname.endsWith('/') && !path.extname(pathname)) {
            const candidate = path.join(rootDir, pathname, 'index.html');
            if (fs.existsSync(candidate)) {
              req.url = pathname + '/' + (search ? '?' + search : '');
            }
          }
        }

        const origEnd = res.end.bind(res);
        res.end = function (chunk?: any, encodingOrCb?: any, cb?: any) {
          const contentType = String(
            res.getHeader?.('content-type') || res.getHeader?.('Content-Type') || ''
          ).toLowerCase();
          if (chunk && contentType.includes('text/html')) {
            const rawHtml =
              typeof chunk === 'string'
                ? chunk
                : Buffer.isBuffer(chunk)
                  ? chunk.toString('utf8')
                  : null;
            if (rawHtml && rawHtml.includes('https://suweldotools.com/images/')) {
              const rewrittenHtml = rawHtml.replaceAll(
                'https://suweldotools.com/images/',
                '/images/'
              );
              if (res.getHeader?.('content-length') || res.getHeader?.('Content-Length')) {
                res.setHeader('Content-Length', Buffer.byteLength(rewrittenHtml, 'utf8'));
              }
              return origEnd(
                Buffer.isBuffer(chunk) ? Buffer.from(rewrittenHtml, 'utf8') : rewrittenHtml,
                encodingOrCb,
                cb
              );
            }
          }
          return origEnd(chunk, encodingOrCb, cb);
        };

        next();
      });
    },
  };
  const staticInputs: Record<string, string> = {
    main: path.resolve(rootDir, 'index.html'),
    calculators: path.resolve(rootDir, 'calculators/index.html'),
    takeHomePay: path.resolve(rootDir, 'take-home-pay-calculator-philippines/index.html'),
    thirteenthMonth: path.resolve(rootDir, '13th-month-pay-calculator/index.html'),
    sssTable: path.resolve(rootDir, 'sss-contribution-table-2026/index.html'),
    about: path.resolve(rootDir, 'about/index.html'),
    privacy: path.resolve(rootDir, 'privacy-policy/index.html'),
    contact: path.resolve(rootDir, 'contact/index.html'),
    disclaimer: path.resolve(rootDir, 'disclaimer/index.html'),
    sources: path.resolve(rootDir, 'sources/index.html'),
    editorialPolicy: path.resolve(rootDir, 'editorial-policy/index.html'),
    correctionsPolicy: path.resolve(rootDir, 'corrections-policy/index.html'),
    authorMohammadIrfan: path.resolve(rootDir, 'authors/mohammad-irfan/index.html'),
    philhealth: path.resolve(rootDir, 'philhealth-contribution-calculator/index.html'),
    overtimeHoliday: path.resolve(rootDir, 'overtime-holiday-pay-calculator-philippines/index.html'),
    pagibigMp2: path.resolve(rootDir, 'pagibig-mp2-savings-estimator/index.html'),
    finalPay: path.resolve(rootDir, 'final-pay-calculator-philippines/index.html'),
    blog: path.resolve(rootDir, 'blog/index.html'),
    tlMain: path.resolve(rootDir, 'tl/index.html'),
    tlCalculators: path.resolve(rootDir, 'tl/calculators/index.html'),
    tlTakeHomePay: path.resolve(rootDir, 'tl/take-home-pay-calculator-philippines/index.html'),
    tlThirteenthMonth: path.resolve(rootDir, 'tl/13th-month-pay-calculator/index.html'),
    tlSssTable: path.resolve(rootDir, 'tl/sss-contribution-table-2026/index.html'),
    tlAbout: path.resolve(rootDir, 'tl/about/index.html'),
    tlPrivacy: path.resolve(rootDir, 'tl/privacy-policy/index.html'),
    tlContact: path.resolve(rootDir, 'tl/contact/index.html'),
    tlDisclaimer: path.resolve(rootDir, 'tl/disclaimer/index.html'),
    tlSources: path.resolve(rootDir, 'tl/sources/index.html'),
    tlEditorialPolicy: path.resolve(rootDir, 'tl/editorial-policy/index.html'),
    tlCorrectionsPolicy: path.resolve(rootDir, 'tl/corrections-policy/index.html'),
    tlAuthorMohammadIrfan: path.resolve(rootDir, 'tl/authors/mohammad-irfan/index.html'),
    tlPhilhealth: path.resolve(rootDir, 'tl/philhealth-contribution-calculator/index.html'),
    tlOvertimeHoliday: path.resolve(rootDir, 'tl/overtime-holiday-pay-calculator-philippines/index.html'),
    tlPagibigMp2: path.resolve(rootDir, 'tl/pagibig-mp2-savings-estimator/index.html'),
    tlFinalPay: path.resolve(rootDir, 'tl/final-pay-calculator-philippines/index.html'),
    tlBlog: path.resolve(rootDir, 'tl/blog/index.html'),
    admin: path.resolve(rootDir, 'admin/index.html'),
  };

  const existingStaticInputs = Object.fromEntries(
    Object.entries(staticInputs).filter(([, filePath]) => fs.existsSync(filePath))
  );
  const seenInputPaths = new Set<string>(Object.values(existingStaticInputs));
  const validSlugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const generatorOwnershipMarker = '<!-- SUWELDOTOOLS_GENERATED_BLOG_POST -->';

  const discoverGeneratedBlogInputs = (blogSubdir: string, keyPrefix: string): Record<string, string> => {
    const discovered: Record<string, string> = {};
    const absBlogDir = path.resolve(rootDir, blogSubdir);
    if (!fs.existsSync(absBlogDir)) return discovered;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(absBlogDir, {withFileTypes: true});
    } catch {
      return discovered;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      if (!validSlugRegex.test(entry.name)) continue;

      const articleHtmlPath = path.resolve(absBlogDir, entry.name, 'index.html');
      if (seenInputPaths.has(articleHtmlPath) || !fs.existsSync(articleHtmlPath)) continue;

      try {
        const htmlContent = fs.readFileSync(articleHtmlPath, 'utf8');
        if (!htmlContent.includes(generatorOwnershipMarker)) continue;
        seenInputPaths.add(articleHtmlPath);
        discovered[`${keyPrefix}_${entry.name}`] = articleHtmlPath;
      } catch {
        continue;
      }
    }

    return discovered;
  };

  const COOKIE_CONSENT_HEAD_SNIPPET = `    <!-- Cookie Consent & Strict GA4 Controller -->
    <script src="/js/cookie-consent.js" defer></script>`;

  const ga4InjectionPlugin = {
    name: 'suweldotools-ga4-injection',
    transformIndexHtml(html: string, ctx?: {path?: string; filename?: string}) {
      const normalizedPath = (ctx?.path || '').replace(/\\/g, '/');
      const normalizedFilename = (ctx?.filename || '').replace(/\\/g, '/');

      if (
        normalizedPath === '/admin' ||
        normalizedPath.startsWith('/admin/') ||
        normalizedFilename.endsWith('/admin/index.html')
      ) {
        return html;
      }

      let transformed = html;

      if (!transformed.includes('/js/cookie-consent.js') && transformed.includes('</head>')) {
        transformed = transformed.replace('</head>', `${COOKIE_CONSENT_HEAD_SNIPPET}\n  </head>`);
      }

      if (!transformed.includes('data-cookie-settings-trigger') && transformed.includes('<footer')) {
        const isFilipinoPage =
          /<html[^>]*\blang=["'](?:tl|fil)/i.test(transformed) ||
          normalizedPath === '/tl' ||
          normalizedPath.startsWith('/tl/') ||
          normalizedFilename.includes('/tl/');
        const footerLabel = isFilipinoPage ? 'Mga Setting ng Cookie' : 'Cookie Settings';
        const footerBtnItem = `              <li>\n                <button type="button" id="cookieSettingsFooterBtn" data-cookie-settings-trigger class="text-slate-600 hover:text-emerald-700 transition-colors duration-150 inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 cursor-pointer text-left">${footerLabel}</button>\n              </li>`;

        transformed = transformed.replace(
          /(<li>\s*<a[^>]+href=["']\/(?:tl\/)?disclaimer\/["'][^>]*>[\s\S]*?<\/a>\s*<\/li>)/i,
          `$1\n${footerBtnItem}`
        );
      }

      return transformed;
    },
  };

  return {
    appType: 'mpa' as const,
    plugins: [mpaCleanUrlPlugin, ga4InjectionPlugin, tailwindcss()],
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          ...existingStaticInputs,
          ...discoverGeneratedBlogInputs('blog', 'blogArticle'),
          ...discoverGeneratedBlogInputs('tl/blog', 'tlBlogArticle'),
        },
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
