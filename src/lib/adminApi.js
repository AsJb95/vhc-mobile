const FUNCTIONS_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/drive-backups`;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const REQUEST_TIMEOUT_MS = 30000;

// Parse a Response whose body may be JSON, an HTML error page, or empty.
// Returns { ok, data } and never throws on a malformed body — callers decide
// what to do with a non-ok status.
async function parseResponse(resp) {
  const text = await resp.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null; // non-JSON body (e.g. a 500 HTML page)
    }
  }
  if (!resp.ok) {
    const detail =
      (data && (data.error || data.message)) ||
      (text ? text.slice(0, 200) : '') ||
      resp.statusText ||
      'Request failed';
    const err = new Error(`HTTP ${resp.status}: ${detail}`);
    err.status = resp.status;
    throw err;
  }
  return data ?? {};
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out. Check your connection and try again.');
    throw new Error(e.message || 'Network request failed');
  } finally {
    clearTimeout(timer);
  }
}

async function callFn(action, params, accessToken) {
  const url = new URL(FUNCTIONS_URL);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);

  const resp = await fetchWithTimeout(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
    },
  });
  return parseResponse(resp);
}

// Restore/other write-ish actions POST a JSON body instead of a query string
// so sensitive params (like a backup password) never end up in a URL.
async function postFn(action, body, accessToken) {
  const resp = await fetchWithTimeout(FUNCTIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...body }),
  });
  return parseResponse(resp);
}

export function listDriveBackups(accessToken) {
  return callFn('list', {}, accessToken).then((r) => r.backups || []);
}

export function getDriveBackupContent(accessToken, fileId) {
  return callFn('content', { fileId }, accessToken);
}

export function restorePharmacyBackup(accessToken, fileId) {
  return postFn('restorePharmacy', { fileId }, accessToken);
}

// NOTE: the edge function also exposes a 'previewWarehouseRestore' action for
// password-protected Warehouse backups, but decrypting them in-app isn't built
// yet (the function currently ignores the password). Add a wrapper here when
// that lands — see supabase/functions/drive-backups/index.ts.
