"use client";

import Script from "next/script";

type TurnstileWidgetProps = {
  siteKey: string;
};

export function TurnstileWidget({ siteKey }: TurnstileWidgetProps) {
  if (!siteKey) return null;

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <div className="turnstile-box">
        <div className="cf-turnstile" data-sitekey={siteKey} />
      </div>
    </>
  );
}
