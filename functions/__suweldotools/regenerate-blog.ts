/**
 * SuweldoTools — Cloudflare Pages Function for Production Static Blog Regeneration
 *
 * Route: POST /__suweldotools/regenerate-blog
 *
 * Why this exists:
 * - Public blog pages (/blog/* and /tl/blog/*) are statically generated at build time
 *   by `scripts/generate-blog.ts` (`bun run generate:blog && vite build`).
 * - In local Vite development, `/__suweldotools/regenerate-blog` is handled by Vite
 *   dev-server middleware in `vite.config.ts`, which spawns `scripts/generate-blog.ts`
 *   locally and writes updated HTML files to disk immediately (`status: "generated"`).
 * - On production Cloudflare Pages, there is no persistent filesystem or Vite dev server.
 *   To regenerate static public blog HTML pages when an admin publishes, updates, or
 *   deletes a blog post, this Cloudflare Pages Function authenticates the administrator
 *   server-side against Supabase Auth + `public.blog_admins` RLS and triggers a fresh
 *   Cloudflare Pages deployment via a server-side Deploy Hook URL.
 *
 * Security invariants:
 * - Only HTTP POST is accepted (returns 405 Method Not Allowed otherwise).
 * - Requires `Authorization: Bearer <supabase_access_token>`.
 * - Verifies the token server-side via Supabase Auth (`GET /auth/v1/user`).
 * - Verifies blog administrator authorization via `public.blog_admins`
 *   (`GET /rest/v1/blog_admins?select=user_id&user_id=eq.<user_id>`).
 * - Triggers the Cloudflare Pages Deploy Hook stored exclusively in the server-side
 *   environment variable `CLOUDFLARE_DEPLOY_HOOK_URL` (never exposed to the client,
 *   logs, or JSON responses).
 */

export interface PagesRegenerateBlogEnv {
  CLOUDFLARE_DEPLOY_HOOK_URL?: string;
  CF_PAGES_DEPLOY_HOOK_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface PagesRegenerateBlogContext {
  request: Request;
  env: PagesRegenerateBlogEnv;
  params?: Record<string, string | string[] | undefined>;
}

export type RegenerateBlogStatus =
  | 'deployment_triggered'
  | 'deployment_running'
  | 'rejected'
  | 'unauthorized'
  | 'missing_config'
  | 'trigger_failed'
  | 'method_not_allowed';

export interface RegenerateBlogResponseBody {
  ok: boolean;
  status: RegenerateBlogStatus;
  deploymentTriggered: boolean;
  regeneratedImmediately: boolean;
  message: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(
  httpStatus: number,
  body: RegenerateBlogResponseBody,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    ...(extraHeaders || {}),
  });

  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers,
  });
}

/**
 * Extracts the Bearer access token from the request's Authorization header.
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authHeader) return null;

  const match = authHeader.trim().match(/^Bearer\s+([^\s]+)$/i);
  if (!match || !match[1]) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolves the configured Supabase project origin and anon key from the Pages environment.
 */
export function resolveSupabaseServerConfig(
  env?: PagesRegenerateBlogEnv
): { supabaseOrigin: string; supabaseAnonKey: string } | null {
  const rawUrl = (env?.VITE_SUPABASE_URL || env?.SUPABASE_URL || '').trim();
  const rawAnonKey = (env?.VITE_SUPABASE_ANON_KEY || env?.SUPABASE_ANON_KEY || '').trim();

  if (!rawUrl || !rawAnonKey) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return {
      supabaseOrigin: parsed.origin,
      supabaseAnonKey: rawAnonKey,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves and validates the server-side Cloudflare Pages Deploy Hook URL.
 * Never returns or logs the secret URL in any error message or client payload.
 */
export function resolveDeployHookUrl(env?: PagesRegenerateBlogEnv): string | null {
  const rawHook = (
    env?.CLOUDFLARE_DEPLOY_HOOK_URL ||
    env?.CF_PAGES_DEPLOY_HOOK_URL ||
    ''
  ).trim();

  if (!rawHook) {
    return null;
  }

  try {
    const parsed = new URL(rawHook);
    if (parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Core request handler for `POST /__suweldotools/regenerate-blog`.
 * Accepts an injectable `customFetch` for deterministic unit testing without network calls.
 */
export async function handleRegenerateBlogRequest(
  context: PagesRegenerateBlogContext,
  customFetch: typeof fetch = fetch
): Promise<Response> {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  // 1. Validate HTTP method: only POST is allowed.
  if (method !== 'POST') {
    return jsonResponse(
      405,
      {
        ok: false,
        status: 'method_not_allowed',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message: 'Method Not Allowed. Use POST to trigger blog deployment regeneration.',
      },
      { Allow: 'POST' }
    );
  }

  // 2. Require a Bearer access token from the authenticated admin session.
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    return jsonResponse(401, {
      ok: false,
      status: 'unauthorized',
      deploymentTriggered: false,
      regeneratedImmediately: false,
      message: 'Authentication required. Missing or invalid Authorization Bearer token.',
    });
  }

  // 3. Validate Supabase server configuration before verifying the token.
  const supabaseConfig = resolveSupabaseServerConfig(env);
  if (!supabaseConfig) {
    return jsonResponse(503, {
      ok: false,
      status: 'missing_config',
      deploymentTriggered: false,
      regeneratedImmediately: false,
      message:
        'Server authentication configuration (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) is missing on Cloudflare Pages.',
    });
  }

  // 4. Verify the Supabase access token server-side against Supabase Auth (/auth/v1/user).
  let authenticatedUserId: string | null = null;
  try {
    const userRes = await customFetch(`${supabaseConfig.supabaseOrigin}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: supabaseConfig.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (userRes.status === 401 || userRes.status === 403) {
      return jsonResponse(401, {
        ok: false,
        status: 'unauthorized',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message: 'Invalid or expired Supabase session token. Please sign in again.',
      });
    }

    if (!userRes.ok) {
      return jsonResponse(502, {
        ok: false,
        status: 'trigger_failed',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message: `Supabase Auth verification failed with HTTP ${userRes.status}.`,
      });
    }

    const userPayload = (await userRes.json()) as { id?: unknown } | null;
    const rawUserId = typeof userPayload?.id === 'string' ? userPayload.id.trim() : '';
    if (!rawUserId || !UUID_REGEX.test(rawUserId)) {
      return jsonResponse(401, {
        ok: false,
        status: 'unauthorized',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message: 'Could not verify a valid Supabase user identity from the session token.',
      });
    }

    authenticatedUserId = rawUserId;
  } catch {
    return jsonResponse(502, {
      ok: false,
      status: 'trigger_failed',
      deploymentTriggered: false,
      regeneratedImmediately: false,
      message: 'Failed to reach Supabase Auth to verify administrator session.',
    });
  }

  // 5. Verify that the authenticated user is listed in `public.blog_admins` using Supabase RLS.
  try {
    const adminCheckUrl = `${supabaseConfig.supabaseOrigin}/rest/v1/blog_admins?select=user_id&user_id=eq.${encodeURIComponent(
      authenticatedUserId
    )}`;

    const adminRes = await customFetch(adminCheckUrl, {
      method: 'GET',
      headers: {
        apikey: supabaseConfig.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (adminRes.status === 401) {
      return jsonResponse(401, {
        ok: false,
        status: 'unauthorized',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message: 'Session unauthorized when verifying administrator privileges.',
      });
    }

    if (adminRes.status === 403) {
      return jsonResponse(403, {
        ok: false,
        status: 'rejected',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message: 'Access denied. Your account is not authorized as a blog administrator.',
      });
    }

    if (!adminRes.ok) {
      return jsonResponse(502, {
        ok: false,
        status: 'trigger_failed',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message: `Failed to verify blog administrator authorization (HTTP ${adminRes.status}).`,
      });
    }

    const adminRows = (await adminRes.json()) as Array<{ user_id?: unknown }> | null;
    const isAuthorizedAdmin =
      Array.isArray(adminRows) &&
      adminRows.some(
        (row) =>
          typeof row?.user_id === 'string' &&
          row.user_id.trim().toLowerCase() === authenticatedUserId!.toLowerCase()
      );

    if (!isAuthorizedAdmin) {
      return jsonResponse(403, {
        ok: false,
        status: 'rejected',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message:
          'Deployment request rejected. Authenticated user is not authorized in public.blog_admins.',
      });
    }
  } catch {
    return jsonResponse(502, {
      ok: false,
      status: 'trigger_failed',
      deploymentTriggered: false,
      regeneratedImmediately: false,
      message: 'Failed to query public.blog_admins to verify administrator authorization.',
    });
  }

  // 6. Ensure the server-side Cloudflare Pages Deploy Hook URL is configured.
  const deployHookUrl = resolveDeployHookUrl(env);
  if (!deployHookUrl) {
    return jsonResponse(503, {
      ok: false,
      status: 'missing_config',
      deploymentTriggered: false,
      regeneratedImmediately: false,
      message:
        'Production deploy hook is not configured. Set CLOUDFLARE_DEPLOY_HOOK_URL in Cloudflare Pages server environment variables.',
    });
  }

  // 7. Trigger the Cloudflare Pages Deploy Hook via POST.
  try {
    const hookRes = await customFetch(deployHookUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
    });

    if (hookRes.status === 409 || hookRes.status === 429) {
      return jsonResponse(202, {
        ok: false,
        status: 'deployment_running',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message:
          'A Cloudflare Pages deployment is already queued or running. Public blog pages will update when the active build completes.',
      });
    }

    if (!hookRes.ok) {
      return jsonResponse(502, {
        ok: false,
        status: 'trigger_failed',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message: `Cloudflare Pages deploy hook failed with HTTP ${hookRes.status}.`,
      });
    }

    // Parse optional JSON body from Cloudflare deploy hook if present
    let hookPayload: { success?: boolean } | null = null;
    try {
      const text = await hookRes.text();
      if (text && text.trim().startsWith('{')) {
        hookPayload = JSON.parse(text) as { success?: boolean };
      }
    } catch {
      // Ignore non-JSON body if status code was 2xx
    }

    if (hookPayload && hookPayload.success === false) {
      return jsonResponse(502, {
        ok: false,
        status: 'trigger_failed',
        deploymentTriggered: false,
        regeneratedImmediately: false,
        message: 'Cloudflare Pages rejected the deploy hook trigger request.',
      });
    }

    return jsonResponse(202, {
      ok: true,
      status: 'deployment_triggered',
      deploymentTriggered: true,
      regeneratedImmediately: false,
      message:
        'Cloudflare Pages deployment triggered. Static public blog pages are rebuilding now and will update once deployment finishes (typically 1–2 minutes).',
    });
  } catch {
    return jsonResponse(502, {
      ok: false,
      status: 'trigger_failed',
      deploymentTriggered: false,
      regeneratedImmediately: false,
      message: 'Network error while invoking Cloudflare Pages deploy hook.',
    });
  }
}

export const onRequest = async (context: PagesRegenerateBlogContext): Promise<Response> => {
  return handleRegenerateBlogRequest(context);
};
