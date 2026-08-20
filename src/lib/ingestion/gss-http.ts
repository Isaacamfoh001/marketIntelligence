// ---------------------------------------------------------------------------
// Shared HTTP helper for Ghana Statistical Service's StatsBank/PxWeb API.
//
// Unlike bog.gov.gh (see ingestion/http.ts), statsbank.statsghana.gov.gh
// presents a complete TLS chain — verified directly: both plain `curl`
// (no -k) and Node's native fetch connect without any workaround. No
// custom CA is needed here, so this intentionally does not reuse
// bog-specific http.ts's agent — that would misleadingly imply the same
// TLS problem exists on a domain that doesn't have it.
// ---------------------------------------------------------------------------

const USER_AGENT = "KorblyMarketIntelligence/0.1 (+internal research tool; Korbly Investment Partners)";
const TIMEOUT_MS = 20_000;

export class FetchError extends Error {}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** GET a PxWeb table's metadata (variables/values) as JSON. */
export async function fetchGssJson(url: string): Promise<unknown> {
  return withTimeout(async (signal) => {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal });
    } catch (err) {
      throw new FetchError(`${url} request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new FetchError(`${url} returned HTTP ${res.status}`);
    try {
      return await res.json();
    } catch (err) {
      throw new FetchError(`${url} returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/** POST a PxWeb query (standard PxWeb API v1 query format) and return the JSON response. */
export async function postGssJson(url: string, body: unknown): Promise<unknown> {
  return withTimeout(async (signal) => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new FetchError(`${url} request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new FetchError(`${url} returned HTTP ${res.status}`);
    try {
      return await res.json();
    } catch (err) {
      throw new FetchError(`${url} returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
