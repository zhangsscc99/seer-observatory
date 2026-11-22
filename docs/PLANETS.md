# PLANETS — 星球/星域进度表

方向：**多搞几个星球出来探索**。每轮挑一个「未完成的星球/星域」做成**可到达、可扫描、有辨识度**的内容，
并在星图台上可选（不同选择真的改变场景：配色 / 行星数 / 危害类型）。

每轮的最低交付（缺一不算完成）：
1. 一个星球/星域的地表或轨道场景（程序化生成，零外部素材）
2. 交互链路：靠近 → 扫描进度 → 资源/日志条目（写 `localStorage` + HUD 档案）
3. 星图台可选，选择改变场景
4. 移动端可玩：竖屏可用、按钮 ≥48px、无滚动条、DPR ≤ 2

## 候选池与状态

| ID | 星球/星域 | 视觉要点 | 玩法钩子 | 状态 |
| --- | --- | --- | --- | --- |
| `ice-ring` | 冰环带 | 蓝白、环系统（多层半透明环 + 卡西尼缝）、低温雾气、冰晶反光 | 环内穿行采样冰芯；低温导致推进器效率下降（能量回充变慢） | ✅ M6 上线（F601–F605，`c7934ca`） |
| `red-giant` | 红巨星系 | 橙红主星占满天空、强辐射警示、尘埃幕 | 辐射累积需要躲进阴影区冷却；恒星光压让航行漂移 | ✅ M8 上线（F801–F804） |
| `gas-storm` | 气态巨行星 | 条纹云带 + 风暴眼、悬浮采集站 | 强引力警示（`gravity`，能量回充 ×0.8）+ 扫描得「风暴氦芯」+ 悬浮采集站作目视地标 | ✅ M7 上线（F701–F705，`7f169b1`） |
| `binary` | 双星系 | 冷白/暖橙两颗恒星 + 双色温照明 + 冷暖双半球行星与晨昏环带 | 双星光子场（`photon`，能量回充 ×1.3，青色警示）+ 扫描得「双星等离子」 | ✅ M9 上线（F901–F905） |
| `blackhole` | 黑洞边缘 | 引力透镜光晕、吸积盘、时间膨胀提示 | 危险区：进入后 HUD 时钟加速、超出半径自动弹出 | ✅ M10 上线（F1001–F1005） |
| `ring-city` | 环形城市 | 人造环、窗光密集、可停靠 | 停靠补给、情报商（解锁下一星球） | ✅ M11 上线（F1109–F1113） |

## 已有星球（M2 铺设，M5 起可扫描）

| ID | 名字 | 类型 | 位置 | 危害 | 资源 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `kelos` | 克洛斯星 | 海洋 | (-260, 40, -620) r150 | — | 重水样本 | 出生正对的目标星 |
| `helka` | 赫尔卡星 | 气态 | (640, 130, -260) r110 | `wind` 气流 | 氦气罐 | 小行星带环绕（700 颗 instanced） |
| `seron` | 塞西利亚星 | 冰 | (-560, -60, 330) r80 | `cold` 低温 | 冰晶 | 后续与 `ice-ring` 共用冰材质配方 |
| `volc` | 火山星 | 火山 | (330, -150, 700) r95 | `radiation` 辐射 | 硫化物 | 夜侧自发光 |
| `icer` | 冰环带 | 冰环 | (-80, 120, -1180) r120 | `cold` 低温 | 氦-3 冰芯 | 环系统（卡西尼缝 + 本影弧 + 冰晶闪点）+ 双层 halo + 向阳雾壳 |
| `gas-storm` | 气态巨行星 | 气态巨行星 | (620, 60, 780) r145 | `gravity` 强引力 | 风暴氦芯 | 条带差速流动 + 风暴眼涡旋 + 1.16R 暖橙 halo + 悬浮采集站 |
| `red-giant` | 红巨星系 | 红巨星 | (-480, 160, 1020) r280 | `radiation` 强辐射 | 红巨星等离子 | Voronoi 米粒光球 + 临边昏暗 + 日珥弧 + 2.6R 尘埃幕 + 局部点光 |
| `binary` | 双子星域 | 双星系 | (1100, -30, -520) r135 | `photon` 光子场 | 双星等离子 | 冷白/暖橙双恒星 + 距离衰减双色温方向光 + 冷暖双半球与晨昏环带 + 双色全息球 |

## 横切能力（M5 ✅ commit 4c0eb5b）

- [x] 扫描系统：`src/game/scan.ts`（纯逻辑，可单测）——进入范围 `3.2R`、按住交互 4.2 s 完成、离开按 `0.35/s` 衰减不清零、
      完成事件带资源/数量/日志；`hazardEffect()` 给出 `energyMul` 与警示文案（覆盖率见 `src/game/scan.test.ts`）
- [x] 档案：`localStorage['seer.archive']`（条目 + 资源计数），HUD 右上「档案」抽屉可查，坏 JSON 不抛错
- [x] 星图台选择：舱内星图台开目标面板，选择写 `seer.target` → 目标行高亮 + 顶部目标文案 + 全息球配色 + 太空里目标星球下方青色标记环；
      危害真的生效（低温 → 推进能量回充 ×0.55，气流/辐射给警示条）
- [x] 危害类型枚举：`cold` / `radiation` / `wind` / `gravity` / `photon` / `tidal`，HUD 顶部警示条（青/金，不用红色战斗色）

## `ice-ring` 交付清单（M6，全绿）

1. ✅ `PLANETS` 加 `icer`（`kind: 'ice-ring'`、`hazard: 'cold'`、出生点前方视野内、SECTOR_RADIUS 内），`TARGETS` 自动包含 —— `cbb8599`
2. ✅ `src/render/rings.ts`：RingGeometry(1.5R, 2.35R) + 三层噪声径向环带、卡西尼缝（0.58–0.66 ≤0.06）、行星本影弧带（×0.35）、前向散射（pow 8）、内外边缘淡出、冰晶闪点 —— `1042e24`
3. ✅ 大气散射：1.16R 宽雾 + 1.05R 窄亮边双层 halo、晨昏暖散射（偏暖 8%）、背光侧衰减到 20%；1.02R 向阳漂移雾壳（≤0.12）；voronoi 冰壳裂纹 + 极冠 —— `a981f30`
4. ✅ 舱内曝光回归：`mean 152.6 → 127.5`（分区曝光舱内 0.72 / 太空 1.0 + 哑光塑料 0.05/0.72 + 地砖压暗 + 接触阴影贴片）—— `3474afc`
5. ✅ `measure-look.mjs` 每场景区间阈值（cabin mean 110-135 / space 45-95 / darkFrac ≤0.15 / p95 ≥120，竖屏只记录）+ `focusPlanet('icer')` 特写 `icer-*.png` —— `f689cba`

## `binary` 交付清单（M9，F901–F905）

1. ✅ `PLANETS` 新增 `binary`（`双子星域`，`(1100, -30, -520)` r135，`kind: 'binary'`、`hazard: 'photon'`、与其余 7 星间距 > 各自半径和 + 100、SECTOR_RADIUS 内）与 `BINARY_STARS`（冷白主星 `0xbfe0ff` + 暖橙伴星 `0xffb066`）；`HAZARDS.photon = { energyMul: 1.3, warn: '双星光子场·回充 ×1.3' }`；`scanResult('binary')` 返回「双星等离子」与 ≥40 字专属观测日志 —— `da3831c`
2. ✅ `src/render/textures.ts` + `src/render/space.ts`：1024×512 `binaryTexture()`（冷暖双半球 + 晨昏环带 + 高频云絮与细丝卷云 + 极区暗化 + 冷暖直射斑）；两颗自发光恒星 + 1.14R/1.28R 成对 halo + billboard 耀斑；距离衰减（550 内全强度、1100 外归零，且隔离在 `near` 组不污染舱内）的第二盏暖橙 `DirectionalLight`（intensity 1.5）与主光冷色温插值；双星行星双色 fresnel 与夜侧 ≥0.08 底色 —— `c084bce`
3. ✅ 扫描与星图台链路：TARGETS 自动包含、扫描入档 `seer.archive`、星图台选中切冷暖双色全息球（`0xbfe0ff` / `0xffb066`）、靠近或选中 `binary` 时顶部青色警示条展示 `photon` 文案 —— `4edc182`
4. ✅ `focusPlanet('binary')`（3.15R、偏离反日方向，暖橙伴星与双色明暗行星同框）+ `measure-look.mjs` 产出 `binary-{844x390,390x844}.png`（阈值不动）—— `c3f7411`
5. ✅ 走查待办 T1/T2：竖屏 390×844 顶部 `#archBtn` / `#dock` / `#mute` 触控高度 50px ≥ 48px 且互不重叠（`e2e/smoke.mjs` 断言覆盖）；`measure-look.mjs` 竖屏 info-only 行只打印 `info` —— `66dcb7d`

## `blackhole` 交付清单（M10）

1. ✅ 星球与危害定义（`src/game/space.ts`、`src/game/scan.ts`）：新增 `blackhole`（黑洞边缘，代号「弥夜」，`kind: 'blackhole'`、`hazard: 'tidal'`，能量回充 ×0.7，青色警示）；`TARGETS` 自动包含，完整接入扫描进度与 `seer.archive` 档案。
2. ✅ 潮汐力场纯逻辑与单测（`src/game/tidal.ts`、`src/game/tidal.test.ts`）：`tidalState(distance, radius)` 分三段——`safe` / `hazard`（1.6R–3.2R，时间膨胀 `timeScale` 1.2→2.4）/ `crush`（<1.6R）；crush 区间累积潮汐张量触发 `ejected` 自动弹开与冷却；`computeEjectTarget` 沿径向推至 `ejectFactor * radius`；全量单测 47 pass。
3. ✅ 黑洞视觉渲染（`src/render/space.ts`、`src/render/textures.ts`）：事件视界纯黑球 + 光子环（1.02–1.06R，朝视向一侧更亮）+ 倾斜吸积盘（1.35R–3.4R，canvas 程序化径向细条带/对数螺旋丝/湍流噪声，内圈快转、additive、多普勒按视线调制亮度与蓝白偏移）+ 引力透镜弧（1.15R–1.6R，扭曲 UV 采样星空/星云，additive 低强度）+ 尘埃幕壳与 ≥300 instanced 逆光尘粒 + 局部 `PointLight`（仅用 `onBeforeCompile`/材质，无后处理框架）。
4. ✅ HUD 与反馈（`src/render/hud.ts`、`src/main.ts`）：顶部青色 `潮汐力场·回充 ×0.7` 警示条；飞行面板实时显示「本地时间 ×1.4」类时间膨胀数字；crush 自动弹开时给出一次性视觉反馈。
5. ✅ 观感门槛与特写实测（`scripts/measure-look.mjs`，2026-11-22，844×390）：cabin `mean 126.17 / darkFrac 0.01 / p95 196.30`、space `mean 92.37 / p95 177.89`；特写 info：icer `91.2/178.2`、gas `77.8/199.4`、red `87.9/217.1`、binary `91.7/174.2`、**black `107.3/250.0`**；竖屏 cabin info `mean 140.96`。

## `ring-city` 交付清单（M11）

1. ✅ 停靠状态机与补给奖励（`src/game/dock.ts`、`src/game/dock.test.ts`）：`dockState(distance, radius, speed)` 输出 `far` / `approach` / `hold` / `docked`；按住 2.5 s 完成停靠，离开时进度衰减，`docked` 后 60 s 冷却；`dockReward()` 补满能量并产出「环城通行密钥」+ 观测日志 —— `faeb208`
2. ✅ `measure-look` 加固：等待 `space` 上限 300 s、截图 `timeout 240 s`、逐星球 `try/catch`、视口失败后重试一次 —— `242c59f`
3. ✅ 主循环与 HUD：停靠接入 `main.ts`；HUD 补给进度条 `#dockProg` / `hud.ts setDock()`；停靠完成写 `seer.archive` 并补满能量 —— `a87765d`
4. ✅ 视觉回归：环城护盾读成淡蓝能量壳（rim pow 3.6→2.5，alpha `0.05 + rim × 0.30`，上限 0.30）；窗光 gain 2.05→1.35，未点亮窗比例 0.22→0.28 —— `08553e8`
5. ✅ M11 look-gate 截图：`ring-844x390.png` / `ring-390x844.png`；`node scripts/measure-look.mjs` → `LOOK OK`（844×390 ring `61.5/139.7`、390×844 ring `59.0/142.4`）；单元测试 57 pass，`node e2e/smoke.mjs` → `SMOKE OK` —— `74d0388`

下一颗候选：待定。

进度标记：⏳ 进行中 · ✅ 已上线（带提交 hash）· 未开始
