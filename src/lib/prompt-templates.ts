export type PromptTemplate = {
  id: string;
  title: string;
  category: string;
  scene: string;
  size: string;
  imagePath: string;
  prompt: string;
  tags: string[];
};

export const promptTemplates: PromptTemplate[] = [
  {
    id: "product-editorial",
    title: "电商产品主图",
    category: "商品",
    scene: "适合小红书、淘宝、独立站商品首图",
    size: "1024x1024",
    imagePath: "/generated/cmoxztq3m0003fjrttal51dz8-1.png",
    tags: ["产品", "干净背景", "高级感"],
    prompt:
      "一张高级电商产品主图，主体产品位于画面中心，干净浅色背景，柔和棚拍光，真实材质细节，轻微自然阴影，现代商业摄影质感，画面简洁、有呼吸感，适合用于商品首图。",
  },
  {
    id: "lifestyle-poster",
    title: "生活方式海报",
    category: "营销",
    scene: "适合朋友圈、社媒广告、活动宣传",
    size: "1024x1536",
    imagePath: "/generated/responses-test-1.png",
    tags: ["海报", "生活方式", "自然光"],
    prompt:
      "生活方式广告海报画面，真实人物在温暖自然光下使用产品，环境干净、有品味，画面带一点胶片摄影质感，浅景深，情绪松弛但精致，构图适合留出上方标题空间，商业广告级别细节。",
  },
  {
    id: "brand-visual",
    title: "品牌视觉大片",
    category: "品牌",
    scene: "适合品牌首页、KV、视觉提案",
    size: "1792x1024",
    imagePath: "/generated/cmoxzo8wy0001fjtad6jyzt98-1.png",
    tags: ["品牌", "KV", "视觉大片"],
    prompt:
      "品牌主视觉大片，高级商业摄影风格，主体清晰有力量，背景具有空间层次和轻微戏剧光，画面色彩克制但有记忆点，适合网站首屏横幅，留出足够文案区域，整体质感专业、可信、昂贵。",
  },
  {
    id: "food-detail",
    title: "餐饮细节特写",
    category: "餐饮",
    scene: "适合菜单、团购、门店宣传图",
    size: "1536x1024",
    imagePath: "/generated/cmoy05icy000cfjrtz1wdqk7q-1.png",
    tags: ["食物", "特写", "诱人"],
    prompt:
      "餐饮摄影细节特写，新鲜食材和成品菜呈现在真实餐桌环境中，食物纹理清晰，热气和光泽自然，暖色侧光，背景轻微虚化，画面让人有食欲，适合菜单和门店宣传。",
  },
  {
    id: "ip-character",
    title: "IP 角色设定",
    category: "角色",
    scene: "适合头像、IP 设定、周边初稿",
    size: "1024x1024",
    imagePath: "/generated/cmoy1a37i0002fjxd9itvi5h6-1.png",
    tags: ["角色", "IP", "可爱"],
    prompt:
      "一个原创品牌 IP 角色设定图，角色正面站立，轮廓清晰，表情友好，有独特记忆点，服装和配饰体现品牌性格，干净背景，柔和体积光，适合继续做头像、贴纸和周边延展。",
  },
  {
    id: "interior-mood",
    title: "空间氛围图",
    category: "空间",
    scene: "适合民宿、装修、门店空间展示",
    size: "1792x1024",
    imagePath: "/generated/cmp1c6dfn0002fjsoz1ly04mz-1.png",
    tags: ["空间", "室内", "氛围"],
    prompt:
      "室内空间氛围图，真实建筑摄影风格，空间整洁但有生活气息，自然光从窗边进入，家具材质细腻，构图开阔，画面呈现舒适、高级、可信的空间体验，适合民宿、门店或装修展示。",
  },
];
