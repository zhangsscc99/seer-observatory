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

## M8 红巨星系 red-giant（F801–F804）

| # | 功能 | verify |
| --- | --- | --- |
| 8.1 | PLANETS 新增 `red-giant`（kind `'red-giant'`、hazard `radiation`、r280 @ (-480,160,1020)、与其余 6 星包围球不重叠、SECTOR_RADIUS 内） | `node --test --test-name-pattern="red-giant|bounding spheres" src/game/` |
| 8.2 | 扫描资源/日志：`scanResult('red-giant')` → 红巨星等离子 + 专属观测日志；`hazardEffect('radiation')` 出「强辐射·护盾警报」 | `node --test --test-name-pattern="red-giant" src/game/` |
| 8.3 | 1024×512 equirect 光球贴图：12×6 + 40×20 双层抖动 Voronoi 米粒（3.33× 尺度差）+ 暗沟 + 16 个耀斑核 + 极区压暗 | `grep -n "redGiantTexture" src/render/textures.ts` |
| 8.4 | 自发光着色器：双层 UV 慢速对流（uTime 0.02）+ 临边昏暗 `pow(1-NdV,1.6)` → 亮度 ×0.34、色偏「红移」+ 色球边缘 + 双层 halo(1.16R gain .62 / 1.06R gain .72) + 5 条日珥弧 + 2.6R 尘埃幕壳与 420 颗逆光尘 + 5.8R 暖橙耀斑 billboard + 局部 PointLight | `grep -n "RED_GIANT_FRAG\|buildProminences\|buildDustVeil" src/render/space.ts` |
| 8.5 | 特写出图：`red-844x390.png` / `red-390x844.png`，阈值不变 | `node scripts/measure-look.mjs` → `LOOK OK`；`ls e2e/shots/red-*.png` |

## M9 双星系 binary + T1/T2（F901–F905）

| # | 功能 | verify |
| --- | --- | --- |
| 9.1 | PLANETS 新增 `binary`（`双子星域`，`(1100,-30,-520)` r135，kind `'binary'`，hazard `'photon'`，间距 > 半径和 + 100，SECTOR_RADIUS 内）与 `BINARY_STARS`（冷白主星 `0xbfe0ff` / 暖橙伴星 `0xffb066`）；`HAZARDS.photon` 回充 ×1.3；`scanResult('binary')` 得「双星等离子」与 ≥40 字观测日志 | `node --test --test-name-pattern="binary\|photon\|bounding\|sector" src/game/` |
| 9.2 | 双星系视觉：`binaryTexture()` 1024×512（冷暖双半球 + 晨昏环带 + 高频云絮/细丝卷云 + 极区暗化 + 双直射斑）；两颗自发光恒星 + 1.14R/1.28R 成对 halo + 耀斑；距离衰减（550→1100）的第二盏暖橙 `DirectionalLight`（1.5，隔离在 `near`）与主光冷色温插值；双星行星双色 fresnel + 夜侧 ≥0.08 底色 | `grep -n "binaryTexture\|buildBinaryStar\|BINARY_PLANET_FRAG\|binaryWarmLight" src/render/textures.ts src/render/space.ts` |
| 9.3 | 扫描链路与星图台：`TARGETS` 自动包含、扫描入 `seer.archive`、星图台选中 `binary` 切冷暖双色全息球与太空标记环、靠近/选中时顶部青色警示条展示 `photon` 文案 | `grep -n "applyTargetHolo\|setHoloColor\|photon" src/main.ts src/render/cabin.ts src/render/hud.ts` |
| 9.4 | look gate 出图：`focusPlanet('binary')` 3.15R 偏离反日方向使伴星入画；`measure-look.mjs` 产出 `binary-{844x390,390x844}.png`（阈值不放宽） | `grep -n "binary" src/main.ts scripts/measure-look.mjs`；`node --check scripts/measure-look.mjs` |
| 9.5 | 走查待办 T1/T2：竖屏 390×844 顶部 `#archBtn` / `#dock` / `#mute` 高度 ≥48px 且不重叠（`smoke.mjs` 断言）；`measure-look.mjs` 竖屏 info-only 行只打印 `info` | `node e2e/smoke.mjs` → `SMOKE OK`；`grep -n "info  " scripts/measure-look.mjs` |
| 9.6 | F906 双星特写可读性：`focusPlanet('binary')` 改至背向两星中点 `3.3R` + 两星张角/FOV 检查（横竖屏两星同框）；主星 `1.12R` / 伴星 `0.86R` 强化白热核心 + 径向日冕/耀斑对比（盘面均 ≥18px）；行星晨昏带两侧各加 3 条异速细卷云带 + 柔化双色 halo（夜侧 ≥0.05） | `npx tsc --noEmit && node --test src/game/ && npm run build && node scripts/measure-look.mjs` → `LOOK OK`；看 `e2e/shots/binary-{844x390,390x844}.png` |

## M10 黑洞边缘 blackhole（F1001–F1005）

| # | 功能 | verify |
| --- | --- | --- |
| 10.1 | PLANETS 新增 `blackhole`（黑洞边缘，代号「弥夜」，`kind: 'blackhole'`、`hazard: 'tidal'` 回充 ×0.7 青色警示），`TARGETS` 自动包含，扫描产出专属资源与观测日志 | `node --test --test-name-pattern="blackhole\|tidal" src/game/` |
| 10.2 | 潮汐力场纯逻辑（`src/game/tidal.ts` + `src/game/tidal.test.ts`）：`tidalState(distance, radius)` 分 `safe` / `hazard`（1.6R–3.2R，`timeScale` 1.2→2.4）/ `crush`（<1.6R）；crush 累积潮汐张量触发 `ejected` 自动弹开 + 冷却；`computeEjectTarget` 沿径向推至 `ejectFactor * radius`（全量单测 47 pass） | `node --test --test-name-pattern="blackhole\|tidal" src/game/` |
| 10.3 | 黑洞视觉渲染（纯 `onBeforeCompile`/材质，无后处理框架）：事件视界纯黑球 + 光子环（1.02–1.06R，朝视向更亮）+ 倾斜吸积盘（1.35R–3.4R，canvas 径向细条带/对数螺旋丝/湍流噪声，内圈快转、additive、多普勒按视线调制一侧更亮更蓝白）+ 引力透镜弧（1.15R–1.6R，扭曲 UV 采样星空/星云，additive 低强度）+ 尘埃幕壳与 ≥300 instanced 逆光尘粒 + 局部 `PointLight` | `grep -n "buildBlackhole" src/render/space.ts` |
| 10.4 | HUD 与潮汐反馈：顶部青色 `潮汐力场·回充 ×0.7` 警示条；飞行面板显示「本地时间 ×1.4」类时间膨胀读数；crush 自动弹开一次性视觉反馈 | `grep -n "潮汐力场\|本地时间\|tidal" src/render/hud.ts src/main.ts` |
| 10.5 | 观感门槛与特写出图：`black-{844x390,390x844}.png`（实测 844×390：cabin 126.17/0.01/196.30、space 92.37/177.89、black 107.3/250.0；竖屏 cabin 140.96） | `node scripts/measure-look.mjs` → `LOOK OK`；`ls e2e/shots/black-*.png` |

## 已知待办（M8 走查后，下一轮优先）

| # | 问题 | 证据 | 验收 |
| --- | --- | --- | --- |
| T1 | ✅（M9 F905 已修）HUD 顶部「档案 / 返回舱内 / 静音」竖屏触控高度 50px ≥ 48px 且互不重叠 | `index.html` 竖屏媒体查询 + `e2e/smoke.mjs` 断言 | DOM 实测三者 ≥48px 且互不重叠；`node e2e/smoke.mjs` 通过 |
| T2 | ✅（M9 F905 已修）`measure-look` 对竖屏 info-only 行不再打印 `PASS/FAIL`，只打印 `info` | `scripts/measure-look.mjs` `report(..., gate)` | 竖屏行只打印 `info`，闸门结论只看横屏 |
| T3 | gas-storm 条带仍偏平滑，缺高频碎云/丝状卷曲；风暴眼偏同心椭圆，螺旋臂可再强化 | `e2e/shots/gas-844x390.png` | 特写里能数出 ≥3 条螺旋臂、条带边缘有破碎感（人工评审 + measure 不退化） |
| T4 | 特写里悬浮采集站偏小、易与飞船剪影混淆 | 同上 | 站体在特写里 ≥1/5 画面高、能辨认环台/塔/窗光 |
| T5 | red-giant 光球在 2.55R 特写下读成「干裂泥地/岩浆裂纹」：Voronoi 米粒尺度仍偏大、暗沟过宽，看不出沸腾对流 | `e2e/shots/red-844x390.png` | 特写里米粒直径 ≤ 屏高 1.5%，沟槽细而密（≥300 个可见单元），仍有 16 个耀斑核 |
| T6 | 日珥弧/尘埃幕在这个机位几乎看不见（只有 halo 发光），临边昏暗中被 halo 复亮，飞船受光偏平 | 同上 | 特写里能数出 ≥2 条日珥弧伸出边缘；尘幕在 2.6R 壳上可见逆光颗粒；飞船朝星面一侧与背面的亮度比 ≥1.8 |
| T7 | binary 特写里第二颗恒星仍被读成「灰色小行星/卫星」，两星色温对比不足（只有一颗有明显星芒） | `e2e/shots/binary-844x390.png`（M9 F906 后） | 两星都读作光球（白热核心 + 径向日冕），冷白/暖橙一眼可分；每颗盘面 ≥ 屏高 12% |
| T8 | **发布链路断点**：`https://openfolio.uk/seer/` 实际由 103.146.124.206 上的旧副本（`7878060`，dist 2026-11-20）提供，本机 198.44.34.68 的 `ci-deploy.sh` 只更新本机 3029，公网仍是 M4/M6 时代构建；Cloudflare 侧无 API token、103 上无 root/write | `curl -s https://openfolio.uk/seer/ \| grep -o 'index-[^"]*\.js'` ≠ 本机 `dist/` 哈希 | 把 CF 源站指到本机（或给 103 同步权限）；公网 asset 哈希 == 本机最新构建哈希，`curl` 公网 200 且能在星图里选到 `binary` |
| T9 | 黑洞特写吸积盘仍偏「正面漩涡」，倾斜透视与事件视界对盘面的前后遮挡不够；光子环偏柔光描边，缺少锐利细环 | `e2e/shots/black-844x390.png`（M10 走查） | 特写机位呈明显斜视角（盘面投影纵横比 ≤ 0.45），视界清晰遮挡盘面后半段且前景盘面跨过视界前缘；光子环在 1.02–1.06R 呈现锐利白热细环（环宽 ≤ 屏高 1.2%，峰值对比明显高于柔光晕） |
| T10 | 飞船在黑洞侧仍是剪影（缺吸积盘溢光/轮廓光）；背景星空在黑洞外缘没有被引力透镜弯曲的实感 | `e2e/shots/black-844x390.png`（M10 走查） | 飞船朝向吸积盘一侧具清晰暖白/橙色轮廓光与受光面（明暗面亮度比 ≥ 1.6，不再纯黑剪影）；黑洞外缘 1.15R–1.8R 区域的背景星点/星云有可辨识的切向拉伸或爱因斯坦弧弯曲感，且 `measure-look` 阈值不退化 |
| T11 | 黑洞特写仍读成「正面同心漩涡/传送门」：吸积盘缺椭圆透视与前后遮挡，光子环是柔光描边不是锐利细环（M10 评审） | `e2e/shots/black-844x390.png` | 盘面倾角 18–22°、黑洞挡住盘后缘；0.99–1.01R 有白热锐环；左右亮度比 ≥1.8 |
| T12 | 黑洞场景里飞船是剪影，看不到盘面溢光/轮廓光，暗面死黑 | 同上 | 飞船朝黑洞一侧亮、背面暗，暗面底色 ≥0.10 |
| T13 | 舱内材质读成「均匀亮面塑料」：金属/哑光塑料/玻璃分不出，缺定向主光与接触阴影（视审：Demo 感明显） | `e2e/shots/cabin-844x390.png` | 金属 roughness 0.2–0.4 / 塑料 0.7 对比可见；有明确主光方向；座椅与平台脚下有接触阴影 |

## M11 环形城市 ring-city（F1109–F1113）

| # | 功能 | verify |
| --- | --- | --- |
| 11.1 | 停靠状态机纯逻辑：`dockState(distance, radius, speed)` → `far` / `approach` / `hold` / `docked`；按住 2.5 s 完成停靠，离开时进度衰减，`docked` 后 60 s 冷却；`dockReward()` 补满能量 + 「环城通行密钥」+ 观测日志 | `node --test --test-name-pattern="dock" src/game/` |
| 11.2 | `measure-look` 加固：等待 `space` 上限 300 s、截图 `timeout 240 s`、逐星球 `try/catch`、视口失败后重试一次 | `grep -n "timeout: 240000\|i < 1200\|attempt <= 2" scripts/measure-look.mjs` |
| 11.3 | 停靠接入主循环与 HUD：`hud.ts setDock()` 驱动补给进度条，停靠完成写 `seer.archive` 并补满能量 | `grep -n "setDock" src/render/hud.ts src/main.ts` |
| 11.4 | 环城视觉回归：护盾淡蓝能量壳（rim pow 2.5，alpha `0.05 + rim × 0.30`，上限 0.30）；窗光 gain 1.35，未点亮窗比例 0.28 | `grep -n "rim \* 0.30\|1.35, 1.35, 1.35\|v < 0.28" src/render/space.ts` |
| 11.5 | M11 look-gate 截图：横竖屏 `ring-844x390.png` / `ring-390x844.png`，`measure-look` → `LOOK OK` | `ls e2e/shots/ring-*.png` |

## M12 环形城市画面跃迁（F1114–F1116）

| # | 功能 | verify |
| --- | --- | --- |
| 12.1 | 核心枢纽去死黑：`ringCityCoreTexture` 底板 `#3b495e` + 面板明暗/高光倒角；`coreMat` `0x7389a6 / metalness 0.58 / roughness 0.5`；核心球 6 纬带 ≥220 个 instanced 自发光舱窗（15% 不亮、gain 1.45/1.0/0.58）、`±34°` 两条纬向灯带、极冠各 16 个灯点 | `grep -n "coreWinSlots\|coreSubRings\|corePolarDots\|3b495e" src/render/space.ts src/render/textures.ts` |
| 12.2 | 定向主光 + 轮廓光 + 城市光晕：环城专属 `DirectionalLight(0xdceeff)`（`SUN_DIR` 偏 25°、仅 `near`、强度 `1.6 × wk`）；`hullMat` `metalness 0.65`；`1.755R` 向阳侧 additive rim 环带；`1.05R–2.02R` 暖色环雾（`opacity 0.085`，上限 0.10） | `grep -n "ringCityKeyLight\|sunSide\|hazeGeo" src/render/space.ts` |
| 12.3 | 结构细节与窗光层次：外环 36 组 instanced 散热鳍片/天线桅杆/服务舱（≤0.06R）；窗光三档 gain `1.9 / 1.35 / 0.7`（`setColorAt`，冷暖 7:3）；4 座塔根部机库口 + 暖光条 | `grep -n "detailSets\|towerHangarGeo\|1.9 : t < 0.68" src/render/space.ts` |
| 12.4 | 观感实测与出图（2026-11-22，844×390）：cabin `121.71 / 0.022 / 230.01`、space `93.08 / 183.64`、ring `64.91 / 147.58`（M11 `61.5 / 139.7`）；竖屏 ring `64.66 / 156.80` | `node scripts/measure-look.mjs`；`ls e2e/shots/ring-*.png` |
| 12.5 | 部署：`ci-deploy` → `DEPLOY OK`；本机与公网同哈希 `index-LQG4jeFw.js`，公网 200 | `curl -s https://openfolio.uk/seer/ \| grep -o 'index-[^"]*\.js'` |
