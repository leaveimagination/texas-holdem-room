import { afterEach, describe, expect, it } from "vitest";
import { publicBaseUrl } from "@/server/room-links";

const originalAppOrigin = process.env.APP_ORIGIN;

describe("room invite link origin", () => {
  afterEach(() => {
    process.env.APP_ORIGIN = originalAppOrigin;
  });

  it("uses forwarded public host when APP_ORIGIN is a loopback development URL", () => {
    process.env.APP_ORIGIN = "http://127.0.0.1:3000";

    const request = new Request("https://texas-holdem-room-production.up.railway.app/api/rooms", {
      headers: {
        "x-forwarded-host": "texas-holdem-room-production.up.railway.app",
        "x-forwarded-proto": "https"
      }
    });

    expect(publicBaseUrl(request)).toBe("https://texas-holdem-room-production.up.railway.app");
  });

  it("keeps APP_ORIGIN for local development requests", () => {
    process.env.APP_ORIGIN = "http://127.0.0.1:3000";

    const request = new Request("http://127.0.0.1:3000/api/rooms");

    expect(publicBaseUrl(request)).toBe("http://127.0.0.1:3000");
  });
});
