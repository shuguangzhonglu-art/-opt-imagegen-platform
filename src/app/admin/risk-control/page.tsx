import Link from "next/link";

import { Notice } from "@/components/notice";
import { RiskControlSettings } from "@/components/risk-control-settings";
import { requireAdmin } from "@/lib/auth";
import { getRiskControlLogs, getRiskControlStatus } from "@/lib/services/risk-control";
import { formatDateTime } from "@/lib/utils/format";

type RiskControlPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    result?: string;
    endpoint?: string;
    search?: string;
  }>;
};

function statusLabel(enabled: boolean) {
  return enabled ? "已启用" : "未启用";
}

function modeLabel(mode: string) {
  if (mode === "OBSERVE") return "观察记录";
  if (mode === "OFF") return "关闭链路";
  return "前置拦截";
}

function resultLabel(result: string) {
  return {
    PASSED: "放行",
    SAMPLED: "采样",
    BLOCKED: "拦截",
    ERROR: "异常",
  }[result] ?? result;
}

function maskApiKeyForClient(key: string) {
  if (!key) return "";
  return key.length > 8 ? `...${key.slice(-6)}` : "已保存 Key";
}

export default async function AdminRiskControlPage({ searchParams }: RiskControlPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const status = await getRiskControlStatus();
  const logs = await getRiskControlLogs({
    result: params.result === "BLOCKED" || params.result === "ERROR" || params.result === "PASSED" || params.result === "SAMPLED" ? params.result : "ALL",
    endpoint: params.endpoint || "ALL",
    search: params.search,
  });

  const cards = [
    { icon: "🛡", label: "运行状态", value: statusLabel(status.config.enabled), note: modeLabel(status.config.mode), tone: "neutral" },
    { icon: "🔑", label: "API Key", value: status.apiKeyCount > 0 ? `${status.apiKeyCount} 个` : "未配置", note: status.config.model, tone: "blue" },
    { icon: "👥", label: "审计范围", value: "全部分组", note: "全部模型生效", tone: "purple" },
    { icon: "▤", label: "审核记录", value: String(status.totalLogs), note: "当前筛选结果", tone: "yellow" },
  ];

  function initial(label: string) {
    return label.charAt(0).toUpperCase();
  }

  return (
    <main className="sub-admin-page risk-page">
      <header className="risk-page-head">
        <div>
          <h1>风控中心</h1>
          <p>配置内容审计策略并查看审核记录</p>
        </div>
        <div className="toolbar-actions">
          <span className="admin-avatar">{initial(admin.email)}</span>
          <Link className="ghost-button compact" href="/admin/risk-control">↻ 刷新状态</Link>
          <RiskControlSettings
            config={{
              ...status.config,
              apiKeys: status.config.apiKeys.map(maskApiKeyForClient),
            }}
          />
          <Link href="/studio" className="ghost-button compact">返回画布</Link>
        </div>
      </header>

      <Notice type="error" message={params.error} />
      <Notice type="success" message={params.success} />

      <section className="risk-summary-grid">
        {cards.map((card) => (
          <article className="risk-summary-card" key={card.label}>
            <span className={`risk-card-icon ${card.tone}`}>{card.icon}</span>
            <div>
              <p>{card.label}</p>
              <strong>{card.value}</strong>
              <small>{card.note}</small>
            </div>
          </article>
        ))}
      </section>

      <section className="risk-dashboard-grid">
        <article className="risk-panel">
          <header>
            <div>
              <h2>前置拦截同步状态</h2>
              <p>同步审核链路的实时计数，不包含异步与记录任务。</p>
            </div>
            <span className="balance-pill">前置拦截</span>
          </header>
          <div className="risk-stat-grid">
            <div className="risk-stat blue"><span>同步处理中</span><strong>{status.syncProcessing}</strong><small>当前正在审核</small></div>
            <div className="risk-stat gray"><span>已检查</span><strong>{status.checked}</strong><small>进入前置拦截链路</small></div>
            <div className="risk-stat green"><span>已放行</span><strong>{status.passed}</strong><small>未触发拦截</small></div>
            <div className="risk-stat red"><span>已拦截</span><strong>{status.blocked}</strong><small>命中后拒绝请求</small></div>
            <div className="risk-stat yellow"><span>审核异常</span><strong>{status.errors}</strong><small>失败或无可用 Key</small></div>
            <div className="risk-stat purple"><span>平均耗时</span><strong>{status.avgLatencyMs} ms</strong><small>同步链路平均值</small></div>
          </div>
        </article>

        <article className="risk-panel">
          <header>
            <div>
              <h2>审核 Key 负载</h2>
              <p>同步前置拦截直接轮询可用审核 Key。</p>
            </div>
            <span className="balance-pill">同步并发 {status.activeWorkers} / 可用 Key {status.availableKeys}，worker：0 / {status.workerCount}</span>
          </header>
          <div className="risk-load-empty">暂无审核 Key 负载数据</div>
        </article>
      </section>

      <section className="risk-records">
        <header>
          <div>
            <h2>审核记录</h2>
            <p>展示命中、拦截、异常和已采样记录。</p>
          </div>
          <Link className="ghost-button compact" href="/admin/risk-control">↻ 刷新</Link>
        </header>
        <div className="risk-filter-banner">
          <span>▽ 模型范围</span>
          <strong>全部模型生效</strong>
        </div>
        <form className="risk-filters">
          <select name="result" defaultValue={params.result || "ALL"}>
            <option value="ALL">全部结果</option>
            <option value="BLOCKED">已拦截</option>
            <option value="PASSED">已放行</option>
            <option value="SAMPLED">已采样</option>
            <option value="ERROR">异常</option>
          </select>
          <select name="endpoint" defaultValue={params.endpoint || "ALL"}>
            <option value="ALL">全部端点</option>
            <option value="direct-generate">direct-generate</option>
            <option value="kv-direct-generate">kv-direct-generate</option>
            <option value="queued-generation">queued-generation</option>
          </select>
          <input name="search" type="search" placeholder="按用户/Key/摘要搜索" defaultValue={params.search || ""} />
          <button className="ghost-button compact" type="submit">筛选</button>
        </form>

        <div className="risk-table-wrap">
          <table className="sub-admin-table risk-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>分组</th>
                <th>用户</th>
                <th>API KEY</th>
                <th>端点</th>
                <th>结果</th>
                <th>最高分</th>
                <th>处置</th>
                <th>上游耗时</th>
                <th>输入摘要</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="risk-empty-cell">暂无审核记录</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>默认分组</td>
                    <td>{log.userEmail ?? log.userId ?? "匿名"}</td>
                    <td>{log.apiKeyTail ?? "—"}</td>
                    <td>{log.endpoint}</td>
                    <td><span className={`risk-result ${log.result.toLowerCase()}`}>{resultLabel(log.result)}</span></td>
                    <td>{log.highestCategory ? `${log.highestCategory} / ${log.highestScore.toFixed(2)}` : "—"}</td>
                    <td>{log.action}</td>
                    <td>{log.latencyMs} ms</td>
                    <td className="risk-summary-text">{log.inputSummary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
