import {
  Bell,
  CalendarClock,
  Camera,
  Check,
  ClipboardList,
  HeartPulse,
  Home,
  MessageCircle,
  Plus,
  Send,
  Settings,
  ShieldCheck,
  UserPlus,
  Users
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { apiBaseUrl, ChatMessage, Group, Member, pillmateApi, Schedule, User } from "./api";
import { createPillMateSocket } from "./socket";

type Tab = "today" | "chat" | "manage";
type Notice = { tone: "good" | "warn" | "info"; text: string };

const weekDays = [
  ["MON", "월"],
  ["TUE", "화"],
  ["WED", "수"],
  ["THU", "목"],
  ["FRI", "금"],
  ["SAT", "토"],
  ["SUN", "일"]
] as const;

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

function formatTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
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
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null,
    [activeGroupId, groups]
  );
  const canManage = activeGroup?.role === "OWNER" || activeGroup?.can_edit_schedule === 1;
  const completedCount = todaySchedules.filter((schedule) => schedule.status === "COMPLETED").length;
  const pendingCount = todaySchedules.length - completedCount;

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
  }, [activeGroup, user]);

  const refreshGroups = useCallback(async () => {
    if (!user) return;
    const result = await pillmateApi.listGroups(user.id);
    setGroups(result.groups);

    if (result.groups.length > 0 && !result.groups.some((group) => group.id === activeGroupId)) {
      setActiveGroupId(result.groups[0].id);
      localStorage.setItem("pillmate:groupId", String(result.groups[0].id));
    }
  }, [activeGroupId, user]);

  useEffect(() => {
    refreshGroups().catch((error) => setNotice({ tone: "warn", text: error.message }));
  }, [refreshGroups]);

  useEffect(() => {
    refreshGroupData().catch((error) => setNotice({ tone: "warn", text: error.message }));
  }, [refreshGroupData]);

  useEffect(() => {
    if (!user || !activeGroup) return undefined;

    const socket: Socket = createPillMateSocket(user.id, activeGroup.id);

    socket.on("chat:message", (message: ChatMessage) => {
      setMessages((current) => [...current.filter((item) => item.id !== message.id), message]);
    });
    socket.on("intake:due", () => {
      setNotice({ tone: "info", text: "복약 시간이 되었습니다. 오늘의 복약 카드를 확인해주세요." });
      refreshGroupData().catch(() => undefined);
    });
    socket.on("intake:completed", () => {
      refreshGroupData().catch(() => undefined);
    });
    socket.on("intake:escalated", () => {
      setNotice({ tone: "warn", text: "가족 복약 미확인 알림이 도착했습니다." });
      refreshGroupData().catch(() => undefined);
    });

    return () => {
      socket.disconnect();
    };
  }, [activeGroup, refreshGroupData, user]);

  async function handleUserCreated(createdUser: User) {
    setUser(createdUser);
    localStorage.setItem("pillmate:user", JSON.stringify(createdUser));
    setNotice({ tone: "good", text: `${createdUser.name}님으로 시작합니다.` });
  }

  async function handleGroupChanged(group: Group) {
    await refreshGroups();
    setActiveGroupId(group.id);
    localStorage.setItem("pillmate:groupId", String(group.id));
    setNotice({ tone: "good", text: `${group.name} 그룹에 연결되었습니다.` });
  }

  async function completeSchedule(scheduleId: number, photo?: File) {
    if (!user) return;
    setIsLoading(true);

    try {
      await pillmateApi.completeSchedule(user.id, scheduleId, photo);
      await refreshGroupData();
      setNotice({ tone: "good", text: "복약 완료가 가족 피드에 공유되었습니다." });
    } catch (error) {
      setNotice({ tone: "warn", text: error instanceof Error ? error.message : "복약 완료에 실패했습니다." });
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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-teal-700 text-white">
              <HeartPulse size={22} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">PillMate</h1>
              <p className="truncate text-sm text-slate-500">{user.name}님의 복약 케어</p>
            </div>
          </div>
          {activeGroup && (
            <select
              className="max-w-44 rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              value={activeGroup.id}
              onChange={(event) => {
                const groupId = Number(event.target.value);
                setActiveGroupId(groupId);
                localStorage.setItem("pillmate:groupId", String(groupId));
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
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 pb-24 pt-4 lg:grid-cols-[minmax(0,1fr)_390px] lg:pb-6">
        <section className="space-y-4">
          {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}

          {!activeGroup ? (
            <GroupSetup user={user} onGroupChanged={handleGroupChanged} />
          ) : (
            <>
              <GroupOverview group={activeGroup} completedCount={completedCount} pendingCount={pendingCount} />

              <div className={activeTab === "today" ? "block" : "hidden lg:block"}>
                <TodayPanel
                  schedules={todaySchedules}
                  currentUserId={user.id}
                  isLoading={isLoading}
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
                  onNotice={setNotice}
                />
              </div>
            </>
          )}
        </section>

        {activeGroup && (
          <aside className={activeTab === "chat" ? "block" : "hidden lg:block"}>
            <ChatPanel user={user} group={activeGroup} messages={messages} onMessageSent={refreshGroupData} />
          </aside>
        )}
      </main>

      {activeGroup && (
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-slate-200 bg-white lg:hidden">
          <TabButton icon={<Home size={20} />} label="오늘" active={activeTab === "today"} onClick={() => setActiveTab("today")} />
          <TabButton
            icon={<MessageCircle size={20} />}
            label="대화"
            active={activeTab === "chat"}
            onClick={() => setActiveTab("chat")}
          />
          <TabButton
            icon={<Settings size={20} />}
            label="관리"
            active={activeTab === "manage"}
            onClick={() => setActiveTab("manage")}
          />
        </nav>
      )}
    </div>
  );
}

function Onboarding({ onUserCreated }: { onUserCreated: (user: User) => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "password123" });
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const result = await pillmateApi.createUser(form);
      onUserCreated(result.user);
    } catch (error) {
      setError(error instanceof Error ? error.message : "사용자 생성에 실패했습니다.");
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-4">
      <form className="w-full max-w-sm space-y-4 rounded border border-slate-200 bg-white p-5 shadow-sm" onSubmit={submit}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-teal-700 text-white">
            <HeartPulse size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">PillMate 시작</h1>
            <p className="text-sm text-slate-500">개발용 계정을 먼저 만듭니다.</p>
          </div>
        </div>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2"
          placeholder="이름"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
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
          시작하기
        </button>
      </form>
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
          <h2 className="font-semibold">가족 링 만들기</h2>
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

function GroupOverview({
  group,
  completedCount,
  pendingCount
}: {
  group: Group;
  completedCount: number;
  pendingCount: number;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <ShieldCheck size={18} />
          가족 링
        </div>
        <p className="mt-2 text-xl font-semibold">{group.name}</p>
        <p className="mt-1 text-sm text-slate-500">초대 코드 {group.invite_code}</p>
      </div>
      <MetricCard icon={<Check size={18} />} label="완료" value={`${completedCount}건`} tone="good" />
      <MetricCard icon={<Bell size={18} />} label="남은 복약" value={`${pendingCount}건`} tone="warn" />
    </div>
  );
}

function TodayPanel({
  schedules,
  currentUserId,
  isLoading,
  onComplete
}: {
  schedules: Schedule[];
  currentUserId: number;
  isLoading: boolean;
  onComplete: (scheduleId: number, photo?: File) => void;
}) {
  if (schedules.length === 0) {
    return (
      <section className="rounded border border-dashed border-slate-300 bg-white p-8 text-center">
        <CalendarClock className="mx-auto text-slate-400" size={32} />
        <h2 className="mt-3 text-lg font-semibold">오늘 등록된 복약이 없습니다.</h2>
        <p className="mt-1 text-sm text-slate-500">권한자가 스케줄 관리에서 복약 일정을 추가할 수 있습니다.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={20} className="text-teal-700" />
        <h2 className="text-lg font-semibold">오늘의 복약</h2>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {schedules.map((schedule) => (
          <MedicationCard
            key={schedule.id}
            schedule={schedule}
            canComplete={schedule.target_user_id === currentUserId}
            isLoading={isLoading}
            onComplete={onComplete}
          />
        ))}
      </div>
    </section>
  );
}

function MedicationCard({
  schedule,
  canComplete,
  isLoading,
  onComplete
}: {
  schedule: Schedule;
  canComplete: boolean;
  isLoading: boolean;
  onComplete: (scheduleId: number, photo?: File) => void;
}) {
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const done = schedule.status === "COMPLETED";

  return (
    <article className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{schedule.target_user_name}</p>
          <h3 className="mt-1 text-xl font-semibold">{schedule.medicine_name}</h3>
          <p className="mt-1 text-sm text-slate-600">{schedule.dosage}</p>
        </div>
        <span className={`rounded px-2 py-1 text-sm font-medium ${done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {statusLabel(schedule.status)}
        </span>
      </div>
      <div className="mt-4 flex items-center gap-2 text-slate-700">
        <Bell size={18} />
        <span className="text-2xl font-semibold">{schedule.intake_time}</span>
        {schedule.completed_at && <span className="text-sm text-slate-500">완료 {formatTime(schedule.completed_at)}</span>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          className="flex min-h-11 items-center justify-center gap-2 rounded bg-teal-700 px-3 py-2 font-medium text-white disabled:bg-slate-300"
          disabled={!canComplete || done || isLoading}
          onClick={() => onComplete(schedule.id)}
        >
          <Check size={18} />
          먹었어요
        </button>
        <button
          className="flex min-h-11 items-center justify-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 disabled:text-slate-400"
          disabled={!canComplete || done || isLoading}
          onClick={() => photoInputRef.current?.click()}
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
          if (file) onComplete(schedule.id, file);
          event.target.value = "";
        }}
      />
    </article>
  );
}

function ChatPanel({
  user,
  group,
  messages,
  onMessageSent
}: {
  user: User;
  group: Group;
  messages: ChatMessage[];
  onMessageSent: () => void;
}) {
  const [content, setContent] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;

    await pillmateApi.sendMessage(user.id, group.id, content);
    setContent("");
    onMessageSent();
  }

  return (
    <section className="flex h-[calc(100vh-112px)] min-h-[520px] flex-col rounded border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center gap-2">
          <MessageCircle size={20} className="text-teal-700" />
          <h2 className="font-semibold">가족 대화방</h2>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">아직 메시지가 없습니다.</p>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} currentUserId={user.id} />)
        )}
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
    </section>
  );
}

function MessageBubble({ message, currentUserId }: { message: ChatMessage; currentUserId: number }) {
  const mine = message.sender_id === currentUserId;
  const system = message.message_type === "SYSTEM_VERIFICATION";

  if (system) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p>{message.content}</p>
        {message.photo_url && <img className="mt-2 max-h-56 rounded object-cover" src={`${apiBaseUrl}${message.photo_url}`} alt="복약 인증" />}
      </div>
    );
  }

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] rounded px-3 py-2 ${mine ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-900"}`}>
        {!mine && <p className="mb-1 text-xs text-slate-500">{message.sender_name}</p>}
        <p className="text-sm">{message.content}</p>
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
  const [form, setForm] = useState({
    target_user_id: "",
    medicine_name: "",
    dosage: "",
    intake_time: "08:30",
    days_of_week: "MON,TUE,WED,THU,FRI"
  });

  useEffect(() => {
    if (!form.target_user_id && members.length > 0) {
      setForm((current) => ({ ...current, target_user_id: String(members[0].user_id) }));
    }
  }, [form.target_user_id, members]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;

    try {
      await pillmateApi.createSchedule(user.id, group.id, {
        ...form,
        target_user_id: Number(form.target_user_id)
      });
      setForm({ ...form, medicine_name: "", dosage: "" });
      await onChanged();
      onNotice({ tone: "good", text: "복약 스케줄이 추가되었습니다." });
    } catch (error) {
      onNotice({ tone: "warn", text: error instanceof Error ? error.message : "스케줄 생성에 실패했습니다." });
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

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <ClipboardList size={20} className="text-teal-700" />
          <h2 className="font-semibold">스케줄 관리</h2>
        </div>
        {!canManage ? (
          <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">스케줄 편집 권한이 필요합니다.</p>
        ) : (
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
            <select
              className="rounded border border-slate-300 px-3 py-2"
              value={form.target_user_id}
              onChange={(event) => setForm({ ...form, target_user_id: event.target.value })}
            >
              {members.map((member) => (
                <option key={member.id} value={member.user_id}>
                  {member.name}
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
            <button className="flex items-center justify-center gap-2 rounded bg-teal-700 px-4 py-2 font-medium text-white md:col-span-2">
              <Plus size={18} />
              스케줄 추가
            </button>
          </form>
        )}
        <div className="mt-5 space-y-2">
          {schedules.map((schedule) => (
            <div key={schedule.id} className="flex items-center justify-between gap-3 border-t border-slate-100 py-3">
              <div>
                <p className="font-medium">{schedule.medicine_name}</p>
                <p className="text-sm text-slate-500">
                  {schedule.target_user_name} · {schedule.intake_time} · {schedule.days_of_week}
                </p>
              </div>
              <span className="text-sm text-slate-500">{schedule.is_active ? "활성" : "중지"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Users size={20} className="text-amber-700" />
          <h2 className="font-semibold">구성원 권한</h2>
        </div>
        <div className="space-y-2">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-2 rounded bg-slate-50 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{member.name}</p>
                <p className="text-sm text-slate-500">{member.role}</p>
              </div>
              <button
                className="rounded border border-slate-300 bg-white px-3 py-1 text-sm disabled:text-slate-400"
                disabled={group.role !== "OWNER" || member.role === "OWNER"}
                onClick={() => togglePermission(member)}
              >
                {member.can_edit_schedule ? "편집 가능" : "권한 없음"}
              </button>
            </div>
          ))}
        </div>
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
    <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`inline-flex items-center gap-2 rounded px-2 py-1 text-sm ${color}`}>
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const colors = {
    good: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warn: "border-rose-200 bg-rose-50 text-rose-800",
    info: "border-sky-200 bg-sky-50 text-sky-800"
  };

  return (
    <div className={`flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm ${colors[notice.tone]}`}>
      <span>{notice.text}</span>
      <button className="rounded px-2 py-1" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex min-h-16 flex-col items-center justify-center gap-1 text-sm ${active ? "text-teal-700" : "text-slate-500"}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

export default App;
