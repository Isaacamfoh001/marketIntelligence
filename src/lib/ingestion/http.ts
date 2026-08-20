// ---------------------------------------------------------------------------
// Shared HTTP fetch helper for live collectors.
//
// bog.gov.gh's TLS handshake omits its intermediate certificate (verified
// by inspection: `openssl s_client -showcerts` returns exactly one
// certificate). Clients that don't already have DigiCert's intermediate
// cached — curl, Node's undici fetch, this server — fail with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE. Browsers mask this because they cache
// the intermediate from having seen it on other DigiCert-issued sites.
//
// The fix is to supply the missing intermediate explicitly alongside the
// normal trusted root store, completing the chain so it verifies against
// a real root — NOT to disable verification. Certificate validation stays
// fully intact.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import * as https from "node:https";
import * as tls from "node:tls";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const digicertGlobalG2Intermediate = fs.readFileSync(
  path.join(__dirname, "certs/digicert-global-g2-tls-rsa-sha256-2020-ca1.pem"),
  "utf-8",
);

const bogAgent = new https.Agent({
  ca: [...tls.rootCertificates, digicertGlobalG2Intermediate],
});

const USER_AGENT = "KorblyMarketIntelligence/0.1 (+internal research tool; Korbly Investment Partners)";
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB safety cap

export class FetchError extends Error {}

/**
 * Fetch a URL under bog.gov.gh with a completed TLS chain, a bounded
 * timeout, and a response-size cap. Throws FetchError on any network,
 * TLS, HTTP-status, or size failure — callers are expected to let this
 * propagate into the ingestion run's failure path.
 */
export function fetchBogText(url: string, opts: { timeoutMs?: number } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 20_000;

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent: bogAgent,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json" },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new FetchError(`${url} returned HTTP ${status}`));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new FetchError(`${url} response exceeded ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", (err) => reject(new FetchError(`${url} response error: ${err.message}`)));
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new FetchError(`${url} timed out after ${timeoutMs}ms`));
    });
    req.on("error", (err) => reject(new FetchError(`${url} request failed: ${err.message}`)));
  });
}

/**
 * POST a form-encoded body under bog.gov.gh with the same TLS/timeout/size
 * handling as fetchBogText. Used only for the historical-backfill AJAX
 * mechanism (see bog-fx-provider.ts for why).
 */
export function postBogForm(
  url: string,
  referer: string,
  form: Record<string, string>,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const body = new URLSearchParams(form).toString();

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        agent: bogAgent,
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "X-Requested-With": "XMLHttpRequest",
          Referer: referer,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new FetchError(`${url} returned HTTP ${status}`));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new FetchError(`${url} response exceeded ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", (err) => reject(new FetchError(`${url} response error: ${err.message}`)));
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new FetchError(`${url} timed out after ${timeoutMs}ms`));
    });
    req.on("error", (err) => reject(new FetchError(`${url} request failed: ${err.message}`)));
    req.write(body);
    req.end();
  });
}
