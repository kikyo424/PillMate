import webPush from "web-push";
import { db } from "../db/connection.js";
import type { UserRow } from "../db/types.js";
import { config } from "../config.js";

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  kind: "INTAKE_DUE" | "INTAKE_COMPLETED" | "INTAKE_ESCALATED";
};

type PushRecipient = Pick<UserRow, "id" | "push_subscription">;

const pushEnabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey);

if (pushEnabled) {
  webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey!, config.vapidPrivateKey!);
}

export function getGroupPushRecipients(groupId: number) {
  return db
    .prepare(
      `SELECT u.id, u.push_subscription
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ? AND u.push_subscription IS NOT NULL`
    )
    .all(groupId) as PushRecipient[];
}

export function getUserPushRecipient(userId: number) {
  return db
    .prepare("SELECT id, push_subscription FROM users WHERE id = ? AND push_subscription IS NOT NULL")
    .get(userId) as PushRecipient | undefined;
}

export async function sendPushToUsers(recipients: PushRecipient[], payload: PushPayload) {
  if (!pushEnabled) {
    return;
  }

  await Promise.all(
    recipients.map(async (recipient) => {
      if (!recipient.push_subscription) {
        return;
      }

      try {
        await webPush.sendNotification(JSON.parse(recipient.push_subscription), JSON.stringify(payload));
      } catch (error) {
        console.warn(`Failed to send push notification to user ${recipient.id}`, error);
      }
    })
  );
}

export async function sendPushToUser(userId: number, payload: PushPayload) {
  const recipient = getUserPushRecipient(userId);

  if (!recipient) {
    return;
  }

  await sendPushToUsers([recipient], payload);
}

export async function sendPushToGroup(groupId: number, payload: PushPayload) {
  await sendPushToUsers(getGroupPushRecipients(groupId), payload);
}
