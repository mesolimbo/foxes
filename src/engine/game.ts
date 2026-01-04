import type { Scene } from "./scene";

const TARGET_FPS = 30;
const FRAME_TIME = 1000 / TARGET_FPS;

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private currentScene: Scene | null = null;
  private lastTime = 0;
  private accumulator = 0;

  constructor(canvasId: string) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) {
      throw new Error(`Canvas element with id "${canvasId}" not found`);
    }
    this.canvas = canvas;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get 2D context");
    }
    this.ctx = ctx;
  }

  async setScene(scene: Scene): Promise<void> {
    this.currentScene = scene;
    await scene.create(this.ctx);
  }

  start(): void {
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private loop = (currentTime: number): void => {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    this.accumulator += deltaTime;

    while (this.accumulator >= FRAME_TIME) {
      if (this.currentScene) {
        this.currentScene.update(this.ctx, FRAME_TIME);
      }
      this.accumulator -= FRAME_TIME;
    }

    requestAnimationFrame(this.loop);
  };

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }
}
