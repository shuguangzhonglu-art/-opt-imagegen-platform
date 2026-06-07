"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { Notice } from "@/components/notice";
import { parseSizes } from "@/lib/config";
import {
  deleteDirectGenerateTaskAction,
  deleteDirectHistoryItemAction,
  getDirectHistoryAction,
  getDirectGenerateTasksByApiKeyAction,
  retryDirectGenerateTaskAction,
  type DirectGenerateState,
} from "@/lib/actions/user-actions";
import type { DirectGenerateTaskState } from "@/lib/services/direct-tasks";

const STORAGE_KEY = "direct-image-generator-api-key";
const SIZE_STORAGE_KEY = "direct-image-generator-size";
const SIZE_OPTIONS = parseSizes("1024x1024:0,1024x1536:0,1536x1024:0,1024x1792:0,1792x1024:0");
const HISTORY_PAGE_SIZE = 12;
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

function getSizeAspectRatio(size: string) {
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) return "1 / 1";
  return `${width} / ${height}`;
}

function readStoredApiKey() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
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

export function NewHomeStudio() {
  const [state, setState] = useState<DirectGenerateState>({});
  const [activeTaskIds, setActiveTaskIds] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [size, setSize] = useState("1024x1024");
  const [prompt, setPrompt] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [referenceItems, setReferenceItems] = useState<ReferenceItem[]>([]);
  const [historyImages, setHistoryImages] = useState<DirectGenerateState["history"]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<GalleryItem | null>(null);
  const [pendingCards, setPendingCards] = useState<PendingCard[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultPanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setApiKey(readStoredApiKey());
    setSize(readStoredSize());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIZE_STORAGE_KEY, size);
  }, [size]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      const normalizedKey = apiKey.trim();
      if (normalizedKey.length < 10) {
        if (!cancelled) {
          setHistoryImages([]);
          setHasMoreHistory(false);
          setPendingCards([]);
          setActiveTaskIds([]);
        }
        return;
      }

      setHistoryLoading(true);
      const [history, tasks] = await Promise.all([
        getDirectHistoryAction(normalizedKey, {
          offset: 0,
          limit: HISTORY_PAGE_SIZE,
        }),
        getDirectGenerateTasksByApiKeyAction(normalizedKey),
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
  }, [apiKey]);

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
        if (task.history) {
          setHistoryImages(task.history);
          setHasMoreHistory(task.history.length === HISTORY_PAGE_SIZE);
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
  }, [activeTaskIds]);

  useEffect(() => {
    return () => {
      referenceItems.forEach((item) => {
        if (item.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, [referenceItems]);

  async function handleLoadMore() {
    const normalizedKey = apiKey.trim();
    if (normalizedKey.length < 10 || historyLoading) return;

    setHistoryLoading(true);
    const nextBatch = await getDirectHistoryAction(normalizedKey, {
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

  function handleReusePrompt(nextPrompt?: string) {
    if (!nextPrompt) return;
    setPrompt(nextPrompt);
  }

  async function handleDeleteImage(filePath: string) {
    const confirmed = window.confirm("确认删除这张图片吗？");
    if (!confirmed) return;
    const result = await deleteDirectHistoryItemAction(apiKey, filePath);
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
    const result = await deleteDirectGenerateTaskAction(apiKey, taskId);
    if (!result.success) {
      window.alert(result.error || "删除失败");
      return;
    }
    setPendingCards((current) => current.filter((card) => card.taskId !== taskId));
    setActiveTaskIds((current) => current.filter((id) => id !== taskId));
  }

  async function handleRetryFailedTask(taskId: string) {
    const task = await retryDirectGenerateTaskAction(apiKey, taskId);
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({});
    setSubmitMessage("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
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

  const galleryImages: GalleryItem[] = historyImages?.length ? historyImages : [];
  const filteredImages = galleryImages.filter((image) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const searchable = `${image.prompt ?? ""} ${image.size ?? ""} ${image.width}x${image.height}`.toLowerCase();
    return searchable.includes(query);
  });

  function handleSaveApiKey() {
    window.localStorage.setItem(STORAGE_KEY, apiKey.trim());
    setApiKeySaved(true);
    window.setTimeout(() => setApiKeySaved(false), 1800);
  }

  return (
    <main className="new-home-page">
      <section className="new-home-shell">
        <header className="new-home-topbar">
          <div className="new-home-topmeta">
            <div className="new-home-brand-wrap">
              <p className="new-home-brand-pill">
                <span>hema API image</span>
                <strong>BY GPT-IMAGE-2.0</strong>
              </p>
            </div>
          </div>

          <div className="new-home-keybox">
            <span>API Key</span>
            <div className="new-home-keyrow">
              <input
                name="apiKeyMirror"
                type="password"
                placeholder="sk-..."
                autoComplete="off"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setApiKeySaved(false);
                }}
              />
              <button type="button" className="new-home-save-key" onClick={handleSaveApiKey} disabled={apiKey.trim().length < 10}>
                {apiKeySaved ? "Saved" : "Save"}
              </button>
            </div>
          </div>
        </header>

        <section className="new-home-workspace">
          <form className="new-home-form-panel" onSubmit={(event) => void handleSubmit(event)}>
            <div className="new-home-panel-head">
              <div>
                <p className="new-home-panel-kicker">INPUT</p>
                <h2 className="new-home-panel-title">直接生成</h2>
              </div>
            </div>

            <input name="apiKey" type="hidden" value={apiKey} readOnly />

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

            <div className="new-home-form-footer">
              <label className="new-home-field new-home-field-inline">
                <span>尺寸</span>
                <select name="size" value={size} onChange={(event) => setSize(event.target.value)}>
                  {SIZE_OPTIONS.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.displayName} · {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <button className="new-home-generate" type="submit" disabled={isSubmitting || apiKey.trim().length < 10 || prompt.trim().length < 8}>
                {isSubmitting ? "提交中..." : "立即生成"}
              </button>
              {submitMessage ? <p className="new-home-submit-hint">{submitMessage}</p> : null}
            </div>
          </form>

          <section ref={resultPanelRef} className="new-home-result-panel">
            <div className="new-home-panel-head">
              <div>
                <p className="new-home-panel-kicker">RESULT</p>
                <h2 className="new-home-panel-title">生成结果</h2>
              </div>
              <div className="new-home-history-pill">
                <span>HISTORY</span>
                <strong>{galleryImages.length} items</strong>
              </div>
            </div>

            <div className="new-home-panel-toolbar">
              <input
                className="new-home-search-input"
                placeholder="搜索历史图片"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <Notice type="error" message={state.error} />
            <Notice type="success" message={state.success} />

            <section className="new-home-gallery">
              {pendingCards.map((pendingCard) => {
                return (
                  <article key={pendingCard.taskId} className={`new-home-history-card pending ${pendingCard.status === "failed" ? "failed" : ""}`}>
                    <div
                      className="new-home-thumb-wrap"
                      style={{ aspectRatio: getSizeAspectRatio(pendingCard.size) }}
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
                                ↻
                              </button>
                              <button
                                type="button"
                                className="new-home-card-action"
                                onClick={() => void handleDeleteFailedTask(pendingCard.taskId)}
                                aria-label="删除"
                                title="删除"
                              >
                                🗑
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
                filteredImages.map((image, index) => (
                  <article key={`${image.filePath}-${index}`} className="new-home-history-card">
                    <div className="new-home-thumb-wrap">
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
                          loading={index < 6 ? "eager" : "lazy"}
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
                        ↓
                      </a>
                      <div className="new-home-history-body">
                        <div className="new-home-history-actions">
                          <button
                            type="button"
                            className="new-home-card-action"
                            onClick={() => handleReusePrompt(image.prompt)}
                            aria-label="重试"
                            title="重试"
                          >
                            ↻
                          </button>
                          <button
                            type="button"
                            className="new-home-card-action"
                            onClick={() => handleReusePrompt(image.prompt)}
                            aria-label="复用"
                            title="复用"
                          >
                            ↶
                          </button>
                          <button
                            type="button"
                            className="new-home-card-action"
                            onClick={() => setImageAsReference(image.filePath)}
                            aria-label="继续编辑"
                            title="继续编辑"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="new-home-card-action"
                            onClick={() => void handleDeleteImage(image.filePath)}
                            aria-label="删除"
                            title="删除"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="new-home-empty">结果会出现在这里</div>
              )}
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
              ↓
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
