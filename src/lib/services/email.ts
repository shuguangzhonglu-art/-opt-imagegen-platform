import "server-only";

import nodemailer from "nodemailer";

import { getPlatformConfig } from "@/lib/config";

type SendVerificationEmailInput = {
  to: string;
  verifyUrl: string;
};

type SendVerificationCodeEmailInput = {
  to: string;
  code: string;
};

async function getEmailTransportConfig() {
  const config = await getPlatformConfig();
  const host = config.smtpHost || process.env.SMTP_HOST || "";
  const port = Number(config.smtpPort || process.env.SMTP_PORT || 587);
  const user = config.smtpUser || process.env.SMTP_USER || "";
  const password = config.smtpPassword || process.env.SMTP_PASSWORD || "";
  const from = config.smtpFrom || process.env.SMTP_FROM || user;

  return { host, port, user, password, from };
}

export async function sendVerificationEmail({ to, verifyUrl }: SendVerificationEmailInput) {
  const { host, port, user, password, from } = await getEmailTransportConfig();

  if (!host || !user || !password) {
    console.log(`[email-verification] ${to}: ${verifyUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass: password,
    },
  });

  await transporter.sendMail({
    from,
    to,
    subject: "验证你的 Image Studio 账号",
    text: `点击下面的链接完成邮箱验证：\n\n${verifyUrl}\n\n链接 24 小时内有效。`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>验证你的 Image Studio 账号</h2>
        <p>点击下面的按钮完成邮箱验证，链接 24 小时内有效。</p>
        <p><a href="${verifyUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">验证邮箱</a></p>
        <p style="color:#666;font-size:13px">${verifyUrl}</p>
      </div>
    `,
  });
}

export async function sendVerificationCodeEmail({ to, code }: SendVerificationCodeEmailInput) {
  const { host, port, user, password, from } = await getEmailTransportConfig();

  if (!host || !user || !password) {
    console.log(`[email-code] ${to}: ${code}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass: password,
    },
  });

  await transporter.sendMail({
    from,
    to,
    subject: "Hemora 注册验证码",
    text: `你的注册验证码是：${code}\n\n验证码 10 分钟内有效。`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>Hemora 注册验证码</h2>
        <p>你的验证码是：</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
        <p style="color:#666;font-size:13px">验证码 10 分钟内有效。</p>
      </div>
    `,
  });
}
