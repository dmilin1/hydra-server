import Discord from "./Discord";

type ProxyResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: ProxyResponseItem[];
};

type ProxyResponseItem = {
  id: string;
  username: string;
  password: string;
  proxy_address: string;
  port: number;
  valid: boolean;
  last_verification: string;
  country_code: string;
  city_name: string;
  asn_name: string;
  asn_number: number;
  high_country_confidence: boolean;
  created_at: string;
};

const PROXY_UPDATE_INTERVAL = 1000 * 60 * 60 * 1; // 1 hour
const RETRY_BAD_PROXY_INTERVAL = 1000 * 60 * 2; // 2 hours

export default class Proxy {
  private static proxies: string[] = [];
  private static badProxies: { [address: string]: number } = {};
  private static lastUpdateAt: number = 0;
  private static nextProxyIndex: number = 0;
  private static inFlightRefresh: Promise<string[]> | null = null;

  static async getProxies() {
    if (
      this.proxies.length + Object.keys(this.badProxies).length > 0 &&
      Date.now() - this.lastUpdateAt < PROXY_UPDATE_INTERVAL
    )
      return this.proxies;
    // Single-flight: concurrent callers share one in-flight refresh instead of
    // each launching their own (the worker pool runs up to 10 in parallel).
    if (!this.inFlightRefresh) {
      this.inFlightRefresh = this.refreshProxies().finally(() => {
        this.inFlightRefresh = null;
      });
    }
    return this.inFlightRefresh;
  }

  private static async refreshProxies() {
    const results: ProxyResponseItem[] = [];
    let nextUrl: string | null =
      "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100";
    while (nextUrl) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Token ${process.env.WEBSHARE_TOKEN}`,
        },
      });
      const res = (await response.json()) as ProxyResponse;
      results.push(...res.results);
      console.log(`Fetched ${results.length} proxies`);
      nextUrl = res.next;
    }
    const freshProxyList = results.map(
      (proxy) =>
        `http://${proxy.username}:${proxy.password}@${proxy.proxy_address}:${proxy.port}`,
    );
    this.proxies = freshProxyList.filter(
      (proxy) => this.badProxies[proxy] === undefined,
    );
    for (const proxy of Object.keys(this.badProxies)) {
      if (!freshProxyList.includes(proxy)) {
        // Proxy no longer exists, remove from bad proxies
        delete this.badProxies[proxy];
      }
    }
    this.badProxies = {};
    this.lastUpdateAt = Date.now();
    return this.proxies;
  }

  static async getProxy() {
    if (!process.env.WEBSHARE_TOKEN) return undefined;
    await this.getProxies();
    this.restoreBadProxies();
    if (this.proxies.length === 0) {
      throw new Error("No good proxies available");
    }
    const proxy = this.proxies[this.nextProxyIndex];
    this.nextProxyIndex = (this.nextProxyIndex + 1) % this.proxies.length;
    return proxy;
  }

  static async handleBadProxy(proxy: string) {
    this.proxies = this.proxies.filter((p) => p !== proxy);
    this.badProxies[proxy] = Date.now();
    const badProxiesLength = Object.keys(this.badProxies).length;
    const totalProxiesLength = this.proxies.length + badProxiesLength;
    console.log(`${badProxiesLength}/${totalProxiesLength} bad proxies`);
  }

  static restoreBadProxies() {
    const goodProxiesLength = this.proxies.length;
    const badProxiesLength = Object.keys(this.badProxies).length;
    const totalProxiesLength = goodProxiesLength + badProxiesLength;
    const fractionBad = badProxiesLength / totalProxiesLength;
    if (fractionBad < 0.1) {
      // If less than 10% of proxies are bad, don't bother restoring them
      return;
    }
    if (fractionBad > 0.25) {
      // Notify
      Discord.sendMessageWithLimit(
        "proxy-bad",
        1000 * 60 * 60 * 1, // 1 hour
        `${((badProxiesLength / totalProxiesLength) * 100).toFixed(2)}% of proxies have gone bad.`,
      );
    }
    const now = Date.now();
    for (const [proxy, markedBadAt] of Object.entries(this.badProxies)) {
      if (now - markedBadAt > RETRY_BAD_PROXY_INTERVAL) {
        this.proxies.push(proxy);
        delete this.badProxies[proxy];
      }
    }
  }

  static async fetch(
    request: string | URL | Request,
    init?: BunFetchRequestInit,
  ) {
    const proxy = await this.getProxy();
    const response = await fetch(request, {
      ...init,
      proxy,
    });
    return {
      response,
      markProxyAsBad: () => (proxy ? this.handleBadProxy(proxy) : undefined),
    };
  }
}
