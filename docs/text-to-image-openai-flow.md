# 文字生成图片实现说明

这份文档只讲一件事：你这个项目里“文字生成图片”到底怎么发请求，参数怎么传，代码链路怎么走，和“参考图编辑”有什么区别。

结论先说：

- 你项目当前的直接生图主链路，不是 `client.images.generate(...)`。
- 你在前台“直接生成”里，默认强制走的是 `Responses API`。
- 真正发请求的地方是 [image-provider.ts](/Users/hemasir/Documents/图片生成网站项目/imagegen-platform/src/lib/services/image-provider.ts) 里的 `generateViaResponsesApi(...)`。
- 只有在另一条分支里，才会走 `client.images.generate(...)`。
- 只要带了 `sourceImagePath`，就优先走 `client.images.edit(...)`，不是纯文生图。

## 1. 代码链路

你现在项目里，用户在前台提交“文字生成图片”时，主调用链是：

1. [user-actions.ts](/Users/hemasir/Documents/图片生成网站项目/imagegen-platform/src/lib/actions/user-actions.ts)
2. `directGenerateAction(...)`
3. `generateImagesWithUserConfig(...)`
4. `generateOpenAiImagesWithOptions(...)`
5. `generateViaResponsesApi(...)`
6. `POST {baseURL}/responses`

对应代码入口：

```ts
const images = await generateImagesWithUserConfig(
  {
    prompt: parsed.data.prompt,
    sourceImagePath,
    size: parsed.data.size,
    quantity: parsed.data.quantity,
  },
  {
    apiKey: parsed.data.apiKey,
    baseURL: parsed.data.baseURL,
    model: parsed.data.model,
    wireApi: "responses",
  },
);
```

这段在 [user-actions.ts](/Users/hemasir/Documents/图片生成网站项目/imagegen-platform/src/lib/actions/user-actions.ts)。

关键点很明确：

- `wireApi: "responses"` 是硬编码传进去的。
- 所以前台“直接生成”默认不是 `images.generate`。
- 只要没上传参考图，就进入 `generateViaResponsesApi(...)`。
- 如果上传了参考图，就优先进入 `generateViaImageEditsApi(...)`。

## 2. 文字生成图片的真实请求代码

你项目当前“文字生成图片”的核心代码，按实际逻辑整理后就是这个：

```ts
async function generateViaResponsesApi(
  input: GenerateImageInput,
  model: string,
  options?: { apiKey?: string; baseURL?: string },
): Promise<GeneratedAsset[]> {
  const baseUrl = options?.baseURL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const apiKey = options?.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("未配置 OPENAI_API_KEY");
  }

  const { width, height } = getImageDimensions(input.size);
  const results: GeneratedAsset[] = [];
  const count = Math.max(1, input.quantity);
  const sourceImageDataUrl = await getSourceImageDataUrl(input.sourceImagePath);
  const content = sourceImageDataUrl
    ? [
        { type: "input_text", text: buildPrompt(input) },
        { type: "input_image", image_url: sourceImageDataUrl },
      ]
    : buildPrompt(input);

  for (let index = 0; index < count; index += 1) {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: sourceImageDataUrl
          ? [
              {
                role: "user",
                content,
              },
            ]
          : content,
        tools: [
          {
            type: "image_generation",
            quality: getResponsesImageQuality(input.quality),
            size: normalizeOpenAISize(input.size, "dall-e-3"),
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`图片接口调用失败（${response.status}）：${text}`);
    }

    const payload = (await response.json()) as {
      output?: Array<{ type?: string; result?: string }>;
    };

    const imageCall = payload.output?.find((item) => item.type === "image_generation_call");
    const result = imageCall?.result;
    if (!result) {
      throw new Error("responses 接口未返回图片结果");
    }

    const fileName = `${input.taskId}-${index + 1}.png`;
    await saveBase64Image(result, fileName);
    results.push({
      filePath: `/generated/${fileName}`,
      width,
      height,
    });
  }

  return results;
}
```

原始位置：

- [image-provider.ts](/Users/hemasir/Documents/图片生成网站项目/imagegen-platform/src/lib/services/image-provider.ts)

## 3. 发出去的 HTTP 请求长什么样

如果这是纯文字生成，没有参考图，那么最终请求体的核心结构就是：

```json
{
  "model": "gpt-5.4",
  "input": "你的提示词\nStyle: 自由创作\nQuality: 高细节质量",
  "tools": [
    {
      "type": "image_generation",
      "quality": "hd",
      "size": "1024x1024"
    }
  ]
}
```

如果带参考图，则 `input` 会变成多模态消息格式：

```json
{
  "model": "gpt-5.4",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "你的提示词\nUse the attached image as visual reference and continue from it.\nStyle: 自由创作\nQuality: 高细节质量"
        },
        {
          "type": "input_image",
          "image_url": "data:image/jpeg;base64,..."
        }
      ]
    }
  ],
  "tools": [
    {
      "type": "image_generation",
      "quality": "hd",
      "size": "1024x1024"
    }
  ]
}
```

但你要看清楚一个事实：

- 这段 `responses` 代码虽然支持把参考图塞进 `input`。
- 可是在你项目外层逻辑里，只要 `sourceImagePath` 存在，通常根本不会走这里。
- 它会先走 `images.edit(...)` 分支。

也就是说，真正的“参考图编辑”主逻辑不是上面这个 `responses` 多模态请求，而是另一条分支。

## 4. 提示词是怎么拼出来的

项目里提示词不是直接只发用户输入，而是通过 `buildPrompt(input)` 拼接：

```ts
function buildPrompt(input: GenerateImageInput) {
  return [
    input.prompt.trim(),
    input.sourceImagePath ? "Use the attached image as visual reference and continue from it." : "",
    input.style ? `Style: ${input.style}` : "",
    input.quality ? `Quality: ${input.quality}` : "",
  ].join("\n");
}
```

结果就是：

- 纯文生图时，提示词至少包含 `prompt + style + quality`
- 图生图时，会多一行：
  `Use the attached image as visual reference and continue from it.`

一个实际例子：

```txt
A highly detailed 3D photorealistic Mars rover on the surface of Mars
Style: 自由创作
Quality: 高细节质量
```

## 5. 参数映射，不要搞混

### `model`

前台默认值在 [user-actions.ts](/Users/hemasir/Documents/图片生成网站项目/imagegen-platform/src/lib/actions/user-actions.ts)：

```ts
model: String(formData.get("model") ?? "").trim() || "gpt-5.4"
```

这意味着：

- 你当前前台默认模型名是 `gpt-5.4`
- 这不是一个典型的官方图片模型名
- 如果你的 `baseURL` 是兼容网关，例如你自己的转发层，它可能把这个模型映射到真实图片能力
- 如果你直连官方 OpenAI 标准接口，这个模型名未必可用

别自欺欺人。模型名能不能跑，取决于你接的到底是什么网关，不取决于前端写了什么。

### `size`

项目会先读前端尺寸，比如：

- `1024x1024`
- `1536x1024`
- `1024x1536`

然后在 `responses` 分支里调用：

```ts
size: normalizeOpenAISize(input.size, "dall-e-3")
```

这很关键。它不是用当前 `model` 做归一化，而是强行按 `"dall-e-3"` 规则处理尺寸。

对应结果：

- 横图会变成 `1792x1024`
- 竖图会变成 `1024x1792`
- 方图会变成 `1024x1024`

也就是说，哪怕你前端传的是 `1536x1024`，在 `responses` 请求里也可能被映射成 `1792x1024`。

### `quality`

在 `responses` 分支里：

```ts
function getResponsesImageQuality(quality: string) {
  return quality.includes("高") ? "hd" : "medium";
}
```

所以：

- 只要质量文案里带“高”，就传 `hd`
- 否则传 `medium`

这套映射很粗暴，但很直接。

### `quantity`

你项目不会在一次 `responses` 请求里要求返回多张图，而是循环请求：

```ts
for (let index = 0; index < count; index += 1) {
  // 每次请求一张
}
```

这意味着：

- 要 4 张图，就发 4 次 `/responses`
- 不是一次请求拿 4 张
- 好处是兼容性简单
- 坏处是慢，而且更容易被限流

## 6. 返回结果是怎么取的

你项目假设 `/responses` 返回结构里有：

```json
{
  "output": [
    {
      "type": "image_generation_call",
      "result": "base64图片数据"
    }
  ]
}
```

然后这里取图：

```ts
const imageCall = payload.output?.find((item) => item.type === "image_generation_call");
const result = imageCall?.result;
```

拿到 `result` 之后直接当 base64 落盘。

也就是说，你当前代码假设：

- 图片结果不是 URL
- 也不是嵌套在别的字段里
- 而是直接放在 `output[].result`

如果你的上游网关返回结构不一样，这段会直接炸。

## 7. 图片怎么保存

保存逻辑很简单：

```ts
async function saveBase64Image(base64Data: string, fileName: string) {
  const absolutePath = path.join(GENERATED_DIR, fileName);
  await fs.writeFile(absolutePath, Buffer.from(base64Data, "base64"));
  return absolutePath;
}
```

生成目录是：

```ts
const GENERATED_DIR = path.join(process.cwd(), "public", "generated");
```

最终前端可访问路径类似：

```txt
/generated/direct-时间戳-随机串-1.png
```

## 8. 项目里另一种“文生图”代码

除了 `responses`，你项目里还保留了一条 `images.generate(...)` 分支：

```ts
const response = await client.images.generate({
  model,
  prompt: buildPrompt(input),
  size: normalizeOpenAISize(input.size, model),
  quality: getOpenAIQuality(model, input.quality),
  n: getOpenAIImageCount(model, input.quantity),
});
```

这条分支在这些情况下才会走：

- 没有参考图
- `wireApi !== "responses"`

也就是：

- 如果你把 `wireApi` 改成 `"images"`，才会进入这条路
- 或者调用别的内部函数时明确不走 `responses`

## 9. 如果你要“参考生成图片的方式”写文生图代码，最接近你项目现状的版本

下面这段代码，不是我拍脑袋写的，而是按你现有项目逻辑整理出来的最接近版本。

### TypeScript 服务端版本

```ts
import fs from "node:fs/promises";
import path from "node:path";

const OPENAI_REQUEST_TIMEOUT_MS = 180000;
const GENERATED_DIR = path.join(process.cwd(), "public", "generated");

function normalizeSize(size: string) {
  const [width, height] = size.split("x").map(Number);
  if (width > height) return "1792x1024";
  if (height > width) return "1024x1792";
  return "1024x1024";
}

function mapQuality(quality: string) {
  return quality.includes("高") ? "hd" : "medium";
}

function buildPrompt(input: {
  prompt: string;
  style?: string;
  quality?: string;
}) {
  return [
    input.prompt.trim(),
    input.style ? `Style: ${input.style}` : "",
    input.quality ? `Quality: ${input.quality}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateTextToImage(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  prompt: string;
  style?: string;
  quality?: string;
  size: string;
  quantity: number;
  taskId: string;
}) {
  await fs.mkdir(GENERATED_DIR, { recursive: true });

  const results: Array<{ filePath: string; width: number; height: number }> = [];
  const [width, height] = params.size.split("x").map(Number);

  for (let index = 0; index < Math.max(1, params.quantity); index += 1) {
    const response = await fetch(`${params.baseURL}/responses`, {
      method: "POST",
      signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        input: buildPrompt({
          prompt: params.prompt,
          style: params.style || "自由创作",
          quality: params.quality || "高细节质量",
        }),
        tools: [
          {
            type: "image_generation",
            quality: mapQuality(params.quality || "高细节质量"),
            size: normalizeSize(params.size),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`调用失败：${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      output?: Array<{ type?: string; result?: string }>;
    };

    const imageCall = payload.output?.find((item) => item.type === "image_generation_call");
    const base64 = imageCall?.result;
    if (!base64) {
      throw new Error("未拿到图片 base64");
    }

    const fileName = `${params.taskId}-${index + 1}.png`;
    const absolutePath = path.join(GENERATED_DIR, fileName);
    await fs.writeFile(absolutePath, Buffer.from(base64, "base64"));

    results.push({
      filePath: `/generated/${fileName}`,
      width,
      height,
    });
  }

  return results;
}
```

## 10. 最小可运行请求示例

如果你只想看最小可用请求，不关心你项目其它包装层，那就是这个：

```ts
const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-5.4",
    input: "生成一张火星车的3D效果照片\nStyle: 自由创作\nQuality: 高细节质量",
    tools: [
      {
        type: "image_generation",
        quality: "hd",
        size: "1024x1024",
      },
    ],
  }),
});
```

取结果：

```ts
const payload = await response.json();
const imageCall = payload.output?.find(
  (item: { type?: string; result?: string }) => item.type === "image_generation_call",
);
const base64 = imageCall?.result;
```

## 11. 你项目的坑

这里不是客气的时候，几个坑必须指出来。

### 1. 默认模型名可疑

`gpt-5.4` 不是一个你可以理所当然认为“官方标准图片模型”的名字。

这意味着：

- 如果你走的是自建兼容网关，可能没问题
- 如果你直连官方接口，这名字可能直接 404 或能力不匹配

### 2. `responses` 分支把尺寸按 `dall-e-3` 规则硬转

这一行：

```ts
size: normalizeOpenAISize(input.size, "dall-e-3")
```

说明：

- 代码根本没按当前真实模型能力来决定尺寸
- 它是拿 `dall-e-3` 规则硬套
- 这会让你前端尺寸和上游实际尺寸不完全一致

### 3. 多张图是串行请求

`quantity = 4` 时，不是一次返回 4 张，而是发 4 次请求。

这会导致：

- 总耗时更长
- 限流风险更高
- 某一张失败时，整批体验变差

### 4. `responses` 返回结构假设过死

你现在写死找：

```ts
item.type === "image_generation_call"
```

以及：

```ts
item.result
```

只要上游兼容层返回结构稍微不同，这段就会坏。

### 5. 有参考图时，前台其实不是“参考生成”，而是优先走编辑接口

这不是语义问题，这是实现事实。

也就是说：

- 你上传参考图
- 并不是“纯文生图 + 参考图理解”
- 而是先尝试 `images.edit(...)`

如果你以为这两者完全等价，那就是误判。

## 12. 如果你要改成统一走 `images.generate(...)`

你只需要理解一件事：

- 当前前台入口把 `wireApi` 写死成了 `"responses"`
- 改成 `"images"`，无参考图时才会走 `client.images.generate(...)`

示意：

```ts
const images = await generateImagesWithUserConfig(
  {
    prompt: parsed.data.prompt,
    sourceImagePath,
    size: parsed.data.size,
    quantity: parsed.data.quantity,
  },
  {
    apiKey: parsed.data.apiKey,
    baseURL: parsed.data.baseURL,
    model: parsed.data.model,
    wireApi: "images",
  },
);
```

但别偷懒。你改这个之前，先确认你的上游网关到底支持哪条协议，别把能跑的链路改死。

## 13. 文档结论

一句话说透：

- 你项目现在“文字生成图片”的实际主实现，是 `POST /responses + tools: [{ type: "image_generation" }]`
- 不是默认 `images.generate(...)`
- 上传参考图时则优先改走 `images.edit(...)`
- 生成结果按 base64 写入 `public/generated`

你如果下一步要，我可以继续直接给你补两份内容：

1. 一份“把这套文生图流程改成 `gpt-image-1` 官方风格”的改造方案
2. 一份“把你当前 `responses` 生图链路接到前端页面”的逐文件修改说明
