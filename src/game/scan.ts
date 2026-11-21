// Planetary scan logic — pure, no three, no DOM. The caller supplies the
// nearest in-range ScanTarget each frame; the Scanner keeps engagement state
// (id / progress / done) so progress survives leaving range and only resets
// when a different target comes into view.

export type HazardKind = 'cold' | 'radiation' | 'wind' | 'gravity';

export interface ScanTarget {
  id: string;
  name: string;
  radius: number;
  hazard?: HazardKind;
}

export type ScanEvent =
  | { type: 'enter'; id: string }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'complete'; id: string; resource: string; amount: number; log: string }
  | { type: 'leave'; id: string };

export const SCAN = {
  /** engage distance = planet radius × this */
  rangeFactor: 3.2,
  /** seconds of holding `act` to finish a scan */
  duration: 4.2,
  /** progress lost per second while released / out of range */
  decay: 0.35,
} as const;

export function withinScan(dist: number, radius: number): boolean {
  return dist <= radius * SCAN.rangeFactor;
}

/** stable 32-bit string hash (fnv-1a) for deterministic yield amounts */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** fixed resource per planet kind — the table new planets draw from */
export const RESOURCE_BY_KIND: Record<string, string> = {
  'ice-ring': '氦-3 冰芯',
  'gas-storm': '风暴氦芯',
  'red-giant': '红巨星等离子',
  ocean: '重水样本',
  gas: '氦气罐',
  ice: '冰晶',
  lava: '硫化物',
};

/** known planet id → resource (mirrors RESOURCE_BY_KIND for this sector) */
const RESOURCE_BY_ID: Record<string, string> = {
  kelos: '重水样本',
  helka: '氦气罐',
  seron: '冰晶',
  volc: '硫化物',
  icer: '氦-3 冰芯',
  'gas-storm': '风暴氦芯',
  'red-giant': '红巨星等离子',
};

const LOG_BY_ID: Record<string, string> = {
  kelos: '全球海洋覆盖，深层洋流中富含重水，采样数据稳定。',
  helka: '高层大气氦浓度偏高，风带湍急但采集窗口充足。',
  seron: '极冠冰层纯净透亮，冰晶晶格完整，适合长期封存。',
  volc: '岩浆活动频繁，喷口周边富集硫化物结晶信号。',
  icer: '环带冰粒纯净，芯部氦-3丰度极高，卡西尼缝边缘结晶完整。',
  'gas-storm': '巨型反气旋风暴眼持续旋转，轨道悬浮采集站正从云带抽取高纯氦芯。',
  'red-giant': '红巨星日冕耀斑剧烈翻涌，强辐射穿透厚重尘埃幕，高温等离子信号充盈星域。',
};

const GENERIC_LOGS: readonly string[] = [
  '光谱扫描完成，表层成分与辐射水平已记入档案。',
  '远距离观测结束，轨道参数与质量估算已归档。',
  '扫描波束回波清晰，矿物分布图谱保存完毕。',
];

export interface ScanResult {
  resource: string;
  amount: number;
  log: string;
}

/** deterministic yield for a target id: resource from the fixed table,
 *  amount = 3 + (hash % 5), log a stable 20–40 字 observation line */
export function scanResult(id: string): ScanResult {
  const kinds = Object.keys(RESOURCE_BY_KIND);
  const resource = RESOURCE_BY_ID[id] ?? RESOURCE_BY_KIND[kinds[hashId(id) % kinds.length]];
  return {
    resource,
    amount: 3 + (hashId(id) % 5),
    log: LOG_BY_ID[id] ?? GENERIC_LOGS[hashId(id) % GENERIC_LOGS.length],
  };
}

export interface HazardEffect {
  /** multiplier applied to boost-energy regeneration */
  energyMul: number;
  /** HUD warning line (cyan / gold, never red) */
  warn: string | null;
}

const HAZARDS: Record<HazardKind, HazardEffect & { warn: string }> = {
  cold: { energyMul: 0.55, warn: '低温·推进器效率下降' },
  radiation: { energyMul: 1, warn: '强辐射·护盾警报' },
  wind: { energyMul: 1, warn: '气流·航向漂移' },
  gravity: { energyMul: 0.8, warn: '强引力·注意距离' },
};

export function hazardEffect(h: HazardKind | undefined): HazardEffect {
  if (!h) return { energyMul: 1, warn: null };
  const e = HAZARDS[h];
  return { energyMul: e.energyMul, warn: e.warn };
}

export class Scanner {
  /** engaged target id (kept while out of range so progress can resume) */
  id: string | null = null;
  progress = 0;
  done = false;

  /**
   * @param near  the in-range target this frame (null when none)
   * @param holding  interaction key held
   */
  update(dt: number, near: ScanTarget | null, holding: boolean): ScanEvent[] {
    const ev: ScanEvent[] = [];
    if (near && near.id !== this.id) {
      if (this.id !== null) ev.push({ type: 'leave', id: this.id });
      this.id = near.id;
      this.progress = 0;
      this.done = false;
      ev.push({ type: 'enter', id: near.id });
    }
    if (this.id === null || this.done) return ev;

    const before = this.progress;
    if (near && holding) this.progress = Math.min(1, this.progress + dt / SCAN.duration);
    else this.progress = Math.max(0, this.progress - SCAN.decay * dt);
    if (this.progress !== before) ev.push({ type: 'progress', id: this.id, progress: this.progress });

    if (this.progress >= 1) {
      this.done = true;
      ev.push({ type: 'complete', id: this.id, ...scanResult(this.id) });
    }
    return ev;
  }
}
