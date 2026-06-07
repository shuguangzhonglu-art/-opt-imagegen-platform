"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type ImageLightboxProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

export function ImageLightbox({ src, alt, width, height }: ImageLightboxProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button className="gallery-image-button" type="button" onClick={() => setOpen(true)} aria-label="查看原图">
        <Image src={src} alt={alt} className="gallery-image" width={width} height={height} />
      </button>

      {open ? (
        <div className="lightbox-backdrop" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <div className="lightbox-toolbar">
              <span aria-hidden="true" />
              <div className="inline-actions">
                <a className="ghost-button small" href={src} download>
                  下载原图
                </a>
                <button className="primary-button small" type="button" onClick={() => setOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
            <div className="lightbox-image-stage">
              <Image
                src={src}
                alt={alt}
                className="lightbox-image"
                width={width}
                height={height}
                priority
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
