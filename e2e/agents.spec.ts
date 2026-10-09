import { expect, test } from "@playwright/test";

// The AI-agent front door: /agents (people), /llms.txt (agents), /mcp (assistant connector).
// Read-only: only the handshake and tool list are checked, never a booking.

test("agents page explains AI booking and links to the form", async ({ page }) => {
  await page.goto("/agents/");
  await expect(page.getByRole("heading", { name: "Book Jon with an AI assistant" })).toBeVisible();
  await expect(page.locator("#mcp")).toHaveText("https://jonmobley.com/mcp");
  await expect(page.getByRole("link", { name: "booking form" })).toHaveAttribute("href", "/booking/");
});

test("llms.txt describes the booking tools", async ({ request }) => {
  const res = await request.get("/llms.txt");
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toContain("https://jonmobley.com/mcp");
  expect(text).toContain("/api/agent/quote");
});

test("MCP server handshakes and lists its tools", async ({ request }) => {
  const init = await request.post("/mcp", {
    headers: { Accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } },
  });
  expect(init.status()).toBe(200);
  expect((await init.json()).result.serverInfo.name).toBe("jon-mobley-booking");
  const list = await request.post("/mcp", { data: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
  const names = (await list.json()).result.tools.map((t: { name: string }) => t.name);
  expect(names).toEqual(["get_offer", "check_availability", "get_quote", "book", "booking_status"]);
});
