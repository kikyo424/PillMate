import express from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import type { Server } from "socket.io";
import { db, runTransaction } from "../db/connection.js";
import type { GroupRow, ScheduleRow } from "../db/types.js";
import { asyncHandler, HttpError } from "../http/errors.js";
import type { AuthedRequest } from "../http/request.js";
import {
  getGroupMembership,
  requireAuth,
  requireGroupMember,
  requireGroupOwner,
  requireScheduleEditor
} from "../middleware/auth.js";
import { buildScheduledTime, getLocalDayBounds, getTodayCode } from "../utils/dates.js";
import { createSystemFeedMessage } from "../services/feed.js";
import { sendPushToGroup } from "../services/notifications.js";
import { runMedicationSchedulerTick } from "../services/scheduler.js";
import { createInviteCode } from "../utils/inviteCode.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import {
  optionalBoolean,
  requireDaysOfWeek,
  requireEmail,
  requireInt,
  requireIntakeTime,
  requireString
} from "../utils/validation.js";

const uploadsDir = path.resolve(process.cwd(), "uploads", "intake-verifications");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname) || ".jpg";
      const safeName = `${Date.now()}-${Math.round(Math.random() * 1_000_000_000)}${extension}`;
      cb(null, safeName);
    }
  }),
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new HttpError(400, "Only image uploads are allowed"));
      return;
    }

    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

function createUniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = createInviteCode();
    const existingGroup = db
      .prepare("SELECT id FROM groups WHERE invite_code = ?")
      .get(inviteCode) as { id: number } | undefined;

    if (!existingGroup) {
      return inviteCode;
    }
  }

  throw new HttpError(500, "Could not create a unique invite code");
}

function assertTargetIsGroupMember(groupId: number, targetUserId: number) {
  const membership = getGroupMembership(groupId, targetUserId);

  if (!membership) {
    throw new HttpError(400, "target_user_id must belong to the group");
  }
}

function getSchedule(scheduleId: number) {
  return db
    .prepare(
      `SELECT id, group_id, target_user_id, medicine_name, dosage, intake_time, days_of_week,
              escalation_minutes, is_active, created_at
       FROM schedules
       WHERE id = ?`
    )
    .get(scheduleId) as ScheduleRow | undefined;
}

function requireEscalationMinutes(value: unknown) {
  const minutes = Number(value);

  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new HttpError(400, "escalation_minutes must be an integer between 1 and 1440");
  }

  return minutes;
}

function getGroupDisplayName(groupId: number, userId: number, fallback: string) {
  const membership = db
    .prepare("SELECT nickname FROM group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, userId) as { nickname: string | null } | undefined;

  return membership?.nickname?.trim() || fallback;
}

function createVerificationFeed(
  io: Server,
  schedule: ScheduleRow,
  user: { id: number; name: string },
  verificationType: "BUTTON" | "PHOTO",
  photoUrl: string | null
) {
  const displayName = getGroupDisplayName(schedule.group_id, user.id, user.name);
  const medicineText = `${schedule.medicine_name} ${schedule.dosage}`.trim();
  const content =
    verificationType === "PHOTO"
      ? `${displayName}님이 ${medicineText} 복약을 사진으로 인증했습니다.`
      : `${displayName}님이 ${medicineText} 복약을 완료했습니다.`;

  return createSystemFeedMessage(io, schedule.group_id, content, photoUrl);
}

export function createApiRouter(io: Server) {
  const router = express.Router();

  router.post(
    "/users",
    asyncHandler(async (req, res) => {
      const email = requireEmail(req.body.email);
      const password = requireString(req.body.password, "password");
      const name = requireString(req.body.name, "name");

      if (password.length < 8) {
        throw new HttpError(400, "password must be at least 8 characters");
      }

      const result = db
        .prepare("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)")
        .run(email, hashPassword(password), name);
      const user = db
        .prepare("SELECT id, email, name, created_at FROM users WHERE id = ?")
        .get(Number(result.lastInsertRowid));

      res.status(201).json({ user });
    })
  );

  router.post(
    "/auth/login",
    asyncHandler(async (req, res) => {
      const email = requireEmail(req.body.email);
      const password = requireString(req.body.password, "password");
      const userWithPassword = db
        .prepare("SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?")
        .get(email) as { id: number; email: string; name: string; password_hash: string; created_at: string } | undefined;

      if (!userWithPassword || !verifyPassword(password, userWithPassword.password_hash)) {
        throw new HttpError(401, "이메일 또는 비밀번호가 올바르지 않습니다.");
      }

      const { password_hash: _passwordHash, ...user } = userWithPassword;
      res.json({ user });
    })
  );

  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ user: (req as AuthedRequest).user });
    })
  );

  router.get(
    "/push/vapid-public-key",
    asyncHandler((_req, res) => {
      res.json({
        enabled: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        publicKey: process.env.VAPID_PUBLIC_KEY ?? null
      });
    })
  );

  router.post(
    "/me/push-subscription",
    requireAuth,
    asyncHandler((req, res) => {
      const authedReq = req as AuthedRequest;

      if (!req.body || typeof req.body !== "object") {
        throw new HttpError(400, "Push subscription body is required");
      }

      const endpoint = requireString(req.body.endpoint, "endpoint");
      const subscriptionJson = JSON.stringify(req.body);

      db.prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, subscription_json)
         VALUES (?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           subscription_json = excluded.subscription_json,
           updated_at = CURRENT_TIMESTAMP`
      ).run(authedReq.user.id, endpoint, subscriptionJson);

      res.status(204).send();
    })
  );

  router.delete(
    "/me/push-subscription",
    requireAuth,
    asyncHandler((req, res) => {
      const authedReq = req as AuthedRequest;
      const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : null;

      if (endpoint) {
        db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(authedReq.user.id, endpoint);
      } else {
        db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(authedReq.user.id);
      }

      res.status(204).send();
    })
  );

  router.post(
    "/groups",
    requireAuth,
    asyncHandler((req, res) => {
      const authedReq = req as AuthedRequest;
      const name = requireString(req.body.name, "name");
      const inviteCode = createUniqueInviteCode();

      const createGroup = () =>
        runTransaction(() => {
        const groupResult = db
          .prepare("INSERT INTO groups (name, owner_id, invite_code) VALUES (?, ?, ?)")
          .run(name, authedReq.user.id, inviteCode);
        const groupId = Number(groupResult.lastInsertRowid);

        db.prepare(
          `INSERT INTO group_members (group_id, user_id, role, can_edit_schedule)
           VALUES (?, ?, 'OWNER', 1)`
        ).run(groupId, authedReq.user.id);

        return db
          .prepare("SELECT id, name, owner_id, invite_code, created_at FROM groups WHERE id = ?")
          .get(groupId);
      });

      res.status(201).json({ group: createGroup() });
    })
  );

  router.get(
    "/groups",
    requireAuth,
    asyncHandler((req, res) => {
      const authedReq = req as AuthedRequest;
      const groups = db
        .prepare(
          `SELECT g.id, g.name, g.owner_id, g.invite_code, g.created_at,
                  gm.role, gm.can_edit_schedule
           FROM groups g
           JOIN group_members gm ON gm.group_id = g.id
           WHERE gm.user_id = ?
           ORDER BY g.created_at DESC`
        )
        .all(authedReq.user.id);

      res.json({ groups });
    })
  );

  router.patch(
    "/groups/:groupId",
    requireAuth,
    requireGroupOwner,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const name = requireString(req.body.name, "name");

      db.prepare("UPDATE groups SET name = ? WHERE id = ?").run(name, groupId);

      const group = db
        .prepare("SELECT id, name, owner_id, invite_code, created_at FROM groups WHERE id = ?")
        .get(groupId);

      res.json({ group });
    })
  );

  router.post(
    "/groups/:groupId/invite-code",
    requireAuth,
    requireGroupOwner,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const inviteCode = createUniqueInviteCode();

      db.prepare("UPDATE groups SET invite_code = ? WHERE id = ?").run(inviteCode, groupId);

      const group = db
        .prepare("SELECT id, name, owner_id, invite_code, created_at FROM groups WHERE id = ?")
        .get(groupId);

      res.json({ group });
    })
  );

  router.delete(
    "/groups/:groupId",
    requireAuth,
    requireGroupOwner,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");

      db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
      res.status(204).send();
    })
  );

  router.delete(
    "/groups/:groupId/me",
    requireAuth,
    requireGroupMember,
    asyncHandler((req, res) => {
      const authedReq = req as AuthedRequest;
      const groupId = requireInt(req.params.groupId, "groupId");
      const membership = getGroupMembership(groupId, authedReq.user.id);

      if (membership?.role === "OWNER") {
        throw new HttpError(400, "Owner must delete the group instead of leaving it");
      }

      db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").run(groupId, authedReq.user.id);
      res.status(204).send();
    })
  );

  router.post(
    "/groups/join",
    requireAuth,
    asyncHandler((req, res) => {
      const authedReq = req as AuthedRequest;
      const inviteCode = requireString(req.body.invite_code ?? req.body.inviteCode, "invite_code").toUpperCase();
      const group = db
        .prepare("SELECT id, name, owner_id, invite_code, created_at FROM groups WHERE invite_code = ?")
        .get(inviteCode) as GroupRow | undefined;

      if (!group) {
        throw new HttpError(404, "Group invite code was not found");
      }

      runTransaction(() => {
        const result = db
          .prepare(
            `INSERT OR IGNORE INTO group_members (group_id, user_id, role, can_edit_schedule)
             VALUES (?, ?, 'MEMBER', 0)`
          )
          .run(group.id, authedReq.user.id);

        if (result.changes > 0) {
          createSystemFeedMessage(io, group.id, `${authedReq.user.name}님이 입장했습니다.`);
        }
      });

      res.status(201).json({ group });
    })
  );

  router.get(
    "/groups/:groupId/members",
    requireAuth,
    requireGroupMember,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const members = db
        .prepare(
          `SELECT gm.id, gm.group_id, gm.user_id, gm.role, gm.nickname, gm.can_edit_schedule, gm.joined_at,
                  u.email, u.name, COALESCE(NULLIF(gm.nickname, ''), u.name) AS display_name
           FROM group_members gm
           JOIN users u ON u.id = gm.user_id
           WHERE gm.group_id = ?
           ORDER BY gm.role = 'OWNER' DESC, display_name ASC`
        )
        .all(groupId);

      res.json({ members });
    })
  );

  router.patch(
    "/groups/:groupId/me/nickname",
    requireAuth,
    requireGroupMember,
    asyncHandler((req, res) => {
      const authedReq = req as AuthedRequest;
      const groupId = requireInt(req.params.groupId, "groupId");
      const nickname = String(req.body.nickname ?? "").trim();

      if (nickname.length > 30) {
        throw new HttpError(400, "Nickname must be 30 characters or fewer");
      }

      db.prepare("UPDATE group_members SET nickname = ? WHERE group_id = ? AND user_id = ?").run(
        nickname || null,
        groupId,
        authedReq.user.id
      );

      const member = db
        .prepare(
          `SELECT gm.id, gm.group_id, gm.user_id, gm.role, gm.nickname, gm.can_edit_schedule, gm.joined_at,
                  u.email, u.name, COALESCE(NULLIF(gm.nickname, ''), u.name) AS display_name
           FROM group_members gm
           JOIN users u ON u.id = gm.user_id
           WHERE gm.group_id = ? AND gm.user_id = ?`
        )
        .get(groupId, authedReq.user.id);

      res.json({ member });
    })
  );

  router.patch(
    "/groups/:groupId/members/:memberId/permissions",
    requireAuth,
    requireGroupOwner,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const memberId = requireInt(req.params.memberId, "memberId");
      const canEditSchedule = optionalBoolean(req.body.can_edit_schedule, false);

      const member = db
        .prepare(
          `SELECT gm.id, gm.role, gm.user_id, gm.nickname, u.name
           FROM group_members gm
           JOIN users u ON u.id = gm.user_id
           WHERE gm.id = ? AND gm.group_id = ?`
        )
        .get(memberId, groupId) as { id: number; role: string; user_id: number; nickname: string | null; name: string } | undefined;

      if (!member) {
        throw new HttpError(404, "Group member was not found");
      }

      if (member.role === "OWNER" && !canEditSchedule) {
        throw new HttpError(400, "Owner schedule edit permission cannot be revoked");
      }

      db.prepare("UPDATE group_members SET can_edit_schedule = ? WHERE id = ?").run(canEditSchedule ? 1 : 0, memberId);

      const updatedMember = db
        .prepare("SELECT id, group_id, user_id, role, nickname, can_edit_schedule, joined_at FROM group_members WHERE id = ?")
        .get(memberId);

      res.json({ member: updatedMember });
    })
  );

  router.delete(
    "/groups/:groupId/members/:memberId",
    requireAuth,
    requireGroupOwner,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const memberId = requireInt(req.params.memberId, "memberId");

      const member = db
        .prepare(
          `SELECT gm.id, gm.role, gm.nickname, u.name
           FROM group_members gm
           JOIN users u ON u.id = gm.user_id
           WHERE gm.id = ? AND gm.group_id = ?`
        )
        .get(memberId, groupId) as { id: number; role: string; nickname: string | null; name: string } | undefined;

      if (!member) {
        throw new HttpError(404, "Group member was not found");
      }

      if (member.role === "OWNER") {
        throw new HttpError(400, "Owner cannot be removed from the group");
      }

      const displayName = member.nickname?.trim() || member.name;

      runTransaction(() => {
        db.prepare("DELETE FROM group_members WHERE id = ? AND group_id = ?").run(memberId, groupId);
        createSystemFeedMessage(io, groupId, `${displayName}님을 강퇴했습니다.`);
      });

      res.status(204).send();
    })
  );

  router.get(
    "/groups/:groupId/schedules",
    requireAuth,
    requireGroupMember,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const schedules = db
        .prepare(
          `SELECT s.id, s.group_id, s.target_user_id, s.medicine_name, s.dosage, s.intake_time,
                  s.days_of_week, s.escalation_minutes, s.is_active, s.created_at,
                  COALESCE(NULLIF(gm.nickname, ''), u.name) AS target_user_name
           FROM schedules s
           JOIN users u ON u.id = s.target_user_id
           LEFT JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = s.target_user_id
           WHERE s.group_id = ?
           ORDER BY s.intake_time ASC, s.created_at DESC`
        )
        .all(groupId);

      res.json({ schedules });
    })
  );

  router.get(
    "/groups/:groupId/schedules/today",
    requireAuth,
    requireGroupMember,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const today = req.query.date ? new Date(String(req.query.date)) : new Date();
      const todayCode = getTodayCode(today);
      const dayBounds = getLocalDayBounds(today);
      const schedules = db
        .prepare(
          `SELECT s.id, s.group_id, s.target_user_id, s.medicine_name, s.dosage, s.intake_time,
                  s.days_of_week, s.escalation_minutes, s.is_active, s.created_at,
                  COALESCE(NULLIF(gm.nickname, ''), u.name) AS target_user_name,
                  il.id AS intake_log_id, il.status, il.verification_type, il.photo_url,
                  il.completed_at, il.scheduled_time
           FROM schedules s
           JOIN users u ON u.id = s.target_user_id
           LEFT JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = s.target_user_id
           LEFT JOIN intake_logs il
             ON il.schedule_id = s.id
            AND il.scheduled_time >= ?
            AND il.scheduled_time < ?
           WHERE s.group_id = ? AND s.is_active = 1 AND instr(',' || s.days_of_week || ',', ',' || ? || ',') > 0
           ORDER BY s.intake_time ASC`
        )
        .all(dayBounds.start, dayBounds.end, groupId, todayCode);

      res.json({ schedules, date: today.toISOString(), day: todayCode });
    })
  );

  router.post(
    "/groups/:groupId/schedules",
    requireAuth,
    requireScheduleEditor,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const targetUserId = requireInt(req.body.target_user_id, "target_user_id");
      const medicineName = requireString(req.body.medicine_name, "medicine_name");
      const dosage = requireString(req.body.dosage, "dosage");
      const intakeTime = requireIntakeTime(req.body.intake_time);
      const daysOfWeek = requireDaysOfWeek(req.body.days_of_week);
      const escalationMinutes =
        req.body.escalation_minutes === undefined ? 30 : requireEscalationMinutes(req.body.escalation_minutes);

      assertTargetIsGroupMember(groupId, targetUserId);

      const result = db
        .prepare(
          `INSERT INTO schedules (group_id, target_user_id, medicine_name, dosage, intake_time, days_of_week, escalation_minutes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(groupId, targetUserId, medicineName, dosage, intakeTime, daysOfWeek, escalationMinutes);
      const schedule = getSchedule(Number(result.lastInsertRowid));

      res.status(201).json({ schedule });
    })
  );

  router.patch(
    "/groups/:groupId/schedules/:scheduleId",
    requireAuth,
    requireScheduleEditor,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const scheduleId = requireInt(req.params.scheduleId, "scheduleId");
      const existingSchedule = getSchedule(scheduleId);

      if (!existingSchedule || existingSchedule.group_id !== groupId) {
        throw new HttpError(404, "Schedule was not found");
      }

      const targetUserId =
        req.body.target_user_id === undefined
          ? existingSchedule.target_user_id
          : requireInt(req.body.target_user_id, "target_user_id");
      const medicineName =
        req.body.medicine_name === undefined
          ? existingSchedule.medicine_name
          : requireString(req.body.medicine_name, "medicine_name");
      const dosage = req.body.dosage === undefined ? existingSchedule.dosage : requireString(req.body.dosage, "dosage");
      const intakeTime =
        req.body.intake_time === undefined ? existingSchedule.intake_time : requireIntakeTime(req.body.intake_time);
      const daysOfWeek =
        req.body.days_of_week === undefined
          ? existingSchedule.days_of_week
          : requireDaysOfWeek(req.body.days_of_week);
      const escalationMinutes =
        req.body.escalation_minutes === undefined
          ? existingSchedule.escalation_minutes
          : requireEscalationMinutes(req.body.escalation_minutes);
      const isActive = req.body.is_active === undefined ? existingSchedule.is_active === 1 : optionalBoolean(req.body.is_active, true);

      assertTargetIsGroupMember(groupId, targetUserId);

      db.prepare(
        `UPDATE schedules
         SET target_user_id = ?, medicine_name = ?, dosage = ?, intake_time = ?, days_of_week = ?, escalation_minutes = ?, is_active = ?
         WHERE id = ?`
      ).run(targetUserId, medicineName, dosage, intakeTime, daysOfWeek, escalationMinutes, isActive ? 1 : 0, scheduleId);

      res.json({ schedule: getSchedule(scheduleId) });
    })
  );

  router.delete(
    "/groups/:groupId/schedules/:scheduleId",
    requireAuth,
    requireScheduleEditor,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const scheduleId = requireInt(req.params.scheduleId, "scheduleId");
      const schedule = getSchedule(scheduleId);

      if (!schedule || schedule.group_id !== groupId) {
        throw new HttpError(404, "Schedule was not found");
      }

      db.prepare("DELETE FROM schedules WHERE id = ?").run(scheduleId);
      res.status(204).send();
    })
  );

  router.post(
    "/schedules/:scheduleId/complete",
    requireAuth,
    upload.single("photo"),
    asyncHandler(async (req, res) => {
      const authedReq = req as AuthedRequest;
      const scheduleId = requireInt(req.params.scheduleId, "scheduleId");
      const schedule = getSchedule(scheduleId);

      if (!schedule || schedule.is_active !== 1) {
        throw new HttpError(404, "Active schedule was not found");
      }

      if (schedule.target_user_id !== authedReq.user.id) {
        throw new HttpError(403, "Only the medication target can complete this schedule");
      }

      const membership = getGroupMembership(schedule.group_id, authedReq.user.id);

      if (!membership) {
        throw new HttpError(403, "You are not a member of this schedule group");
      }

      const scheduledTime =
        typeof req.body.scheduled_time === "string" && req.body.scheduled_time.trim()
          ? new Date(req.body.scheduled_time).toISOString()
          : buildScheduledTime(new Date(), schedule.intake_time);
      const scheduledAt = new Date(scheduledTime);

      if (Number.isNaN(scheduledAt.getTime())) {
        throw new HttpError(400, "scheduled_time is invalid");
      }

      if (scheduledAt.getTime() > Date.now()) {
        throw new HttpError(400, "Medication can only be completed after the scheduled time");
      }

      const photoUrl = req.file ? `/uploads/intake-verifications/${req.file.filename}` : null;
      const verificationType = photoUrl ? "PHOTO" : "BUTTON";
      const completedAt = new Date().toISOString();

      const completeLog = () =>
        runTransaction(() => {
        db.prepare(
          `INSERT OR IGNORE INTO intake_logs (schedule_id, target_user_id, scheduled_time)
           VALUES (?, ?, ?)`
        ).run(schedule.id, schedule.target_user_id, scheduledTime);

        db.prepare(
          `UPDATE intake_logs
           SET status = 'COMPLETED', verification_type = ?, photo_url = ?, completed_at = ?
           WHERE schedule_id = ? AND scheduled_time = ?`
        ).run(verificationType, photoUrl, completedAt, schedule.id, scheduledTime);

        const intakeLog = db
          .prepare(
            `SELECT id, schedule_id, target_user_id, scheduled_time, status, verification_type, photo_url, completed_at
             FROM intake_logs
             WHERE schedule_id = ? AND scheduled_time = ?`
          )
          .get(schedule.id, scheduledTime);

        createVerificationFeed(io, schedule, authedReq.user, verificationType, photoUrl);

        return intakeLog;
      });

      const intakeLog = completeLog();
      const displayName = getGroupDisplayName(schedule.group_id, authedReq.user.id, authedReq.user.name);

      await sendPushToGroup(schedule.group_id, {
        title: "복약 완료",
        body: `${displayName}님이 ${schedule.medicine_name} ${schedule.dosage} 복약을 완료했습니다.`,
        kind: "INTAKE_COMPLETED",
        url: "/"
      });

      io.to(`group:${schedule.group_id}`).emit("intake:completed", {
        intake_log: intakeLog,
        schedule_id: schedule.id,
        group_id: schedule.group_id,
        target_user_id: schedule.target_user_id
      });

      res.json({ intake_log: intakeLog });
    })
  );

  router.post(
    "/scheduler/tick",
    requireAuth,
    asyncHandler(async (_req, res) => {
      const result = await runMedicationSchedulerTick(io);
      res.json(result);
    })
  );

  router.post(
    "/groups/:groupId/messages",
    requireAuth,
    requireGroupMember,
    asyncHandler(async (req, res) => {
      const authedReq = req as AuthedRequest;
      const groupId = requireInt(req.params.groupId, "groupId");
      const content = requireString(req.body.content, "content");

      const result = db
        .prepare(
          `INSERT INTO chat_messages (group_id, sender_id, message_type, content)
           VALUES (?, ?, 'TEXT', ?)`
        )
        .run(groupId, authedReq.user.id, content);
      const message = db
        .prepare(
          `SELECT cm.id, cm.group_id, cm.sender_id, cm.message_type, cm.content, cm.photo_url,
                  cm.created_at, COALESCE(NULLIF(gm.nickname, ''), u.name) AS sender_name
           FROM chat_messages cm
           LEFT JOIN users u ON u.id = cm.sender_id
           LEFT JOIN group_members gm ON gm.group_id = cm.group_id AND gm.user_id = cm.sender_id
           WHERE cm.id = ?`
        )
        .get(Number(result.lastInsertRowid));
      const displayName = getGroupDisplayName(groupId, authedReq.user.id, authedReq.user.name);

      io.to(`group:${groupId}`).emit("chat:message", message);
      await sendPushToGroup(
        groupId,
        {
          title: `${displayName}님의 새 메시지`,
          body: content,
          kind: "CHAT_MESSAGE",
          url: "/"
        },
        authedReq.user.id
      );
      res.status(201).json({ message });
    })
  );

  router.get(
    "/groups/:groupId/messages",
    requireAuth,
    requireGroupMember,
    asyncHandler((req, res) => {
      const groupId = requireInt(req.params.groupId, "groupId");
      const limit = Math.min(Number(req.query.limit ?? 50), 100);
      const messages = db
        .prepare(
          `SELECT cm.id, cm.group_id, cm.sender_id, cm.message_type, cm.content, cm.photo_url,
                  cm.created_at, COALESCE(NULLIF(gm.nickname, ''), u.name) AS sender_name
           FROM chat_messages cm
           LEFT JOIN users u ON u.id = cm.sender_id
           LEFT JOIN group_members gm ON gm.group_id = cm.group_id AND gm.user_id = cm.sender_id
           WHERE cm.group_id = ?
           ORDER BY cm.created_at DESC, cm.id DESC
           LIMIT ?`
        )
        .all(groupId, limit)
        .reverse();

      res.json({ messages });
    })
  );

  return router;
}
