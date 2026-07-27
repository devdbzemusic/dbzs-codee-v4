import { describe, expect, it, beforeAll, afterAll } from "vitest";
import http from "node:http";
import {
  isPrivateIP,
  validateHost,
  normalizeHtml,
  AgentWebResearchService
} from "./webResearchService.js";

describe("AgentWebResearchService - SSRF & private IPs", () => {
  it("correctly identifies private IPv4 and loopback addresses", async () => {
    expect(await isPrivateIP("127.0.0.1")).toBe(true);
    expect(await isPrivateIP("127.255.0.1")).toBe(true);
    expect(await isPrivateIP("10.0.0.1")).toBe(true);
    expect(await isPrivateIP("172.16.5.1")).toBe(true);
    expect(await isPrivateIP("172.31.255.255")).toBe(true);
    expect(await isPrivateIP("192.168.1.1")).toBe(true);
    expect(await isPrivateIP("169.254.169.254")).toBe(true);
    expect(await isPrivateIP("0.0.0.0")).toBe(true);
  });

  it("correctly identifies public IPv4 addresses", async () => {
    expect(await isPrivateIP("8.8.8.8")).toBe(false);
    expect(await isPrivateIP("142.250.190.46")).toBe(false);
  });

  it("correctly identifies private IPv6 addresses", async () => {
    expect(await isPrivateIP("::1")).toBe(true);
    expect(await isPrivateIP("fc00::1")).toBe(true);
    expect(await isPrivateIP("fdff::ffff")).toBe(true);
    expect(await isPrivateIP("fe80::1")).toBe(true);
  });

  it("blocks private hosts in validateHost", async () => {
    expect(await validateHost("localhost")).toBe(false);
    expect(await validateHost("127.0.0.1")).toBe(false);
  });
});

describe("AgentWebResearchService - HTML Normalizer", () => {
  it("removes scripts, styles, iframe, and normalizes HTML text", () => {
    const rawHtml = `
      <html>
        <head>
          <title>Test Page</title>
          <style>body { color: red; }</style>
        </head>
        <body>
          <script>console.log("hello");</script>
          <div id="nav">Header Nav</div>
          <main>
            <h1>Main Title</h1>
            <p>This is a paragraph.</p>
            <p>Another paragraph &amp; text.</p>
          </main>
        </body>
      </html>
    `;
    const normalized = normalizeHtml(rawHtml);
    expect(normalized.title).toBe("Test Page");
    expect(normalized.text).toContain("Main Title");
    expect(normalized.text).toContain("This is a paragraph.");
    expect(normalized.text).toContain("Another paragraph & text.");
    expect(normalized.text).not.toContain("body { color");
    expect(normalized.text).not.toContain("console.log");
  });
});

describe("AgentWebResearchService - Search", () => {
  it("performs mock search and returns ranked items", async () => {
    const service = new AgentWebResearchService();
    const result = await service.search({
      id: "test-req",
      runId: "test-run",
      query: "TypeScript Handbook",
      purpose: "test search",
      maxResults: 2,
      safeSearch: "strict",
      createdAt: new Date().toISOString()
    });

    expect(result.status).toBe("succeeded");
    expect(result.items.length).toBeLessThanOrEqual(2);
    expect(result.items[0].url).toContain("typescriptlang.org");
  });

  it("respects allowed and blocked domains policies", async () => {
    const service = new AgentWebResearchService();
    const result = await service.search({
      id: "test-req-2",
      runId: "test-run",
      query: "TypeScript Handbook",
      purpose: "test search",
      maxResults: 10,
      allowedDomains: ["typescriptlang.org"],
      safeSearch: "strict",
      createdAt: new Date().toISOString()
    });

    for (const item of result.items) {
      expect(item.sourceDomain).toBe("typescriptlang.org");
    }
  });
});

describe("AgentWebResearchService - Fetch HTTP safety server tests", () => {
  let server: http.Server;
  const port = 8990;

  beforeAll(() => {
    process.env.NODE_ENV = "test";
    server = http.createServer((req, res) => {
      if (req.url === "/large") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("a".repeat(2000));
      } else if (req.url === "/binary") {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(Buffer.from([0x00, 0x01]));
      } else if (req.url === "/redirect") {
        res.writeHead(302, { "Location": `http://127.0.0.1:${port}/success` });
        res.end();
      } else if (req.url === "/success") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><head><title>Success</title></head><body>Redirect success</body></html>");
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><head><title>Ok</title></head><body>Normal Content</body></html>");
      }
    });
    server.listen(port);
  });

  afterAll(() => {
    process.env.NODE_ENV = "development";
    server.close();
  });

  it("fetches successfully via test local override", async () => {
    const service = new AgentWebResearchService();
    const doc = await service.fetch({
      id: "fetch-1",
      runId: "test-run",
      url: `http://127.0.0.1:${port}/success`,
      purpose: "test fetch",
      createdAt: new Date().toISOString()
    });

    expect(doc.title).toBe("Success");
    expect(doc.text).toContain("Redirect success");
  });

  it("follows redirects manually and fetches", async () => {
    const service = new AgentWebResearchService();
    const doc = await service.fetch({
      id: "fetch-2",
      runId: "test-run",
      url: `http://127.0.0.1:${port}/redirect`,
      purpose: "test fetch redirect",
      createdAt: new Date().toISOString()
    });

    expect(doc.finalUrl).toBe(`http://127.0.0.1:${port}/success`);
    expect(doc.title).toBe("Success");
  });

  it("blocks bodies that exceed maxBytes", async () => {
    const service = new AgentWebResearchService();
    await expect(
      service.fetch({
        id: "fetch-3",
        runId: "test-run",
        url: `http://127.0.0.1:${port}/large`,
        purpose: "test fetch size limit",
        maxBytes: 500,
        createdAt: new Date().toISOString()
      })
    ).rejects.toThrow("[RESEARCH_LIMIT_SIZE]");
  });

  it("blocks non-allowed content types (binary/octet-stream)", async () => {
    const service = new AgentWebResearchService();
    await expect(
      service.fetch({
        id: "fetch-4",
        runId: "test-run",
        url: `http://127.0.0.1:${port}/binary`,
        purpose: "test fetch binary limit",
        createdAt: new Date().toISOString()
      })
    ).rejects.toThrow("[RESEARCH_BINARY_BLOCKED]");
  });
});
