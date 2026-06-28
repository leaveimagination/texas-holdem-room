-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoomMode" AS ENUM ('cash', 'tournament');

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "hostTokenHash" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "mode" "RoomMode" NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomParticipant" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT,
    "seatNumber" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hand" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "handNumber" INTEGER NOT NULL,
    "buttonSeat" INTEGER NOT NULL,
    "smallBlind" INTEGER NOT NULL,
    "bigBlind" INTEGER NOT NULL,
    "board" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Hand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandPlayer" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "seatNumber" INTEGER NOT NULL,
    "startingChips" INTEGER NOT NULL,
    "endingChips" INTEGER NOT NULL,
    "holeCards" JSONB,

    CONSTRAINT "HandPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandAction" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "street" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "amount" INTEGER,
    "resultingStack" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pot" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "potType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "eligibleParticipantIds" JSONB NOT NULL,
    "winnerParticipantIds" JSONB NOT NULL,

    CONSTRAINT "Pot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyIn" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentResult" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "eliminationOrder" INTEGER,
    "finalRank" INTEGER,

    CONSTRAINT "TournamentResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_inviteCode_key" ON "Room"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "RoomParticipant_roomId_seatNumber_key" ON "RoomParticipant"("roomId", "seatNumber");

-- CreateIndex
CREATE INDEX "RoomParticipant_roomId_tokenHash_idx" ON "RoomParticipant"("roomId", "tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Hand_roomId_handNumber_key" ON "Hand"("roomId", "handNumber");

-- CreateIndex
CREATE UNIQUE INDEX "HandPlayer_handId_participantId_key" ON "HandPlayer"("handId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "HandAction_handId_sequenceNumber_key" ON "HandAction"("handId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentResult_roomId_participantId_key" ON "TournamentResult"("roomId", "participantId");

-- AddForeignKey
ALTER TABLE "RoomParticipant" ADD CONSTRAINT "RoomParticipant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hand" ADD CONSTRAINT "Hand_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandPlayer" ADD CONSTRAINT "HandPlayer_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandPlayer" ADD CONSTRAINT "HandPlayer_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "RoomParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandAction" ADD CONSTRAINT "HandAction_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandAction" ADD CONSTRAINT "HandAction_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "RoomParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pot" ADD CONSTRAINT "Pot_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyIn" ADD CONSTRAINT "BuyIn_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyIn" ADD CONSTRAINT "BuyIn_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "RoomParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentResult" ADD CONSTRAINT "TournamentResult_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentResult" ADD CONSTRAINT "TournamentResult_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "RoomParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
