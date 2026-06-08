import Image from "next/image";
import Link from "next/link";

import { getCurrentSession } from "@/lib/auth";

const HERO_IMAGE = "/hemora-ocean-masterpiece.png";

export default async function HomePage() {
  const session = await getCurrentSession();
  const studioHref = session ? "/studio" : "/auth/login?redirectTo=%2Fstudio";

  return (
    <main className="gallery-home">
      <nav className="gallery-nav" aria-label="主页导航">
        <Link href="/" className="gallery-logo">
          Hemora
        </Link>
        <div className="gallery-nav-actions">
          <Link href={studioHref}>登入</Link>
        </div>
      </nav>

      <section id="home" className="gallery-hero">
        <div className="gallery-side-copy gallery-side-copy-left">
          <h1>想 象</h1>
          <span />
          <p>AI 艺术创作</p>
        </div>

        <div className="gallery-art-stage" aria-label="AI 生成作品展示">
          <div className="gallery-frame">
            <div className="gallery-frame-inner">
              <Image
                src={HERO_IMAGE}
                alt="AI 生成的印象派海平线画作"
                width={1680}
                height={960}
                priority
                className="gallery-hero-image"
              />
            </div>
          </div>
        </div>

        <div className="gallery-side-copy gallery-side-copy-right">
          <h2>成 画</h2>
          <span />
          <p>从想象到画面</p>
        </div>
      </section>
    </main>
  );
}
