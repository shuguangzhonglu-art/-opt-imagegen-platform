import OpenAI from "openai";
import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";

const KV_SCENES = [
  { id: "01", title: "01:主KV视觉", description: "Hero Shot，严格还原产品图" },
  { id: "02", title: "02:生活/使用场景", description: "Lifestyle，展示实际使用" },
  { id: "03", title: "03:工艺/技术/概念", description: "Process/Concept，卖点可视化" },
  { id: "04", title: "04:特写 - 放大产品细节", description: "Detail 01，包装与局部" },
  { id: "05", title: "05:特写 - 材质/质感", description: "Detail 02，材质和触感" },
  { id: "06", title: "06:特写 - 功能细节", description: "Detail 03，结构和功能" },
  { id: "07", title: "07:用户评价/口碑", description: "Review，评分和反馈" },
  { id: "08", title: "08:品牌故事/配色灵感", description: "Moodboard，品牌调性" },
  { id: "09", title: "09:产品参数/规格表", description: "Specifications，参数表" },
  { id: "10", title: "10:使用指南/注意事项", description: "Usage Guide，步骤和说明" },
];

function extractJson(value: string) {
  const match = value.match(/\{[\s\S]*\}/);
  return match?.[0] || value;
}

function fallbackPlans(input: {
  brand: string;
  productInfo: string;
  extraPrompt: string;
  visualStyle: string;
  typography: string;
  sceneIds: string[];
}) {
  const scenes = KV_SCENES.filter((scene) => input.sceneIds.includes(scene.id));
  return scenes.map((scene) => ({
    sceneId: scene.id,
    title: scene.title,
    prompt: [
      "电商KV视觉生成任务，9:16竖版。",
      `场景：${scene.title} / ${scene.description}`,
      `品牌：${input.brand || "从参考图识别"}`,
      `产品信息：${input.productInfo || "从参考图识别产品类型、规格、卖点、配色、材质和包装细节"}`,
      `补充要求：${input.extraPrompt || "高端电商主KV，产品居中，干净背景，卖点信息可视化"}`,
      `视觉风格：${input.visualStyle}`,
      `排版细节：${input.typography}`,
      "必须严格还原上传产品图，包括包装设计、颜色、LOGO位置、文字内容、图案元素、材质质感和结构比例。不得改变品牌元素。",
      "中英文双语排版：中文标题更大，英文副标题较小；卖点用“中文 / English”格式；CTA可使用“立即选购 SHOP NOW”。",
      "Negative prompts: wrong packaging, changed logo, inaccurate text, different colors, fake claims, unreadable typography, watermark, low quality, blurry product, distorted product, bad perspective, harsh shadow, cluttered background, duplicate product, cropped logo, extra labels, random icons, cartoonish render, plastic fake texture, inconsistent bilingual text",
    ].join("\n"),
  }));
}

async function fileToDataUrlPart(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return {
    type: "image_url" as const,
    image_url: {
      url: `data:${file.type || "image/png"};base64,${buffer.toString("base64")}`,
    },
  };
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "主站未配置 OPENAI_API_KEY" }, { status: 500 });
  }

  const formData = await request.formData();
  const brand = String(formData.get("brand") ?? "").trim();
  const productInfo = String(formData.get("productInfo") ?? "").trim();
  const extraPrompt = String(formData.get("extraPrompt") ?? "").trim();
  const visualStyle = String(formData.get("visualStyle") ?? "AI自动匹配").trim();
  const typography = String(formData.get("typography") ?? "AI自动匹配").trim();
  const sceneIds = formData.getAll("sceneIds").map((item) => String(item)).filter(Boolean);
  const productImages = formData
    .getAll("productImages")
    .filter((item): item is File => typeof item === "object" && item !== null && "size" in item && item.size > 0)
    .slice(0, 10);
  const logoImage = formData.get("logoImage");
  const logoFiles =
    typeof logoImage === "object" && logoImage !== null && "size" in logoImage && logoImage.size > 0
      ? [logoImage as File]
      : [];

  if (!sceneIds.length) {
    return NextResponse.json({ error: "请至少选择一个场景" }, { status: 400 });
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 120000),
  });
  const model = process.env.OPENAI_KV_MODEL || "gpt-5.4";
  const scenes = KV_SCENES.filter((scene) => sceneIds.includes(scene.id));
  const imageParts = await Promise.all([...productImages, ...logoFiles].map(fileToDataUrlPart));

  const text = [
    "你是电商KV视觉系统agent。请分析上传的商品图和LOGO，生成可直接给图片生成模型使用的场景prompt。",
    "请遵循这些硬规则：",
    "1. 先识别品牌名称、产品类型、规格、核心卖点、主色调、辅助色、设计风格、目标受众、品牌调性、包装亮点、材质和结构。",
    "2. 每个prompt必须强调严格还原上传商品图：包装设计、颜色、LOGO位置、文字内容、图案元素、材质质感、结构比例不得更改。",
    "3. 每个prompt必须是9:16竖版电商海报，包含中英文双语排版要求、LOGO位置、CTA、负面词。",
    "4. 输出只允许JSON，不要markdown。",
    `品牌名称：${brand || "从图中识别"}`,
    `商品信息：${productInfo || "从图中识别"}`,
    `补充要求：${extraPrompt || "无"}`,
    `视觉风格：${visualStyle}`,
    `排版细节：${typography}`,
    `选中场景：${scenes.map((scene) => `${scene.id}-${scene.title}-${scene.description}`).join("；")}`,
    'JSON格式：{"report":"识别报告文本","plans":[{"sceneId":"01","title":"01:主KV视觉","prompt":"完整图片生成prompt"}]}',
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.35,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text }, ...imageParts],
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content || "";
    const parsed = JSON.parse(extractJson(raw)) as { report?: string; plans?: Array<{ sceneId: string; title: string; prompt: string }> };
    const plans = Array.isArray(parsed.plans) && parsed.plans.length
      ? parsed.plans.filter((plan) => sceneIds.includes(plan.sceneId))
      : fallbackPlans({ brand, productInfo, extraPrompt, visualStyle, typography, sceneIds });

    return NextResponse.json({
      report: parsed.report || "已完成商品识别和KV场景提示词生成。",
      plans,
      model,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "KV分析失败",
        report: "",
        plans: fallbackPlans({ brand, productInfo, extraPrompt, visualStyle, typography, sceneIds }),
      },
      { status: 500 },
    );
  }
}
