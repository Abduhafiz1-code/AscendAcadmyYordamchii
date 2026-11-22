interface EdgeRuntimeLike {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Webhook'ni darhol 200 bilan yopish uchun ishni fonda davom ettiradi.
 * Supabase Edge Runtime `EdgeRuntime.waitUntil` ni beradi; lokal testda oddiy promise.
 */
export function background(promise: Promise<unknown>, label = "background"): void {
  const task = promise.catch((error) => {
    console.error(`${label} xatosi:`, error instanceof Error ? error.stack ?? error.message : error);
  });
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(task);
    return;
  }
  void task;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
