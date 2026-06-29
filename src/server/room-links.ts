export function publicBaseUrl(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const appOrigin = process.env.APP_ORIGIN?.replace(/\/$/, "");
  if (appOrigin && (!forwardedHost || !isLoopbackOrigin(appOrigin))) {
    return appOrigin;
  }

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  if (appOrigin) {
    return appOrigin;
  }

  return new URL(request.url).origin;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
  } catch {
    return false;
  }
}
