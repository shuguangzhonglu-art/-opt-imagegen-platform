"use client";

import Image from "next/image";
import Link from "next/link";
import type { FormEvent } from "react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Notice } from "@/components/notice";
import { parseSizes } from "@/lib/config";
import {
  deleteDirectGenerateTaskAction,
  deleteDirectHistoryItemAction,
  getCurrentUserOverviewAction,
  getDirectHistoryAction,
  getDirectGenerateTasksAction,
  getKvGenerateTasksAction,
  getKvHistoryAction,
  retryDirectGenerateTaskAction,
  type DirectGenerateState,
} from "@/lib/actions/user-actions";
import type { DirectGenerateTaskState } from "@/lib/services/direct-tasks";

const SIZE_STORAGE_KEY = "direct-image-generator-size";
const SIZE_OPTIONS = parseSizes("1024x1024:0,1024x1536:0,1536x1024:0,1024x1792:0,1792x1024:0");
const HISTORY_PAGE_SIZE = 12;
const GALLERY_SINGLE_COLUMN_MAX_WIDTH = 720;
const GALLERY_DOUBLE_COLUMN_MAX_WIDTH = 1080;
const PENDING_PARTICLES = Array.from({ length: 126 }, (_, index) => {
  const columns = 14;
  const col = index % columns;
  const row = Math.floor(index / columns);
  const x = 8 + col * 8 + (row % 2 === 0 ? 0 : 4);
  const y = 8 + row * 10;
  const size = 2 + ((index * 5) % 3);
  const delay = (index % 18) * 0.07;
  return { x, y, size, delay };
});

function getDisplayAspectRatio(size: string) {
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) return "1 / 1";

  const ratio = width / height;
  if (ratio > 1) return `${Math.min(ratio, 4 / 3)} / 1`;
  if (ratio < 1) return `1 / ${Math.min(1 / ratio, 4 / 3)}`;
  return "1 / 1";
}

function getImageDisplayAspectRatio(image: GalleryItem) {
  if (image.size) return getDisplayAspectRatio(image.size);
  if (image.width > 0 && image.height > 0) return getDisplayAspectRatio(`${image.width}x${image.height}`);
  return "1 / 1";
}

function getImageDisplayRatioValue(image: GalleryItem) {
  const source = image.size || (image.width > 0 && image.height > 0 ? `${image.width}x${image.height}` : "1x1");
  const [width, height] = source.split("x").map(Number);
  if (!width || !height) return 1;

  const ratio = width / height;
  if (ratio > 1) return Math.min(ratio, 4 / 3);
  if (ratio < 1) return 1 / Math.min(1 / ratio, 4 / 3);
  return 1;
}

function getSizePreviewStyle(size: string): CSSProperties {
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) return { width: 38, height: 38 };
  const maxWidth = 52;
  const maxHeight = 42;
  const ratio = width / height;
  if (ratio >= 1) {
    return { width: maxWidth, height: Math.max(24, Math.round(maxWidth / ratio)) };
  }
  return { width: Math.max(24, Math.round(maxHeight * ratio)), height: maxHeight };
}

function formatHistoryDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

function ActionIcon({ name }: { name: "download" | "retry" | "reuse" | "edit" | "delete" }) {
  if (name === "download") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v13" />
        <path d="m6.5 10.5 5.5 5.5 5.5-5.5" />
        <path d="M5 21h14" />
      </svg>
    );
  }
  if (name === "retry") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12a8 8 0 1 0 2.4-5.7" />
        <path d="M4 4v6h6" />
      </svg>
    );
  }
  if (name === "reuse") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 7 4 12l5 5" />
        <path d="M20 17a7 7 0 0 0-7-7H4" />
      </svg>
    );
  }
  if (name === "edit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 20 4.2-1 10.4-10.4a2.2 2.2 0 0 0-3.1-3.1L5.1 15.9 4 20Z" />
        <path d="m14 7 3 3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

function readStoredSize() {
  if (typeof window === "undefined") return "1024x1024";
  try {
    return window.localStorage.getItem(SIZE_STORAGE_KEY) || "1024x1024";
  } catch {
    return "1024x1024";
  }
}

function taskToGenerateState(task: DirectGenerateTaskState): DirectGenerateState {
  return {
    error: task.error,
    success: task.success,
    history: task.history,
    images: task.images,
    elapsedMs: task.elapsedMs,
    submitted: task.submitted,
  };
}

type GalleryItem = {
  filePath: string;
  width: number;
  height: number;
  prompt?: string;
  size?: string;
  createdAt?: string;
};

type PendingCard = {
  taskId: string;
  startedAt: number;
  size: string;
  status: "running" | "failed";
  error?: string;
  isLocal?: boolean;
};

type ReferenceItem = {
  id: string;
  label: string;
  previewUrl: string;
  sourcePath?: string;
  file?: File;
};

type KvScene = {
  id: string;
  title: string;
  description: string;
};

type KvPromptPlan = {
  sceneId: string;
  title: string;
  prompt: string;
};

type UserOverview = {
  email: string;
  displayName: string;
  role: string;
  balance: number;
  taskCount: number;
};

type StudioMode = "image" | "kv";

const KV_SCENES: KvScene[] = [
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

export function NewHomeStudio({ currentUser, mode = "image" }: { currentUser: UserOverview; mode?: StudioMode }) {
  const isKvMode = mode === "kv";
  const [state, setState] = useState<DirectGenerateState>({});
  const [userOverview, setUserOverview] = useState<UserOverview>(currentUser);
  const [activeTaskIds, setActiveTaskIds] = useState<string[]>([]);
  const [size, setSize] = useState(() => (isKvMode ? "1024x1792" : readStoredSize()));
  const [prompt, setPrompt] = useState(
    isKvMode
      ? "产品：\n品牌：\n核心卖点：\n目标人群：\n画面风格：高端电商主KV，产品居中，干净背景，卖点信息可视化。"
      : "",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [galleryColumnCount, setGalleryColumnCount] = useState(3);
  const [referenceItems, setReferenceItems] = useState<ReferenceItem[]>([]);
  const [historyImages, setHistoryImages] = useState<DirectGenerateState["history"]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<GalleryItem | null>(null);
  const [pendingCards, setPendingCards] = useState<PendingCard[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [kvBrand, setKvBrand] = useState("");
  const [kvInfo, setKvInfo] = useState("");
  const [kvLogo, setKvLogo] = useState<ReferenceItem | null>(null);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>(["01"]);
  const [kvVisualStyle, setKvVisualStyle] = useState("AI自动匹配");
  const [kvTypography, setKvTypography] = useState("AI自动匹配");
  const [kvPlans, setKvPlans] = useState<KvPromptPlan[]>([]);
  const [kvReport, setKvReport] = useState("");
  const [isAnalyzingKv, setIsAnalyzingKv] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const resultPanelRef = useRef<HTMLElement | null>(null);
  const selectedKvPlans = kvPlans.filter((plan) => selectedSceneIds.includes(plan.sceneId));

  async function refreshUserOverview() {
    try {
      setUserOverview(await getCurrentUserOverviewAction());
    } catch {
      return;
    }
  }

  useEffect(() => {
    if (!isKvMode) window.localStorage.setItem(SIZE_STORAGE_KEY, size);
  }, [isKvMode, size]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      const [history, tasks] = await Promise.all([
        (isKvMode ? getKvHistoryAction : getDirectHistoryAction)({
          offset: 0,
          limit: HISTORY_PAGE_SIZE,
        }),
        isKvMode ? getKvGenerateTasksAction() : getDirectGenerateTasksAction(),
      ]);

      if (!cancelled) {
        setHistoryImages(history);
        setHasMoreHistory(history.length === HISTORY_PAGE_SIZE);
        setPendingCards(
          tasks
            .filter((task) => task.taskId && task.submitted?.size)
            .map((task) => ({
              taskId: task.taskId as string,
              startedAt: task.createdAt ?? Date.now(),
              size: task.submitted?.size || "1024x1024",
              status: task.status === "failed" ? "failed" : "running",
              error: task.error,
            })),
        );
        setActiveTaskIds(
          tasks
            .filter((task) => task.taskId && (task.status === "pending" || task.status === "running"))
            .map((task) => task.taskId as string),
        );
        setHistoryLoading(false);
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [isKvMode]);

  useEffect(() => {
    let cancelled = false;
    async function pollTask(taskId: string) {
      let response: Response;
      try {
        response = await fetch(`/api/direct-generate/status?taskId=${encodeURIComponent(taskId)}`, {
          cache: "no-store",
        });
      } catch {
        window.setTimeout(() => {
          if (!cancelled) void pollTask(taskId);
        }, 2500);
        return;
      }

      let task: DirectGenerateTaskState;
      try {
        task = (await response.json()) as DirectGenerateTaskState;
      } catch {
        window.setTimeout(() => {
          if (!cancelled) void pollTask(taskId);
        }, 2500);
        return;
      }

      if (cancelled) return;

      if (task.status === "succeeded" || task.status === "failed") {
        void refreshUserOverview();
        setActiveTaskIds((current) => current.filter((id) => id !== taskId));
        setState({
          error: task.error,
          success: task.success,
          elapsedMs: task.elapsedMs,
          submitted: task.submitted,
        });
        setPendingCards((current) =>
          task.status === "failed"
            ? current.map((card) =>
                card.taskId === taskId
                  ? {
                      ...card,
                      status: "failed",
                      error: task.error,
                    }
                  : card,
              )
            : current.filter((card) => card.taskId !== taskId),
        );
        if (task.history && !isKvMode) {
          setHistoryImages(task.history);
          setHasMoreHistory(task.history.length === HISTORY_PAGE_SIZE);
        } else if (task.status === "succeeded" && isKvMode) {
          const history = await getKvHistoryAction({
            offset: 0,
            limit: HISTORY_PAGE_SIZE,
          });
          setHistoryImages(history);
          setHasMoreHistory(history.length === HISTORY_PAGE_SIZE);
        }
        return;
      }

      window.setTimeout(() => {
        if (!cancelled) void pollTask(taskId);
      }, 2500);
    }

    activeTaskIds.forEach((taskId) => {
      void pollTask(taskId);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTaskIds, isKvMode]);

  useEffect(() => {
    return () => {
      referenceItems.forEach((item) => {
        if (item.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      if (kvLogo?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(kvLogo.previewUrl);
      }
    };
  }, [referenceItems, kvLogo]);

  useEffect(() => {
    function syncGalleryColumnCount() {
      const width = window.innerWidth;
      if (width <= GALLERY_SINGLE_COLUMN_MAX_WIDTH) {
        setGalleryColumnCount(1);
      } else if (width <= GALLERY_DOUBLE_COLUMN_MAX_WIDTH) {
        setGalleryColumnCount(2);
      } else {
        setGalleryColumnCount(3);
      }
    }

    syncGalleryColumnCount();
    window.addEventListener("resize", syncGalleryColumnCount);
    return () => window.removeEventListener("resize", syncGalleryColumnCount);
  }, []);

  async function handleLoadMore() {
    if (historyLoading) return;

    setHistoryLoading(true);
    const nextBatch = await (isKvMode ? getKvHistoryAction : getDirectHistoryAction)({
      offset: historyImages?.length ?? 0,
      limit: HISTORY_PAGE_SIZE,
    });
    setHistoryImages((current) => [...(current ?? []), ...nextBatch]);
    setHasMoreHistory(nextBatch.length === HISTORY_PAGE_SIZE);
    setHistoryLoading(false);
  }

  function syncFileInput(nextItems: ReferenceItem[]) {
    if (!fileInputRef.current) return;
    const dataTransfer = new DataTransfer();
    nextItems.forEach((item) => {
      if (item.file) {
        dataTransfer.items.add(item.file);
      }
    });
    fileInputRef.current.files = dataTransfer.files;
  }

  function appendReferenceFiles(files: File[]) {
    if (!files.length) return;
    setReferenceItems((current) => {
      const nextItems = [
        ...current,
        ...files.map((file) => ({
          id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          label: file.name,
          previewUrl: URL.createObjectURL(file),
          file,
        })),
      ];
      syncFileInput(nextItems);
      return nextItems;
    });
  }

  function setImageAsReference(filePath: string) {
    setReferenceItems((current) => {
      if (current.some((item) => item.sourcePath === filePath)) {
        return current;
      }
      return [
        ...current,
        {
          id: filePath,
          label: "历史参考图",
          previewUrl: filePath,
          sourcePath: filePath,
        },
      ];
    });
  }

  function removeReferenceItem(id: string) {
    setReferenceItems((current) => {
      const nextItems = current.filter((item) => item.id !== id);
      const removed = current.find((item) => item.id === id);
      if (removed?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      syncFileInput(nextItems);
      return nextItems;
    });
  }

  function applyLogoFile(file: File) {
    setKvLogo((current) => {
      if (current?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return {
        id: `${file.name}-${file.size}-${Date.now()}`,
        label: file.name,
        previewUrl: URL.createObjectURL(file),
        file,
      };
    });
  }

  function toggleKvScene(sceneId: string) {
    setSelectedSceneIds((current) => {
      if (current.includes(sceneId)) {
        return current.filter((id) => id !== sceneId);
      }
      return [...current, sceneId].sort();
    });
  }

  function selectAllKvScenes() {
    setSelectedSceneIds(KV_SCENES.map((scene) => scene.id));
  }

  async function analyzeKvAgent() {
    if (!isKvMode || isAnalyzingKv) return;
    if (!selectedSceneIds.length) {
      setSubmitMessage("请至少选择一个场景");
      return;
    }
    if (!referenceItems.some((item) => item.file) && !kvInfo.trim()) {
      setSubmitMessage("请上传商品图，或填写商品信息");
      return;
    }

    setSubmitMessage("");
    setIsAnalyzingKv(true);

    try {
      const formData = new FormData();
      formData.set("brand", kvBrand);
      formData.set("productInfo", kvInfo);
      formData.set("extraPrompt", prompt);
      formData.set("visualStyle", kvVisualStyle);
      formData.set("typography", kvTypography);
      selectedSceneIds.forEach((sceneId) => formData.append("sceneIds", sceneId));
      referenceItems
        .filter((item) => item.file)
        .slice(0, 10)
        .forEach((item) => formData.append("productImages", item.file as File));
      if (kvLogo?.file) {
        formData.set("logoImage", kvLogo.file);
      }

      const response = await fetch("/api/kv/analyze", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      const plans = Array.isArray(payload.plans) ? (payload.plans as KvPromptPlan[]) : [];
      if (!response.ok && !plans.length) {
        throw new Error(payload?.error || "KV分析失败");
      }
      setKvReport(payload.report || "已完成商品识别和场景提示词生成。");
      setKvPlans(plans.filter((plan) => selectedSceneIds.includes(plan.sceneId)));
      setSubmitMessage(response.ok ? "分析完成，选择场景后可提交队列" : `主站模型分析失败，已生成基础提示词：${payload?.error || ""}`);
    } catch (error) {
      setKvReport("");
      setKvPlans([]);
      setSubmitMessage(error instanceof Error ? error.message : "KV分析失败");
    } finally {
      setIsAnalyzingKv(false);
    }
  }

  function handleReusePrompt(nextPrompt?: string) {
    if (!nextPrompt) return;
    setPrompt(nextPrompt);
  }

  async function handleDeleteImage(filePath: string) {
    const confirmed = window.confirm("确认删除这张图片吗？");
    if (!confirmed) return;
    const result = await deleteDirectHistoryItemAction(filePath);
    if (!result.success) {
      window.alert(result.error || "删除失败");
      return;
    }
    setHistoryImages((current) => (current ?? []).filter((item) => item.filePath !== filePath));
    setState((current) => ({
      ...current,
      images: current.images?.filter((item) => item.filePath !== filePath),
    }));
  }

  async function handleDeleteFailedTask(taskId: string) {
    const confirmed = window.confirm("确认删除这条失败任务吗？");
    if (!confirmed) return;
    if (taskId.startsWith("failed-") || taskId.startsWith("local-")) {
      setPendingCards((current) => current.filter((card) => card.taskId !== taskId));
      setActiveTaskIds((current) => current.filter((id) => id !== taskId));
      return;
    }
    const result = await deleteDirectGenerateTaskAction(taskId);
    if (!result.success) {
      window.alert(result.error || "删除失败");
      return;
    }
    setPendingCards((current) => current.filter((card) => card.taskId !== taskId));
    setActiveTaskIds((current) => current.filter((id) => id !== taskId));
  }

  async function handleRetryFailedTask(taskId: string) {
    const task = await retryDirectGenerateTaskAction(taskId);
    void refreshUserOverview();
    if (task.status === "failed" || !task.taskId) {
      setState(taskToGenerateState(task));
      return;
    }

    setState({});
    setPendingCards((current) => {
      const filtered = current.filter((card) => card.taskId !== taskId);
      return [
        {
          taskId: task.taskId as string,
          startedAt: task.createdAt ?? Date.now(),
          size: task.submitted?.size || "1024x1024",
          status: "running",
        },
        ...filtered,
      ];
    });
    setActiveTaskIds((current) => [...current.filter((id) => id !== taskId), task.taskId as string]);
  }

  async function submitGenerateFormData(formData: FormData) {
    setState({});
    setSubmitMessage("");
    setIsSubmitting(true);

    formData.delete("sourceImagePaths");
    referenceItems
      .filter((item) => item.sourcePath)
      .forEach((item) => formData.append("sourceImagePaths", item.sourcePath as string));
    const submittedSize = formData.get("size")?.toString() || size;
    const localTaskId = `local-${Date.now()}`;

    setPendingCards((current) => [
      {
        taskId: localTaskId,
        startedAt: Date.now(),
        size: submittedSize,
        status: "running",
        isLocal: true,
      },
      ...current,
    ]);
    window.setTimeout(() => {
      resultPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);

    let response: Response;
    try {
      response = await fetch("/api/direct-generate/start", {
        method: "POST",
        body: formData,
      });
    } catch {
      setIsSubmitting(false);
      setSubmitMessage("提交失败，请检查网络后重试");
      setPendingCards((current) => [
        {
          taskId: `failed-${Date.now()}`,
          startedAt: Date.now(),
          size: submittedSize,
          status: "failed",
          error: "提交失败，请检查网络后重试",
        },
        ...current.filter((card) => card.taskId !== localTaskId),
      ]);
      return;
    }

    let task: DirectGenerateTaskState;
    try {
      task = (await response.json()) as DirectGenerateTaskState;
    } catch {
      setIsSubmitting(false);
      setSubmitMessage("服务返回异常，请稍后重试");
      setPendingCards((current) => [
        {
          taskId: `failed-${Date.now()}`,
          startedAt: Date.now(),
          size: submittedSize,
          status: "failed",
          error: "服务返回异常，请稍后重试",
        },
        ...current.filter((card) => card.taskId !== localTaskId),
      ]);
      return;
    }

    setIsSubmitting(false);
    setSubmitMessage("已提交，正在生成");
    void refreshUserOverview();

    if (!response.ok || task.status === "failed" || !task.taskId) {
      setState(taskToGenerateState(task));
      setSubmitMessage(task.error || "生成失败");
      setPendingCards((current) => [
        {
          taskId: task.taskId || `failed-${Date.now()}`,
          startedAt: task.createdAt ?? Date.now(),
          size: submittedSize,
          status: "failed",
          error: task.error || "生成失败",
        },
        ...current.filter((card) => card.taskId !== localTaskId),
      ]);
      return;
    }

    setState({});
    setPendingCards((current) =>
      current.map((card) =>
        card.taskId === localTaskId
          ? {
              taskId: task.taskId as string,
              startedAt: Date.now(),
              size: submittedSize,
              status: "running",
            }
          : card,
      ),
    );
    setActiveTaskIds((current) => [...current, task.taskId as string]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const baseFormData = new FormData(event.currentTarget);

    if (isKvMode) {
      if (!selectedKvPlans.length) {
        setSubmitMessage("请先分析生成KV提示词，再提交队列");
        return;
      }

      for (const plan of selectedKvPlans) {
        const formData = new FormData(event.currentTarget);
        formData.set("prompt", plan.prompt);
        formData.set("size", "1024x1792");
        formData.set("generationStyle", "kv");
        await submitGenerateFormData(formData);
      }
      setSubmitMessage(`已提交 ${selectedKvPlans.length} 个KV场景到队列`);
      return;
    }

    await submitGenerateFormData(baseFormData);
  }

  const galleryImages: GalleryItem[] = historyImages?.length ? historyImages : [];
  const filteredImages = galleryImages.filter((image) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const searchable = `${image.prompt ?? ""} ${image.size ?? ""} ${image.width}x${image.height}`.toLowerCase();
    return searchable.includes(query);
  });
  const runningPendingCards = pendingCards.filter((card) => card.status === "running");
  const failedPendingCards = pendingCards.filter((card) => card.status === "failed");
  const galleryColumns = useMemo(() => {
    const columns = Array.from({ length: galleryColumnCount }, () => [] as GalleryItem[]);
    const columnHeights = Array.from({ length: galleryColumnCount }, () => 0);

    filteredImages.forEach((image) => {
      const targetColumn = columnHeights.indexOf(Math.min(...columnHeights));
      columns[targetColumn].push(image);
      columnHeights[targetColumn] += 1 / getImageDisplayRatioValue(image);
    });

    return columns;
  }, [filteredImages, galleryColumnCount]);

  return (
    <main className={`new-home-page ${isKvMode ? "kv-page" : ""}`}>
      <section className="new-home-shell">
        <header className="new-home-topbar">
          <div className="new-home-topmeta">
            <div className="new-home-brand-wrap">
              <p className="new-home-brand-pill">
                <Link href="/" className="new-home-brand-link" aria-label="回到 Hemora 首页">Hemora</Link>
                <strong>{isKvMode ? "KV STUDIO" : "IMAGE STUDIO"}</strong>
              </p>
            </div>
          </div>

          <div className="new-home-keybox">
            <div className="new-home-userbox">
              <a href="/credits" className="new-home-profile-link" aria-label="账户中心">
                <span className="new-home-user-avatar">{userOverview.displayName.slice(0, 1).toUpperCase()}</span>
                <span className="new-home-user-name">{userOverview.displayName}</span>
              </a>
              <strong>{userOverview.balance} 积分</strong>
              {userOverview.role === "ADMIN" ? (
                <a href="/admin/users" className="new-home-admin-link">用户</a>
              ) : null}
            </div>
          </div>
        </header>

        <section className="new-home-workspace">
          <form className="new-home-form-panel" onSubmit={(event) => void handleSubmit(event)}>
            <div className="new-home-panel-head">
              <div>
                <p className="new-home-panel-kicker">{isKvMode ? "AGENT INPUT" : "INPUT"}</p>
                <h2 className="new-home-panel-title">{isKvMode ? "电商KV" : "直接生成"}</h2>
              </div>
              {isKvMode ? <a href="/studio" className="new-home-mode-link">普通生成</a> : <a href="/kv" className="new-home-mode-link">KV入口</a>}
            </div>

            {isKvMode ? (
              <>
                <section className="kv-agent-step">
                  <p><span />01 商品上传</p>
                  <label className="kv-upload-tile" htmlFor="new-home-source-image">
                    <strong>上传商品图</strong>
                    <em>3~10 张商品/包装图</em>
                  </label>
                  <input
                    ref={fileInputRef}
                    id="new-home-source-image"
                    name="sourceImages"
                    type="file"
                    accept="image/png,image/jpeg"
                    multiple
                    className="direct-file-input"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      appendReferenceFiles(files);
                    }}
                  />
                </section>

                {referenceItems.length ? (
                  <section className="new-home-reference-bar">
                    <div className="new-home-reference-list">
                      {referenceItems.map((item) => (
                        <div key={item.id} className="new-home-reference-chip">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.previewUrl} alt={item.label} width={40} height={40} className="new-home-reference-thumb" />
                          <span>{item.label}</span>
                          <button type="button" onClick={() => removeReferenceItem(item.id)}>
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="kv-agent-step">
                  <p><span />02 商品信息 <b>选填</b></p>
                  <div className="kv-info-row">
                    <input
                      value={kvBrand}
                      onChange={(event) => setKvBrand(event.target.value)}
                      placeholder="品牌名称"
                    />
                    <label className="kv-logo-upload" htmlFor="kv-logo-image">
                      Logo
                    </label>
                    <input
                      ref={logoInputRef}
                      id="kv-logo-image"
                      type="file"
                      accept="image/png,image/jpeg"
                      className="direct-file-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) applyLogoFile(file);
                      }}
                    />
                  </div>
                  {kvLogo ? <div className="kv-logo-name">{kvLogo.label}</div> : null}
                  <textarea
                    value={kvInfo}
                    onChange={(event) => setKvInfo(event.target.value)}
                    rows={4}
                    placeholder="核心卖点/参数"
                  />
                </section>

                <section className="kv-agent-step">
                  <div className="kv-step-head">
                    <p><span />03 场景规划</p>
                    <button type="button" onClick={selectAllKvScenes}>一键全选</button>
                  </div>
                  <div className="kv-scene-grid">
                    {KV_SCENES.map((scene) => {
                      const selected = selectedSceneIds.includes(scene.id);
                      return (
                        <button
                          key={scene.id}
                          type="button"
                          className={`kv-scene-card ${selected ? "selected" : ""}`}
                          onClick={() => toggleKvScene(scene.id)}
                        >
                          <strong>{scene.title}</strong>
                          <em>{scene.description}</em>
                          <span>{selected ? "✓" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="kv-agent-step">
                  <p><span />04 视觉与排版</p>
                  <label className="new-home-field">
                    <span>KV视觉风格</span>
                    <select value={kvVisualStyle} onChange={(event) => setKvVisualStyle(event.target.value)}>
                      <option>AI自动匹配</option>
                      <option>杂志编辑风格</option>
                      <option>水彩艺术风格</option>
                      <option>科技未来风格</option>
                      <option>复古胶片风格</option>
                      <option>极简北欧风格</option>
                      <option>霓虹赛博风格</option>
                      <option>自然有机风格</option>
                    </select>
                  </label>
                  <label className="new-home-field">
                    <span>排版细节</span>
                    <select value={kvTypography} onChange={(event) => setKvTypography(event.target.value)}>
                      <option>AI自动匹配</option>
                      <option>粗衬线大标题 + 细线装饰 + 网格对齐</option>
                      <option>玻璃拟态卡片 + 半透明背景 + 柔和圆角</option>
                      <option>3D浮雕文字 + 金属质感 + 光影效果</option>
                      <option>手写体标注 + 水彩笔触 + 不规则布局</option>
                      <option>无衬线粗体 + 霓虹描边 + 发光效果</option>
                      <option>极细线条字 + 大量留白 + 精确对齐</option>
                    </select>
                  </label>
                  <label className="new-home-field">
                    <span>补充要求</span>
                    <textarea
                      name="prompt"
                      rows={4}
                      placeholder="可写模特、场景、平台、必须包含对比图等要求"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                    />
                  </label>
                </section>

                {kvReport ? <pre className="kv-report">{kvReport}</pre> : null}
                {kvPlans.length ? (
                  <div className="kv-plan-list">
                    {kvPlans.map((plan) => (
                      <button key={plan.sceneId} type="button" onClick={() => setPrompt(plan.prompt)}>
                        {plan.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <label className="new-home-field">
                  <span>提示词</span>
                  <textarea
                    name="prompt"
                    rows={8}
                    placeholder="描述你想要的画面"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                  />
                </label>

                <div className="new-home-field">
                  <span>参考图</span>
                  <label className="new-home-dropzone" htmlFor="new-home-source-image">
                    <strong>拖拽图片到这里，或点击上传</strong>
                    <em>支持多张参考图</em>
                  </label>
                  <input
                    ref={fileInputRef}
                    id="new-home-source-image"
                    name="sourceImages"
                    type="file"
                    accept="image/png,image/jpeg"
                    multiple
                    className="direct-file-input"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      appendReferenceFiles(files);
                    }}
                  />
                </div>

                {referenceItems.length ? (
                  <section className="new-home-reference-bar">
                    <div className="new-home-reference-list">
                      {referenceItems.map((item) => (
                        <div key={item.id} className="new-home-reference-chip">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.previewUrl} alt={item.label} width={40} height={40} className="new-home-reference-thumb" />
                          <span>{item.label}</span>
                          <button type="button" onClick={() => removeReferenceItem(item.id)}>
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            )}

            <div className="new-home-form-footer">
              <div className="new-home-field new-home-size-field">
                <span>尺寸</span>
                <input type="hidden" name="size" value={size} readOnly />
                <div className="new-home-size-options" role="radiogroup" aria-label="生成尺寸">
                  {SIZE_OPTIONS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role="radio"
                      className={`new-home-size-option ${size === item.label ? "selected" : ""}`}
                      aria-checked={size === item.label}
                      onClick={() => setSize(item.label)}
                      >
                      <i
                        className="new-home-size-preview"
                        style={getSizePreviewStyle(item.label)}
                        aria-hidden="true"
                      />
                      <strong>{item.displayName}</strong>
                    </button>
                  ))}
                </div>
              </div>

              {isKvMode ? (
                <button
                  type="button"
                  className="new-home-agent-button"
                  onClick={() => void analyzeKvAgent()}
                  disabled={isAnalyzingKv || isSubmitting}
                >
                  {isAnalyzingKv ? "分析中..." : "分析生成提示词"}
                </button>
              ) : null}
              <button
                className="new-home-generate"
                type="submit"
                disabled={isSubmitting || (isKvMode ? !selectedKvPlans.length : prompt.trim().length < 8)}
              >
                {isSubmitting ? "提交中..." : isKvMode ? `提交 ${selectedKvPlans.length || selectedSceneIds.length} 个场景到队列` : "立即生成"}
              </button>
              {submitMessage ? <p className="new-home-submit-hint">{submitMessage}</p> : null}
            </div>
          </form>

          <section ref={resultPanelRef} className="new-home-result-panel">
            <div className="new-home-panel-head">
              <div>
                <p className="new-home-panel-kicker">{isKvMode ? "QUEUE OUTPUT" : "RESULT"}</p>
                <h2 className="new-home-panel-title">{isKvMode ? "KV队列" : "生成结果"}</h2>
              </div>
              <div className="new-home-history-pill">
                <span>HISTORY</span>
                <strong>{galleryImages.length} items</strong>
              </div>
            </div>

            <div className="new-home-panel-toolbar">
              <input
                className="new-home-search-input"
                placeholder={isKvMode ? "搜索KV历史图片" : "搜索历史图片"}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <Notice type="error" message={state.error} />
            <Notice type="success" message={state.success} />

            <section className="new-home-gallery" style={{ "--gallery-columns": galleryColumnCount } as CSSProperties}>
              {runningPendingCards.map((pendingCard) => {
                return (
                  <article key={pendingCard.taskId} className={`new-home-history-card pending ${pendingCard.status === "failed" ? "failed" : ""}`}>
                    <div
                      className="new-home-thumb-wrap"
                      style={{ aspectRatio: getDisplayAspectRatio(pendingCard.size) }}
                    >
                      <div className="new-home-pending-surface">
                        {pendingCard.status === "running" ? (
                          <div className="new-home-pending-breath" aria-label="生成中">
                            <span className="new-home-pending-glow" />
                            <span className="new-home-pending-glow new-home-pending-glow-soft" />
                            {PENDING_PARTICLES.map((particle, index) => (
                              <span
                                key={`${pendingCard.taskId}-${index}`}
                                className="new-home-pending-particle"
                                style={
                                  {
                                    "--particle-x": `${particle.x}px`,
                                    "--particle-y": `${particle.y}px`,
                                    "--particle-size": `${particle.size}px`,
                                    "--particle-delay": `${particle.delay}s`,
                                  } as CSSProperties
                                }
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="new-home-pending-time">失败</span>
                        )}
                        {pendingCard.status === "failed" ? (
                          <>
                            <p className="new-home-pending-error">{pendingCard.error || "生成失败"}</p>
                            <div className="new-home-history-actions new-home-pending-actions">
                              <button
                                type="button"
                                className="new-home-card-action"
                                onClick={() => void handleRetryFailedTask(pendingCard.taskId)}
                                aria-label="重试"
                                title="重试"
                              >
                                <span aria-hidden="true">↻</span>
                              </button>
                              <button
                                type="button"
                                className="new-home-card-action"
                                onClick={() => void handleDeleteFailedTask(pendingCard.taskId)}
                                aria-label="删除"
                                title="删除"
                              >
                                <span aria-hidden="true">⌫</span>
                              </button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}

              {filteredImages.length ? (
                <div className="new-home-gallery-columns">
                  {galleryColumns.map((column, columnIndex) => (
                    <div key={`gallery-column-${columnIndex}`} className="new-home-gallery-column">
                      {column.map((image, imageIndex) => {
                        const eagerIndex = columnIndex + imageIndex * galleryColumnCount;
                        return (
                          <article key={`${image.filePath}-${columnIndex}-${imageIndex}`} className="new-home-history-card">
                            <div
                              className="new-home-thumb-wrap"
                              style={{ aspectRatio: getImageDisplayAspectRatio(image) }}
                            >
                              <button
                                type="button"
                                className="new-home-history-thumb"
                                onClick={() => setLightboxImage(image)}
                              >
                                <Image
                                  src={image.filePath}
                                  alt="生成图片"
                                  width={image.width}
                                  height={image.height}
                                  className="new-home-image"
                                  unoptimized
                                  loading={eagerIndex < 6 ? "eager" : "lazy"}
                                />
                              </button>
                              <a
                                href={image.filePath}
                                download
                                className="new-home-card-download"
                                aria-label="下载"
                                title="下载"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <ActionIcon name="download" />
                              </a>
                              <div className="new-home-image-meta">
                                {image.createdAt ? <span>{formatHistoryDate(image.createdAt)}</span> : null}
                              </div>
                              <div className="new-home-history-body">
                                {image.prompt ? <p className="new-home-card-prompt">{image.prompt}</p> : null}
                                <div className="new-home-history-actions">
                                  <button
                                    type="button"
                                    className="new-home-card-action"
                                    onClick={() => handleReusePrompt(image.prompt)}
                                    aria-label="重试"
                                    title="重试"
                                  >
                                    <ActionIcon name="retry" />
                                  </button>
                                  <button
                                    type="button"
                                    className="new-home-card-action"
                                    onClick={() => handleReusePrompt(image.prompt)}
                                    aria-label="复用"
                                    title="复用"
                                  >
                                    <ActionIcon name="reuse" />
                                  </button>
                                  <button
                                    type="button"
                                    className="new-home-card-action"
                                    onClick={() => setImageAsReference(image.filePath)}
                                    aria-label="继续编辑"
                                    title="继续编辑"
                                  >
                                    <ActionIcon name="edit" />
                                  </button>
                                  <button
                                    type="button"
                                    className="new-home-card-action"
                                    onClick={() => void handleDeleteImage(image.filePath)}
                                    aria-label="删除"
                                    title="删除"
                                  >
                                    <ActionIcon name="delete" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                !runningPendingCards.length && !failedPendingCards.length ? <div className="new-home-empty">结果会出现在这里</div> : null
              )}

              {failedPendingCards.map((pendingCard) => {
                return (
                  <article key={pendingCard.taskId} className="new-home-history-card pending failed">
                    <div
                      className="new-home-thumb-wrap"
                      style={{ aspectRatio: getDisplayAspectRatio(pendingCard.size) }}
                    >
                      <div className="new-home-pending-surface">
                        <span className="new-home-pending-time">失败</span>
                        <p className="new-home-pending-error">{pendingCard.error || "生成失败"}</p>
                        <div className="new-home-history-actions new-home-pending-actions">
                          <button
                            type="button"
                            className="new-home-card-action"
                            onClick={() => void handleRetryFailedTask(pendingCard.taskId)}
                            aria-label="重试"
                            title="重试"
                          >
                            <span aria-hidden="true">↻</span>
                          </button>
                          <button
                            type="button"
                            className="new-home-card-action"
                            onClick={() => void handleDeleteFailedTask(pendingCard.taskId)}
                            aria-label="删除"
                            title="删除"
                          >
                            <span aria-hidden="true">⌫</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>

            {hasMoreHistory ? (
              <div className="new-home-status">
                <button type="button" className="new-home-more" onClick={() => void handleLoadMore()} disabled={historyLoading}>
                  {historyLoading ? "加载中..." : "显示更多"}
                </button>
              </div>
            ) : null}
          </section>
        </section>

        {lightboxImage ? (
          <div className="new-home-lightbox" role="dialog" aria-modal="true" onClick={() => setLightboxImage(null)}>
            <button
              type="button"
              className="new-home-lightbox-close"
              aria-label="关闭"
              title="关闭"
              onClick={() => setLightboxImage(null)}
            >
              ×
            </button>
            <a
              href={lightboxImage.filePath}
              download
              className="new-home-lightbox-download"
              aria-label="下载"
              title="下载"
              onClick={(event) => event.stopPropagation()}
            >
              D
            </a>
            <div className="new-home-lightbox-image-wrap" onClick={(event) => event.stopPropagation()}>
              <Image
                src={lightboxImage.filePath}
                alt="预览图片"
                width={lightboxImage.width}
                height={lightboxImage.height}
                className="new-home-lightbox-image"
                unoptimized
                priority
              />
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
