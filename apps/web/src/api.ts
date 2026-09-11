const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export type User = {
  id: number;
  email: string;
  name: string;
};

export type Group = {
  id: number;
  name: string;
  owner_id: number;
  invite_code: string;
  role: "OWNER" | "MANAGER" | "MEMBER";
  can_edit_schedule: 0 | 1;
};

export type Member = {
  id: number;
  group_id: number;
  user_id: number;
  role: "OWNER" | "MANAGER" | "MEMBER";
  can_edit_schedule: 0 | 1;
  email: string;
  name: string;
};

export type Schedule = {
  id: number;
  group_id: number;
  target_user_id: number;
  target_user_name?: string;
  medicine_name: string;
  dosage: string;
  intake_time: string;
  days_of_week: string;
  is_active: 0 | 1;
  status?: "PENDING" | "COMPLETED" | "MISSED" | "SKIPPED" | null;
  verification_type?: "BUTTON" | "PHOTO" | null;
  photo_url?: string | null;
  completed_at?: string | null;
  scheduled_time?: string | null;
};

export type ChatMessage = {
  id: number;
  group_id: number;
  sender_id: number | null;
  sender_name?: string | null;
  message_type: "TEXT" | "PHOTO" | "SYSTEM_VERIFICATION";
  content: string;
  photo_url: string | null;
  created_at: string;
};

type ApiOptions = {
  method?: string;
  userId?: number;
  body?: unknown;
};

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers();

  if (options.userId) {
    headers.set("x-user-id", String(options.userId));
  }

  let body: BodyInit | undefined;

  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(errorBody.error ?? "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const apiBaseUrl = API_BASE_URL;

export const pillmateApi = {
  createUser(body: { name: string; email: string; password: string }) {
    return api<{ user: User }>("/api/users", { method: "POST", body });
  },
  listGroups(userId: number) {
    return api<{ groups: Group[] }>("/api/groups", { userId });
  },
  createGroup(userId: number, name: string) {
    return api<{ group: Group }>("/api/groups", { method: "POST", userId, body: { name } });
  },
  joinGroup(userId: number, inviteCode: string) {
    return api<{ group: Group }>("/api/groups/join", {
      method: "POST",
      userId,
      body: { invite_code: inviteCode }
    });
  },
  listMembers(userId: number, groupId: number) {
    return api<{ members: Member[] }>(`/api/groups/${groupId}/members`, { userId });
  },
  updatePermission(userId: number, groupId: number, memberId: number, canEditSchedule: boolean) {
    return api<{ member: Member }>(`/api/groups/${groupId}/members/${memberId}/permissions`, {
      method: "PATCH",
      userId,
      body: { can_edit_schedule: canEditSchedule }
    });
  },
  listTodaySchedules(userId: number, groupId: number) {
    return api<{ schedules: Schedule[]; day: string }>(`/api/groups/${groupId}/schedules/today`, { userId });
  },
  listSchedules(userId: number, groupId: number) {
    return api<{ schedules: Schedule[] }>(`/api/groups/${groupId}/schedules`, { userId });
  },
  createSchedule(userId: number, groupId: number, body: Record<string, unknown>) {
    return api<{ schedule: Schedule }>(`/api/groups/${groupId}/schedules`, {
      method: "POST",
      userId,
      body
    });
  },
  completeSchedule(userId: number, scheduleId: number, photo?: File) {
    const body = new FormData();

    if (photo) {
      body.set("photo", photo);
    }

    return api<{ intake_log: unknown }>(`/api/schedules/${scheduleId}/complete`, {
      method: "POST",
      userId,
      body
    });
  },
  listMessages(userId: number, groupId: number) {
    return api<{ messages: ChatMessage[] }>(`/api/groups/${groupId}/messages`, { userId });
  },
  sendMessage(userId: number, groupId: number, content: string) {
    return api<{ message: ChatMessage }>(`/api/groups/${groupId}/messages`, {
      method: "POST",
      userId,
      body: { content }
    });
  }
};
