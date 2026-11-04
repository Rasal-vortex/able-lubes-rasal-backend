import "dotenv/config";
import bcrypt from "bcryptjs";
import prisma from "../src/config/prisma.js";
import { seedCanonicalUnits } from "./unit-catalog.js";

try {
  // Validate admin environment variables
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD are required to seed the initial admin",
    );
  }

  const email = process.env.ADMIN_EMAIL.toLowerCase();
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);

  await prisma.$transaction(async (tx) => {
    // 1. Ensure initial admin
    await tx.user.upsert({
      where: { email },
      update: {
        role: "ADMIN",
      },
      create: {
        name: process.env.ADMIN_NAME || "System Administrator",
        email,
        passwordHash,
        role: "ADMIN",
      },
    });

    console.info(`Initial admin ensured for ${email}`);

    // 2. Ensure the canonical catalog without deleting existing units.
    await seedCanonicalUnits(tx);
  });

  console.info("Unit catalog seeded successfully.");
} catch (error) {
  console.error("Database seeding failed:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
