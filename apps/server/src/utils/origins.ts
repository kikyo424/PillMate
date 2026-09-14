const devOriginPatterns = [
  /^http:\/\/([a-z0-9-]+\.)*localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
  /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
  /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+:\d+$/
];

export function isAllowedDevOrigin(origin: string) {
  return devOriginPatterns.some((pattern) => pattern.test(origin));
}

export function resolveCorsOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
  if (!origin || origin === process.env.CORS_ORIGIN || isAllowedDevOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`CORS origin is not allowed: ${origin}`));
}
