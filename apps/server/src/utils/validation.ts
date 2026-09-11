import { HttpError } from "../http/errors.js";

export function requireString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${fieldName} is required`);
  }

  return value.trim();
}

export function requireEmail(value: unknown) {
  const email = requireString(value, "email").toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "A valid email is required");
  }

  return email;
}

export function requireInt(value: unknown, fieldName: string) {
  const numberValue = Number(value);

  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive integer`);
  }

  return numberValue;
}

export function requireIntakeTime(value: unknown) {
  const time = requireString(value, "intake_time");

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new HttpError(400, "intake_time must use HH:mm format");
  }

  return time;
}

export function requireDaysOfWeek(value: unknown) {
  const days = requireString(value, "days_of_week")
    .split(",")
    .map((day) => day.trim().toUpperCase())
    .filter(Boolean);
  const validDays = new Set(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

  if (days.length === 0 || days.some((day) => !validDays.has(day))) {
    throw new HttpError(400, "days_of_week must contain comma-separated weekday codes");
  }

  return [...new Set(days)].join(",");
}

export function optionalBoolean(value: unknown, defaultValue: boolean) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new HttpError(400, "Boolean value is required");
  }

  return value;
}
