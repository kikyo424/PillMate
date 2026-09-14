import { createAuthClient } from "better-auth/react";
import { apiBaseUrl } from "./api";

export const authClient = createAuthClient({
  baseURL: apiBaseUrl
});
