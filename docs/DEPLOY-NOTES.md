# DEPLOY NOTES — 发布链路实况（2026-11-21 核查）

## 结论：本机部署不上公网

`https://openfolio.uk/seer/` 现在由 **103.146.124.206** 上的 `/www/seer-observatory`（root 拥有，
git 停在 `7878060`，`server/dist` 构建于 2026-11-20 12:36）提供，公网首页引用 `assets/index-DBZc_T7n.js`。

本机（`198.44.34.68` / hostname `ecs3944`，仓库 `/www/seer-observatory` → `/data/app/seer-observatory`）：

- `bash scripts/ci-deploy.sh` → `DEPLOY OK`，但只更新本机 `127.0.0.1:3029`；
- 本机 `portfolio-proxy`（`/root/Portfolio-Manager/portfolio-proxy.js`，`SEER_URL=http://127.0.0.1:3029`）
  经 `curl -H 'Host: openfolio.uk' http://127.0.0.1/seer/` 取到的是**最新**构建；
- 公网同一路径仍返回旧构建 → Cloudflare 源站不是本机。

核查证据：

```bash
# 本机
curl -s http://127.0.0.1:3029/seer/ | grep -o 'index-[^"]*\.js'      # index-D_-0ZTQK.js（最新）
# 公网
curl -s https://openfolio.uk/seer/ | grep -o 'index-[^"]*\.js'       # index-DBZc_T7n.js（旧）
curl -sI https://openfolio.uk/seer/ | grep cf-cache-status           # DYNAMIC（不是 CF 缓存造成的）
```

## 可用的旁路手段

- SSH 到源站：`ssh -i /root/.ssh/id_tunnel tunnel@103.146.124.206`（`tunnel` 用户，**无 sudo**，
  `/www/seer-observatory` 属 root，不可写）。
- Cloudflare API：本机没有 `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN`，无法 purge 或改源站。

## 需要人工/有权限一侧做的事（二选一）

1. 把 `openfolio.uk` 的 `/seer`（以及 `/bbq`、`/transport` 等）源站切到 `198.44.34.68` 的本机网关；
2. 或给 103 一个可写/可拉取的发布路径（例如给 `tunnel` 用户 `dist` 写权限，或用 GitHub Actions 部署到 103）。

在解决之前，本项目的「公网验收」只能证明源站可达，**不能证明新构建已上线**。
