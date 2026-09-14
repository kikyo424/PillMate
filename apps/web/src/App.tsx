import {
  Bell,
  CalendarClock,
  Camera,
  Check,
  ClipboardList,
  Edit3,
  HeartPulse,
  Home,
  LogOut,
  MessageCircle,
  Plus,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  X,
  UserPlus,
  Users
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { ApiError, apiBaseUrl, ChatMessage, Group, Member, pillmateApi, Schedule, User } from "./api";
import { authClient } from "./auth-client";
import { createPillMateSocket } from "./socket";

type Tab = "home" | "today" | "chat" | "manage";
type Notice = { tone: "good" | "warn" | "info"; text: string };
type AppNotification = Notice & {
  id: number;
  created_at: string;
};
type UnreadCounts = Record<number, number>;
type ScheduleFormState = {
  target_user_id: string;
  medicine_name: string;
  dosage: string;
  intake_time: string;
  days_of_week: string;
  escalation_minutes: string;
};

const weekDays = [
  ["MON", "월"],
  ["TUE", "화"],
  ["WED", "수"],
  ["THU", "목"],
  ["FRI", "금"],
  ["SAT", "토"],
  ["SUN", "일"]
] as const;

const emptyScheduleForm: ScheduleFormState = {
  target_user_id: "",
  medicine_name: "",
  dosage: "",
  intake_time: "08:30",
  days_of_week: "MON,TUE,WED,THU,FRI",
  escalation_minutes: "30"
};

function readStoredUser() {
  const raw = localStorage.getItem("pillmate:user");
  return raw ? (JSON.parse(raw) as User) : null;
}

function statusLabel(status?: Schedule["status"]) {
  if (status === "COMPLETED") return "완료";
  if (status === "PENDING") return "대기";
  if (status === "MISSED") return "미복용";
  return "예정";
}

function parseServerDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(" ", "T")}Z`);
  }

  return new Date(value);
}

function formatTime(value?: string | null) {
  if (!value) return "";
  return parseServerDate(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function formatChatTimestamp(value: string) {
  return parseServerDate(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getCurrentMinuteKey(date = new Date()) {
  return `${getLocalDateKey(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function isScheduleDue(schedule: Schedule, now = new Date()) {
  if (schedule.scheduled_time) {
    return new Date(schedule.scheduled_time).getTime() <= now.getTime();
  }

  const [hours, minutes] = schedule.intake_time.split(":").map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);

  return scheduled.getTime() <= now.getTime();
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

function App() {
  const [user, setUser] = useState<User | null>(() => readStoredUser());
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(() => {
    const stored = localStorage.getItem("pillmate:groupId");
    return stored ? Number(stored) : null;
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [todaySchedules, setTodaySchedules] = useState<Schedule[]>([]);
  const [allSchedules, setAllSchedules] = useState<Schedule[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [appNotifications, setAppNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [todayKey, setTodayKey] = useState(() => getLocalDateKey());
  const [currentMinuteKey, setCurrentMinuteKey] = useState(() => getCurrentMinuteKey());
  const [unreadChatByGroup, setUnreadChatByGroup] = useState<UnreadCounts>({});
  const [unreadIntakeByGroup, setUnreadIntakeByGroup] = useState<UnreadCounts>({});

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? null,
    [activeGroupId, groups]
  );
  const canManage = activeGroup?.role === "OWNER" || activeGroup?.can_edit_schedule === 1;
  const completedCount = todaySchedules.filter((schedule) => schedule.status === "COMPLETED").length;
  const pendingCount = todaySchedules.length - completedCount;
  const totalUnreadCount = [...Object.values(unreadChatByGroup), ...Object.values(unreadIntakeByGroup)].reduce(
    (sum, count) => sum + count,
    0
  ) + appNotifications.length;
  const activeGroupUnreadCount = activeGroup
    ? (unreadChatByGroup[activeGroup.id] ?? 0) + (unreadIntakeByGroup[activeGroup.id] ?? 0) + appNotifications.length
    : 0;

  const showNotice = useCallback((nextNotice: Notice) => {
    setAppNotifications((current) => [
      {
        ...nextNotice,
        id: Date.now() + Math.floor(Math.random() * 1000),
        created_at: new Date().toISOString()
      },
      ...current
    ].slice(0, 50));
  }, []);

  function removeAppNotification(notificationId: number) {
    setAppNotifications((current) => current.filter((notification) => notification.id !== notificationId));
  }

  function clearAppNotifications() {
    setAppNotifications([]);
  }

  const resetStoredSession = useCallback(() => {
    localStorage.removeItem("pillmate:user");
    localStorage.removeItem("pillmate:groupId");
    setUser(null);
    setGroups([]);
    setActiveGroupId(null);
    setMembers([]);
    setTodaySchedules([]);
    setAllSchedules([]);
    setMessages([]);
    setUnreadChatByGroup({});
    setUnreadIntakeByGroup({});
    setAppNotifications([]);
  }, []);

  const clearCurrentSession = useCallback(() => {
    localStorage.removeItem("pillmate:user");
    localStorage.removeItem("pillmate:groupId");
    setUser(null);
    setGroups([]);
    setActiveGroupId(null);
    setMembers([]);
    setTodaySchedules([]);
    setAllSchedules([]);
    setMessages([]);
    setUnreadChatByGroup({});
    setUnreadIntakeByGroup({});
    setActiveTab("home");
  }, []);

  const handleDataError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        resetStoredSession();
        return;
      }

      showNotice({ tone: "warn", text: error instanceof Error ? error.message : "데이터를 불러오지 못했습니다." });
    },
    [resetStoredSession, showNotice]
  );

  const refreshGroupData = useCallback(async () => {
    if (!user || !activeGroup) return;
    const [memberResult, todayResult, scheduleResult, messageResult] = await Promise.all([
      pillmateApi.listMembers(user.id, activeGroup.id),
      pillmateApi.listTodaySchedules(user.id, activeGroup.id),
      pillmateApi.listSchedules(user.id, activeGroup.id),
      pillmateApi.listMessages(user.id, activeGroup.id)
    ]);

    setMembers(memberResult.members);
    setTodaySchedules(todayResult.schedules);
    setAllSchedules(scheduleResult.schedules);
    setMessages(messageResult.messages);
  }, [activeGroup, todayKey, user]);

  const refreshGroups = useCallback(async () => {
    if (!user) return;
    const result = await pillmateApi.listGroups(user.id);
    setGroups(result.groups);

    if (activeGroupId && !result.groups.some((group) => group.id === activeGroupId)) {
      setActiveGroupId(null);
      localStorage.removeItem("pillmate:groupId");
      setActiveTab("home");
    }
  }, [activeGroupId, user]);

  useEffect(() => {
    refreshGroups().catch(handleDataError);
  }, [handleDataError, refreshGroups]);

  useEffect(() => {
    refreshGroupData().catch(handleDataError);
  }, [handleDataError, refreshGroupData]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTodayKey((current) => {
        const next = getLocalDateKey();
        return current === next ? current : next;
      });
      setCurrentMinuteKey(getCurrentMinuteKey());
    }, 60_000);

    const refreshOnFocus = () => {
      setTodayKey(getLocalDateKey());
      setCurrentMinuteKey(getCurrentMinuteKey());
      refreshGroupData().catch(handleDataError);
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [handleDataError, refreshGroupData]);

  useEffect(() => {
    if (!user || groups.length === 0) return undefined;

    const socket: Socket = createPillMateSocket(
      user.id,
      groups.map((group) => group.id)
    );

    socket.on("chat:message", (message: ChatMessage) => {
      const isActiveGroupMessage = message.group_id === activeGroup?.id;
      const isViewingActiveChat = isActiveGroupMessage && activeTab === "chat";
      const isMyMessage = message.sender_id === user.id;

      if (isActiveGroupMessage) {
        setMessages((current) => [...current.filter((item) => item.id !== message.id), message]);
      }

      if (!isViewingActiveChat && !isMyMessage) {
        setUnreadChatByGroup((current) => ({
          ...current,
          [message.group_id]: (current[message.group_id] ?? 0) + 1
        }));
      }
    });
    socket.on("intake:due", (payload: { group_id?: number }) => {
      const groupId = payload.group_id ?? activeGroup?.id;

      if (groupId && (activeGroup?.id !== groupId || activeTab !== "today")) {
        setUnreadIntakeByGroup((current) => ({
          ...current,
          [groupId]: (current[groupId] ?? 0) + 1
        }));
      }
      refreshGroupData().catch(() => undefined);
    });
    socket.on("intake:completed", (payload: { target_user_id?: number }) => {
      if (payload.target_user_id !== user.id) {
        showNotice({ tone: "good", text: "복약 완료 피드가 업데이트되었습니다." });
      }
      refreshGroupData().catch(() => undefined);
    });
    socket.on("intake:escalated", () => {
      showNotice({ tone: "warn", text: "복약 미확인 알림이 도착했습니다." });
      refreshGroupData().catch(() => undefined);
    });

    return () => {
      socket.disconnect();
    };
  }, [activeGroup, activeTab, groups, refreshGroupData, showNotice, user]);

  useEffect(() => {
    if (!activeGroup || activeTab !== "chat") return;

    setUnreadChatByGroup((current) => {
      if (!current[activeGroup.id]) {
        return current;
      }

      const next = { ...current };
      delete next[activeGroup.id];
      return next;
    });
  }, [activeGroup, activeTab]);

  useEffect(() => {
    if (!activeGroup || activeTab !== "today") return;

    setUnreadIntakeByGroup((current) => {
      if (!current[activeGroup.id]) {
        return current;
      }

      const next = { ...current };
      delete next[activeGroup.id];
      return next;
    });
  }, [activeGroup, activeTab]);

  async function handleUserCreated(createdUser: User) {
    setUser(createdUser);
    localStorage.setItem("pillmate:user", JSON.stringify(createdUser));
    showNotice({ tone: "good", text: `${createdUser.name}님으로 시작합니다.` });
  }

  async function handleGroupChanged(group: Group) {
    await refreshGroups();
    setActiveGroupId(group.id);
    localStorage.setItem("pillmate:groupId", String(group.id));
    setActiveTab("today");
    showNotice({ tone: "good", text: `${group.name} 그룹에 연결되었습니다.` });
  }

  function goHome() {
    setActiveGroupId(null);
    localStorage.removeItem("pillmate:groupId");
    setActiveTab("home");
  }

  function selectGroup(groupId: number, nextTab: Tab = "today") {
    setActiveGroupId(groupId);
    localStorage.setItem("pillmate:groupId", String(groupId));
    setActiveTab(nextTab);

    if (nextTab === "chat") {
      setUnreadChatByGroup((current) => {
        if (!current[groupId]) {
          return current;
        }

        const next = { ...current };
        delete next[groupId];
        return next;
      });
    }
  }

  function clearChatUnread(groupId: number) {
    setUnreadChatByGroup((current) => {
      if (!current[groupId]) {
        return current;
      }

      const next = { ...current };
      delete next[groupId];
      return next;
    });
  }

  function clearIntakeUnread(groupId: number) {
    setUnreadIntakeByGroup((current) => {
      if (!current[groupId]) {
        return current;
      }

      const next = { ...current };
      delete next[groupId];
      return next;
    });
  }

  function openChatNotification(groupId: number) {
    clearChatUnread(groupId);
    selectGroup(groupId, "chat");
  }

  function openIntakeNotification(groupId: number) {
    clearIntakeUnread(groupId);
    selectGroup(groupId, "today");
  }

  async function handleLogout() {
    setIsLoading(true);

    try {
      if ("serviceWorker" in navigator && "PushManager" in window) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
          await pillmateApi.deletePushSubscription(subscription.endpoint).catch(() => undefined);
          await subscription.unsubscribe().catch(() => undefined);
        }
      }

      showNotice({ tone: "info", text: "로그아웃되었습니다." });
      await authClient.signOut();
      clearCurrentSession();
    } catch (error) {
      showNotice({ tone: "warn", text: error instanceof Error ? error.message : "로그아웃에 실패했습니다." });
    } finally {
      setIsLoading(false);
    }
  }

  async function completeSchedule(schedule: Schedule, photo?: File) {
    if (!user) return;
    setIsLoading(true);

    try {
      await pillmateApi.completeSchedule(user.id, schedule.id, photo, schedule.scheduled_time);
      await refreshGroupData();
      showNotice({ tone: "good", text: "복약 완료가 피드에 공유되었습니다." });
    } catch (error) {
      showNotice({ tone: "warn", text: error instanceof Error ? error.message : "복약 완료에 실패했습니다." });
    } finally {
      setIsLoading(false);
    }
  }

  if (!user) {
    return <Onboarding onUserCreated={handleUserCreated} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={goHome}
              title="홈으로 이동"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-teal-700 text-white">
                <HeartPulse size={22} />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold">PillMate</h1>
                <p className="truncate text-sm text-slate-500">{user.name}님의 복약 알림</p>
              </div>
            </button>
            <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
              <NotificationBell
                groups={activeTab === "home" ? groups : activeGroup ? [activeGroup] : []}
                unreadChatByGroup={unreadChatByGroup}
                unreadIntakeByGroup={unreadIntakeByGroup}
                appNotifications={appNotifications}
                totalCount={activeTab === "home" ? totalUnreadCount : activeGroupUnreadCount}
                title={activeTab === "home" ? "전체 방 알림" : "현재 방 알림"}
                onOpenChat={openChatNotification}
                onOpenIntake={openIntakeNotification}
                onRemoveNotification={removeAppNotification}
                onClearNotifications={clearAppNotifications}
              />
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded border border-slate-300 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 sm:w-auto sm:px-3"
                disabled={isLoading}
                onClick={handleLogout}
                title="로그아웃"
              >
                <LogOut size={18} />
                <span className="hidden sm:ml-2 sm:inline">LogOut</span>
              </button>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:shrink-0">
            {activeGroup && (
              <select
                className="w-full min-w-0 rounded border border-slate-300 bg-white px-3 py-2 text-sm sm:w-48"
                value={activeGroup.id}
                onChange={(event) => {
                  selectGroup(Number(event.target.value));
                }}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 pb-24 pt-3 lg:grid-cols-[minmax(0,1fr)_390px] lg:pb-6 lg:pt-4">
        <section className="space-y-4">
          {activeTab === "home" ? (
            <HomePanel
              user={user}
              groups={groups}
              activeGroupId={activeGroup?.id ?? null}
              unreadChatByGroup={unreadChatByGroup}
              unreadIntakeByGroup={unreadIntakeByGroup}
              onSelectGroup={selectGroup}
              onGroupChanged={handleGroupChanged}
            />
          ) : !activeGroup && activeTab === "today" ? (
            <TodayGroupPanel
              user={user}
              groups={groups}
              unreadByGroup={unreadIntakeByGroup}
              onSelectGroup={(groupId) => selectGroup(groupId, "today")}
            />
          ) : !activeGroup && activeTab === "chat" ? (
            <GroupNotificationPanel
              icon={<MessageCircle size={20} className="text-teal-700" />}
              title="대화"
              emptyText="확인할 새 채팅이 없습니다."
              groups={groups}
              unreadByGroup={unreadChatByGroup}
              fallbackLabel="대화방 열기"
              onSelectGroup={(groupId) => selectGroup(groupId, "chat")}
            />
          ) : !activeGroup ? (
            <GroupSetup user={user} onGroupChanged={handleGroupChanged} />
          ) : (
            <>
              <GroupOverview
                group={activeGroup}
                completedCount={completedCount}
                pendingCount={pendingCount}
                onNotice={showNotice}
              />

              <div className={activeTab === "today" ? "block" : "hidden lg:block"}>
                <TodayPanel
                  schedules={todaySchedules}
                  currentUserId={user.id}
                  isLoading={isLoading}
                  currentMinuteKey={currentMinuteKey}
                  onComplete={completeSchedule}
                />
              </div>

              <div className={activeTab === "manage" ? "block" : "hidden lg:block"}>
                <ManagePanel
                  user={user}
                  group={activeGroup}
                  members={members}
                  schedules={allSchedules}
                  canManage={canManage}
                  onChanged={refreshGroupData}
                  onNotice={showNotice}
                />
              </div>
            </>
          )}
        </section>

        {activeGroup && activeTab !== "home" && (
          <aside className={activeTab === "chat" ? "block" : "hidden lg:block"}>
            <ChatPanel
              user={user}
              group={activeGroup}
              members={members}
              messages={messages}
              onChanged={refreshGroupData}
              onGroupsChanged={refreshGroups}
              onMessageSent={refreshGroupData}
              onNotice={showNotice}
            />
          </aside>
        )}
      </main>

      {groups.length > 0 && (
        <nav className={`fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white lg:hidden ${activeGroup ? "grid-cols-4" : "grid-cols-3"}`}>
          <TabButton icon={<Home size={20} />} label="홈" active={activeTab === "home"} onClick={goHome} />
          <TabButton
            icon={<CalendarClock size={20} />}
            label="오늘"
            active={activeTab === "today"}
            badge={activeGroup ? unreadIntakeByGroup[activeGroup.id] : Object.values(unreadIntakeByGroup).reduce((sum, count) => sum + count, 0)}
            onClick={() => setActiveTab("today")}
          />
          <TabButton
            icon={<MessageCircle size={20} />}
            label="대화"
            active={activeTab === "chat"}
            badge={activeGroup ? unreadChatByGroup[activeGroup.id] : Object.values(unreadChatByGroup).reduce((sum, count) => sum + count, 0)}
            onClick={() => setActiveTab("chat")}
          />
          {activeGroup && (
            <TabButton
              icon={<Settings size={20} />}
              label="관리"
              active={activeTab === "manage"}
              onClick={() => setActiveTab("manage")}
            />
          )}
        </nav>
      )}
    </div>
  );
}

function Onboarding({ onUserCreated }: { onUserCreated: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "password123" });
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const result =
        mode === "login"
          ? await authClient.signIn.email({ email: form.email, password: form.password })
          : await authClient.signUp.email({ email: form.email, password: form.password, name: form.name });

      if (result.error) {
        setError(result.error.message ?? (mode === "login" ? "로그인에 실패했습니다." : "사용자 생성에 실패했습니다."));
        return;
      }

      const me = await pillmateApi.me();
      onUserCreated(me.user);
    } catch (error) {
      setError(error instanceof Error ? error.message : mode === "login" ? "로그인에 실패했습니다." : "사용자 생성에 실패했습니다.");
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-sm space-y-3">
        <form className="space-y-4 rounded border border-slate-200 bg-white p-5 shadow-sm" onSubmit={submit}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-teal-700 text-white">
              <HeartPulse size={22} />
            </div>
            <div>
              <h1 className="text-xl font-semibold">PillMate 시작</h1>
              <p className="text-sm text-slate-500">{mode === "login" ? "기존 계정으로 로그인합니다." : "새 계정을 만듭니다."}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 rounded border border-slate-300 bg-slate-50 p-1">
            <button
              className={`rounded px-3 py-2 text-sm font-medium ${mode === "login" ? "bg-white text-teal-700 shadow-sm" : "text-slate-500"}`}
              type="button"
              onClick={() => setMode("login")}
            >
              로그인
            </button>
            <button
              className={`rounded px-3 py-2 text-sm font-medium ${mode === "signup" ? "bg-white text-teal-700 shadow-sm" : "text-slate-500"}`}
              type="button"
              onClick={() => setMode("signup")}
            >
              새 계정
            </button>
          </div>
          {mode === "signup" && (
            <input
              className="w-full rounded border border-slate-300 px-3 py-2"
              placeholder="이름"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          )}
          <input
            className="w-full rounded border border-slate-300 px-3 py-2"
            placeholder="이메일"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
          <input
            className="w-full rounded border border-slate-300 px-3 py-2"
            placeholder="비밀번호"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
          {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button className="flex w-full items-center justify-center gap-2 rounded bg-teal-700 px-4 py-2 font-medium text-white">
            <Check size={18} />
            {mode === "login" ? "로그인" : "계정 만들기"}
          </button>
        </form>
      </div>
    </main>
  );
}

function GroupSetup({ user, onGroupChanged }: { user: User; onGroupChanged: (group: Group) => void }) {
  const [groupName, setGroupName] = useState("우리 가족");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const result = await pillmateApi.createGroup(user.id, groupName);
      onGroupChanged(result.group);
    } catch (error) {
      setError(error instanceof Error ? error.message : "그룹 생성에 실패했습니다.");
    }
  }

  async function joinGroup(event: FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const result = await pillmateApi.joinGroup(user.id, inviteCode);
      onGroupChanged(result.group);
    } catch (error) {
      setError(error instanceof Error ? error.message : "그룹 참여에 실패했습니다.");
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form className="space-y-3 rounded border border-slate-200 bg-white p-4 shadow-sm" onSubmit={createGroup}>
        <div className="flex items-center gap-2 text-teal-800">
          <Users size={20} />
          <h2 className="font-semibold">대화방 만들기</h2>
        </div>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
        />
        <button className="flex w-full items-center justify-center gap-2 rounded bg-teal-700 px-4 py-2 font-medium text-white">
          <Plus size={18} />
          그룹 생성
        </button>
      </form>

      <form className="space-y-3 rounded border border-slate-200 bg-white p-4 shadow-sm" onSubmit={joinGroup}>
        <div className="flex items-center gap-2 text-amber-700">
          <UserPlus size={20} />
          <h2 className="font-semibold">초대 코드로 참여</h2>
        </div>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2 uppercase"
          placeholder="예: A1B2C3D4"
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value)}
        />
        <button className="flex w-full items-center justify-center gap-2 rounded bg-amber-600 px-4 py-2 font-medium text-white">
          <UserPlus size={18} />
          참여하기
        </button>
      </form>
      {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700 md:col-span-2">{error}</p>}
    </div>
  );
}

function NotificationBell({
  groups,
  unreadChatByGroup,
  unreadIntakeByGroup,
  appNotifications,
  totalCount,
  title,
  onOpenChat,
  onOpenIntake,
  onRemoveNotification,
  onClearNotifications
}: {
  groups: Group[];
  unreadChatByGroup: UnreadCounts;
  unreadIntakeByGroup: UnreadCounts;
  appNotifications: AppNotification[];
  totalCount: number;
  title: string;
  onOpenChat: (groupId: number) => void;
  onOpenIntake: (groupId: number) => void;
  onRemoveNotification: (notificationId: number) => void;
  onClearNotifications: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasUnread = totalCount > 0;

  return (
    <div className="relative">
      <button
        className="relative flex h-10 w-10 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
        onClick={() => setOpen((current) => !current)}
        title={title}
      >
        <Bell size={18} />
        <Badge className="absolute -right-2 -top-2" count={totalCount} />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-72 rounded border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            <div className="flex items-center gap-1">
              {appNotifications.length > 0 && (
                <button className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={onClearNotifications}>
                  전체 삭제
                </button>
              )}
              <button className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>
          </div>
          {!hasUnread ? (
            <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">새 알림이 없습니다.</p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {appNotifications.map((notification) => (
                <div key={notification.id} className="rounded border border-slate-200 bg-white p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${notification.tone === "warn" ? "text-rose-700" : notification.tone === "good" ? "text-emerald-700" : "text-sky-700"}`}>
                        {notification.tone === "warn" ? "주의" : notification.tone === "good" ? "완료" : "알림"}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">{notification.text}</p>
                      <p className="mt-1 text-xs text-slate-400">{formatChatTimestamp(notification.created_at)}</p>
                    </div>
                    <button
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="알림 삭제"
                      onClick={() => onRemoveNotification(notification.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {groups.map((group) => {
                const chatCount = unreadChatByGroup[group.id] ?? 0;
                const intakeCount = unreadIntakeByGroup[group.id] ?? 0;

                if (chatCount + intakeCount === 0) {
                  return null;
                }

                return (
                  <div key={group.id} className="rounded bg-slate-50 p-2">
                    <p className="truncate px-1 text-sm font-medium">{group.name}</p>
                    {chatCount > 0 && (
                      <button
                        className="mt-1 flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-white"
                        onClick={() => {
                          onOpenChat(group.id);
                          setOpen(false);
                        }}
                      >
                        <span>새 채팅 메시지</span>
                        <Badge count={chatCount} />
                      </button>
                    )}
                    {intakeCount > 0 && (
                      <button
                        className="mt-1 flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-white"
                        onClick={() => {
                          onOpenIntake(group.id);
                          setOpen(false);
                        }}
                      >
                        <span>복약 알림</span>
                        <Badge count={intakeCount} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HomePanel({
  user,
  groups,
  activeGroupId,
  unreadChatByGroup,
  unreadIntakeByGroup,
  onSelectGroup,
  onGroupChanged
}: {
  user: User;
  groups: Group[];
  activeGroupId: number | null;
  unreadChatByGroup: UnreadCounts;
  unreadIntakeByGroup: UnreadCounts;
  onSelectGroup: (groupId: number, nextTab?: Tab) => void;
  onGroupChanged: (group: Group) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex min-h-[520px] flex-col rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Home size={20} className="text-teal-700" />
          <h2 className="font-semibold">PillMate</h2>
        </div>
        <div className="grid gap-2">
          {groups.map((group) => {
            const selected = group.id === activeGroupId;
            const unreadCount = unreadChatByGroup[group.id] ?? 0;
            const intakeCount = unreadIntakeByGroup[group.id] ?? 0;
            return (
              <button
                key={group.id}
                className={`grid gap-2 rounded border px-3 py-3 text-left sm:grid-cols-[minmax(0,1fr)_auto] ${
                  selected ? "border-teal-700 bg-teal-50" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
                onClick={() => onSelectGroup(group.id, "today")}
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{group.name}</span>
                    <Badge count={unreadCount + intakeCount} />
                  </span>
                  <span className="mt-1 block text-sm text-slate-500">초대 코드 {group.invite_code}</span>
                </span>
                <span className={`text-sm font-medium ${selected ? "text-teal-700" : "text-slate-500"}`}>
                  {selected ? "선택됨" : "들어가기"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <PushNotificationPanel />
      <GroupSetup user={user} onGroupChanged={onGroupChanged} />
    </section>
  );
}

type TodayGroupSummary = {
  total: number;
  due: number;
  completed: number;
  upcoming: number;
};

function TodayGroupPanel({
  user,
  groups,
  unreadByGroup,
  onSelectGroup
}: {
  user: User;
  groups: Group[];
  unreadByGroup: UnreadCounts;
  onSelectGroup: (groupId: number) => void;
}) {
  const [summaries, setSummaries] = useState<Record<number, TodayGroupSummary>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSummaries() {
      setLoading(true);

      try {
        const results = await Promise.all(
          groups.map(async (group) => {
            const result = await pillmateApi.listTodaySchedules(user.id, group.id);
            const completed = result.schedules.filter((schedule) => schedule.status === "COMPLETED").length;
            const due = result.schedules.filter(
              (schedule) => schedule.status !== "COMPLETED" && schedule.target_user_id === user.id && isScheduleDue(schedule)
            ).length;
            const upcoming = result.schedules.filter((schedule) => schedule.status !== "COMPLETED" && !isScheduleDue(schedule)).length;

            return [group.id, { total: result.schedules.length, due, completed, upcoming }] as const;
          })
        );

        if (!cancelled) {
          setSummaries(Object.fromEntries(results));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSummaries().catch(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [groups, user.id]);

  if (groups.length === 0) {
    return (
      <section className="rounded border border-dashed border-slate-300 bg-white p-8 text-center">
        <Home className="mx-auto text-slate-400" size={32} />
        <h2 className="mt-3 text-lg font-semibold">참여 중인 방이 없습니다.</h2>
        <p className="mt-1 text-sm text-slate-500">홈에서 방을 만들거나 초대 코드로 참여해주세요.</p>
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock size={20} className="text-teal-700" />
        <h2 className="font-semibold">오늘</h2>
      </div>
      <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
        {groups.map((group) => {
          const summary = summaries[group.id];
          const unreadCount = unreadByGroup[group.id] ?? 0;
          const badgeCount = unreadCount + (summary?.due ?? 0);

          return (
            <button
              key={group.id}
              className="grid w-full gap-2 rounded border border-slate-200 bg-white px-3 py-3 text-left hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto]"
              onClick={() => onSelectGroup(group.id)}
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{group.name}</span>
                  <Badge count={badgeCount} />
                </span>
                <span className="mt-1 block text-sm text-slate-500">
                  {loading && !summary
                    ? "오늘 복약을 확인하는 중입니다."
                    : summary?.total
                      ? `미완료 ${summary.due}건 · 예정 ${summary.upcoming}건 · 완료 ${summary.completed}건`
                      : "오늘 등록된 복약이 없습니다."}
                </span>
              </span>
              <span className="text-sm font-medium text-teal-700">
                {summary?.due || unreadCount ? "확인하기" : "더보기"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GroupNotificationPanel({
  icon,
  title,
  emptyText,
  groups,
  unreadByGroup,
  fallbackLabel,
  onSelectGroup
}: {
  icon: React.ReactNode;
  title: string;
  emptyText: string;
  groups: Group[];
  unreadByGroup: UnreadCounts;
  fallbackLabel: string;
  onSelectGroup: (groupId: number) => void;
}) {
  if (groups.length === 0) {
    return (
      <section className="rounded border border-dashed border-slate-300 bg-white p-8 text-center">
        <Home className="mx-auto text-slate-400" size={32} />
        <h2 className="mt-3 text-lg font-semibold">참여 중인 방이 없습니다.</h2>
        <p className="mt-1 text-sm text-slate-500">홈에서 방을 만들거나 초대 코드로 참여해주세요.</p>
      </section>
    );
  }

  const unreadTotal = Object.values(unreadByGroup).reduce((sum, count) => sum + count, 0);

  return (
    <section className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
        {groups.map((group) => {
          const unreadCount = unreadByGroup[group.id] ?? 0;

          return (
            <button
              key={group.id}
              className="grid w-full gap-2 rounded border border-slate-200 bg-white px-3 py-3 text-left hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto]"
              onClick={() => onSelectGroup(group.id)}
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{group.name}</span>
                  <Badge count={unreadCount} />
                </span>
                <span className="mt-1 block text-sm text-slate-500">
                  {unreadCount > 0 ? `${unreadCount}건 확인 필요` : emptyText}
                </span>
              </span>
              <span className="text-sm font-medium text-teal-700">{unreadCount > 0 ? "확인하기" : fallbackLabel}</span>
            </button>
          );
        })}
      </div>
      {unreadTotal === 0 && <p className="mt-3 rounded bg-slate-50 p-3 text-sm text-slate-500">{emptyText}</p>}
    </section>
  );
}

function PushNotificationPanel() {
  const [status, setStatus] = useState<"checking" | "ready" | "subscribed" | "unsupported" | "disabled">("checking");
  const [message, setMessage] = useState("");

  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  const refreshSubscriptionState = useCallback(async () => {
    if (!supported) {
      setStatus("unsupported");
      setMessage("이 브라우저는 푸시 알림을 지원하지 않습니다.");
      return;
    }

    const keyStatus = await pillmateApi.getVapidPublicKey();

    if (!keyStatus.enabled || !keyStatus.publicKey) {
      setStatus("disabled");
      setMessage("서버에 VAPID 키가 없어 브라우저 푸시가 꺼져 있습니다.");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    setStatus(subscription ? "subscribed" : "ready");
    setMessage(subscription ? "이 기기에서 알림을 받고 있습니다." : "이 기기에서 복약과 채팅 알림을 받을 수 있습니다.");
  }, [supported]);

  useEffect(() => {
    refreshSubscriptionState().catch((error) => {
      setStatus("disabled");
      setMessage(error instanceof Error ? error.message : "알림 상태를 확인하지 못했습니다.");
    });
  }, [refreshSubscriptionState]);

  async function enableNotifications() {
    try {
      const keyStatus = await pillmateApi.getVapidPublicKey();

      if (!keyStatus.enabled || !keyStatus.publicKey) {
        setStatus("disabled");
        setMessage("서버에 VAPID 키를 설정한 뒤 다시 시도해주세요.");
        return;
      }

      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setMessage("브라우저 알림 권한이 허용되지 않았습니다.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyStatus.publicKey)
      });

      await pillmateApi.savePushSubscription(subscription.toJSON());
      setStatus("subscribed");
      setMessage("이 기기 알림을 켰습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "알림 설정에 실패했습니다.");
    }
  }

  async function disableNotifications() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      await subscription?.unsubscribe();
      await pillmateApi.deletePushSubscription(subscription?.endpoint);
      setStatus("ready");
      setMessage("이 기기 알림을 껐습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "알림 해제에 실패했습니다.");
    }
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bell size={20} className="text-amber-700" />
            <h2 className="font-semibold">기기 알림</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">{message || "알림 상태를 확인하고 있습니다."}</p>
        </div>
        {status === "subscribed" ? (
          <button
            className="shrink-0 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            onClick={disableNotifications}
          >
            끄기
          </button>
        ) : (
          <button
            className="shrink-0 rounded bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-300"
            disabled={status === "checking" || status === "unsupported" || status === "disabled"}
            onClick={enableNotifications}
          >
            켜기
          </button>
        )}
      </div>
    </section>
  );
}

function GroupOverview({
  group,
  completedCount,
  pendingCount,
  onNotice
}: {
  group: Group;
  completedCount: number;
  pendingCount: number;
  onNotice: (notice: Notice) => void;
}) {
  async function copyInviteCode() {
    try {
      await navigator.clipboard.writeText(group.invite_code);
      onNotice({ tone: "good", text: "초대 코드가 복사되었습니다." });
    } catch {
      onNotice({ tone: "warn", text: "초대 코드 복사에 실패했습니다." });
    }
  }

  return (
    <div className="grid gap-2 md:grid-cols-3">
      <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2mt-1 truncate text-lg font-semibold">
          <ShieldCheck size={18} />
          {group.name}
        </div>
        <button
          className="mt-1 text-left font-mono text-sm text-slate-500 underline-offset-2 hover:text-teal-700 hover:underline"
          onClick={copyInviteCode}
          title="초대 코드 복사"
        >
          초대 코드 {group.invite_code}
        </button>
      </div>
      <MetricCard icon={<Check size={18} />} label="확인" value={`${completedCount}건`} tone="good" />
      <MetricCard icon={<Bell size={18} />} label="미확인" value={`${pendingCount}건`} tone="warn" />
    </div>
  );
}

function TodayPanel({
  schedules,
  currentUserId,
  isLoading,
  currentMinuteKey,
  onComplete
}: {
  schedules: Schedule[];
  currentUserId: number;
  isLoading: boolean;
  currentMinuteKey: string;
  onComplete: (schedule: Schedule, photo?: File) => void;
}) {
  if (schedules.length === 0) {
    return (
      <section className="rounded border border-dashed border-slate-300 bg-white p-8 text-center">
        <CalendarClock className="mx-auto text-slate-400" size={32} />
        <h2 className="mt-3 text-lg font-semibold">오늘 등록된 복약이 없습니다.</h2>
        <p className="mt-1 text-sm text-slate-500">스케줄 관리에서 복약 일정을 추가할 수 있습니다.</p>
        <p className="mt-1 text-sm text-slate-400">권한이 있어야 추가 및 수정 가능합니다.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={20} className="text-teal-700" />
        <h2 className="text-lg font-semibold">오늘의 복약</h2>
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto pb-3">
        {schedules.map((schedule) => (
          <div key={schedule.id} className="w-[calc(100vw-2rem)] max-w-sm shrink-0 snap-start sm:w-80">
            <MedicationCard
              schedule={schedule}
              canComplete={schedule.target_user_id === currentUserId && isScheduleDue(schedule)}
              isLoading={isLoading}
              currentMinuteKey={currentMinuteKey}
              onComplete={onComplete}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function MedicationCard({
  schedule,
  canComplete,
  isLoading,
  currentMinuteKey,
  onComplete
}: {
  schedule: Schedule;
  canComplete: boolean;
  isLoading: boolean;
  currentMinuteKey: string;
  onComplete: (schedule: Schedule, photo?: File) => void;
}) {
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const done = schedule.status === "COMPLETED";
  const due = isScheduleDue(schedule);
  const disabledReason = done ? "이미 완료되었습니다." : due ? undefined : "알림이 울린 이후에 완료할 수 있습니다.";
  const confirmMessage = `${schedule.medicine_name} ${schedule.dosage} 복약을 완료 처리할까요?`;

  function confirmCompletion(photo?: File) {
    if (!window.confirm(confirmMessage)) {
      return;
    }

    onComplete(schedule, photo);
  }

  void currentMinuteKey;

  return (
    <article className="flex h-full min-h-56 flex-col rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-500">{schedule.target_user_name}</p>
          <h3 className="mt-1 text-xl font-semibold">{schedule.medicine_name}</h3>
          <p className="mt-1 text-sm text-slate-600">{schedule.dosage}</p>
        </div>
        <span className={`shrink-0 rounded px-2 py-1 text-sm font-medium ${done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {statusLabel(schedule.status)}
        </span>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4 text-slate-700">
        <Bell size={18} />
        <span className="text-2xl font-semibold">{schedule.intake_time}</span>
        {schedule.completed_at && <span className="text-sm text-slate-500">완료 {formatTime(schedule.completed_at)}</span>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          className="flex min-h-11 items-center justify-center gap-2 rounded bg-teal-700 px-3 py-2 font-medium text-white disabled:bg-slate-300"
          disabled={!canComplete || done || isLoading}
          onClick={() => confirmCompletion()}
          title={disabledReason}
        >
          <Check size={18} />
          먹었어요
        </button>
        <button
          className="flex min-h-11 items-center justify-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 disabled:text-slate-400"
          disabled={!canComplete || done || isLoading}
          onClick={() => photoInputRef.current?.click()}
          title={disabledReason}
        >
          <Camera size={18} />
          사진 인증
        </button>
      </div>
      <input
        ref={photoInputRef}
        className="hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) confirmCompletion(file);
          event.target.value = "";
        }}
      />
    </article>
  );
}

function ChatPanel({
  user,
  group,
  members,
  messages,
  onChanged,
  onGroupsChanged,
  onMessageSent,
  onNotice
}: {
  user: User;
  group: Group;
  members: Member[];
  messages: ChatMessage[];
  onChanged: () => void;
  onGroupsChanged: () => void;
  onMessageSent: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [content, setContent] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => parseServerDate(a.created_at).getTime() - parseServerDate(b.created_at).getTime()),
    [messages]
  );

  useEffect(() => {
    if (showSettings) return;
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [showSettings, sortedMessages.length, group.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;

    await pillmateApi.sendMessage(user.id, group.id, content);
    setContent("");
    onMessageSent();
  }

  return (
    <section className="flex h-[calc(100dvh-168px)] min-h-[420px] flex-col rounded border border-slate-200 bg-white shadow-sm lg:h-[calc(100vh-112px)] lg:min-h-[520px]">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MessageCircle size={20} className="text-teal-700" />
            <h2 className="font-semibold">{group.name} 대화</h2>
          </div>
          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-700"
            onClick={() => setShowSettings((current) => !current)}
            title="방 설정"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
      {showSettings ? (
        <MemberSettingsPanel
          user={user}
          group={group}
          members={members}
          onChanged={onChanged}
          onGroupsChanged={onGroupsChanged}
          onNotice={onNotice}
        />
      ) : (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {sortedMessages.length === 0 ? (
              <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">아직 메시지가 없습니다.</p>
            ) : (
              sortedMessages.map((message) => <MessageBubble key={message.id} message={message} currentUserId={user.id} />)
            )}
            <div ref={messageEndRef} />
          </div>
          <form className="flex gap-2 border-t border-slate-200 p-3" onSubmit={submit}>
            <input
              className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2"
              placeholder="응원 메시지"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
            <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-teal-700 text-white" title="보내기">
              <Send size={18} />
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function MessageBubble({ message, currentUserId }: { message: ChatMessage; currentUserId: number }) {
  const mine = message.sender_id === currentUserId;
  const system = message.message_type === "SYSTEM_VERIFICATION";
  const warning = system && message.content.trim().startsWith("경고:");
  const quietSystem =
    system && (message.content.trim().endsWith("님을 강퇴했습니다.") || message.content.trim().endsWith("님이 입장했습니다."));
  const timestamp = formatChatTimestamp(message.created_at);

  if (quietSystem) {
    return (
      <div className="flex justify-center">
        <p className="rounded bg-slate-100/60 px-3 py-1 text-xs text-slate-400">
          {message.content} · {timestamp}
        </p>
      </div>
    );
  }

  if (system) {
    return (
      <div
        className={`rounded border p-3 text-sm ${
          warning
            ? "border-rose-200 bg-rose-50 text-rose-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
      >
        <p>{message.content}</p>
        {message.photo_url && <img className="mt-2 max-h-56 rounded object-cover" src={`${apiBaseUrl}${message.photo_url}`} alt="복약 인증" />}
        <p className={`mt-2 text-xs ${warning ? "text-rose-700" : "text-amber-700"}`}>{timestamp}</p>
      </div>
    );
  }

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] rounded px-3 py-2 ${mine ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-900"}`}>
        {!mine && <p className="mb-1 text-xs text-slate-500">{message.sender_name}</p>}
        <p className="text-sm">{message.content}</p>
        <p className={`mt-1 text-right text-xs ${mine ? "text-teal-100" : "text-slate-500"}`}>{timestamp}</p>
      </div>
    </div>
  );
}

function MemberSettingsPanel({
  user,
  group,
  members,
  onChanged,
  onGroupsChanged,
  onNotice
}: {
  user: User;
  group: Group;
  members: Member[];
  onChanged: () => void;
  onGroupsChanged: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);
  const [memberNickname, setMemberNickname] = useState("");
  const [groupName, setGroupName] = useState(group.name);
  const editingMember = members.find((member) => member.id === editingMemberId) ?? null;

  useEffect(() => {
    setGroupName(group.name);
  }, [group.name]);

  async function saveGroupName(event: FormEvent) {
    event.preventDefault();

    try {
      await pillmateApi.updateGroup(user.id, group.id, groupName);
      await onGroupsChanged();
      onNotice({ tone: "good", text: "방 이름이 변경되었습니다." });
    } catch (error) {
      onNotice({ tone: "warn", text: error instanceof Error ? error.message : "방 이름 변경에 실패했습니다." });
    }
  }

  async function regenerateInviteCode() {
    if (!window.confirm("기존 초대 코드는 더 이상 사용할 수 없게 됩니다. 새로 만들까요?")) {
      return;
    }

    try {
      await pillmateApi.regenerateInviteCode(user.id, group.id);
      await onGroupsChanged();
      onNotice({ tone: "good", text: "초대 코드가 새로 생성되었습니다." });
    } catch (error) {
      onNotice({ tone: "warn", text: error instanceof Error ? error.message : "초대 코드 재생성에 실패했습니다." });
    }
  }

  async function copyInviteCode() {
    try {
      await navigator.clipboard.writeText(group.invite_code);
      onNotice({ tone: "good", text: "초대 코드가 복사되었습니다." });
    } catch {
      onNotice({ tone: "warn", text: "초대 코드 복사에 실패했습니다." });
    }
  }

  async function leaveGroup() {
    if (!window.confirm(`${group.name} 방에서 나가시겠습니까?`)) {
      return;
    }

    try {
      await pillmateApi.leaveGroup(user.id, group.id);
      await onGroupsChanged();
      onNotice({ tone: "good", text: "방에서 나갔습니다." });
    } catch (error) {
      onNotice({ tone: "warn", text: error instanceof Error ? error.message : "방 나가기에 실패했습니다." });
    }
  }

  async function deleteGroup() {
    if (!window.confirm(`${group.name} 방과 모든 스케줄/채팅을 삭제하시겠습니까?`)) {
      return;
    }

    try {
      await pillmateApi.deleteGroup(user.id, group.id);
      await onGroupsChanged();
      onNotice({ tone: "good", text: "방이 삭제되었습니다." });
    } catch (error) {
      onNotice({ tone: "warn", text: error instanceof Error ? error.message : "방 삭제에 실패했습니다." });
    }
  }

  async function togglePermission(member: Member) {
    try {
      await pillmateApi.updatePermission(user.id, group.id, member.id, member.can_edit_schedule !== 1);
      await onChanged();
    } catch (error) {
      onNotice({ tone: "warn", text: error instanceof Error ? error.message : "권한 변경에 실패했습니다." });
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`${member.display_name}님을 방에서 내보내시겠습니까?`)) {
      return;
    }

    try {
      await pillmateApi.removeMember(user.id, group.id, member.id);
      await onChanged();
      onNotice({ tone: "good", text: "구성원을 내보냈습니다." });
    } catch (error) {
      onNotice({ tone: "warn", text: error instanceof Error ? error.message : "구성원 내보내기에 실패했습니다." });
    }
  }

  function openMemberSettings(member: Member) {
    setEditingMemberId(member.id);
    setMemberNickname(member.nickname ?? "");
  }

  function closeMemberSettings() {
    setEditingMemberId(null);
    setMemberNickname("");
  }

  async function saveNickname(event: FormEvent) {
    event.preventDefault();

    if (!editingMember || editingMember.user_id !== user.id) {
      return;
    }

    try {
      await pillmateApi.updateMyNickname(user.id, group.id, memberNickname);
      await onChanged();
      closeMemberSettings();
      onNotice({ tone: "good", text: "이 방에서 보이는 닉네임이 변경되었습니다." });
    } catch (error) {
      onNotice({ tone: "warn", text: error instanceof Error ? error.message : "닉네임 변경에 실패했습니다." });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <section className="rounded bg-slate-50 p-3">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={18} className="text-teal-700" />
            <h2 className="font-semibold">방 설정</h2>
          </div>
          <form className="space-y-2" onSubmit={saveGroupName}>
            <input
              className="w-full rounded border border-slate-300 bg-white px-3 py-2"
              disabled={group.role !== "OWNER"}
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
            />
            <button
              className="flex w-full items-center justify-center gap-2 rounded bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-300"
              disabled={group.role !== "OWNER"}
            >
              <Save size={16} />
              이름 저장
            </button>
          </form>
          <div className="mt-3 rounded border border-slate-200 bg-white p-2">
            <p className="text-xs text-slate-500">초대 코드</p>
            <button
              className="mt-1 font-mono text-sm font-semibold underline-offset-2 hover:text-teal-700 hover:underline"
              onClick={copyInviteCode}
              title="초대 코드 복사"
            >
              {group.invite_code}
            </button>
            <button
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:text-slate-400"
              disabled={group.role !== "OWNER"}
              onClick={regenerateInviteCode}
            >
              초대 코드 새로 만들기
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            <button
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:text-slate-400"
              disabled={group.role === "OWNER"}
              onClick={leaveGroup}
            >
              방 나가기
            </button>
            <button
              className="rounded border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 disabled:text-slate-400"
              disabled={group.role !== "OWNER"}
              onClick={deleteGroup}
            >
              방 삭제
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-amber-700" />
            <h2 className="font-semibold">구성원</h2>
          </div>
        {members.map((member) => (
          <div key={member.id} className="rounded bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{member.display_name}</p>
                <p className="text-sm text-slate-500">{member.role}</p>
              </div>
              <button
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-700"
                title="구성원 설정"
                onClick={() => (editingMemberId === member.id ? closeMemberSettings() : openMemberSettings(member))}
              >
                <Settings size={16} />
              </button>
            </div>
            {editingMemberId === member.id && (
              <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                {member.user_id === user.id && (
                  <form className="space-y-2" onSubmit={saveNickname}>
                    <input
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                      maxLength={30}
                      placeholder={member.name}
                      value={memberNickname}
                      onChange={(event) => setMemberNickname(event.target.value)}
                    />
                    <p className="text-sm text-slate-500">비워두면 계정 이름인 {member.name}으로 표시됩니다.</p>
                    <button className="flex w-full items-center justify-center gap-2 rounded bg-teal-700 px-4 py-2 font-medium text-white">
                      <Check size={18} />
                      이름 저장
                    </button>
                  </form>
                )}
                <button
                  className="flex w-full items-center justify-center rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:text-slate-400"
                  disabled={group.role !== "OWNER" || member.role === "OWNER"}
                  onClick={() => togglePermission(member)}
                >
                  {member.can_edit_schedule ? "권한 회수" : "권한 부여"}
                </button>
                <button
                  className="flex w-full items-center justify-center rounded border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 disabled:text-slate-400"
                  disabled={group.role !== "OWNER" || member.role === "OWNER"}
                  onClick={() => removeMember(member)}
                >
                  내보내기
                </button>
              </div>
            )}
          </div>
        ))}
        </section>
      </div>
    </div>
  );
}

function ManagePanel({
  user,
  group,
  members,
  schedules,
  canManage,
  onChanged,
  onNotice
}: {
  user: User;
  group: Group;
  members: Member[];
  schedules: Schedule[];
  canManage: boolean;
  onChanged: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [form, setForm] = useState<ScheduleFormState>(emptyScheduleForm);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);

  useEffect(() => {
    if (!form.target_user_id && members.length > 0) {
      setForm((current) => ({ ...current, target_user_id: String(members[0].user_id) }));
    }
  }, [form.target_user_id, members]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;

    try {
      const payload = {
        ...form,
        target_user_id: Number(form.target_user_id),
        escalation_minutes: Number(form.escalation_minutes)
      };

      if (editingScheduleId) {
        await pillmateApi.updateSchedule(user.id, group.id, editingScheduleId, payload);
      } else {
        await pillmateApi.createSchedule(user.id, group.id, payload);
      }

      setEditingScheduleId(null);
      setShowScheduleForm(false);
      setForm({ ...emptyScheduleForm, target_user_id: form.target_user_id });
      await onChanged();
      onNotice({ tone: "good", text: editingScheduleId ? "복약 스케줄이 수정되었습니다." : "복약 스케줄이 추가되었습니다." });
    } catch (error) {
      onNotice({ tone: "warn", text: error instanceof Error ? error.message : "스케줄 저장에 실패했습니다." });
    }
  }

  function startEdit(schedule: Schedule) {
    setEditingScheduleId(schedule.id);
    setShowScheduleForm(true);
    setForm({
      target_user_id: String(schedule.target_user_id),
      medicine_name: schedule.medicine_name,
      dosage: schedule.dosage,
      intake_time: schedule.intake_time,
      days_of_week: schedule.days_of_week,
      escalation_minutes: String(schedule.escalation_minutes ?? 30)
    });
  }

  function cancelEdit() {
    setEditingScheduleId(null);
    setShowScheduleForm(false);
    setForm({ ...emptyScheduleForm, target_user_id: form.target_user_id });
  }

  function startCreateSchedule() {
    setEditingScheduleId(null);
    setShowScheduleForm(true);
    setForm({ ...emptyScheduleForm, target_user_id: form.target_user_id || (members[0] ? String(members[0].user_id) : "") });
  }

  async function deleteSchedule(schedule: Schedule) {
    if (!canManage) return;

    try {
      await pillmateApi.deleteSchedule(user.id, group.id, schedule.id);
      if (editingScheduleId === schedule.id) {
        cancelEdit();
      }
      await onChanged();
      onNotice({ tone: "good", text: "복약 스케줄이 삭제되었습니다." });
    } catch (error) {
      onNotice({ tone: "warn", text: error instanceof Error ? error.message : "스케줄 삭제에 실패했습니다." });
    }
  }

  return (
    <section>
      <div className="flex h-[430px] flex-col rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-teal-700" />
            <h2 className="font-semibold">스케줄 관리</h2>
          </div>
          {canManage && (
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-teal-700 text-white"
              onClick={showScheduleForm && !editingScheduleId ? cancelEdit : startCreateSchedule}
              title={showScheduleForm && !editingScheduleId ? "등록 닫기" : "스케줄 추가"}
            >
              {showScheduleForm && !editingScheduleId ? <X size={18} /> : <Plus size={18} />}
            </button>
          )}
        </div>
        {!canManage ? (
          <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">스케줄 편집 권한이 필요합니다.</p>
        ) : showScheduleForm ? (
          <form className="grid min-h-0 gap-3 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-3 md:grid-cols-2" onSubmit={submit}>
            <select
              className="rounded border border-slate-300 px-3 py-2"
              value={form.target_user_id}
              onChange={(event) => setForm({ ...form, target_user_id: event.target.value })}
            >
              {members.map((member) => (
                <option key={member.id} value={member.user_id}>
                  {member.display_name}
                </option>
              ))}
            </select>
            <input
              className="rounded border border-slate-300 px-3 py-2"
              placeholder="약 이름"
              value={form.medicine_name}
              onChange={(event) => setForm({ ...form, medicine_name: event.target.value })}
            />
            <input
              className="rounded border border-slate-300 px-3 py-2"
              placeholder="복용량"
              value={form.dosage}
              onChange={(event) => setForm({ ...form, dosage: event.target.value })}
            />
            <input
              className="rounded border border-slate-300 px-3 py-2"
              type="time"
              value={form.intake_time}
              onChange={(event) => setForm({ ...form, intake_time: event.target.value })}
            />
            <label className="grid gap-1">
              <span className="text-sm font-medium text-slate-600">미확인 알림</span>
              <div className="flex items-center rounded border border-slate-300 bg-white px-3 py-2">
                <input
                  className="min-w-0 flex-1 bg-transparent outline-none"
                  min={1}
                  max={1440}
                  type="number"
                  value={form.escalation_minutes}
                  onChange={(event) => setForm({ ...form, escalation_minutes: event.target.value })}
                />
                <span className="ml-2 text-sm text-slate-500">분 뒤</span>
              </div>
            </label>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              {weekDays.map(([code, label]) => {
                const selected = form.days_of_week.split(",").includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    className={`h-9 w-9 rounded border text-sm font-medium ${selected ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                    onClick={() => {
                      const days = new Set(form.days_of_week.split(",").filter(Boolean));
                      if (selected) days.delete(code);
                      else days.add(code);
                      setForm({ ...form, days_of_week: weekDays.map(([day]) => day).filter((day) => days.has(day)).join(",") });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2 md:col-span-2 md:grid-cols-[1fr_auto]">
              <button className="flex items-center justify-center gap-2 rounded bg-teal-700 px-4 py-2 font-medium text-white">
                {editingScheduleId ? <Save size={18} /> : <Plus size={18} />}
                {editingScheduleId ? "수정 저장" : "스케줄 추가"}
              </button>
              {editingScheduleId && (
                <button
                  className="flex items-center justify-center gap-2 rounded border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700"
                  type="button"
                  onClick={cancelEdit}
                >
                  <X size={18} />
                  취소
                </button>
              )}
            </div>
          </form>
        ) : null}
        {!showScheduleForm && (
          <div className="max-h-[312px] space-y-2 overflow-y-auto pr-1">
            {schedules.length === 0 && (
              <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">등록된 스케줄이 없습니다.</p>
            )}
            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="grid min-h-[72px] gap-3 border-t border-slate-100 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div>
                  <p className="font-medium">{schedule.medicine_name}</p>
                  <p className="text-sm text-slate-500">
                    {schedule.target_user_name} · {schedule.intake_time} · {schedule.days_of_week} · {schedule.escalation_minutes ?? 30}분 뒤 알림
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">{schedule.is_active ? "활성" : "중지"}</span>
                  {canManage && (
                    <>
                      <button
                        className="flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 disabled:text-slate-300"
                        disabled={schedule.is_active !== 1}
                        title="스케줄 수정"
                        onClick={() => startEdit(schedule)}
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        className="flex h-9 w-9 items-center justify-center rounded border border-rose-200 bg-white text-rose-700 disabled:text-slate-300"
                        disabled={schedule.is_active !== 1}
                        title="스케줄 삭제"
                        onClick={() => deleteSchedule(schedule)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "good" | "warn";
}) {
  const color = tone === "good" ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50";

  return (
    <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className={`inline-flex items-center gap-2 rounded px-2 py-1 text-sm ${color}`}>
        {icon}
        {label}
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function TabButton({
  icon,
  label,
  active,
  badge,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-sm ${active ? "text-teal-700" : "text-slate-500"}`}
      onClick={onClick}
    >
      <Badge className="absolute right-5 top-2" count={badge ?? 0} />
      {icon}
      {label}
    </button>
  );
}

function Badge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) {
    return null;
  }

  return (
    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-semibold text-white ${className}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default App;
