#!/usr/bin/env python3
"""Build the official-style Seer robot procedurally and export public/models/seer.glb.

Modelled from the official character sheets (docs/reference/robot/),
chibi "short & chubby" proportions — total height H = 1.00, head width W = 0.58:
feet 12% H · legs 13% H · gold-ring torso 9% H · head shell ~55% H · antenna 11% H.
Feet splay outward to 1.10 W, gold ring torso 0.97 W, visor 0.69 W.
Face: dark riveted visor plate with two white emissive eyes, each with a
black vertical pupil and a white highlight dot (calm, neutral expression).

Run headless:  blender -b -P scripts/build-robot.py [-- --out path.glb]

Conventions (written into public/models/README.md):
  * units: metres; total height ~1.0 m, width ~0.50 m
  * origin: on the ground, centred between the feet
  * facing: -Y in Blender  ->  +Z in glTF/three.js
  * pivots: `body` (breath bob + lean), `head` (sway), `leg_L/R` (hip),
    `leg_tube_L/R` (bellows stretch), `antenna` (wobble), `eye` (blink),
    `tip` (antenna light pulse)
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public/models/seer.glb")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out" in argv:
    OUT = argv[argv.index("--out") + 1]

# ── reset ────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)

# ── materials ────────────────────────────────────────────────────────
def mat(name, color, rough, metal, emit=None, estr=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = estr
    return m

M_BLACK = mat("shellBlack", (0.075, 0.075, 0.078), 0.35, 0.10)   # #1A1A1A head/feet
M_GOLD = mat("gold", (0.72, 0.55, 0.22), 0.25, 0.90)             # #D9B45B ring/ears
M_GOLD_HI = mat("goldHi", (0.85, 0.70, 0.38), 0.30, 0.85)        # trim highlight
M_GRAY = mat("gray", (0.42, 0.42, 0.44), 0.40, 0.80)             # #808080 bellows/joints
M_GRAY_D = mat("grayDark", (0.22, 0.22, 0.24), 0.50, 0.60)       # grooves/inner discs
M_FRAME = mat("frame", (0.14, 0.14, 0.155), 0.42, 0.30)          # visor ring
M_FACE = mat("face", (0.02, 0.02, 0.025), 0.55, 0.20)            # visor interior
M_INK = mat("ink", (0.015, 0.015, 0.018), 0.50, 0.10)            # rivets/pupils
M_BLUE = mat("blue", (0.16, 0.55, 0.88), 0.35, 0.60)             # antenna cap
M_EYE = mat("eyeWhite", (1, 1, 1), 0.40, 0.0, emit=(1, 1, 1), estr=2.4)

# ── helpers ──────────────────────────────────────────────────────────
def _fin(o, name, material, smooth=True):
    o.name = name
    o.data.name = name + "_mesh"
    if material:
        o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o

def sphere(name, r, loc, scale, material, seg=20, rings=14, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r,
                                         location=loc, rotation=rot)
    o = _fin(bpy.context.object, name, material)
    o.scale = scale
    if parent:
        o.parent = parent
    return o

def cyl(name, r, h, loc, material, rot=(0, 0, 0), seg=16, r2=None, parent=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=h,
                                            location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=r2, depth=h,
                                        location=loc, rotation=rot)
    o = _fin(bpy.context.object, name, material, smooth=False)
    for p in o.data.polygons:
        if abs(p.normal.z) < 0.7:
            p.use_smooth = True
    if parent:
        o.parent = parent
    return o

def box(name, size, loc, material, rot=(0, 0, 0), parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    o = _fin(bpy.context.object, name, material, smooth=False)
    o.scale = size
    if bevel > 0:
        mod = o.modifiers.new("bev", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    if parent:
        o.parent = parent
    return o

def torus(name, major, minor, loc, material, rot=(0, 0, 0), parent=None, majseg=24, minseg=8):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=majseg, minor_segments=minseg,
        location=loc, rotation=rot)
    o = _fin(bpy.context.object, name, material)
    if parent:
        o.parent = parent
    return o

def half_torus(name, major, minor, loc, material, majseg=24, minseg=8):
    """Torus with the y<0 half deleted — an open arc spanning local +Y."""
    import bmesh
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=majseg, minor_segments=minseg,
                                     location=loc)
    o = _fin(bpy.context.object, name, material)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for v in [v for v in bm.verts if v.co.y < 0]:
        bm.verts.remove(v)
    bm.to_mesh(o.data)
    bm.free()
    return o

def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    bpy.context.collection.objects.link(o)
    if parent:
        o.parent = parent
    return o

def child(o, parent, loc, rot=(0, 0, 0)):
    """Re-parent keeping `loc` as the new LOCAL transform."""
    o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    return o

X90 = (math.pi / 2, 0, 0)
Y90 = (0, math.pi / 2, 0)

# ── rig ──────────────────────────────────────────────────────────────
# Vertical layout (world Z, metres): feet 0–0.12 · legs 0.12–0.25 ·
# torso ring 0.25–0.34 · head shell 0.31–0.90 · antenna 0.89–1.00.
seer = empty("seer", (0, 0, 0))
body = empty("body", (0, 0, 0), seer)

# torso — one fat gold ring (0.97 W ≈ 0.56 wide) + three ball sockets
RING_Z = 0.30
torso_ring = torus("torso_ring", 0.240, 0.041, (0, 0, 0), M_GOLD, majseg=28, minseg=8)
child(torso_ring, body, (0, 0, RING_Z))
ring_hi = torus("torso_ring_hi", 0.242, 0.017, (0, 0, 0), M_GOLD_HI, majseg=28, minseg=6)
child(ring_hi, body, (0, 0, RING_Z + 0.028))
ring_lo = torus("torso_ring_lo", 0.233, 0.016, (0, 0, 0), M_GRAY_D, majseg=28, minseg=6)
child(ring_lo, body, (0, 0, RING_Z - 0.030))

# dark collar plugging the annular gap between ring ID and the skull's belly
neck = cyl("neck", 0.215, 0.16, (0, 0, 0), M_BLACK, seg=20, r2=0.135)
child(neck, body, (0, 0, 0.34))

joints = {"joint_A": (0, -0.252, 0.295, 0.050),
          "joint_B": (-0.248, -0.02, 0.30, 0.052),
          "joint_C": (0.248, -0.02, 0.30, 0.052)}
for name, (x, y, z, r) in joints.items():
    j = sphere(name, r, (x, y, z), (1, 1, 1), M_GRAY, seg=12, rings=8)
    child(j, body, (x, y, z))

# ── head — pivot at the neck (z=0.30); children local to it ──────────
# skull: r=0.29 ball centred at world z=0.605 → spans 0.315–0.895 (≈55% H),
# 0.58 wide (head width = W).
head = empty("head", (0, 0, 0.30), body)
SK = 0.305                            # local z of the skull centre

skull = sphere("head_shell", 0.29, (0, 0, 0), (1.0, 0.97, 1.0), M_BLACK, seg=22, rings=14)
child(skull, head, (0, 0, SK))

# small white specular dot on the skull (signature detail on the sheets)
dot = sphere("head_dot", 0.022, (0, 0, 0), (1.0, 0.45, 1.25), M_EYE, seg=10, rings=8)
child(dot, head, (0.115, -0.16, SK + 0.21), (0.5, 0.55, 0))

# ── visor — bolted-on faceplate on the front of the ball ─────────────
# face empty sits slightly embedded; +z is the plate normal (tilted ~15° up).
FACE_TILT = 1.30
face_g = empty("face", (0, -0.252, SK + 0.075), head)
face_g.rotation_euler = (FACE_TILT, 0, 0)

plate = cyl("face_plate", 0.176, 0.030, (0, 0, 0), M_FACE, seg=28)
child(plate, face_g, (0, 0, 0.006))
frame = torus("visor_frame", 0.176, 0.028, (0, 0, 0), M_FRAME, majseg=28, minseg=8)
child(frame, face_g, (0, 0, 0.010))

for i in range(8):
    a = math.radians(i * 45 + 22.5)
    rv = sphere(f"rivet_{i}", 0.0125, (0, 0, 0), (1, 1, 0.7), M_INK, seg=10, rings=6)
    child(rv, face_g, (0.176 * math.cos(a), 0.176 * math.sin(a), 0.036))

# eyes — two white vertical ovals, centred black slit pupils + highlight dot
eye = empty("eye", (0, -0.002, 0.030), face_g)
for s, tag in ((-1, "L"), (1, "R")):
    w = sphere(f"eye_{tag}", 0.056, (0, 0, 0), (0.80, 1.30, 0.30), M_EYE, seg=14, rings=10)
    child(w, eye, (s * 0.063, 0.004, 0))
    p = sphere(f"pupil_{tag}", 0.020, (0, 0, 0), (0.62, 2.05, 0.55), M_INK, seg=10, rings=8)
    child(p, eye, (s * 0.063, 0.010, 0.019))
    h = sphere(f"hi_{tag}", 0.010, (0, 0, 0), (1, 1, 0.5), M_EYE, seg=8, rings=6)
    child(h, eye, (s * 0.058, 0.036, 0.030))

# ears — gold half-rings hugging the lower sides of the head, opening down
# and leaning slightly rearward (headphone arc on the sheets).
ear_rot = (Matrix.Rotation(-0.35, 4, 'X')
           @ Matrix.Rotation(math.pi / 2, 4, 'Z')
           @ Matrix.Rotation(math.pi / 2, 4, 'X')).to_euler()
for s, tag in ((-1, "L"), (1, "R")):
    e = half_torus(f"ear_{tag}", 0.105, 0.030, (0, 0, 0), M_GOLD, majseg=20)
    child(e, head, (s * 0.225, 0.015, 0.170), ear_rot)

# ── antenna — tilted folded-plate radar + blue-capped rear tube ──────
antenna = empty("antenna", (-0.06, 0.06, 0.50), head)
antenna.rotation_euler = (0.42, -0.30, 0.08)
base = cyl("ant_base", 0.036, 0.06, (0, 0, 0), M_GRAY, seg=12)
child(base, antenna, (0, 0, 0.02))
pa = box("ant_panelA", (0.065, 0.095, 0.17), (0, 0, 0), M_GRAY, bevel=0.014)
child(pa, antenna, (0, 0, 0.10), (-0.15, 0, 0))
pb = box("ant_panelB", (0.155, 0.085, 0.075), (0, 0, 0), M_GRAY, bevel=0.020)
child(pb, antenna, (0, -0.005, 0.195), (0.55, 0, 0))
tube = cyl("ant_tube", 0.024, 0.11, (0, 0, 0), M_GRAY, rot=X90, seg=12)
child(tube, antenna, (0, 0.06, 0.115), X90)
cap = cyl("ant_cap", 0.030, 0.030, (0, 0, 0), M_BLUE, rot=X90, seg=12)
child(cap, antenna, (0, 0.12, 0.115), X90)
tip = sphere("tip", 0.017, (0, 0, 0), (1, 1, 1), M_EYE, seg=10, rings=8)
child(tip, antenna, (0, -0.065, 0.195))

# ── legs — ball hip, corrugated bellows (13% H), wide splayed foot ───
def build_leg(s):
    tag = "L" if s < 0 else "R"
    pivot = empty(f"leg_{tag}", (s * 0.085, 0, 0.265), body)

    hip = sphere(f"leg{tag}_hip", 0.048, (0, 0, 0), (1, 1, 1), M_GRAY, seg=12, rings=8)
    child(hip, pivot, (0, 0, -0.005))

    tube = empty(f"leg_tube_{tag}", (0, 0, 0), pivot)
    core = cyl(f"leg{tag}_core", 0.042, 0.15, (0, 0, 0), M_GRAY_D, seg=12)
    child(core, tube, (0, 0, -0.105))
    for i in range(4):
        r = torus(f"leg{tag}_bellows{i}", 0.052, 0.015, (0, 0, 0), M_GRAY,
                  majseg=14, minseg=5)
        child(r, tube, (0, 0, -0.055 - i * 0.034))

    ankle = sphere(f"leg{tag}_ankle", 0.040, (0, 0, 0), (1, 1, 1), M_GRAY, seg=10, rings=8)
    child(ankle, pivot, (0, 0, -0.16))

    # foot: wide oval sole + black dome + gold rim + grey toe pad, toe-out ~23°.
    # Centres only ±0.095 from the hip: heels nearly touch, toes flare so the
    # pair spans ≈1.10 W (0.64 m) — wider than the head.
    foot = empty(f"foot_{tag}", (s * 0.028, -0.01, -0.265), pivot)
    foot.rotation_euler = (0, 0, s * 0.40)

    sole = cyl(f"foot{tag}_sole", 0.15, 0.022, (0, 0, 0), M_FACE, seg=20)
    sole.scale = (1.04, 1.35, 1.0)
    child(sole, foot, (0, 0, 0.011))
    dome = sphere(f"foot{tag}_dome", 0.15, (0, 0, 0), (1.03, 1.33, 0.42), M_BLACK,
                  seg=18, rings=10)
    child(dome, foot, (0, -0.005, 0.055))
    rim = torus(f"foot{tag}_rim", 0.148, 0.020, (0, 0, 0), M_GOLD, majseg=22, minseg=6)
    rim.scale = (1.04, 1.33, 0.55)
    child(rim, foot, (0, -0.005, 0.030))
    toe = box(f"foot{tag}_toe", (0.11, 0.055, 0.030), (0, 0, 0), M_GRAY, bevel=0.010)
    child(toe, foot, (0, -0.185, 0.042), (-0.5, 0, 0))
    return pivot

legL = build_leg(-1)
legR = build_leg(1)

# ── export ───────────────────────────────────────────────────────────
for o in bpy.context.scene.objects:
    o.select_set(True)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_animations=False,
    export_extras=False,
    export_skins=False,
    export_morph=False,
)

# report
tris = 0
for o in bpy.context.scene.objects:
    if o.type == "MESH":
        m = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        m.calc_loop_triangles()
        tris += len(m.loop_triangles)
size = os.path.getsize(OUT)
print(f"SEER-GLB objects={sum(1 for o in bpy.context.scene.objects if o.type == 'MESH')} "
      f"tris={tris} size={size}B ({size / 1024:.1f}KB) -> {OUT}")
