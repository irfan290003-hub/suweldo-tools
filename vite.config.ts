import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {generatePublicBlog} from './scripts/generate-blog';

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
    configureServer(server: {middlewares: {use: (fn: (req: {url?: string; method?: string}, res: any, next: () => void) => void) => void}}) {
      // Initial sync when dev server starts so static /blog/ and /tl/blog/ pages match Supabase
      void syncStaticBlogPages(true);

      server.middlewares.use(async (req, res, next) => {
        if (req.url) {
          const [pathname, search] = req.url.split('?');

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
        next();
      });
    },
  };
  const staticInputs: Record<string, string> = {
    main: path.resolve(rootDir, 'index.html'),
    takeHomePay: path.resolve(rootDir, 'take-home-pay-calculator-philippines/index.html'),
    thirteenthMonth: path.resolve(rootDir, '13th-month-pay-calculator/index.html'),
    sssTable: path.resolve(rootDir, 'sss-contribution-table-2026/index.html'),
    about: path.resolve(rootDir, 'about/index.html'),
    privacy: path.resolve(rootDir, 'privacy-policy/index.html'),
    contact: path.resolve(rootDir, 'contact/index.html'),
    disclaimer: path.resolve(rootDir, 'disclaimer/index.html'),
    philhealth: path.resolve(rootDir, 'philhealth-contribution-calculator/index.html'),
    overtimeHoliday: path.resolve(rootDir, 'overtime-holiday-pay-calculator-philippines/index.html'),
    blog: path.resolve(rootDir, 'blog/index.html'),
    tlMain: path.resolve(rootDir, 'tl/index.html'),
    tlTakeHomePay: path.resolve(rootDir, 'tl/take-home-pay-calculator-philippines/index.html'),
    tlThirteenthMonth: path.resolve(rootDir, 'tl/13th-month-pay-calculator/index.html'),
    tlSssTable: path.resolve(rootDir, 'tl/sss-contribution-table-2026/index.html'),
    tlAbout: path.resolve(rootDir, 'tl/about/index.html'),
    tlPrivacy: path.resolve(rootDir, 'tl/privacy-policy/index.html'),
    tlContact: path.resolve(rootDir, 'tl/contact/index.html'),
    tlDisclaimer: path.resolve(rootDir, 'tl/disclaimer/index.html'),
    tlPhilhealth: path.resolve(rootDir, 'tl/philhealth-contribution-calculator/index.html'),
    tlOvertimeHoliday: path.resolve(rootDir, 'tl/overtime-holiday-pay-calculator-philippines/index.html'),
    tlBlog: path.resolve(rootDir, 'tl/blog/index.html'),
    admin: path.resolve(rootDir, 'admin/index.html'),
  };

  const seenInputPaths = new Set<string>(Object.values(staticInputs));
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

  const GA4_MEASUREMENT_ID = 'G-E3Z696ZY0J';
  const GA4_HEAD_SNIPPET = `    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('set', 'allow_google_signals', false);
      gtag('set', 'allow_ad_personalization_signals', false);
      gtag('config', '${GA4_MEASUREMENT_ID}');
    </script>`;

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

      if (
        html.includes(GA4_MEASUREMENT_ID) ||
        html.includes('googletagmanager.com/gtag/js')
      ) {
        return html;
      }

      if (html.includes('</head>')) {
        return html.replace('</head>', `${GA4_HEAD_SNIPPET}\n  </head>`);
      }

      return html;
    },
  };

  return {
    appType: 'mpa' as const,
    plugins: [mpaCleanUrlPlugin, ga4InjectionPlugin, react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          ...staticInputs,
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
