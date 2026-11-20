# seer.glb — 赛尔机器人（按官方设定图重建）

由 `scripts/build-robot.py` 程序化生成，可复现：

```bash
blender -b -P scripts/build-robot.py            # 默认输出到这里
blender -b -P scripts/build-robot.py -- --out /tmp/seer.glb
```

参考：`docs/reference/robot/`（seer_base / seer_story / seer_speed）。

## 约定

| 项 | 值 |
| --- | --- |
| 单位 | 米 |
| 总高 | ~0.95 m（含天线锤头），体宽 ~0.50 m |
| 原点 | 地面、两脚之间 |
| 朝向 | 面朝 glTF **+Z**（Blender 里为 -Y）；`src/render/robot.ts` 沿用「面朝 +z」约定 |
| 三角面 | 8732（≤ 9000） |
| 文件大小 | ~319 KB（≤ 500 KB） |
| 材质 | Principled BSDF → glTF metallic-roughness；眼/头顶白点/天线灯用 emissive + `KHR_materials_emissive_strength`（强度 4） |

## 节点命名（动画挂点）

```
seer                          根（原点）
└─ body                       呼吸起伏 + 行走前倾枢轴
   ├─ torso_ring / _hi / _lo  金橙色躯干环带
   ├─ joint_A / joint_B / joint_C   三颗球形模块插槽（前中 / 左 / 右）
   ├─ head                    颈部枢轴（待机左右 sway）
   │   head_shell             哑光黑大球壳（≈身高 48%）
   │   head_dot               头顶白色高光点
   │   visor_frame            深色铆钉圆环面罩框
   │   face_plate             面罩内凹黑盘
   │   rivet_0..7             8 颗铆钉
   │   ├─ eye                 眨眼枢轴（压扁 y）
   │   │   eye_L / eye_R      白色发光眼块（emissive）
   │   │   pupil_L / pupil_R  黑色下垂瞳孔
   │   ear_L / ear_R          金色声呐圆盘 + ear_in_* 内凹盘 + *_slat 格栅
   │   └─ antenna             天线枢轴（rest 倾斜姿态 + wobble）
   │       ant_base / ant_arm / ant_head(锤头) / ant_face / tip(灯)
   └─ leg_L / leg_R           髋关节枢轴（步态摆动 + 悬浮收腿）
       leg{LR}_hip            髋球
       ├─ leg_tube_L / leg_tube_R   波纹管枢轴（行走时微伸缩）
       │   leg{LR}_core + leg{LR}_bellows0..4（torus 阵列）
       leg{LR}_ankle          踝球
       └─ foot_L / foot_R     飞碟脚（微外八）
           foot{LR}_dome 黑穹顶 / foot{LR}_rim 金包边 /
           foot{LR}_sole 底 / foot{LR}_toe 灰梯形前板
```

材质：`shellBlack`（#1A1A1A 哑光黑 rough .35 / metal .1）、`gold`/`goldHi`
（#D9B45B metal .9 / rough .25）、`gray`（#808080 metal .8 / rough .4，波纹管与
天线）、`grayDark`、`frame`（面罩框）、`face`（面罩内盘）、`ink`（铆钉/瞳孔）、
`eyeWhite`（眼/白点/天线灯，emissive 4）。
