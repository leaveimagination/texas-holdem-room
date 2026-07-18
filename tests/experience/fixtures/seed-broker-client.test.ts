import { afterEach, describe, expect, it, vi } from "vitest";

import {
  consumeFixtureSeedBrokerEnvironment,
  consumeFixtureSeedBrokerForPlaywrightWorker,
  seedFixtureThroughBroker
} from "./seed-broker-client";

const previousEndpoint = process.env.SITE_TEST_FIXTURE_BROKER_ENDPOINT;
const previousToken = process.env.SITE_TEST_FIXTURE_BROKER_TOKEN;

afterEach(() => {
  restore("SITE_TEST_FIXTURE_BROKER_ENDPOINT", previousEndpoint);
  restore("SITE_TEST_FIXTURE_BROKER_TOKEN", previousToken);
});

describe("fixture seed broker requests", () => {
  it("sends only a whitelisted fixture descriptor and validates the echoed kind", async () => {
    const request = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
      ok: true, roomId: "room-1", fixtureId: "side-pot", handNumber: 1
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(seedFixtureThroughBroker({
      broker: { endpoint: "http://127.0.0.1:47000/v1/seed", authorizationToken: "secret" },
      runId: "run-1",
      roomId: "room-1",
      fixture: { kind: "side-pot", participantIds: { aces: "a", kings: "k", queens: "q", jacks: "j" } },
      fetch: request as typeof fetch,
      requestId: "AAAAAAAAAAAAAAAAAAAAAA",
      now: () => new Date("2026-07-18T00:00:00Z")
    })).resolves.toMatchObject({ fixtureId: "side-pot" });
    const sent = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(sent.fixture).toEqual({ kind: "side-pot", participantIds: { aces: "a", kings: "k", queens: "q", jacks: "j" } });
  });
});

describe("fixture seed broker client bootstrap", () => {
  it("leaves the token intact in Playwright discovery and consumes it only in a worker", () => {
    process.env.SITE_TEST_FIXTURE_BROKER_ENDPOINT = "http://127.0.0.1:47000/v1/seed";
    process.env.SITE_TEST_FIXTURE_BROKER_TOKEN = "run-secret";

    expect(consumeFixtureSeedBrokerForPlaywrightWorker(undefined)).toBeNull();
    expect(process.env.SITE_TEST_FIXTURE_BROKER_TOKEN).toBe("run-secret");
    expect(consumeFixtureSeedBrokerForPlaywrightWorker("0")).toEqual({
      endpoint: "http://127.0.0.1:47000/v1/seed",
      authorizationToken: "run-secret"
    });
    expect(process.env.SITE_TEST_FIXTURE_BROKER_TOKEN).toBeUndefined();
  });

  it("consumes the secret before a browser process can inherit the worker environment", () => {
    process.env.SITE_TEST_FIXTURE_BROKER_ENDPOINT = "http://127.0.0.1:47000/v1/seed";
    process.env.SITE_TEST_FIXTURE_BROKER_TOKEN = "run-secret";

    const consumed = consumeFixtureSeedBrokerEnvironment();
    expect(consumed).toEqual({
      endpoint: "http://127.0.0.1:47000/v1/seed",
      authorizationToken: "run-secret"
    });
    expect(process.env.SITE_TEST_FIXTURE_BROKER_TOKEN).toBeUndefined();
    expect(process.env.SITE_TEST_FIXTURE_BROKER_ENDPOINT).toBeUndefined();
    expect(consumeFixtureSeedBrokerEnvironment()).toBe(consumed);
  });

  it("rejects a non-loopback or public application route and still removes the token", () => {
    process.env.SITE_TEST_FIXTURE_BROKER_ENDPOINT = "https://example.test/api/seed";
    process.env.SITE_TEST_FIXTURE_BROKER_TOKEN = "run-secret";

    expect(() => consumeFixtureSeedBrokerEnvironment()).toThrow(/loopback seed route/i);
    expect(process.env.SITE_TEST_FIXTURE_BROKER_TOKEN).toBeUndefined();
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
