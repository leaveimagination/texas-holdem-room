import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Prisma migration", () => {
  it("creates the full schema from an empty database", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma", "migrations", "20260628080000_add_participant_token_hash", "migration.sql"),
      "utf8"
    );

    expect(sql).toContain('CREATE TYPE "RoomMode"');
    expect(sql).toContain('CREATE TABLE "Room"');
    expect(sql).toContain('CREATE TABLE "RoomParticipant"');
    expect(sql).toContain('"tokenHash" TEXT');
    expect(sql).toContain('ALTER TABLE "RoomParticipant" ADD CONSTRAINT');
  });

  it("adds durable room session summaries", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma", "migrations", "20260717090000_add_room_session_summary", "migration.sql"),
      "utf8"
    );

    expect(sql).toContain('ALTER TABLE "Room" ADD COLUMN "sessionSummary" JSONB');
  });

  it("adds durable participant kick revocation", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma", "migrations", "20260720130000_add_participant_kicked_at", "migration.sql"),
      "utf8"
    );
    expect(sql).toContain('ADD COLUMN "kickedAt" TIMESTAMP(3)');
    expect(sql).toContain('CREATE INDEX "RoomParticipant_roomId_kickedAt_idx"');
  });
});
