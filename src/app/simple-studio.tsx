"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { Notice } from "@/components/notice";
import { parseSizes } from "@/lib/config";
import {
  type DirectGenerateState,
  getDirectHistoryAction,
} from "@/lib/actions/user-actions";
import type { DirectGenerateTaskState } from "@/lib/services/direct-tasks";

const initialState: DirectGenerateState = {};
const STORAGE_KEY = "direct-image-generator-api-key";
const SIZE_STORAGE_KEY = "direct-image-generator-size";
const SIZE_OPTIONS = parseSizes("1024x1024:0,1024x1536:0,1536x1024:0,1024x1792:0,1792x1024:0");
const HISTORY_PAGE_SIZE = 12;

function readStoredApiKey() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return "";
  }
}

function readStoredSize() {
  if (typeof window === "undefined") {
    return "1024x1024";
  }

  try {
    return window.localStorage.getItem(SIZE_STORAGE_KEY) || "1024x1024";
  } catch {
    window.localStorage.removeItem(SIZE_STORAGE_KEY);
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

export function DirectStudio() {
  const [state, setState] = useState<DirectGenerateState>(initialState);
  const [pending, setPending] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState(readStoredApiKey);
  const [size, setSize] = useState(readStoredSize);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);
  const [referenceSourcePath, setReferenceSourcePath] = useState<string | null>(null);
  const [referenceLabel, setReferenceLabel] = useState<string>("");
  const [dragActive, setDragActive] = useState(false);
  const [historyImages, setHistoryImages] = useState<DirectGenerateState["history"]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, apiKey);
  }, [apiKey]);

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
      const history = await getDirectHistoryAction({
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

  const displayedHistory = state.history ?? historyImages;
  const displayedHasMoreHistory = state.history
    ? state.history.length === HISTORY_PAGE_SIZE
    : hasMoreHistory;
  const activeReferenceSourcePath = referenceSourcePath;

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
        if (!cancelled) {
          void pollTask();
        }
      }, 2500);
    }

    void pollTask();

    return () => {
      cancelled = true;
    };
  }, [activeTaskId]);

  useEffect(() => {
    return () => {
      if (referencePreviewUrl) {
        URL.revokeObjectURL(referencePreviewUrl);
      }
    };
  }, [referencePreviewUrl]);

  async function handleLoadMore() {
    const normalizedKey = apiKey.trim();
    if (normalizedKey.length < 10 || historyLoading) {
      return;
    }

    setHistoryLoading(true);
    const nextBatch = await getDirectHistoryAction({
      offset: displayedHistory?.length ?? 0,
      limit: HISTORY_PAGE_SIZE,
    });

    setHistoryImages((current) => [...(current ?? []), ...nextBatch]);
    setHasMoreHistory(nextBatch.length === HISTORY_PAGE_SIZE);
    setHistoryLoading(false);
  }

  function applyReferenceFile(file: File) {
    if (referencePreviewUrl) {
      URL.revokeObjectURL(referencePreviewUrl);
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    if (fileInputRef.current) {
      fileInputRef.current.files = dataTransfer.files;
    }

    setReferenceSourcePath(null);
    setReferenceLabel(file.name);
    setReferencePreviewUrl(URL.createObjectURL(file));
  }

  function selectGeneratedImageAsReference(filePath: string) {
    if (referencePreviewUrl) {
      URL.revokeObjectURL(referencePreviewUrl);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setReferenceSourcePath(filePath);
    setReferenceLabel("已选择生成图作为参考图");
    setReferencePreviewUrl(filePath);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setPending(true);
    setState({});

    const formData = new FormData(event.currentTarget);
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
    setState(taskToGenerateState(task));
  }

  return (
    <main className="direct-page">
      <section className="direct-shell">
        <div className="direct-copy">
          <div className="direct-marquee">
            <span>HEMA API</span>
            <span>IMAGE</span>
            <span>BYOK</span>
            <span>GPT-IMAGE-2.0</span>
          </div>
          <p className="direct-kicker">hema API image</p>
          <h1>hema API 图片生成</h1>
        </div>

        <div className="direct-grid">
          <form
            className="direct-form"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <label>
              <span>API Key</span>
              <input
                name="apiKey"
                type="password"
                placeholder="sk-..."
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                required
              />
            </label>

            <input name="sourceImagePath" type="hidden" value={activeReferenceSourcePath ?? ""} />

            <label className="direct-dropzone-label">
              <span>参考图（可选）</span>
              <div
                className={`direct-dropzone ${dragActive ? "is-dragging" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) {
                    applyReferenceFile(file);
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  name="sourceImage"
                  type="file"
                  accept="image/png,image/jpeg"
                  className="direct-file-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      setReferencePreviewUrl(null);
                      setReferenceSourcePath(null);
                      setReferenceLabel("");
                      return;
                    }
                    applyReferenceFile(file);
                  }}
                />
                <p className="direct-dropzone-title">拖拽图片到这里，或点击上传</p>
                {referenceLabel ? <p className="direct-dropzone-meta">{referenceLabel}</p> : null}
              </div>
            </label>

            <label>
              <span>提示词</span>
              <textarea
                name="prompt"
                rows={8}
                placeholder="例如：cinematic portrait of a woman in a red silk dress, dramatic studio lighting, ultra detailed"
                defaultValue={state.submitted?.prompt ?? ""}
                required
              />
            </label>

            <label>
              <span>尺寸</span>
              <select name="size" value={size} onChange={(event) => setSize(event.target.value)}>
                {SIZE_OPTIONS.map((size) => (
                  <option key={size.label} value={size.label}>
                    {size.displayName} · {size.label}
                  </option>
                ))}
              </select>
            </label>

            <button className="direct-submit" type="submit" disabled={pending}>
              {pending ? "生成中..." : "立即生成"}
            </button>
          </form>

          <section className="direct-result">
            <div className="result-head">
              <div>
                <p className="direct-kicker">Result</p>
                <h2>生成结果</h2>
              </div>
              <div className="direct-block direct-block-lilac result-badge">
                <p className="direct-block-tag">History</p>
                <p>{displayedHistory?.length ? `${displayedHistory.length} items` : "Ready"}</p>
              </div>
            </div>

            <Notice type="error" message={state.error} />
            <Notice type="success" message={state.success} />
            <Notice type="success" message={state.warning} />

            {pending ? <p className="direct-note">生成中...</p> : null}

            {state.elapsedMs ? (
              <p className="direct-note">本次耗时 {Math.round(state.elapsedMs / 1000)} 秒</p>
            ) : null}

            {referencePreviewUrl ? (
              <div className="source-preview-card">
                <p className="direct-kicker">Reference</p>
                <div className="source-preview-wrap">
                  <Image
                    src={referencePreviewUrl}
                    alt="参考图"
                    width={512}
                    height={512}
                    className="result-image"
                  />
                </div>
                <button
                  type="button"
                  className="result-link-button"
                  onClick={() => {
                    if (referencePreviewUrl) {
                      URL.revokeObjectURL(referencePreviewUrl);
                    }
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                    setReferencePreviewUrl(null);
                    setReferenceSourcePath(null);
                    setReferenceLabel("");
                  }}
                >
                  清除参考图
                </button>
              </div>
            ) : null}

            {state.images?.length ? (
              <div className="result-grid">
                {state.images.map((image) => (
                  <article key={image.filePath} className="result-card">
                    <button
                      type="button"
                      className="result-image-button"
                      onClick={() => selectGeneratedImageAsReference(image.filePath)}
                    >
                      <div className="result-image-wrap">
                        <Image
                          src={image.filePath}
                          alt="生成结果"
                          width={image.width}
                          height={image.height}
                          className="result-image"
                        />
                      </div>
                    </button>
                    <button
                      type="button"
                      className="result-link-button"
                      onClick={() => selectGeneratedImageAsReference(image.filePath)}
                    >
                      作为参考图继续编辑
                    </button>
                    <a href={image.filePath} target="_blank" rel="noreferrer" className="result-link">
                      打开原图
                    </a>
                  </article>
                ))}
              </div>
            ) : displayedHistory?.length ? (
              <>
                <div className="result-grid">
                  {displayedHistory.map((image) => (
                    <article key={`${image.filePath}-${image.createdAt}`} className="result-card">
                      <button
                        type="button"
                        className="result-image-button"
                        onClick={() => selectGeneratedImageAsReference(image.filePath)}
                      >
                        <div className="result-image-wrap">
                          <Image
                            src={image.filePath}
                            alt="历史生成结果"
                            width={image.width}
                            height={image.height}
                            className="result-image"
                          />
                        </div>
                      </button>
                      <p className="direct-note">{image.size}</p>
                      <p className="direct-note">{new Date(image.createdAt).toLocaleString()}</p>
                      <button
                        type="button"
                        className="result-link-button"
                        onClick={() => selectGeneratedImageAsReference(image.filePath)}
                      >
                        作为参考图继续编辑
                      </button>
                      <a href={image.filePath} target="_blank" rel="noreferrer" className="result-link">
                        打开原图
                      </a>
                    </article>
                  ))}
                </div>
                {displayedHasMoreHistory ? (
                  <button
                    type="button"
                    className="direct-submit"
                    onClick={() => void handleLoadMore()}
                    disabled={historyLoading}
                  >
                    {historyLoading ? "加载中..." : "显示更多"}
                  </button>
                ) : null}
              </>
            ) : (
              <div className="result-empty">
                <strong>结果会出现在这里</strong>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
