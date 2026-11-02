import { createFileRoute } from "@tanstack/react-router";
import { APP_BUILD_ID, APP_BUILD_TIME, APP_VERSION } from "@/lib/appVersion";

// Public, read-only identity of the deployed web build. Contains no user data.
export const Route = createFileRoute("/api/public/version")({
  server: {
    handlers: {
      GET: async () => {
        const headers = {
          "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
          pragma: "no-cache",
          "x-content-type-options": "nosniff",
        };
        if (!APP_BUILD_ID) return Response.json({ error: "unstamped" }, { status: 503, headers });
        return Response.json({ buildId: APP_BUILD_ID, buildTime: APP_BUILD_TIME, version: APP_VERSION }, { headers });
      },
    },
  },
});
