import { PrismaClient } from "@prisma/client";

// Crew portal password hashes are never loaded unless a query asks for them (only the crew login code does),
// so a crew record handed to a page or component can't carry one.
const make = () => new PrismaClient({ omit: { crew: { passwordHash: true } } });
type Client = ReturnType<typeof make>;

const globalForPrisma = globalThis as unknown as { prisma?: Client };

export const prisma = globalForPrisma.prisma ?? make();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
