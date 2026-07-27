import dns from "node:dns";
import { isIP } from "node:net";
import type {
  AgentWebSearchRequest,
  AgentWebSearchResult,
  AgentWebSearchResultItem,
  AgentWebFetchRequest,
  AgentWebDocument
} from "@dbzs/shared";

// SSRF prevention: Check loopback and private ranges (RFC 1918 / RFC 4193)
export async function isPrivateIP(ip: string): Promise<boolean> {
  const normalized = ip.trim();
  if (normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.")) {
    return true;
  }
  // IPv4 Private Space (10.0.0.0/8)
  if (normalized.startsWith("10.")) {
    return true;
  }
  // IPv4 Private Space (172.16.0.0/12)
  if (normalized.startsWith("172.")) {
    const parts = normalized.split(".").map(Number);
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return true;
    }
  }
  // IPv4 Private Space (192.168.0.0/16)
  if (normalized.startsWith("192.168.")) {
    return true;
  }
  // IPv4 Link Local (169.254.0.0/16)
  if (normalized.startsWith("169.254.")) {
    return true;
  }
  // 0.0.0.0
  if (normalized === "0.0.0.0") {
    return true;
  }

  // IPv6 Unique Local Address (fc00::/7)
  if (normalized.toLowerCase().startsWith("fc") || normalized.toLowerCase().startsWith("fd")) {
    return true;
  }
  // IPv6 Link Local (fe80::/10)
  if (normalized.toLowerCase().startsWith("fe8")) {
    return true;
  }

  return false;
}

export async function validateHost(hostname: string): Promise<boolean> {
  if (isIP(hostname)) {
    return !(await isPrivateIP(hostname));
  }
  try {
    const addresses = await dns.promises.resolve(hostname);
    for (const addr of addresses) {
      if (await isPrivateIP(addr)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function normalizeHtml(html: string): { title: string; text: string } {
  // Strip scripts, styles, comments, iframe, noscript
  let cleaned = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<noscript[\s\S]*?>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Extract title
  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(cleaned);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Convert block tags to spacing for readable formatting
  cleaned = cleaned
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n");

  // Extract text by removing all HTML tags
  let text = cleaned
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();

  // Decode standard HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  return { title, text };
}

export class AgentWebResearchService {
  private static readonly MOCK_SEARCH_ITEMS: AgentWebSearchResultItem[] = [
    {
      id: "mock-1",
      title: "Official TypeScript Handbook and Documentation",
      url: "https://www.typescriptlang.org/docs/",
      displayUrl: "https://www.typescriptlang.org/docs/",
      snippet: "Welcome to the TypeScript Handbook. Learn about compiler options, types, generics, classes, modules, and how to safely migrate existing codebases to latest compiler versions.",
      sourceDomain: "typescriptlang.org",
      rank: 1
    },
    {
      id: "mock-2",
      title: "Vitest Testing Framework Guide & API reference",
      url: "https://vitest.dev/guide/",
      displayUrl: "https://vitest.dev/guide/",
      snippet: "Vitest is a fast, modern unit testing framework built on Vite. It supports TypeScript, coverage tools, workspace configurations, and features full Jest compatibility.",
      sourceDomain: "vitest.dev",
      rank: 2
    },
    {
      id: "mock-3",
      title: "GitHub - dbzs-codee-project open source repository",
      url: "https://github.com/devdbzemusic/dbzs-codee-project",
      displayUrl: "https://github.com/devdbzemusic/dbzs-codee-project",
      snippet: "Repository for dbzs-codee-project. Focuses on local AI orchestration, safe terminal execution, modular workspace architectures, and robust agent run loops.",
      sourceDomain: "github.com",
      rank: 3
    }
  ];

  async search(request: AgentWebSearchRequest): Promise<AgentWebSearchResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      if (request.maxResults > 100) {
        throw new Error("[RESEARCH_POLICY_VIOLATION] maxResults limits exceeded.");
      }

      // Check Serper or Tavily key in env to decide on real search
      const serperKey = process.env.DBZS_SERPER_API_KEY || process.env.SERPER_API_KEY;
      const tavilyKey = process.env.DBZS_TAVILY_API_KEY || process.env.TAVILY_API_KEY;

      let items: AgentWebSearchResultItem[] = [];
      let provider = "mock-search-provider";

      if (serperKey) {
        provider = "serper";
        items = await this.querySerper(request.query, request.maxResults, serperKey);
      } else if (tavilyKey) {
        provider = "tavily";
        items = await this.queryTavily(request.query, request.maxResults, tavilyKey);
      } else {
        // Fallback to mock items filtered vaguely by query keywords
        const keywords = request.query.toLowerCase().split(/\s+/);
        items = AgentWebResearchService.MOCK_SEARCH_ITEMS.filter((item) =>
          keywords.some((kw) =>
            item.title.toLowerCase().includes(kw) ||
            item.snippet.toLowerCase().includes(kw)
          )
        );
        if (items.length === 0) {
          items = [...AgentWebResearchService.MOCK_SEARCH_ITEMS];
        }
        items = items.slice(0, request.maxResults);
      }

      // Apply domains policy
      if (request.allowedDomains && request.allowedDomains.length > 0) {
        items = items.filter((item) => request.allowedDomains!.includes(item.sourceDomain));
      }
      if (request.blockedDomains && request.blockedDomains.length > 0) {
        items = items.filter((item) => !request.blockedDomains!.includes(item.sourceDomain));
      }

      const durationMs = Date.now() - startTime;
      return {
        requestId: request.id,
        query: request.query,
        provider,
        status: "succeeded",
        items,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      return {
        requestId: request.id,
        query: request.query,
        provider: "unknown",
        status: "failed",
        items: [],
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs
      };
    }
  }

  async fetch(request: AgentWebFetchRequest): Promise<AgentWebDocument> {
    const extractedAt = new Date().toISOString();
    const maxBytes = request.maxBytes ?? 1024 * 1024; // Default 1 MB
    const timeoutMs = request.timeoutMs ?? 20000; // Default 20 s

    // Check if test override is active for local mock test-server
    const isTestServer = request.url.includes("127.0.0.1") && (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development");

    let currentUrl = request.url;
    const maxRedirects = 5;

    for (let redirectCount = 0; redirectCount < maxRedirects; redirectCount++) {
      const parsed = new URL(currentUrl);

      // Enforce HTTPS unless running tests with local mock server
      if (parsed.protocol !== "https:" && !isTestServer) {
        throw new Error(`[RESEARCH_HTTP_BLOCKED] Only HTTPS protocol is allowed: ${currentUrl}`);
      }

      // DNS / SSRF checks
      if (!isTestServer) {
        const isHostValid = await validateHost(parsed.hostname);
        if (!isHostValid) {
          throw new Error(`[RESEARCH_SSRF_BLOCKED] Private IP or loopback detected for host: ${parsed.hostname}`);
        }
      }

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: "GET",
          headers: {
            "User-Agent": "DBZS-Code-Assistant-Web-Research/1.0",
            "Accept": "text/html,text/plain,application/json,application/xml,text/xml"
          },
          redirect: "manual",
          signal: controller.signal
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(`[RESEARCH_TIMEOUT] Request timed out after ${timeoutMs}ms.`);
        }
        throw err;
      } finally {
        clearTimeout(timeoutHandle);
      }

      // Handle redirect manually
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("[RESEARCH_REDIRECT_FAILED] Redirect Location header missing.");
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        throw new Error(`[RESEARCH_HTTP_ERROR] HTTP error: ${response.status}`);
      }

      // Verify Content-Type
      const contentType = response.headers.get("content-type") ?? "text/plain";
      const baseType = contentType.split(";")[0].trim().toLowerCase();
      const allowedTypes = ["text/html", "text/plain", "application/json", "application/xml", "text/xml"];
      if (!allowedTypes.includes(baseType)) {
        throw new Error(`[RESEARCH_BINARY_BLOCKED] Content-Type ${contentType} is not allowed.`);
      }

      // Streaming chunk limits to enforce maxBytes
      const reader = response.body?.getReader();
      let responseText = "";

      if (!reader) {
        responseText = await response.text();
        if (responseText.length > maxBytes) {
          throw new Error(`[RESEARCH_LIMIT_SIZE] Body size exceeded limit of ${maxBytes} bytes.`);
        }
      } else {
        let totalBytes = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.length;
            if (totalBytes > maxBytes) {
              throw new Error(`[RESEARCH_LIMIT_SIZE] Body size exceeded limit of ${maxBytes} bytes.`);
            }
            chunks.push(value);
          }
        }
        const bodyBuffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        responseText = bodyBuffer.toString("utf-8");
      }

      // Normalize HTML if needed
      let docText = responseText;
      let title = "";
      if (baseType === "text/html") {
        const normalized = normalizeHtml(responseText);
        title = normalized.title;
        docText = normalized.text;
      }

      const truncated = responseText.length > docText.length;
      return {
        requestId: request.id,
        url: request.url,
        finalUrl: currentUrl,
        title: title || parsed.pathname,
        sourceDomain: parsed.hostname,
        contentType: baseType,
        text: docText,
        extractedAt,
        truncated
      };
    }

    throw new Error("[RESEARCH_REDIRECT_FAILED] Too many redirects.");
  }

  private async querySerper(query: string, maxResults: number, apiKey: string): Promise<AgentWebSearchResultItem[]> {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ q: query, num: maxResults })
    });
    if (!res.ok) {
      throw new Error(`Serper search failed: ${res.status}`);
    }
    const data = (await res.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string; position?: number }> };
    return (data.organic ?? []).map((item, index) => {
      const linkUrl = item.link ?? "";
      const sourceDomain = new URL(linkUrl).hostname;
      return {
        id: `serper-${index + 1}`,
        title: item.title ?? "",
        url: linkUrl,
        displayUrl: linkUrl,
        snippet: item.snippet ?? "",
        sourceDomain,
        rank: item.position ?? index + 1
      };
    });
  }

  private async queryTavily(query: string, maxResults: number, apiKey: string): Promise<AgentWebSearchResultItem[]> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults })
    });
    if (!res.ok) {
      throw new Error(`Tavily search failed: ${res.status}`);
    }
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string; score?: number }> };
    return (data.results ?? []).map((item, index) => {
      const linkUrl = item.url ?? "";
      const sourceDomain = new URL(linkUrl).hostname;
      return {
        id: `tavily-${index + 1}`,
        title: item.title ?? "",
        url: linkUrl,
        displayUrl: linkUrl,
        snippet: item.content ?? "",
        sourceDomain,
        rank: index + 1
      };
    });
  }
}
