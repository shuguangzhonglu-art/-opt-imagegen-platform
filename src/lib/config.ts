import { prisma } from "@/lib/db";

export type ParsedSize = {
  label: string;
  cost: number;
  width: number;
  height: number;
  displayName: string;
};

export type PlatformConfig = {
  defaultUnitCost: number;
  availableSizes: ParsedSize[];
  taskConcurrency: number;
  fileRetentionDays: number;
  signupBonus: number;
};

const DEFAULT_SIZES = "1024x1024:40,1024x1536:60,1536x1024:60,1024x1792:80,1792x1024:80";

const SIZE_DISPLAY_NAMES: Record<string, string> = {
  "1024x1024": "方形 1:1",
  "1024x1536": "竖版 3:4",
  "1024x1792": "故事版 9:16",
  "1536x1024": "横版 4:3",
  "1792x1024": "宽屏 16:9",
};

export function parseSizes(raw: string): ParsedSize[] {
  return raw.split(",").map((entry) => {
    const [label, costRaw] = entry.split(":");
    const [widthRaw, heightRaw] = label.split("x");
    return {
      label,
      cost: Number(costRaw),
      width: Number(widthRaw),
      height: Number(heightRaw),
      displayName: SIZE_DISPLAY_NAMES[label] ?? label,
    };
  });
}

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });

  if (!settings) {
    return {
      defaultUnitCost: 40,
      availableSizes: parseSizes(DEFAULT_SIZES),
      taskConcurrency: 1,
      fileRetentionDays: 30,
      signupBonus: 200,
    };
  }

  return {
    defaultUnitCost: settings.defaultUnitCost,
    availableSizes: parseSizes(settings.availableSizes),
    taskConcurrency: settings.taskConcurrency,
    fileRetentionDays: settings.fileRetentionDays,
    signupBonus: settings.signupBonus,
  };
}

export function getSizeCost(config: PlatformConfig, size: string) {
  return config.availableSizes.find((item) => item.label === size)?.cost ?? config.defaultUnitCost;
}

export function formatSizeLabel(size: string) {
  return SIZE_DISPLAY_NAMES[size] ?? size;
}
