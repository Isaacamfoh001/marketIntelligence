// The library's primary filter chips are mutually exclusive: exactly one reads as selected.
import "dotenv/config";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "@/lib/prisma";
import { createThesis } from "@/lib/thesis-service";
import ThesesPage from "../page";

const render = async (q: Record<string, string>) => renderToStaticMarkup(await ThesesPage({ searchParams: Promise.resolve(q) }));
const chipNav = (html: string) => html.slice(html.indexOf('aria-label="Filter by status"'));

const db = getPrisma();
beforeAll(async () => {
  const security = await db.security.findFirstOrThrow({ where: { ticker: { not: { startsWith: "ZZ" } } }, select: { id: true } });
  const r = await createThesis({ subject: { type: "SECURITY", id: security.id }, activate: true, content: { title: "ZZTC chips", belief: "b", rationale: "r", mustBeTrue: ["m"], invalidation: ["i"], confidence: "LOW", horizon: "SHORT" } });
  if (!r.ok) throw new Error(JSON.stringify(r));
});
afterAll(async () => {
  await db.thesis.deleteMany({ where: { title: { startsWith: "ZZTC" } } });
});

describe("thesis library filter chips", () => {
  it("search and other compatible filters keep the single selection", async () => {
    const nav = (await render({ review: "needed", q: "ZZTC", kind: "EQUITY" }));
    expect(nav.match(/<a[^>]*aria-current="true"/g)).toHaveLength(1);
  });
  it.each([[{}, "All"], [{ review: "needed" }, "Needs review"], [{ status: "LIVE" }, "Live"], [{ status: "ACTIVE" }, "Active"]])("%j selects exactly one chip: %s", async (q, label) => {
    const html = await render(q as Record<string, string>);
    expect(html).toContain('aria-label="Filter by status"');
    const nav = chipNav(html).slice(0, chipNav(html).indexOf("</nav>"));
    const selected = [...nav.matchAll(/<a[^>]*aria-current="true"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s*\d+\s*$/, "").trim());
    expect(selected).toEqual([label]);
  });
});
