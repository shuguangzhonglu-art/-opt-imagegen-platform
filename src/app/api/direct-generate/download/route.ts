import path from "node:path";

import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";

const ALLOWED_REMOTE_HOSTS = new Set(["cdn.hemasir.online"]);

function getSafeFilename(url: URL) {
  const basename = path.basename(url.pathname) || "imagegen.png";
  const decoded = decodeURIComponent(basename);
  return decoded.replace(/[^\w.\-()\u4e00-\u9fa5]/g, "_") || "imagegen.png";
}

function isAllowedDownloadUrl(target: URL, request: Request) {
  const requestUrl = new URL(request.url);
  if (target.origin === requestUrl.origin && target.pathname.startsWith("/generated/")) {
    return true;
  }
  return target.protocol === "https:" && ALLOWED_REMOTE_HOSTS.has(target.hostname);
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get("url") || "";
  if (!rawUrl) {
    return NextResponse.json({ error: "缺少下载地址" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl, requestUrl.origin);
  } catch {
    return NextResponse.json({ error: "下载地址不合法" }, { status: 400 });
  }

  if (!isAllowedDownloadUrl(target, request)) {
    return NextResponse.json({ error: "不允许下载该地址" }, { status: 400 });
  }

  const upstream = await fetch(target, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "下载失败" }, { status: upstream.status || 502 });
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const filename = getSafeFilename(target);

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
