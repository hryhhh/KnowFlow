import type { SearchProvider, SearchResult } from "@knowbase-x/agents";

/**
 * Tavily Search Provider
 * 专为 AI 设计，返回结构化搜索结果
 */
export class TavilySearchProvider implements SearchProvider {
  private readonly apiKey: string;
  private readonly baseURL = "https://api.tavily.com";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options?: Record<string, any>): Promise<SearchResult[]> {
    const maxResults = options?.max_results ?? 5;

    const response = await fetch(`${this.baseURL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Tavily API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;

    return (data.results || []).map((item: any) => ({
      title: item.title || query,
      uri: item.url || "",
      snippet: item.content || "",
      source: "tavily",
      publishedAt: item.published_date,
    }));
  }
}

/**
 * Serper (Google) Search Provider
 * Google 官方 API，数据全面
 */
export class SerperSearchProvider implements SearchProvider {
  private readonly apiKey: string;
  private readonly baseURL = "https://google.serper.dev/search";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options?: Record<string, any>): Promise<SearchResult[]> {
    const maxResults = options?.num ?? 5;

    const response = await fetch(this.baseURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify({
        q: query,
        num: maxResults,
        gl: "cn",
        hl: "zh-cn",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Serper API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;

    return (data.organic || []).map((item: any) => ({
      title: item.title || query,
      uri: item.link || "",
      snippet: item.snippet || "",
      source: "google",
      publishedAt: item.date,
    }));
  }
}

/**
 * 创建 Search Provider
 * 根据 WEB_SEARCH_PROVIDER 环境变量选择
 */
export function createSearchProvider(
  providerName: string,
  apiKey: string,
): SearchProvider {
  switch (providerName.toLowerCase()) {
    case "tavily":
      return new TavilySearchProvider(apiKey);
    case "serper":
      return new SerperSearchProvider(apiKey);
    default:
      throw new Error(`不支持的 Web Search Provider: ${providerName}`);
  }
}
