import Image from "next/image";
import Link from "next/link";

import { getCurrentSession } from "@/lib/auth";

const HERO_IMAGE = "/hemora-ocean-masterpiece.png";

export default async function HomePage() {
  const session = await getCurrentSession();
  const studioHref = session ? "/studio" : "/auth/login?redirectTo=%2Fstudio";
  const kvHref = session ? "/kv" : "/auth/login?redirectTo=%2Fkv";

  return (
    <main className="gallery-home">
      <nav className="gallery-nav" aria-label="主页导航">
        <Link href="/" className="gallery-logo">
          Hemora
        </Link>
        <div className="gallery-nav-actions">
          <a href="#explore">探索</a>
          <Link href={kvHref}>KV工具</Link>
          <Link href={session ? "/studio" : "/auth/login?redirectTo=%2Fstudio"}>登录</Link>
          <button type="button" className="gallery-menu-button" aria-label="菜单">
            <span />
            <span />
          </button>
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

      <a href="#explore" className="gallery-scroll-cue" aria-label="向下探索">
        ↓
      </a>

      <section id="explore" className="gallery-feature-strip" aria-label="平台能力">
        <div>
          <span>01</span>
          <strong>生成</strong>
          <p>一句话成图</p>
        </div>
        <div>
          <span>02</span>
          <strong>控制</strong>
          <p>尺寸与参考图可调</p>
        </div>
        <div>
          <span>03</span>
          <strong>私密</strong>
          <p>作品归你所有</p>
        </div>
        <div>
          <span>04</span>
          <strong>KV</strong>
          <p>生成电商海报提示词</p>
        </div>
      </section>

      <section id="works" className="gallery-showcase">
        <div>
          <p className="gallery-section-kicker">WORKS</p>
          <h2>从商业图到私人灵感，都可以直接生成。</h2>
        </div>
        <div className="gallery-work-grid">
          <Image src="/generated/direct-1780279814682-ylduq0r9-1.png" alt="护肤品生成图" width={1024} height={1024} />
          <Image src="/generated/direct-1780330465851-6ldlsvse-1.png" alt="春日海报生成图" width={1024} height={1536} />
          <Image src="/generated/direct-1780293433467-wxjwl4yq-1.png" alt="风景生成图" width={1024} height={1024} />
        </div>
      </section>

      <section id="pricing" className="gallery-pricing">
        <p>按积分使用，登录后即可查看余额、历史记录和生成任务。</p>
        <div className="gallery-pricing-actions">
          <Link href={studioHref}>进入工作台</Link>
          <Link href={kvHref} className="gallery-pricing-secondary">
            KV生成入口
          </Link>
        </div>
      </section>
    </main>
  );
}
