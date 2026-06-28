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
});
