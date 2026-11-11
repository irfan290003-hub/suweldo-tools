/**
 * Cloudflare Pages Function: Branded Blog Image Proxy
 * Route: /images/YYYY/MM/filename.(webp|png|jpg|jpeg)
 * Maps to Supabase Storage public object:
 *   https://otsdwsbaehwwlglxmnel.supabase.co/storage/v1/object/public/blog-images/featured/YYYY-MM/filename.ext
 */

const DEFAULT_SUPABASE_ORIGIN = 'https://otsdwsbaehwwlglxmnel.supabase.co';
const DEFAULT_BLOG_IMAGES_BUCKET = 'blog-images';

const YEAR_REGEX = /^\d{4}$/;
const MONTH_REGEX = /^(0[1-9]|1[0-2])$/;
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}\.(webp|png|jpg|jpeg)$/i;

const EXTENSION_MIME_MAP: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export interface PagesFunctionEnv {
  VITE_SUPABASE_URL?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_BLOG_IMAGES_BUCKET?: string;
}

export interface PagesFunctionContext {
  request: Request;
  params?: {
    path?: string | string[];
  };
  env?: PagesFunctionEnv;
}

export interface ValidatedBrandedImagePath {
  year: string;
  month: string;
  filename: string;
  extension: 'webp' | 'png' | 'jpg' | 'jpeg';
  contentType: string;
  objectPath: string;
}

/**
 * Strictly validates a raw request URL or pathname for `/images/YYYY/MM/filename.ext`.
 * Rejects path traversal (`..`), encoded traversal (`%2e`, `%2f`, `%5c`, `%00`),
 * backslashes, extra segments, invalid year/month ranges, and unsupported extensions.
 */
export function parseAndValidateBrandedImageRequest(
  rawUrlOrPathname: string
): { ok: true; data: ValidatedBrandedImagePath } | { ok: false; reason: string } {
  if (!rawUrlOrPathname || typeof rawUrlOrPathname !== 'string') {
    return { ok: false, reason: 'Empty URL' };
  }

  // Inspect the raw string before URL parsing normalizes dot-segments or backslashes
  if (
    rawUrlOrPathname.includes('\\') ||
    /%2e/i.test(rawUrlOrPathname) ||
    /%2f/i.test(rawUrlOrPathname) ||
    /%5c/i.test(rawUrlOrPathname) ||
    /%00/i.test(rawUrlOrPathname) ||
    /[\x00-\x1f\x7f]/.test(rawUrlOrPathname)
  ) {
    return { ok: false, reason: 'Unsafe characters or encoded traversal in URL' };
  }

  let pathname = rawUrlOrPathname;
  if (rawUrlOrPathname.startsWith('http://') || rawUrlOrPathname.startsWith('https://')) {
    try {
      const schemeEnd = rawUrlOrPathname.indexOf('://');
      const afterHostIdx = rawUrlOrPathname.indexOf('/', schemeEnd + 3);
      const rawPathPart =
        afterHostIdx === -1 ? '/' : rawUrlOrPathname.slice(afterHostIdx).split(/[?#]/)[0];
      if (
        rawPathPart.includes('//') ||
        rawPathPart.includes('/..') ||
        rawPathPart.includes('../') ||
        rawPathPart.includes('/./') ||
        rawPathPart.endsWith('/.')
      ) {
        return { ok: false, reason: 'Path traversal or duplicate slashes detected' };
      }
      const parsedUrl = new URL(rawUrlOrPathname);
      pathname = parsedUrl.pathname;
    } catch {
      return { ok: false, reason: 'Malformed request URL' };
    }
  } else {
    pathname = rawUrlOrPathname.split(/[?#]/)[0];
    if (
      pathname.includes('//') ||
      pathname.includes('/..') ||
      pathname.includes('../') ||
      pathname.includes('/./') ||
      pathname.endsWith('/.')
    ) {
      return { ok: false, reason: 'Path traversal or duplicate slashes detected' };
    }
  }

  if (!pathname.startsWith('/images/')) {
    return { ok: false, reason: 'Path does not start with /images/' };
  }

  const relativePath = pathname.slice('/images/'.length);
  if (!relativePath || relativePath.endsWith('/')) {
    return { ok: false, reason: 'Missing image path segments' };
  }

  const segments = relativePath.split('/');
  if (segments.length !== 3) {
    return { ok: false, reason: 'Expected exactly /images/YYYY/MM/filename.ext' };
  }

  const [year, month, filename] = segments;

  if (!YEAR_REGEX.test(year)) {
    return { ok: false, reason: 'Invalid 4-digit year' };
  }
  const yearNum = Number(year);
  if (yearNum < 2000 || yearNum > 2100) {
    return { ok: false, reason: 'Year out of supported range (2000-2100)' };
  }

  if (!MONTH_REGEX.test(month)) {
    return { ok: false, reason: 'Invalid 2-digit month (01-12)' };
  }

  if (!filename || filename.includes('..') || !SAFE_FILENAME_REGEX.test(filename)) {
    return { ok: false, reason: 'Invalid filename or unsupported image extension' };
  }

  const dotIdx = filename.lastIndexOf('.');
  const ext = filename.slice(dotIdx + 1).toLowerCase() as 'webp' | 'png' | 'jpg' | 'jpeg';
  const contentType = EXTENSION_MIME_MAP[ext];
  if (!contentType) {
    return { ok: false, reason: 'Unsupported image extension' };
  }

  const objectPath = `featured/${year}-${month}/${filename}`;

  return {
    ok: true,
    data: {
      year,
      month,
      filename,
      extension: ext,
      contentType,
      objectPath,
    },
  };
}

/**
 * Resolves the upstream Supabase Storage public object URL for a validated image path.
 */
export function buildSupabaseStorageObjectUrl(
  validated: ValidatedBrandedImagePath,
  env?: PagesFunctionEnv
): string {
  const rawOrigin = (env?.VITE_SUPABASE_URL || env?.SUPABASE_URL || DEFAULT_SUPABASE_ORIGIN).trim();
  let origin = DEFAULT_SUPABASE_ORIGIN;
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      origin = parsed.origin;
    }
  } catch {
    origin = DEFAULT_SUPABASE_ORIGIN;
  }

  const rawBucket = (env?.VITE_SUPABASE_BLOG_IMAGES_BUCKET || DEFAULT_BLOG_IMAGES_BUCKET).trim();
  const bucket = /^[a-zA-Z0-9._-]+$/.test(rawBucket) ? rawBucket : DEFAULT_BLOG_IMAGES_BUCKET;

  return `${origin}/storage/v1/object/public/${bucket}/${validated.objectPath}`;
}

function createNotFoundResponse(isHead: boolean): Response {
  return new Response(isHead ? null : 'Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function createMethodNotAllowedResponse(): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: {
      Allow: 'GET, HEAD',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * Core handler for Cloudflare Pages Function (`onRequest`) and unit tests.
 */
export async function handleBrandedImageRequest(
  context: PagesFunctionContext,
  customFetch: typeof fetch = fetch
): Promise<Response> {
  const { request, env } = context;
  const method = (request.method || 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    return createMethodNotAllowedResponse();
  }

  const isHead = method === 'HEAD';
  const validation = parseAndValidateBrandedImageRequest(request.url);
  if (!validation.ok) {
    return createNotFoundResponse(isHead);
  }

  // If Cloudflare Pages also provides `params.path`, ensure it matches the 3 expected segments
  if (context.params && context.params.path !== undefined) {
    const paramSegments = Array.isArray(context.params.path)
      ? context.params.path
      : String(context.params.path).split('/');
    if (
      paramSegments.length !== 3 ||
      paramSegments[0] !== validation.data.year ||
      paramSegments[1] !== validation.data.month ||
      paramSegments[2] !== validation.data.filename
    ) {
      return createNotFoundResponse(isHead);
    }
  }

  const upstreamUrl = buildSupabaseStorageObjectUrl(validation.data, env);

  const upstreamHeaders = new Headers();
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch) {
    upstreamHeaders.set('If-None-Match', ifNoneMatch);
  }
  const ifModifiedSince = request.headers.get('if-modified-since');
  if (ifModifiedSince) {
    upstreamHeaders.set('If-Modified-Since', ifModifiedSince);
  }

  try {
    const upstreamResponse = await customFetch(upstreamUrl, {
      method,
      headers: upstreamHeaders,
      redirect: 'manual',
    });

    if (upstreamResponse.status === 304) {
      const headers = new Headers();
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');
      const etag = upstreamResponse.headers.get('etag');
      if (etag) headers.set('ETag', etag);
      return new Response(null, { status: 304, headers });
    }

    // Supabase Storage returns 404 or 400 (with JSON {"statusCode":"404"}) when a public object does not exist
    if (upstreamResponse.status === 404 || upstreamResponse.status === 400) {
      return createNotFoundResponse(isHead);
    }

    if (!upstreamResponse.ok) {
      return new Response(isHead ? null : 'Bad Gateway', {
        status: 502,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const upstreamContentType = (upstreamResponse.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const resolvedContentType =
      upstreamContentType === 'image/webp' ||
      upstreamContentType === 'image/png' ||
      upstreamContentType === 'image/jpeg'
        ? upstreamContentType
        : validation.data.contentType;

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', resolvedContentType);
    responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');

    const contentLength = upstreamResponse.headers.get('content-length');
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }
    const etag = upstreamResponse.headers.get('etag');
    if (etag) {
      responseHeaders.set('ETag', etag);
    }
    const lastModified = upstreamResponse.headers.get('last-modified');
    if (lastModified) {
      responseHeaders.set('Last-Modified', lastModified);
    }

    return new Response(isHead ? null : upstreamResponse.body, {
      status: 200,
      headers: responseHeaders,
    });
  } catch {
    return new Response(isHead ? null : 'Bad Gateway', {
      status: 502,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}

export const onRequest = (context: PagesFunctionContext): Promise<Response> => {
  return handleBrandedImageRequest(context);
};
