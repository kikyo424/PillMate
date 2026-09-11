import type { NextFunction, Request, Response } from "express";
import { db } from "../db/connection.js";
import type { GroupMemberRow, UserRow } from "../db/types.js";
import { HttpError } from "../http/errors.js";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const rawUserId = req.header("x-user-id");
  const userId = Number(rawUserId);

  if (!rawUserId || !Number.isInteger(userId) || userId <= 0) {
    next(new HttpError(401, "x-user-id header is required for development auth"));
    return;
  }

  const user = db
    .prepare("SELECT id, email, name, password_hash, push_subscription, created_at FROM users WHERE id = ?")
    .get(userId) as UserRow | undefined;

  if (!user) {
    next(new HttpError(401, "Authenticated user was not found"));
    return;
  }

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name
  };

  next();
}

export function getGroupMembership(groupId: number, userId: number) {
  return db
    .prepare(
      "SELECT id, group_id, user_id, role, can_edit_schedule, joined_at FROM group_members WHERE group_id = ? AND user_id = ?"
    )
    .get(groupId, userId) as GroupMemberRow | undefined;
}

export function requireGroupMember(req: Request, _res: Response, next: NextFunction) {
  const groupId = Number(req.params.groupId);

  if (!Number.isInteger(groupId) || groupId <= 0) {
    next(new HttpError(400, "A valid groupId is required"));
    return;
  }

  const membership = req.user ? getGroupMembership(groupId, req.user.id) : undefined;

  if (!membership) {
    next(new HttpError(403, "You are not a member of this group"));
    return;
  }

  next();
}

export function requireGroupOwner(req: Request, _res: Response, next: NextFunction) {
  const groupId = Number(req.params.groupId);
  const membership = req.user ? getGroupMembership(groupId, req.user.id) : undefined;

  if (membership?.role !== "OWNER") {
    next(new HttpError(403, "Only the group owner can perform this action"));
    return;
  }

  next();
}

export function requireScheduleEditor(req: Request, _res: Response, next: NextFunction) {
  const groupId = Number(req.params.groupId);
  const membership = req.user ? getGroupMembership(groupId, req.user.id) : undefined;

  if (!membership) {
    next(new HttpError(403, "You are not a member of this group"));
    return;
  }

  if (membership.role !== "OWNER" && membership.can_edit_schedule !== 1) {
    next(new HttpError(403, "Schedule edit permission is required"));
    return;
  }

  next();
}
