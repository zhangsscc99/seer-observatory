# FEATURES — 增量清单

每条都带可执行的 verify 命令。全量门槛：

```bash
npx tsc --noEmit && node --test src/game/ && npm run build && node scripts/measure-look.mjs
```

（改了 `*.test.ts` 后先 `bash scripts/build-tests.sh` 重新生成 `*.test.js`；`npm test` 会自动做。）

## M1 舱内可玩

| # | 功能 | verify |
| --- | --- | --- |
| 1.1 | 瞭望舱场景：弧形控制台 ×6（左右各 3，斜台面 + 灯带）、座椅、舷窗立柱、顶灯阵列、圆形天窗 | `node --test --test-name-pattern="layout: 6 consoles" src/game/` ；看 `e2e/shots/cabin-844x390.png` |
| 1.2 | 全息星图台：基座 + 旋转绿色线框地球 + 光环 + 光锥 | `node scripts/measure-look.mjs`（截图 `cabin-*.png` 中央） |
| 1.3 | 地板同心圆环 / 电路圆台 / 条纹地毯（canvas 程序化贴图 + emissiveMap） | `grep -n "floorTextures" src/render/textures.ts src/render/cabin.ts` |
| 1.4 | 赛尔机器人：第三人称，WASD / 左摇杆移动，推满或 Shift 奔跑，步态动画 | `node --test --test-name-pattern="run is faster\|camera-relative" src/game/` |
| 1.5 | 轨道相机：鼠标拖动 / 右半屏拖动；不出舱壁；竖屏自适应 FOV | `node e2e/smoke.mjs` |
| 1.6 | 碰撞：不穿墙、不穿控制台、不穿座椅 / 星图台；控制台间隙可通行 | `node --test --test-name-pattern="cannot\|gaps\|seat" src/game/` |
| 1.7 | 极简 HUD：地点 + 目标提示 + 「启航」按钮（≥48px，安全区，竖屏可用） | `node scripts/measure-look.mjs`（断言靠近星图台时按钮出现） |
| 1.8 | 交互：靠近星图台（≤2.5 m）才出现「启航」，否则拒绝 | `node --test --test-name-pattern="gated\|nearPedestal" src/game/` |

## M2 太空飞行

| # | 功能 | verify |
| --- | --- | --- |
| 2.1 | 三模式状态机 cabin ⇄ transit ⇄ space；启航 0.8 s 推进 + 淡出 → 切场景 → 淡入 | `node --test --test-name-pattern="launch timeline\|dock\|huge dt" src/game/` |
| 2.2 | 飞行手感：巡航 / 推进 / 减速、偏航 + 俯仰（钳制）、转向横滚 | `node --test --test-name-pattern="cruises\|brake\|steer right" src/game/` |
| 2.3 | 推进能量：消耗、回充、耗尽后需重新充能 | `node --test --test-name-pattern="boost cuts out" src/game/` |
| 2.4 | 4 颗行星（海洋 / 气态 / 冰 / 火山）+ fresnel 大气边缘光 + 外层光晕 | `node --test --test-name-pattern="planets" src/game/` ；看 `e2e/shots/space-*.png` |
| 2.5 | 小行星带：700 颗单个 InstancedMesh，确定性生成，环绕赫尔卡星 | `grep -n "InstancedMesh" src/render/space.ts` |
| 2.6 | 星云天空（着色器一次性烘焙 cubemap）+ 星点层 + 恒星光源 | `grep -n "bakeSky\|makeStars" src/main.ts` |
| 2.7 | 实心天体推出 + 星域边界自动返航 | `node --test --test-name-pattern="planet\|sector" src/game/` |
| 2.8 | 飞行 HUD：航速、能量条、推进 / 减速按住键、返回舱内 | `node e2e/smoke.mjs` |
| 2.9 | 跟随相机：朝向滞后、距离 / FOV 随速度拉伸 | `grep -n "chase camera" src/main.ts` |

## M3 观感与音效

| # | 功能 | verify |
| --- | --- | --- |
| 3.1 | 材质区分：塑料壳 / 合金饰条 / 面罩 / 软垫；灯带与屏幕为发光体 | `grep -n "roughness" src/render/materials.ts` |
| 3.2 | 地砖细微反射（roughnessMap + 星云环境贴图）、窗边与星图台的加色光溢出 | `grep -n "envMapIntensity\|light spill" src/render/cabin.ts` |
| 3.3 | 太阳耀斑（billboard sprite，缓慢旋转 / 呼吸）+ 日冕 | `grep -n "flareTexture" src/render/space.ts` |
| 3.4 | 星尘粒子：围绕飞船的包裹盒，随速度变大 | `grep -n "DUST_COUNT" src/render/space.ts` |
| 3.5 | 空间站外观（返航目标）、飞船尾焰随油门伸缩 | `grep -n "buildStation\|flames" src/render/space.ts src/render/ship.ts` |
| 3.6 | 程序化音效：脚步、提示、确认、启航、返航、碰撞、拒绝 + 舱内低鸣 / 推进器嗡鸣循环 | `node e2e/smoke.mjs`（断言 footstep 计数） |
| 3.7 | 静音开关持久化（`localStorage['seer.muted']`） | `node e2e/smoke.mjs` |
| 3.8 | 观感门槛（舱内 + 太空）与四张参考截图 | `node scripts/measure-look.mjs` |

## M4 主角造型

| # | 功能 | verify |
| --- | --- | --- |
| 4.1 | 主角换成 AI 生成 GLB（腾讯混元 hy-3d-express 图生3D，12k 三角面），`seer.glb` 保留为降级层 | `ls -l public/models/seer-express.glb`；`grep -n "expressRig" src/render/robot.ts`；看 `e2e/shots/robot-{front,walk,back,mid}-844x390.png` |
| 4.2 | 三级降级链：seer-express.glb → seer.glb → primitive 造型（不白屏），`source` 标记 `'primitive' \| 'glb' \| 'express'` | `grep -n "falling back to seer.glb\|keeping primitive" src/render/robot.ts` |
| 4.3 | 待机眼亮度呼吸 + 身体微起伏；行走波纹管伸缩 + 前倾 3°；悬浮收腿 | `grep -n "eyeGlow\|setHover" src/render/robot.ts src/main.ts` |
| 4.4 | 截图门槛在 4 核 SwiftShader 下稳定（截图 120 s 超时 + 3 次重试，阈值不动） | `node scripts/measure-look.mjs` → `LOOK OK` |
| 4.5 | ART-SPEC 记录机器人配色/材质/朝向/面数与实测亮度带 | `grep -n "2.5 主角机器人模型" docs/ART-SPEC.md` |

## M5 扫描 / 档案 / 星图台

| # | 功能 | verify |
| --- | --- | --- |
| 5.1 | 扫描系统（纯逻辑）：3.2R 进入范围、按住交互 4.2 s 完成、离开 0.35/s 衰减不清零、每星球资源/数量/日志、完成事件只发一次 | `node --test --test-name-pattern="scan" src/game/` |
| 5.2 | 档案持久化 `seer.archive`：累计扫描次数与资源，坏 JSON 回退空档案 | `node --test --test-name-pattern="archive" src/game/` |
| 5.3 | 星图台目标选择：`seer.target` → 目标行高亮、目标文案、全息球换色、太空里目标星球下方青色标记环 | `node e2e/smoke.mjs`（`星图 opens with selectable targets` / `target kelos saved`） |
| 5.4 | 危害真的生效：`cold` 能量回充 ×0.55、`wind`/`radiation` 顶部警示条 | `node --test --test-name-pattern="hazard" src/game/` |
| 5.5 | HUD：扫描条 + 完成卡片 + 档案抽屉 + 警示条，按钮 ≥48px，竖屏无滚动条 | 看 `e2e/shots/cabin-390x844.png`；`grep -n "archBtn" index.html` |
| 5.6 | 舱内交互改为「星图面板 → 面板内启航」，smoke/measure 脚本同步 | `node e2e/smoke.mjs` → `SMOKE OK`；`node scripts/measure-look.mjs` → `LOOK OK` |

## M6 冰环带（F601–F605）

| # | 功能 | verify |
| --- | --- | --- |
| 6.1 | `icer` 星球数据：出生点前方视野内、`hazard: 'cold'`、`kind: 'ice-ring'`，`TARGETS` 经 `PLANETS.map` 自动包含；各行星包围球互不重叠、均在 `SECTOR_RADIUS` 内 | `node --test --test-name-pattern="icer\|bounding\|sector" src/game/` |
| 6.2 | 环系统 `src/render/rings.ts`：`RingGeometry(1.5R,2.35R,192,4)`、三层噪声径向环带、卡西尼缝（0.58–0.66 alpha≤0.06）、行星本影弧带 ×0.35、前向散射 pow 8、边缘 0.06 淡出、冰晶闪点 | `grep -n "buildRings\|cass\|umbra" src/render/rings.ts`；看 `e2e/shots/icer-844x390.png` |
| 6.3 | 冰星本体：voronoi 多边形冰裂纹 + 极冠贴图；双层 halo（1.05R 窄亮边 pow 6 + 1.16R 宽雾）、背光侧 20%、晨昏暖 8%；向阳 1.02R 漂移雾壳 ≤0.12 | `grep -n "ice-ring\|HALO_SCALE_NARROW\|FROST" src/render/textures.ts src/render/space.ts` |
| 6.4 | 舱内曝光回归：分区曝光（舱内 0.72 / 太空 1.0）、哑光塑料 0.05/0.72、地砖压暗、接触阴影贴片；mean 152.6 → 127.5 ∈ 110-135 | `node scripts/measure-look.mjs`（cabin 全 PASS） |
| 6.5 | `measure-look` 逐场景阈值：cabin 110-135 + darkFrac ≤0.15 / space 45-95 / p95 ≥120（竖屏只记录）；`focusPlanet('icer')` 输出 `icer-{844x390,390x844}.png` | `node scripts/measure-look.mjs` → `LOOK OK`；`ls e2e/shots/icer-*.png` |

## M7 气态巨行星 gas-storm（F701–F705）

| # | 功能 | verify |
| --- | --- | --- |
| 7.1 | PLANETS 新增 gas-storm（kind 'gas-storm'、hazard 'gravity'、包围球不重叠、SECTOR_RADIUS 内），TARGETS 自动包含 | `node --test --test-name-pattern="gas-storm" src/game/` |
| 7.2 | 扫描资源/日志：scanResult('gas-storm') → 风暴氦芯 + 专属观测日志 | `node --test --test-name-pattern="gas-storm" src/game/` |
| 7.3 | 1024×512 equirect 条带贴图：域扭曲 + 4 层条带 + 絮状/细湍流 + 对数螺旋风暴眼 + 极区暗化 | `grep -n "gas-storm" src/render/textures.ts` |
| 7.4 | 着色器：赤道快极区慢的差速流动 + 风暴眼旋转采样 + 夜侧边缘散射（不死黑）+ 双层暖橙 halo | `grep -n "uStorm" src/render/space.ts` |
| 7.5 | 程序化悬浮采集站（环台+桁架+塔+16 窗光+3 暖工灯+采集缆+信标，自转/浮动，≤9 draw call） | `grep -n "buildGasStation" src/render/space.ts` |
| 7.6 | measure-look 泛化特写：`icer-*` 与 `gas-*` 两个视口都出图；preview server 掉线自动重启 | `node scripts/measure-look.mjs` → `LOOK OK`；`ls e2e/shots/gas-*.png` |

## 交付

| # | 功能 | verify |
| --- | --- | --- |
| D.1 | 零依赖静态服务器，`/seer/` 前缀，健康检查 | `curl -sf http://127.0.0.1:3029/api/health` |
| D.2 | pm2 `seer-observatory` @ 3029 | `pm2 describe seer-observatory \| grep -E "status\|script path"` |
| D.3 | 部署门：build → 备份 → 部署 → 重启 → 健康检查 → 失败回滚 | `bash scripts/ci-deploy.sh` |
| D.4 | 体积：首屏 JS gzip < 1.5 MB；three 之外代码 < 400 KB | `npm run build`（看 gzip 列）；`cat src/**/*.ts \| wc -c` |

## 已知待办（M7 走查后，下一轮优先）

| # | 问题 | 证据 | 验收 |
| --- | --- | --- | --- |
| T1 | HUD 顶部「档案 / 返回舱内 / 静音」视觉高度 ~34–40px，低于移动端 48px 触控标准 | `e2e/shots/gas-390x844.png` | DOM 实测三者 ≥48px 且互不重叠；`node e2e/smoke.mjs` 通过 |
| T2 | `measure-look` 对竖屏 info-only 行仍打印 `FAIL`（不应有 PASS/FAIL 字样），易被误读为闸门失败 | 一次完整跑的输出 | 竖屏行只打印 `info`，闸门结论只看横屏 |
| T3 | gas-storm 条带仍偏平滑，缺高频碎云/丝状卷曲；风暴眼偏同心椭圆，螺旋臂可再强化 | `e2e/shots/gas-844x390.png` | 特写里能数出 ≥3 条螺旋臂、条带边缘有破碎感（人工评审 + measure 不退化） |
| T4 | 特写里悬浮采集站偏小、易与飞船剪影混淆 | 同上 | 站体在特写里 ≥1/5 画面高、能辨认环台/塔/窗光 |
