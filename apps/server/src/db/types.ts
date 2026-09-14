export type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  push_subscription: string | null;
  created_at: string;
};

export type GroupRow = {
  id: number;
  name: string;
  owner_id: number;
  invite_code: string;
  created_at: string;
};

export type GroupMemberRow = {
  id: number;
  group_id: number;
  user_id: number;
  role: "OWNER" | "MANAGER" | "MEMBER";
  nickname: string | null;
  can_edit_schedule: 0 | 1;
  joined_at: string;
};

export type ScheduleRow = {
  id: number;
  group_id: number;
  target_user_id: number;
  medicine_name: string;
  dosage: string;
  intake_time: string;
  days_of_week: string;
  escalation_minutes: number;
  is_active: 0 | 1;
  created_at: string;
};
