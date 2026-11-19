# 赛尔 · 瞭望舱 (Seer Observatory)

浏览器 3D 太空小游戏，致敬《赛尔号》的视觉语言（白色未来舱 + 青色灯带 + 全息星图），
**不使用任何原作素材**：全部几何由 primitive 拼装，贴图由 canvas 程序化生成，音效由 WebAudio 合成。

- 线上：<https://openfolio.uk/seer/>
- 本机：`http://127.0.0.1:3029/seer/`（pm2 进程 `seer-observatory`）

## 玩法

| 模式 | 操作 |
| --- | --- |
| 瞭望舱 | 左半屏摇杆 / `WASD` 移动（推满或 `Shift` 奔跑）；右半屏拖动 / 鼠标拖动转视角；走到全息星图台 → 「启航」/ `E` |
| 太空飞行 | 摇杆 / `WASD` 转向与俯仰；「推进」/ `Space` 加速（消耗能量）；「减速」/ `X`；「返回舱内」/ `R` |
| 通用 | 右上角 ♪ / `M` 静音（持久化） |

## 开发

```bash
npm ci
npm run dev                    # http://127.0.0.1:5175/seer/
npx tsc --noEmit               # 类型检查
npm test                       # 打包 *.test.ts → node --test src/game/
npm run build                  # → dist/
node scripts/measure-look.mjs  # 观感门槛 + 生成 e2e/shots/*.png
node e2e/smoke.mjs             # 端到端：走路→启航→飞行→返航
npm run deploy                 # build → 备份 → 部署 → pm2 → 健康检查 → 失败回滚
```

## 结构

```
src/game/    纯逻辑（不 import three）：碰撞、机器人、飞船运动学、状态机、布局数据 + 单测
src/render/  three 渲染：舱体、机器人、飞船、太空、天空烘焙、程序化贴图、HUD
src/input/   键盘 / 鼠标 / 触摸
src/audio/   WebAudio 程序化音效
server/      零依赖静态服务器（/seer/ + /api/health）
scripts/     measure-look、ci-deploy、rollback、verify、build-tests
docs/        SPEC.md（架构 + 状态机）、ART-SPEC.md（美术 / 音效规范）
```

详见 [docs/SPEC.md](docs/SPEC.md)、[docs/ART-SPEC.md](docs/ART-SPEC.md)、[FEATURES.md](FEATURES.md)。
