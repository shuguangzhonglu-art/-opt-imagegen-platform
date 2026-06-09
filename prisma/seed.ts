import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@flux.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin123456";
  const demoUserEmail = "hema@demo.ai";
  const demoPassword = "demo123456";

  const [adminHash, demoHash] = await Promise.all([
    bcrypt.hash(adminPassword, 10),
    bcrypt.hash(demoPassword, 10),
  ]);

  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      defaultUnitCost: 40,
      availableSizes: "1024x1024:40,1024x1536:60,1536x1024:60,1024x1792:80,1792x1024:80",
      taskConcurrency: 1,
      fileRetentionDays: 30,
      signupBonus: 200,
      registrationInviteEnabled: false,
      signupActivityEnabled: false,
      signupActivityCredits: 0,
      signupActivityExpiresInHours: 24,
      signupActivityInviteOnly: true,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash: adminHash,
      displayName: "管理员",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
    create: {
      email: adminEmail,
      displayName: "管理员",
      passwordHash: adminHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      wallet: { create: { balance: 0 } },
    },
  });

  await prisma.user.upsert({
    where: { email: demoUserEmail },
    update: { passwordHash: demoHash, displayName: "演示用户" },
    create: {
      email: demoUserEmail,
      displayName: "演示用户",
      passwordHash: demoHash,
      wallet: { create: { balance: 1280 } },
    },
  });

  const count = await prisma.redeemCode.count();
  if (count === 0) {
    await prisma.redeemCode.createMany({
      data: [
        {
          code: "FC-880-START",
          batchName: "Launch Batch",
          creditAmount: 880,
          createdById: admin.id,
        },
        {
          code: "FC-3000-PRO",
          batchName: "Launch Batch",
          creditAmount: 3000,
          createdById: admin.id,
        },
      ],
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
