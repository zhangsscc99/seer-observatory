// Single source of colour truth — see docs/ART-SPEC.md §1.
export const PAL = {
  hullWhite: 0xf2f6fa,
  hullShade: 0xc9d4e0,
  panelGrey: 0x8e9db0,
  metalDark: 0x3a475a,
  visor: 0x0c1b33,
  cyan: 0x38e1ff,
  cyanDeep: 0x1296d8,
  blueCarpet: 0x1c3f9e,
  holoGreen: 0x4dffa0,
  tealAccent: 0x2fe6b8,
  warmWhite: 0xffffff,
  spaceDeep: 0x0a1030,
  nebulaViolet: 0x7a48d8,
  nebulaBlue: 0x2a7af0,
  sun: 0xfff1c8,
  thruster: 0x7fe9ff,
} as const;

export const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
