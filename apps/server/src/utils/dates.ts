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
