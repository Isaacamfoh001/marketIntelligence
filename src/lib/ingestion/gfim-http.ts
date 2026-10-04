// ---------------------------------------------------------------------------
// Shared HTTP fetch helper for gfim.com.gh (M7.2).
//
// Unlike bog.gov.gh (see http.ts), gfim.com.gh's TLS chain is complete —
// no custom CA bundle needed, plain Node fetch works. gfim.com.gh's
// robots.txt does not restrict automated agents (verified M7.1/M7.2
// research: no bot-specific disallow, 200 responses to a ClaudeBot-style
// UA on both HTML pages and its public WordPress REST API), unlike
// gse.com.gh which actively blocks AI-agent user agents at the edge.
// ---------------------------------------------------------------------------

const USER_AGENT = "KorblyMarketIntelligence/0.1 (+internal research tool; Korbly Investment Partners)";
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024; // 20MB — a trading report workbook is well under this

export class GfimFetchError extends Error {}

async function boundedFetch(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json,*/*" }, signal: controller.signal });
    if (!res.ok) throw new GfimFetchError(`${url} returned HTTP ${res.status}`);
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new GfimFetchError(`${url} response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    }
    return res;
  } catch (err) {
    if (err instanceof GfimFetchError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new GfimFetchError(`${url} request failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGfimJson(url: string, opts: { timeoutMs?: number } = {}): Promise<unknown> {
  const res = await boundedFetch(url, opts.timeoutMs ?? 20_000);
  return res.json();
}

export async function fetchGfimBuffer(url: string, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
  const res = await boundedFetch(url, opts.timeoutMs ?? 30_000);
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new GfimFetchError(`${url} response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  return Buffer.from(arrayBuffer);
}
