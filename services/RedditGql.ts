import { eq } from "drizzle-orm";
import { db } from "../db/db";
import { redditAccounts } from "../db/schema";
import { decrypt, encrypt } from "../utils/crypto";
import { generateUserAgent } from "../utils/userAgent";
import Proxy from "./Proxy";

/**
 * Reddit's GraphQL API, the one Reddit's own apps use (the old .json API is
 * being shut down). It authenticates with the same token_v2 that
 * www.reddit.com gives logged in browsers, which Reddit only issues in the
 * response to a POST from a page session: a HEAD of the home page first sets
 * the cookies (loid, csrf_token...) that the POST needs. Tokens last 24 hours.
 */

export type GqlOperation = { name: string; hash: string };

type RedditAccount = typeof redditAccounts.$inferSelect;
type SessionCookie = { name: string; value: string };

// Treat tokens this close to expiring as expired, so requests don't race it.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const tokens = new Map<number, { token: string; expiresAt: number }>();

function getExpiry(token: string): number {
  try {
    const payload = token.split(".")[1] ?? "";
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch (_e) {
    return 0;
  }
}

async function requestToken(account: RedditAccount): Promise<string> {
  const session: SessionCookie = JSON.parse(decrypt(account.session));
  const cookies = new Map([[session.name, session.value]]);
  const userAgent = generateUserAgent();
  const send = async (url: string, init: BunFetchRequestInit) => {
    const result = await Proxy.fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        "User-Agent": userAgent,
        cookie: [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
      },
    });
    for (const setCookie of result.response.headers.getSetCookie()) {
      const pair = setCookie.split(";")[0] ?? "";
      const split = pair.indexOf("=");
      cookies.set(pair.slice(0, split).trim(), pair.slice(split + 1));
    }
    return result;
  };

  const home = await send("https://www.reddit.com/", { method: "HEAD" });
  if (home.response.status >= 400) {
    // Reddit also answers 403 to a session it no longer accepts. If the same
    // proxy loads the page without the session, the session is the problem.
    const loggedOut = await Proxy.fetch("https://www.reddit.com/", {
      method: "HEAD",
      proxy: home.proxy,
      headers: { "User-Agent": userAgent },
    });
    if (loggedOut.response.ok) {
      throw new Error("Reddit rejected the session. It may have expired.");
    }
    home.markProxyAsBad();
    throw new Error(`Failed to load reddit.com: [${home.response.status}]`);
  }
  // Reddit rejects the empty body (HTTP 400) but still sets token_v2.
  await send("https://www.reddit.com/svc/shreddit/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const token = cookies.get("token_v2");
  if (!token) {
    throw new Error(
      "Reddit did not issue a token. The session may have expired.",
    );
  }

  // The HEAD renews the session cookie (it lasts 6 months from its last
  // use), so keep the renewed one for accounts the app isn't opened on.
  const renewed = cookies.get(session.name);
  if (renewed && renewed !== session.value) {
    await db
      .update(redditAccounts)
      .set({ session: encrypt(JSON.stringify({ ...session, value: renewed })) })
      .where(eq(redditAccounts.id, account.id))
      .execute();
  }
  tokens.set(account.id, { token, expiresAt: getExpiry(token) });
  return token;
}

async function getToken(account: RedditAccount): Promise<string> {
  const cached = tokens.get(account.id);
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return cached.token;
  }
  return await requestToken(account);
}

/** Runs one of Reddit's app operations as the account and returns its data. */
export async function redditGql(
  account: RedditAccount,
  operation: GqlOperation,
  variables: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const send = async (token: string) =>
    await Proxy.fetch("https://cf.gql-fed.reddit.com/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": generateUserAgent(),
      },
      body: JSON.stringify({
        operationName: operation.name,
        variables,
        extensions: {
          persistedQuery: { version: 1, sha256Hash: operation.hash },
        },
      }),
    });

  let { response, markProxyAsBad } = await send(await getToken(account));
  if (response.status === 401 || response.status === 403) {
    // Revoked or replaced token (401 = none, 403 = invalid): get a new one.
    tokens.delete(account.id);
    ({ response, markProxyAsBad } = await send(await requestToken(account)));
  }
  if (response.status >= 400) {
    markProxyAsBad();
    throw new Error(`${operation.name} failed: [${response.status}]`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = await response.json();
  } catch (_e) {
    markProxyAsBad();
    throw new Error(`${operation.name} returned a non-JSON response`);
  }
  if (json?.data == null) {
    throw new Error(
      `${operation.name} failed: ${json?.errors?.[0]?.message ?? "no data"}`,
    );
  }
  return json.data;
}
