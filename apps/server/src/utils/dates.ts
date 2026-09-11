const dayCodes = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export function getTodayCode(date = new Date()) {
  return dayCodes[date.getDay()];
}

export function buildScheduledTime(date: Date, intakeTime: string) {
  const [hours, minutes] = intakeTime.split(":").map(Number);
  const scheduled = new Date(date);
  scheduled.setHours(hours, minutes, 0, 0);

  return scheduled.toISOString();
}

export function getLocalDayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}
