import express from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import type { Server } from "socket.io";
import { db, runTransaction } from "../db/connection.js";
import type { GroupRow, ScheduleRow, UserRow } from "../db/types.js";
import { asyncHandler, HttpError } from "../http/errors.js";
import type { AuthedRequest } from "../http/request.js";
import {
  getGroupMembership,
  requireAuth,
  requireGroupMember,
  requireGroupOwner,
  requireScheduleEditor
} from "../middleware/auth.js";
import { buildScheduledTime, getTodayCode } from "../utils/dates.js";
import { createInviteCode } from "../utils/inviteCode.js";
import { hashPassword } from "../utils/password.js";
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
      `SELECT id, group_id, target_user_id, medicine_name, dosage, intake_time, days_of_week, is_active, created_at
       FROM schedules
       WHERE id = ?`
    )
    .get(scheduleId) as ScheduleRow | undefined;
}

function createVerificationFeed(
  io: Server,
  schedule: ScheduleRow,
  user: { id: number; name: string },
  verificationType: "BUTTON" | "PHOTO",
  photoUrl: string | null
) {
  const content =
    verificationType === "PHOTO"
      ? `${user.name}님이 사진으로 복약을 인증했습니다.`
      : `${user.name}님이 복약을 완료했습니다.`;

  const result = db
    .prepare(
      `INSERT INTO chat_messages (group_id, sender_id, message_type, content, photo_url)
       VALUES (?, NULL, 'SYSTEM_VERIFICATION', ?, ?)`
    )
    .run(schedule.group_id, content, photoUrl);

  const message = db
    .prepare(
      `SELECT id, group_id, sender_id, message_type, content, photo_url, created_at
       FROM chat_messages
       WHERE id = ?`
    )
    .get(Number(result.lastInsertRowid));

  io.to(`group:${schedule.group_id}`).emit("chat:message", message);
}

export function createApiRouter(io: Server) {
  const router = express.Router();

  router.post(
    "/users",
    asyncHandler((req, res) => {
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

  router.get(
    "/me",
    requireAuth,
    asyncHandler((req, res) => {
      res.json({ user: (req as AuthedRequest).user });
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

      db.prepare(
        `INSERT OR IGNORE INTO group_members (group_id, user_id, role, can_edit_schedule)
         VALUES (?, ?, 'MEMBER', 0)`
      ).run(group.id, authedReq.user.id);

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
          `SELECT gm.id, gm.group_id, gm.user_id, gm.role, gm.can_edit_schedule, gm.joined_at,
                  u.email, u.name
           FROM group_members gm
           JOIN users u ON u.id = gm.user_id
           WHERE gm.group_id = ?
           ORDER BY gm.role = 'OWNER' DESC, u.name ASC`
        )
        .all(groupId);

      res.json({ members });
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
        .prepare("SELECT id, role FROM group_members WHERE id = ? AND group_id = ?")
        .get(memberId, groupId) as { id: number; role: string } | undefined;

      if (!member) {
        throw new HttpError(404, "Group member was not found");
      }

      if (member.role === "OWNER" && !canEditSchedule) {
        throw new HttpError(400, "Owner schedule edit permission cannot be revoked");
      }

      db.prepare("UPDATE group_members SET can_edit_schedule = ? WHERE id = ?").run(canEditSchedule ? 1 : 0, memberId);

      const updatedMember = db
        .prepare("SELECT id, group_id, user_id, role, can_edit_schedule, joined_at FROM group_members WHERE id = ?")
        .get(memberId);

      res.json({ member: updatedMember });
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
                  s.days_of_week, s.is_active, s.created_at, u.name AS target_user_name
           FROM schedules s
           JOIN users u ON u.id = s.target_user_id
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
      const schedules = db
        .prepare(
          `SELECT s.id, s.group_id, s.target_user_id, s.medicine_name, s.dosage, s.intake_time,
                  s.days_of_week, s.is_active, s.created_at, u.name AS target_user_name
           FROM schedules s
           JOIN users u ON u.id = s.target_user_id
           WHERE s.group_id = ? AND s.is_active = 1 AND instr(',' || s.days_of_week || ',', ',' || ? || ',') > 0
           ORDER BY s.intake_time ASC`
        )
        .all(groupId, todayCode);

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

      assertTargetIsGroupMember(groupId, targetUserId);

      const result = db
        .prepare(
          `INSERT INTO schedules (group_id, target_user_id, medicine_name, dosage, intake_time, days_of_week)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(groupId, targetUserId, medicineName, dosage, intakeTime, daysOfWeek);
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
      const isActive = req.body.is_active === undefined ? existingSchedule.is_active === 1 : optionalBoolean(req.body.is_active, true);

      assertTargetIsGroupMember(groupId, targetUserId);

      db.prepare(
        `UPDATE schedules
         SET target_user_id = ?, medicine_name = ?, dosage = ?, intake_time = ?, days_of_week = ?, is_active = ?
         WHERE id = ?`
      ).run(targetUserId, medicineName, dosage, intakeTime, daysOfWeek, isActive ? 1 : 0, scheduleId);

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

      db.prepare("UPDATE schedules SET is_active = 0 WHERE id = ?").run(scheduleId);
      res.status(204).send();
    })
  );

  router.post(
    "/schedules/:scheduleId/complete",
    requireAuth,
    upload.single("photo"),
    asyncHandler((req, res) => {
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
      const photoUrl = req.file ? `/uploads/intake-verifications/${req.file.filename}` : null;
      const verificationType = photoUrl ? "PHOTO" : "BUTTON";

      const completeLog = () =>
        runTransaction(() => {
        db.prepare(
          `INSERT OR IGNORE INTO intake_logs (schedule_id, target_user_id, scheduled_time)
           VALUES (?, ?, ?)`
        ).run(schedule.id, schedule.target_user_id, scheduledTime);

        db.prepare(
          `UPDATE intake_logs
           SET status = 'COMPLETED', verification_type = ?, photo_url = ?, completed_at = CURRENT_TIMESTAMP
           WHERE schedule_id = ? AND scheduled_time = ?`
        ).run(verificationType, photoUrl, schedule.id, scheduledTime);

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

      res.json({ intake_log: completeLog() });
    })
  );

  router.post(
    "/groups/:groupId/messages",
    requireAuth,
    requireGroupMember,
    asyncHandler((req, res) => {
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
                  cm.created_at, u.name AS sender_name
           FROM chat_messages cm
           LEFT JOIN users u ON u.id = cm.sender_id
           WHERE cm.id = ?`
        )
        .get(Number(result.lastInsertRowid));

      io.to(`group:${groupId}`).emit("chat:message", message);
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
                  cm.created_at, u.name AS sender_name
           FROM chat_messages cm
           LEFT JOIN users u ON u.id = cm.sender_id
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
