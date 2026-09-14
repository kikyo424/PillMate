import webPush from "web-push";
import { db } from "../db/connection.js";
import { config } from "../config.js";

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  kind: "INTAKE_DUE" | "INTAKE_COMPLETED" | "INTAKE_ESCALATED" | "CHAT_MESSAGE";
};

type PushSubscriptionRecipient = {
  id: number;
  user_id: number;
  endpoint: string;
  subscription_json: string;
};

const pushEnabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey);

if (pushEnabled) {
  webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey!, config.vapidPrivateKey!);
}

export function getGroupPushRecipients(groupId: number, excludeUserId?: number) {
  return db
    .prepare(
      `SELECT ps.id, ps.user_id, ps.endpoint, ps.subscription_json
       FROM group_members gm
       JOIN push_subscriptions ps ON ps.user_id = gm.user_id
       WHERE gm.group_id = ?
         AND (? IS NULL OR gm.user_id <> ?)`
    )
    .all(groupId, excludeUserId ?? null, excludeUserId ?? null) as PushSubscriptionRecipient[];
}

export function getUserPushRecipient(userId: number) {
  return db
    .prepare("SELECT id, user_id, endpoint, subscription_json FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as PushSubscriptionRecipient[];
}

export async function sendPushToUsers(recipients: PushSubscriptionRecipient[], payload: PushPayload) {
  if (!pushEnabled) {
    return;
  }

  await Promise.all(
    recipients.map(async (recipient) => {
      try {
        await webPush.sendNotification(JSON.parse(recipient.subscription_json), JSON.stringify(payload));
      } catch (error) {
        db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(recipient.id);
        console.warn(`Failed to send push notification to user ${recipient.user_id}`, error);
      }
    })
  );
}

export async function sendPushToUser(userId: number, payload: PushPayload) {
  const recipients = getUserPushRecipient(userId);

  if (recipients.length === 0) {
    return;
  }

  await sendPushToUsers(recipients, payload);
}

export async function sendPushToGroup(groupId: number, payload: PushPayload, excludeUserId?: number) {
  await sendPushToUsers(getGroupPushRecipients(groupId, excludeUserId), payload);
}
