# SPEC — 架构与三模式状态机

## 1. 目标

移动端优先的浏览器 3D 游戏：在「瞭望舱」里操控赛尔机器人，走到全息星图台启航，切到太空驾驶飞船，
随时返航。依赖只有 `three` + `vite` + `typescript`；零外部图片 / 音频。

## 2. 分层

```
            ┌────────────── src/main.ts（组合根，唯一同时认识两边的文件）──────────────┐
            │                                                                          │
   src/game/**  纯逻辑，不 import three            src/render/**  three 网格 / 材质 / 着色器
   ├ collision.ts  圆 vs 圆 + 圆形房间边界          ├ cabin.ts     舱体（按 game/cabin.ts 的数字搭）
   ├ cabin.ts      舱内布局数据 + 碰撞体生成        ├ robot.ts     机器人模型 + 步态动画
   ├ robot.ts      第三人称行走运动学               ├ ship.ts      飞船模型 + 尾焰
   ├ ship.ts       飞船运动学 / 能量 / 推出球体     ├ space.ts     太阳、行星、小行星带、星尘、空间站外观
   ├ space.ts      星域布局 + 确定性小行星带        ├ sky.ts       星云着色器 → 一次性烘焙 cubemap + 星点
   ├ mode.ts       三模式状态机                     ├ textures.ts  canvas 程序化贴图
   └ rng.ts        mulberry32 / damp / angleDelta   ├ materials.ts 材质配方 + lathe 扫掠工具
                                                    └ hud.ts       DOM HUD
   src/input/controls.ts  键鼠 + 触摸 → 纯数字      src/audio/sfx.ts  WebAudio 合成
```

规则：

- `src/game/**` 只依赖自身，可被 `node --test` 直接覆盖（`scripts/build-tests.sh` 用 esbuild 把 `*.test.ts`
  打成 `*.test.js`，`src/game/index.js` 汇总注册，`node --test src/game/` 即可跑）。
- 布局数字只有一份：`game/cabin.ts`、`game/space.ts`。渲染读同一份常量来摆网格，碰撞与画面不会漂移。
- 单场景：舱体组、太空远景组（行星 / 太阳 / 小行星带，透过舷窗也能看到）、太空近景组（空间站外观、
  飞行光照、星尘）。模式切换只是切 `visible`，没有加载。

## 3. 坐标与约定

- 单位米，`+y` 向上，舰首 `-z`。
- 舱内极坐标：`θ`（度）→ `(x, z) = (sin θ, cos θ)·r`；`θ=0` 舰尾，`90` 右舷，`180` 舰首。与
  `THREE.LatheGeometry` 的 `phi` 一致，所以弧形控制台直接用 lathe 扫掠。
- 相机 yaw=0 朝 `-z`；机器人 `heading` 的朝向为 `(sin h, cos h)`。
- 飞船 `forward = (-sin yaw·cos pitch, sin pitch, -cos yaw·cos pitch)`，模型机头朝本地 `-z`，
  欧拉顺序 `YXZ`。

## 4. 三模式状态机（`src/game/mode.ts`）

```
                requestLaunch(near)                       t ≥ duration
   ┌────────┐ ───────────────────────▶ ┌──────────────┐ ───────────────▶ ┌────────┐
   │ cabin  │                          │   transit    │                  │ space  │
   └────────┘ ◀─────────────────────── │ to: space|cabin │ ◀───────────── └────────┘
                 t ≥ duration          └──────────────┘    requestDock()
```

| 模式 | 可控 | 画面 | 进入条件 |
| --- | --- | --- | --- |
| `cabin` | 机器人 + 环绕相机 | 舱体 | 初始；或 dock transit 结束 |
| `transit` | 无（输入被忽略，动作按钮隐藏） | 见时间线 | `requestLaunch(true)` / `requestDock()` |
| `space` | 飞船 | 太空 | launch transit 结束 |

transit 时间线（秒）：

| 方向 | 推进 `thrust` | 淡出 | **swap** | 淡入 | 合计 |
| --- | --- | --- | --- | --- | --- |
| launch (→space) | 0.80：舱内相机前推、FOV +22°、抖动、全息球加速旋转变亮、蓄力音 | 0.35 → 白青 | `onSwap('space')`：重置飞船、切组 | 0.60 | 1.75 |
| dock (→cabin) | — | 0.35 | `onSwap('cabin')`：机器人放回星图台前 | 0.60 | 0.95 |

保证（均有单测）：

- 启航只在 `cabin` 且 `nearPedestal`（距星图台中心 ≤ 2.5 m）时成立；transit 中不可重入。
- `onSwap` 每次 transit **恰好一次**，即使单帧 `dt` 巨大。
- `scene` 访问器给出"此刻该画哪个场景"，`fade` 给出遮罩不透明度，`thrust` 给出 0..1 推进进度。

## 5. 舱内逻辑

- 碰撞世界 = 一组圆 + 半径 6.85 m 的圆形边界。每个弧形控制台是一串沿弧线的圆（间距 < 半径，机器人
  钻不过去）+ 四个端角小圆；座椅、星图台各一个圆。`resolve()` 迭代推出（≤ 8 轮）。
- 机器人：相机相对输入 → 目标速度（走 2.2 / 跑 4.4 m/s）指数趋近；碰撞后用实际位移回写速度（贴墙滑动）；
  朝向指数转向行进方向；每 0.55 m 记一次脚步（驱动步态与脚步声）。
- 相机：绕机器人的 yaw/pitch 轨道相机，距离按"不出舱壁 / 不顶天花板"逐步收缩；竖屏自动放大纵向 FOV
  以保证 ≥ 62° 横向视野。

## 6. 飞行逻辑

- 输入：`steerX/steerY`（带 5/s 的平滑）、`boost`、`brake`。
- 速度向目标指数趋近：巡航 45、推进 170、减速 6。推进消耗能量 22/s，回充 14/s；耗尽后需回到 15 才能再推。
- 俯仰钳制 ±1.25 rad；转向带视觉横滚（最大 0.75 rad）。
- 行星 / 空间站是实心球：穿入即推出，并按迎面程度削减速度。
- 星域半径 1500：出界后自动把机头转回原点。
- 跟随相机：相机朝向以 3.2/s 滞后于飞船朝向，距离与 FOV 随速度拉伸。

## 7. 性能预算

- DPR ≤ 2；无后处理、无实时阴影（机器人用贴花接触阴影）。
- 星云只在启动时渲染一次到 cubemap（触屏设备 512，桌面 1024），之后每帧只是一次 cube 采样。
- 小行星带 700 颗 = 1 个 `InstancedMesh`；顶灯 36 块 = 2 个 `InstancedMesh`。
- 产物：`three` 之外的代码 < 400 KB；首屏 JS gzip ≈ 165 KB。

## 8. 部署

- `server/index.js`：零依赖静态服务器，`127.0.0.1:3029`，前缀 `/seer`，`GET /api/health → {ok:true}`。
- `ecosystem.config.cjs`：pm2 进程 `seer-observatory`。
- `scripts/ci-deploy.sh`：build → 备份 `server/dist`（留 3 份）→ 部署 → pm2 restart/start → 轮询健康检查 →
  失败则 `scripts/rollback.sh`。

## 9. 调试钩子

`window.__frames`（已渲染帧数）、`window.__seer`（`mode / robot / ship / sfx / controls / gotoPedestal() /
launch() / dock()`）——仅供 e2e 与 measure-look 使用。
