// Unified input: keyboard + mouse drag + touch (floating left stick, right
// half drag-to-look). Produces plain numbers; knows nothing about three.

export class Controls {
  /** -1..1 */
  moveX = 0;
  moveY = 0;
  /** true when the stick is pushed to its rim, or Shift is held */
  run = false;
  /** hold buttons — set by keys or by HUD buttons */
  boostKey = false;
  brakeKey = false;
  boostBtn = false;
  brakeBtn = false;
  onInteract: () => void = () => {};
  onAnyGesture: () => void = () => {};

  private keys = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private stickOX = 0;
  private stickOY = 0;
  private lookId = -1;
  private lastX = 0;
  private lastY = 0;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private static readonly STICK_R = 56;

  constructor(surface: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'stick';
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onAnyGesture();
      if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'KeyF') this.onInteract();
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    surface.addEventListener('pointerdown', (e) => {
      this.onAnyGesture();
      surface.setPointerCapture(e.pointerId);
      const leftHalf = e.clientX < window.innerWidth * 0.5;
      if (e.pointerType !== 'mouse' && leftHalf && this.stickId < 0) {
        this.stickId = e.pointerId;
        this.stickOX = e.clientX;
        this.stickOY = e.clientY;
        this.stickX = this.stickY = 0;
        this.base.style.display = 'block';
        this.base.style.left = `${e.clientX}px`;
        this.base.style.top = `${e.clientY}px`;
        this.knob.style.transform = 'translate(-50%, -50%)';
      } else if (this.lookId < 0) {
        this.lookId = e.pointerId;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
      e.preventDefault();
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) {
        let dx = e.clientX - this.stickOX;
        let dy = e.clientY - this.stickOY;
        const len = Math.hypot(dx, dy);
        const R = Controls.STICK_R;
        if (len > R) {
          dx *= R / len;
          dy *= R / len;
        }
        this.stickX = dx / R;
        this.stickY = -dy / R;
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (e.pointerId === this.lookId) {
        this.lookDX += e.clientX - this.lastX;
        this.lookDY += e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === this.stickId) {
        this.stickId = -1;
        this.stickX = this.stickY = 0;
        this.base.style.display = 'none';
      }
      if (e.pointerId === this.lookId) this.lookId = -1;
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** call once per frame before reading */
  poll(): void {
    let x = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    let y = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
    const stickLen = Math.hypot(this.stickX, this.stickY);
    if (stickLen > 0.12) {
      x = this.stickX;
      y = this.stickY;
    }
    this.moveX = x;
    this.moveY = y;
    this.run = this.key('ShiftLeft', 'ShiftRight') || stickLen > 0.92;
    this.boostKey = this.key('Space', 'ShiftLeft', 'ShiftRight');
    this.brakeKey = this.key('KeyX', 'ControlLeft', 'KeyC');
  }

  get boost(): boolean {
    return this.boostKey || this.boostBtn;
  }
  get brake(): boolean {
    return this.brakeKey || this.brakeBtn;
  }

  /** accumulated look drag in CSS px since the last call */
  consumeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return out;
  }
}
