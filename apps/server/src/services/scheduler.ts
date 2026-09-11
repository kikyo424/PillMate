import cron from "node-cron";
import type { Server } from "socket.io";
import { config } from "../config.js";
import { db, runTransaction } from "../db/connection.js";
import type { ScheduleRow } from "../db/types.js";
import { buildScheduledTime, getTodayCode } from "../utils/dates.js";
import { createSystemFeedMessage } from "./feed.js";
import { sendPushToGroup, sendPushToUser } from "./notifications.js";

type DueScheduleRow = ScheduleRow & {
  target_user_name: string;
};

type PendingEscalationRow = {
  id: number;
  schedule_id: number;
  target_user_id: number;
  scheduled_time: string;
  group_id: number;
  medicine_name: string;
  dosage: string;
  target_user_name: string;
};

function getDueSchedules(now: Date) {
  const todayCode = getTodayCode(now);
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return db
    .prepare(
      `SELECT s.id, s.group_id, s.target_user_id, s.medicine_name, s.dosage, s.intake_time,
              s.days_of_week, s.is_active, s.created_at, u.name AS target_user_name
       FROM schedules s
       JOIN users u ON u.id = s.target_user_id
       WHERE s.is_active = 1
         AND s.intake_time = ?
         AND instr(',' || s.days_of_week || ',', ',' || ? || ',') > 0`
    )
    .all(currentTime, todayCode) as DueScheduleRow[];
}

function getPendingEscalations(now: Date) {
  const escalationCutoff = new Date(now.getTime() - config.escalationMinutes * 60 * 1000).toISOString();

  return db
    .prepare(
      `SELECT il.id, il.schedule_id, il.target_user_id, il.scheduled_time,
              s.group_id, s.medicine_name, s.dosage, u.name AS target_user_name
       FROM intake_logs il
       JOIN schedules s ON s.id = il.schedule_id
       JOIN users u ON u.id = il.target_user_id
       WHERE il.status = 'PENDING'
         AND il.escalated_at IS NULL
         AND il.scheduled_time <= ?`
    )
    .all(escalationCutoff) as PendingEscalationRow[];
}

async function notifyDueSchedule(io: Server, schedule: DueScheduleRow, now: Date) {
  const scheduledTime = buildScheduledTime(now, schedule.intake_time);
  let shouldNotify = false;

  runTransaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO intake_logs (schedule_id, target_user_id, scheduled_time)
       VALUES (?, ?, ?)`
    ).run(schedule.id, schedule.target_user_id, scheduledTime);

    const result = db
      .prepare(
        `UPDATE intake_logs
         SET notification_sent_at = CURRENT_TIMESTAMP
         WHERE schedule_id = ?
           AND scheduled_time = ?
           AND status = 'PENDING'
           AND notification_sent_at IS NULL`
      )
      .run(schedule.id, scheduledTime);

    shouldNotify = result.changes > 0;
  });

  if (!shouldNotify) {
    return;
  }

  const payload = {
    schedule_id: schedule.id,
    group_id: schedule.group_id,
    target_user_id: schedule.target_user_id,
    medicine_name: schedule.medicine_name,
    dosage: schedule.dosage,
    scheduled_time: scheduledTime
  };

  io.to(`user:${schedule.target_user_id}`).emit("intake:due", payload);

  await sendPushToUser(schedule.target_user_id, {
    title: "복약 시간입니다",
    body: `${schedule.medicine_name} ${schedule.dosage} 복용 시간이에요.`,
    kind: "INTAKE_DUE",
    url: "/"
  });
}

async function escalateMissedIntake(io: Server, intake: PendingEscalationRow) {
  const result = db
    .prepare(
      `UPDATE intake_logs
       SET escalated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'PENDING' AND escalated_at IS NULL`
    )
    .run(intake.id);

  if (result.changes === 0) {
    return;
  }

  const content = `경고: ${intake.target_user_name}님이 아직 ${intake.medicine_name} 복약을 완료하지 않았습니다.`;
  const payload = {
    intake_log_id: intake.id,
    schedule_id: intake.schedule_id,
    group_id: intake.group_id,
    target_user_id: intake.target_user_id,
    medicine_name: intake.medicine_name,
    scheduled_time: intake.scheduled_time
  };

  createSystemFeedMessage(io, intake.group_id, content);
  io.to(`group:${intake.group_id}`).emit("intake:escalated", payload);

  await sendPushToGroup(intake.group_id, {
    title: "복약 미확인 경고",
    body: content,
    kind: "INTAKE_ESCALATED",
    url: "/"
  });
}

export async function runMedicationSchedulerTick(io: Server, now = new Date()) {
  const dueSchedules = getDueSchedules(now);

  for (const schedule of dueSchedules) {
    await notifyDueSchedule(io, schedule, now);
  }

  const pendingEscalations = getPendingEscalations(now);

  for (const intake of pendingEscalations) {
    await escalateMissedIntake(io, intake);
  }

  return {
    dueSchedules: dueSchedules.length,
    escalations: pendingEscalations.length
  };
}

export function startMedicationScheduler(io: Server) {
  const task = cron.schedule("* * * * *", () => {
    runMedicationSchedulerTick(io).catch((error) => {
      console.error("Medication scheduler tick failed", error);
    });
  });

  return task;
}
