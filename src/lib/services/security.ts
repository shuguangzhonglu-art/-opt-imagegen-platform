import "server-only";

import { prisma } from "@/lib/db";

export async function countRecentRegistrations(email: string, windowMinutes: number) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const emailDomain = email.split("@")[1] ?? "";

  return prisma.user.count({
    where: {
      createdAt: { gte: since },
      email: emailDomain ? { endsWith: `@${emailDomain}` } : undefined,
    },
  });
}

export async function verifyTurnstileToken(token: string, secretKey: string) {
  if (!secretKey || !token) return false;

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      secret: secretKey,
      response: token,
    }),
  });

  if (!response.ok) return false;
  const data = (await response.json()) as { success?: boolean };
  return data.success === true;
}
