import { randomBytes } from "node:crypto";

export interface FixtureSeedBrokerClient {
  endpoint: string;
  authorizationToken: string;
}

let consumedBrokerEnvironment: FixtureSeedBrokerClient | null | undefined;

export function consumeFixtureSeedBrokerForPlaywrightWorker(
  workerIndex = process.env.TEST_WORKER_INDEX
): FixtureSeedBrokerClient | null {
  return workerIndex === undefined ? null : consumeFixtureSeedBrokerEnvironment();
}

export function consumeFixtureSeedBrokerEnvironment(): FixtureSeedBrokerClient | null {
  const endpoint = process.env.SITE_TEST_FIXTURE_BROKER_ENDPOINT?.trim();
  const authorizationToken = process.env.SITE_TEST_FIXTURE_BROKER_TOKEN?.trim();
  if (!endpoint && !authorizationToken && consumedBrokerEnvironment !== undefined) {
    return consumedBrokerEnvironment;
  }
  if (
    endpoint &&
    !authorizationToken &&
    consumedBrokerEnvironment &&
    endpoint === consumedBrokerEnvironment.endpoint
  ) {
    delete process.env.SITE_TEST_FIXTURE_BROKER_ENDPOINT;
    return consumedBrokerEnvironment;
  }
  delete process.env.SITE_TEST_FIXTURE_BROKER_ENDPOINT;
  delete process.env.SITE_TEST_FIXTURE_BROKER_TOKEN;
  if (!endpoint && !authorizationToken) {
    consumedBrokerEnvironment = null;
    return null;
  }
  if (!endpoint || !authorizationToken) {
    throw new Error("Fixture seed broker environment is incomplete");
  }
  const url = new URL(endpoint);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/v1/seed" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Fixture seed broker endpoint must be the run-scoped loopback seed route");
  }
  consumedBrokerEnvironment = Object.freeze({
    endpoint: url.toString(),
    authorizationToken
  });
  return consumedBrokerEnvironment;
}

export async function seedNormalBettingThroughBroker(input: {
  broker: FixtureSeedBrokerClient;
  runId: string;
  roomId: string;
  participantIds: { button: string; small: string; big: string };
  now?: () => Date;
  requestId?: string;
  fetch?: typeof fetch;
}): Promise<{ roomId: string; fixtureId: "normal-betting"; handNumber: number }> {
  const response = await (input.fetch ?? fetch)(input.broker.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.broker.authorizationToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      runId: input.runId,
      roomId: input.roomId,
      requestId: input.requestId ?? randomBytes(16).toString("base64url"),
      issuedAt: (input.now ?? (() => new Date()))().toISOString(),
      fixture: { kind: "normal-betting", participantIds: input.participantIds }
    })
  });
  const body = await response.json() as unknown;
  if (!response.ok || !isSeedResponse(body)) {
    throw new Error(`Fixture seed broker rejected request (${response.status}): ${errorText(body)}`);
  }
  return body;
}

function isSeedResponse(input: unknown): input is {
  roomId: string;
  fixtureId: "normal-betting";
  handNumber: number;
} {
  return typeof input === "object" && input !== null &&
    typeof (input as Record<string, unknown>).roomId === "string" &&
    (input as Record<string, unknown>).fixtureId === "normal-betting" &&
    typeof (input as Record<string, unknown>).handNumber === "number";
}

function errorText(input: unknown): string {
  return typeof input === "object" && input !== null &&
    typeof (input as Record<string, unknown>).error === "string"
    ? String((input as Record<string, unknown>).error)
    : "invalid response";
}
