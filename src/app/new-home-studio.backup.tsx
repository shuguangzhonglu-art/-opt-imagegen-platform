"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { Notice } from "@/components/notice";
import { parseSizes } from "@/lib/config";
import {
  deleteDirectHistoryItemAction,
  getDirectHistoryAction,
  type DirectGenerateState,
} from "@/lib/actions/user-actions";
import type { DirectGenerateTaskState } from "@/lib/services/direct-tasks";

const STORAGE_KEY = "direct-image-generator-api-key";
const SIZE_STORAGE_KEY = "direct-image-generator-size";
const SIZE_OPTIONS = parseSizes("1024x1024:0,1024x1536:0,1536x1024:0,1024x1792:0,1792x1024:0");
const HISTORY_PAGE_SIZE = 12;

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

type ReferenceItem = {
  id: string;
  label: string;
  previewUrl: string;
  sourcePath?: string;
  file?: File;
};

const DEMO_IMAGES: GalleryItem[] = [
  {
    filePath: "/generated/demo/placeholder-1.svg",
    width: 1024,
    height: 1024,
    prompt: "A soft editorial portrait with delicate natural light and paper texture",
    size: "1024x1024",
    createdAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
  },
  {
    filePath: "/generated/demo/placeholder-2.svg",
    width: 1024,
    height: 1536,
    prompt: "Minimal product photo of a ceramic perfume bottle on warm stone",
    size: "1024x1536",
    createdAt: new Date(Date.now() - 56 * 60 * 1000).toISOString(),
  },
  {
    filePath: "/generated/demo/placeholder-3.svg",
    width: 1536,
    height: 1024,
    prompt: "Quiet modern living room with cream fabric, wood, shadow, and depth",
    size: "1536x1024",
    createdAt: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString(),
  },
  {
    filePath: "/generated/demo/placeholder-4.svg",
    width: 1024,
    height: 1024,
    prompt: "Fashion campaign close-up, translucent makeup, glossy lips, muted beige",
    size: "1024x1024",
    createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
  },
  {
    filePath: "/generated/demo/placeholder-5.svg",
    width: 1024,
    height: 1536,
    prompt: "A botanical still life with floating petals, glass, and morning mist",
    size: "1024x1536",
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  },
  {
    filePath: "/generated/demo/placeholder-6.svg",
    width: 1536,
    height: 1024,
    prompt: "An elegant cafe facade in Tokyo, framed symmetrically after rain",
    size: "1536x1024",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export function NewHomeStudio() {
  const [state, setState] = useState<DirectGenerateState>({});
  const [pending, setPending] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState(readStoredApiKey);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [size, setSize] = useState(readStoredSize);
  const [prompt, setPrompt] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [referenceItems, setReferenceItems] = useState<ReferenceItem[]>([]);
  const [historyImages, setHistoryImages] = useState<DirectGenerateState["history"]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<GalleryItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        }
        return;
      }

      setHistoryLoading(true);
      const history = await getDirectHistoryAction(normalizedKey, {
        offset: 0,
        limit: HISTORY_PAGE_SIZE,
      });

      if (!cancelled) {
        setHistoryImages(history);
        setHasMoreHistory(history.length === HISTORY_PAGE_SIZE);
        setHistoryLoading(false);
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    if (!activeTaskId) return;

    let cancelled = false;
    const taskId = activeTaskId;

    async function pollTask() {
      const response = await fetch(`/api/direct-generate/status?taskId=${encodeURIComponent(taskId)}`);
      const task = (await response.json()) as DirectGenerateTaskState;
      if (cancelled) return;

      if (task.status === "succeeded" || task.status === "failed") {
        setPending(false);
        setActiveTaskId(null);
        setState(taskToGenerateState(task));
        if (task.history) {
          setHistoryImages(task.history);
          setHasMoreHistory(task.history.length === HISTORY_PAGE_SIZE);
        }
        return;
      }

      window.setTimeout(() => {
        if (!cancelled) void pollTask();
      }, 2500);
    }

    void pollTask();

    return () => {
      cancelled = true;
    };
  }, [activeTaskId]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setState({});

    const formData = new FormData(event.currentTarget);
    formData.delete("sourceImagePaths");
    referenceItems
      .filter((item) => item.sourcePath)
      .forEach((item) => formData.append("sourceImagePaths", item.sourcePath as string));
    const response = await fetch("/api/direct-generate/start", {
      method: "POST",
      body: formData,
    });
    const task = (await response.json()) as DirectGenerateTaskState;

    if (!response.ok || task.status === "failed" || !task.taskId) {
      setPending(false);
      setState(taskToGenerateState(task));
      return;
    }

    setActiveTaskId(task.taskId);
  }

  const galleryImages: GalleryItem[] = state.images?.length
    ? state.images.map((image) => ({
        ...image,
        prompt: state.submitted?.prompt,
        size: state.submitted?.size,
      }))
    : (historyImages?.length ? historyImages : DEMO_IMAGES);
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
                <strong>by GPT-IMAGE-2.0</strong>
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

        <section className="new-home-toolbar">
          <button type="button" className="new-home-pill">
            RESULT
          </button>
          <input
            className="new-home-search-input"
            placeholder="搜索历史图片"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <div className="new-home-history-pill">
            <span>HISTORY</span>
            <strong>{galleryImages.length} items</strong>
          </div>
        </section>

        <section className="new-home-gallery">
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
            <div className="new-home-empty">No matching tasks</div>
          )}
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
                priority
              />
            </div>
          </div>
        ) : null}

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

        <section className="new-home-status">
          <Notice type="error" message={state.error} />
          <Notice type="success" message={state.success} />
          {pending ? <p className="new-home-note">生成中...</p> : null}
          {pending && state.elapsedMs ? <p className="new-home-note">已生成 {Math.round(state.elapsedMs / 1000)} 秒</p> : null}
          {hasMoreHistory ? (
            <button type="button" className="new-home-more" onClick={() => void handleLoadMore()} disabled={historyLoading}>
              {historyLoading ? "加载中..." : "显示更多"}
            </button>
          ) : null}
        </section>

        <form className="new-home-composer" onSubmit={(event) => void handleSubmit(event)}>
          <input name="apiKey" type="hidden" value={apiKey} readOnly />

          <div className="new-home-composer-main">
            <textarea
              name="prompt"
              rows={2}
              placeholder="Ask anything or drop an image to continue editing"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />

            <div className="new-home-composer-side">
              <label className="new-home-attach" htmlFor="new-home-source-image">
                + Image
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
          </div>

          <div className="new-home-composer-footer">
            <div className="new-home-controls">
              <label>
                <span>size</span>
                <select name="size" value={size} onChange={(event) => setSize(event.target.value)}>
                  {SIZE_OPTIONS.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button className="new-home-submit" type="submit" disabled={pending || apiKey.trim().length < 10 || prompt.trim().length < 8}>
              {pending ? "Generating..." : "Send"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
