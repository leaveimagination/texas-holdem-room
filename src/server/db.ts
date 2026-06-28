import { loadLocalEnv } from "./env";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();

export const prisma = new PrismaClient();
