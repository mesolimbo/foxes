export interface Scene {
  create(ctx: CanvasRenderingContext2D): void | Promise<void>;
  update(ctx: CanvasRenderingContext2D, deltaTime: number): void;
}
