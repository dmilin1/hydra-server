import Task from "./Task";
import { db } from "../db/db";
import { customers, redditAccounts } from "../db/schema";
import { eq } from "drizzle-orm";
import PushNotifications from "../services/PushNotifications";
import { redditGql, SessionError } from "../services/RedditGql";

/**
 * Reddit's inbox is now a notification feed (private messages moved to chat),
 * mostly Reddit's own suggestions. Like the app, only replies and username
 * mentions are kept.
 */
const GetInboxNotificationFeedV2 = {
  name: "GetInboxNotificationFeedV2",
  hash: "bfb3b015837f416e9ceb15d8c8082cd6bfc727124e8ac969eb25332c331ee614",
};

// The app's page size, so the badge counts the same replies as the app does.
const PAGE_SIZE = 50;

const REPLY_TYPES = new Set([
  "POST_REPLY",
  "COMMENT_REPLY",
  "USERNAME_MENTION",
]);

const HOUR_MS = 1000 * 60 * 60;

// When the server switched to the new inbox. Older notifications were handled
// (or not) by the old one, so they're never sent.
const NEW_INBOX_START = Date.parse("2026-11-02T03:41:22.000Z");

type Notification = {
  id: string;
  title?: string;
  body?: string;
  sentAt: string;
  readAt: string | null;
  deeplinkUrl?: string;
  comment?: {
    id: string;
    content?: { preview?: string };
    authorInfo?: { displayName?: string };
  } | null;
  context?: { messageType?: string; post?: { title?: string } } | null;
};

/** A reply or mention, merged per comment: a reply that also pings the user arrives as both. */
type InboxReply = {
  commentId: string;
  unread: boolean;
  sentAt: number;
  title: string;
  body: string;
};

// "2026-10-25T23:40:08.323000+0000" -> "2026-10-25T23:40:08.323+00:00"
function parseTime(time: string): number {
  return Date.parse(
    time.replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"),
  );
}

/** The comment id a notification is about, if it's a reply or mention. */
function getCommentId(node: Notification): string | undefined {
  const type = node.context?.messageType ?? "";
  if (!REPLY_TYPES.has(type) && !(node.comment && type.includes("REPLY"))) {
    return undefined;
  }
  if (node.comment?.id) return node.comment.id;
  // Mentions have no comment, but link to it: .../comments/<post>/<slug>/<id>/
  const match = (node.deeplinkUrl ?? "").match(
    /\/comments\/[^/]+\/[^/]+\/([a-z0-9]+)\/?(?:[?#].*)?$/i,
  );
  return match ? `t1_${match[1]}` : undefined;
}

/**
 * "<author> in <post title>" with the comment as the body. Mentions don't
 * come with their comment or post, so they use Reddit's own wording.
 */
function getText(
  node: Notification,
): { title: string; body: string } | undefined {
  const author = node.comment?.authorInfo?.displayName;
  const postTitle = node.context?.post?.title;
  if (author && postTitle) {
    return {
      title: `${author} in ${postTitle}`,
      body: node.comment?.content?.preview ?? "",
    };
  }
  if (node.title) {
    return { title: node.title, body: node.body ?? "" };
  }
}

function getReplies(nodes: Notification[]): InboxReply[] {
  const byComment = new Map<string, InboxReply>();
  for (const node of nodes) {
    const commentId = getCommentId(node);
    const text = getText(node);
    if (!commentId || !text) continue;
    const unread = !node.readAt;
    const sentAt = parseTime(node.sentAt);
    const existing = byComment.get(commentId);
    if (!existing) {
      byComment.set(commentId, { commentId, unread, sentAt, ...text });
      continue;
    }
    existing.unread &&= unread;
    existing.sentAt = Math.max(existing.sentAt, sentAt);
    // The reply's text is more specific than the mention's.
    if (node.comment) Object.assign(existing, text);
  }
  return [...byComment.values()];
}

type CheckForMessagesData = {
  redditAccountId: number;
};

export default class CheckForMessages extends Task<
  "CheckForMessages",
  CheckForMessagesData
> {
  async handle(): Promise<void> {
    const redditAccount = db
      .select()
      .from(redditAccounts)
      .where(eq(redditAccounts.id, this.data.redditAccountId))
      .get();

    if (!redditAccount) {
      throw new Error(
        `Reddit account with ID ${this.data.redditAccountId} not found`,
      );
    }

    try {
      await this.check(redditAccount);
    } catch (e) {
      if (e instanceof SessionError) {
        // Retrying can't help until the app registers a new session (which
        // clears this), so check rarely. The random spread keeps these
        // accounts from all coming back at once.
        await db
          .update(redditAccounts)
          .set({
            lastCheckedAt: new Date(
              Date.now() + (11 + Math.random()) * HOUR_MS,
            ).toISOString(),
          })
          .where(eq(redditAccounts.id, redditAccount.id))
          .execute();
      }
      throw e;
    }
  }

  async check(redditAccount: typeof redditAccounts.$inferSelect) {
    const data = await redditGql(redditAccount, GetInboxNotificationFeedV2, {
      pageSize: PAGE_SIZE,
      includeAnnouncement: false,
    });
    // A very old session still gets a token, but not one for the account.
    if (!data.notificationInboxV2) {
      throw new SessionError(
        "Reddit returned no inbox. The session may have expired.",
      );
    }
    const nodes: Notification[] = (
      data.notificationInboxV2.elements?.edges ?? []
    )
      .map((edge: { node?: Notification }) => edge?.node)
      .filter((node: Notification | undefined) => node?.id && node.sentAt);
    const replies = getReplies(nodes);
    const unreadCount = replies.filter((reply) => reply.unread).length;

    // lastMessageId holds the sentAt of the newest notification sent. Before
    // the new inbox it held an old message id, which doesn't parse.
    const lastSentAt = Date.parse(redditAccount.lastMessageId ?? "") || 0;
    const toSend = replies.filter(
      (reply) =>
        reply.unread && reply.sentAt > Math.max(NEW_INBOX_START, lastSentAt),
    );

    if (toSend.length < 1) {
      await db
        .update(redditAccounts)
        .set({
          lastCheckedAt: new Date().toISOString(),
        })
        .where(eq(redditAccounts.id, redditAccount.id))
        .execute();
      return;
    }

    const customer = db
      .select()
      .from(customers)
      .where(eq(customers.customerId, redditAccount.customerId))
      .get();

    if (!customer?.pushToken) {
      throw new Error(
        `Push token not found for customer ${redditAccount.customerId}`,
      );
    }

    // A failed push mustn't stop the watermark below, or the next check would
    // send the others again.
    await Promise.allSettled(
      toSend.map((reply) =>
        PushNotifications.send(
          customer.pushToken!,
          reply.title,
          reply.body,
          unreadCount,
        ),
      ),
    );

    await db
      .update(redditAccounts)
      .set({
        lastMessageId: new Date(
          Math.max(...toSend.map((reply) => reply.sentAt)),
        ).toISOString(),
        lastCheckedAt: new Date().toISOString(),
      })
      .where(eq(redditAccounts.id, redditAccount.id))
      .execute();
  }
}
