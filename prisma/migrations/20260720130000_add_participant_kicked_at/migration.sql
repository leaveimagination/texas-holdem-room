ALTER TABLE "RoomParticipant" ADD COLUMN "kickedAt" TIMESTAMP(3);

CREATE INDEX "RoomParticipant_roomId_kickedAt_idx" ON "RoomParticipant"("roomId", "kickedAt");
