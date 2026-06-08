"use client";

import { useMemo, useState } from "react";

import { updateRiskControlSettingsAction } from "@/lib/actions/admin-actions";
import type { RiskControlConfig } from "@/lib/services/risk-control";

type RiskControlSettingsProps = {
  config: RiskControlConfig;
};

export function RiskControlSettings({ config }: RiskControlSettingsProps) {
  const [open, setOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const keywordCount = useMemo(() => config.blockedKeywords.length, [config.blockedKeywords.length]);
  const inputKeyCount = useMemo(() => {
    return apiKeyInput
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean).length;
  }, [apiKeyInput]);

  return (
    <>
      <button className="primary-button compact risk-settings-button" type="button" onClick={() => setOpen(true)}>
        ⚙ 内容审计设置
      </button>
      {open ? (
        <div className="risk-modal-backdrop" role="dialog" aria-modal="true" aria-label="内容审计设置">
          <div className="risk-modal">
            <header className="risk-modal-head">
              <h2>内容审计设置</h2>
              <button className="icon-action risk-close" type="button" onClick={() => setOpen(false)} aria-label="关闭">
                ×
              </button>
            </header>

            <form action={updateRiskControlSettingsAction}>
              <nav className="risk-tabs" aria-label="内容审计配置">
                <span className="active">基础</span>
                <span>审计范围</span>
                <span>运行队列</span>
                <span>命中通知</span>
                <span>风险阈值</span>
                <span className="active">关键词拦截</span>
                <span>日志保留</span>
              </nav>

              <div className="risk-settings-grid">
                <label className="risk-toggle-card">
                  <span>
                    <strong>开启内容审计</strong>
                    <small>关闭后风控中心只保留配置，不会审核新请求。</small>
                  </span>
                  <input name="enabled" type="checkbox" defaultChecked={config.enabled} />
                </label>

                <label>
                  <span>全局模式</span>
                  <select name="mode" defaultValue={config.mode}>
                    <option value="PRE_BLOCK">前置拦截</option>
                    <option value="OBSERVE">仅观察记录</option>
                    <option value="OFF">关闭链路</option>
                  </select>
                  <small>每次请求先同步审核最新用户输入，命中后立即拒绝请求。</small>
                </label>

                <label>
                  <span>OpenAI Base URL</span>
                  <input name="baseUrl" type="url" defaultValue={config.baseUrl} />
                </label>

                <label>
                  <span>模型名</span>
                  <input name="model" type="text" defaultValue={config.model} />
                </label>

                <label>
                  <span>HTTP 超时 (ms)</span>
                  <input name="timeoutMs" type="number" min="100" defaultValue={config.timeoutMs} />
                </label>

                <label>
                  <span>失败重试次数</span>
                  <input name="retryCount" type="number" min="0" defaultValue={config.retryCount} />
                </label>

                <label>
                  <span>采样率</span>
                  <input name="sampleRate" type="number" min="0" max="100" defaultValue={config.sampleRate} />
                </label>

                <label>
                  <span>日志保留天数</span>
                  <input name="retentionDays" type="number" min="1" defaultValue={config.retentionDays} />
                </label>
              </div>

              <section className="risk-key-card">
                <div className="risk-key-head">
                  <div>
                    <h3>OpenAI API Keys</h3>
                    <p>当前已保存 {config.apiKeys.length} 个 Key；输入区只用于新增，保存后只显示 Key 尾号。</p>
                  </div>
                  <div className="toolbar-actions">
                    <button className="ghost-button compact" type="button" disabled>测试输入区 Key</button>
                    <button className="ghost-button compact" type="button" disabled>测试已保存 Key</button>
                  </div>
                </div>
                <div className="risk-key-grid">
                  <div>
                    <label className="risk-write-mode">
                      <span>写入方式</span>
                      <strong>增量添加</strong>
                    </label>
                    <textarea
                      name="apiKeys"
                      rows={6}
                      value={apiKeyInput}
                      onChange={(event) => setApiKeyInput(event.target.value)}
                      placeholder="新增 API Key，每行一个；保存后会追加到已保存 Key"
                    />
                    <span className="risk-mini-pill">输入区 {inputKeyCount} 个 Key</span>
                    <label className="risk-test-input">
                      <strong>审计试跑输入</strong>
                      <textarea rows={4} placeholder="输入要测试的用户提示词；留空时仅测试 Key 可用性。" />
                    </label>
                  </div>
                  <div className="risk-key-status">
                    <h4>Key 可用状态 <span>{config.apiKeys.length} 个 Key</span></h4>
                    <p>400 不冻结；401/403 冻结 10 分钟；429/529 冻结 1 分钟；其他 HTTP 错误冻结 10 秒。</p>
                    {config.apiKeys.length > 0 ? (
                      <div className="risk-saved-key-list">
                        {config.apiKeys.map((key, index) => (
                          <span key={`${key}-${index}`}>{key}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="risk-empty-box">
                        <strong>暂无 Key 状态</strong>
                        <small>保存 Key 或测试输入区 Key 后会显示可用性。</small>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="risk-keyword-card">
                <div className="risk-info-box">
                  <strong>关键词拦截仅在「前置拦截」模式下生效。</strong>
                  <span>匹配忽略大小写；命中后会按下方策略决定是否调用上游审计接口。</span>
                </div>
                <h3>审计策略</h3>
                <div className="risk-policy-grid">
                  <label className="risk-policy-card">
                    <input name="keywordStrategy" type="radio" value="KEYWORD_AND_API" defaultChecked={config.keywordStrategy === "KEYWORD_AND_API"} />
                    <strong>关键词 + API</strong>
                    <span>命中关键词直接拦截；未命中时再调用上游审计接口。</span>
                  </label>
                  <label className="risk-policy-card">
                    <input name="keywordStrategy" type="radio" value="KEYWORD_ONLY" defaultChecked={config.keywordStrategy === "KEYWORD_ONLY"} />
                    <strong>仅关键词</strong>
                    <span>只用关键词判断，未命中即放行，不调用上游审计接口，可显著降低 API 用量。</span>
                  </label>
                  <label className="risk-policy-card">
                    <input name="keywordStrategy" type="radio" value="API_ONLY" defaultChecked={config.keywordStrategy === "API_ONLY"} />
                    <strong>仅 API</strong>
                    <span>只调用上游审计接口判断，本页关键词列表不会生效。</span>
                  </label>
                </div>

                <div className="risk-keyword-title">
                  <h3>拦截关键词</h3>
                  <span>已配置 {keywordCount} 个关键词</span>
                </div>
                <textarea
                  name="blockedKeywords"
                  rows={8}
                  defaultValue={config.blockedKeywords.join("\n")}
                  placeholder={"每行输入一个关键词，例如：\n敏感词1\n敏感词2"}
                />
                <p className="risk-help">最多保存 10000 个关键词，单个长度不超过 200 个字符；重复项会自动去重。</p>
              </section>

              <section className="risk-key-card">
                <div className="risk-settings-grid full">
                  <label>
                    <span>拦截提示</span>
                    <textarea name="blockMessage" rows={4} defaultValue={config.blockMessage} />
                  </label>
                  <label className="risk-toggle-card inline">
                    <span>
                      <strong>命中通知</strong>
                      <small>保留来源项目的配置项，本项目暂未接邮件模板。</small>
                    </span>
                    <input name="notifyOnHit" type="checkbox" defaultChecked={config.notifyOnHit} />
                  </label>
                </div>
              </section>

              <footer className="risk-modal-actions">
                <button className="ghost-button compact" type="button" onClick={() => setOpen(false)}>取消</button>
                <button className="primary-button compact" type="submit">✓ 保存内容审计配置</button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
