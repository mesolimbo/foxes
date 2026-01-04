import type { Scene } from "../engine/scene";

const TILE_SIZE = 120;
const MAP_WIDTH = 1320; // 11 tiles wide (closest to 1280 with full tiles)
const MAP_HEIGHT = 720; // 6 tiles tall
const VIEWPORT_WIDTH = 426;
const VIEWPORT_HEIGHT = 720;
const GRID_COLS = 11;
const GRID_ROWS = 6;

// Bush sprite indices (0-indexed)
const BUSH_VERT_MIDDLE = 0;
const BUSH_VERT_CAP_TOP = 1;
const BUSH_HORIZ_MIDDLE = 2;
const BUSH_HORIZ_CAP_LEFT = 3;
const BUSH_JOINER = 4;
const BUSH_HORIZ_CAP_RIGHT = 5;
const BUSH_VERT_CAP_BOTTOM = 6;

// Wall segment length (2 = just caps, 3+ = caps with middle)
const MIN_WALL_LENGTH = 2;
const MAX_WALL_LENGTH = 5;
const NUM_DETACHED_WALLS = 6; // Free-standing walls (in addition to the intersecting pair)
const MAX_PLACEMENT_ATTEMPTS = 200; // Max iterations to place all walls

export class MazeScene implements Scene {
  private grassImg: HTMLImageElement | null = null;
  private bushesImg: HTMLImageElement | null = null;
  private mapCanvas: OffscreenCanvas | null = null;
  private mapCtx: OffscreenCanvasRenderingContext2D | null = null;
  private wallMatrix: boolean[][] = []; // true = wall, false = grass
  private cameraX = 0;
  private cameraY = 0;
  private keys: Set<string> = new Set();

  async create(ctx: CanvasRenderingContext2D): Promise<void> {
    await this.loadAssets();
    this.generateMaze();
    this.renderMapToBuffer();
    this.setupInput();
  }

  private setupInput(): void {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.key);
    });
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  private async loadAssets(): Promise<void> {
    [this.grassImg, this.bushesImg] = await Promise.all([
      this.loadImage("/assets/plain_grass.png"),
      this.loadImage("/assets/bushes.png"),
    ]);
  }

  private generateMaze(): void {
    // Initialize wall matrix - all false (grass)
    this.wallMatrix = [];
    for (let row = 0; row < GRID_ROWS; row++) {
      this.wallMatrix.push(new Array(GRID_COLS).fill(false));
    }

    // Place one intersecting pair (horizontal + vertical that cross)
    this.placeIntersectingPair();

    // Place additional detached walls, iterating until we have enough
    let placedCount = 0;
    let attempts = 0;

    while (placedCount < NUM_DETACHED_WALLS && attempts < MAX_PLACEMENT_ATTEMPTS) {
      if (this.placeDetachedWall()) {
        placedCount++;
      }
      attempts++;
    }

    console.log(`Placed ${placedCount} detached walls in ${attempts} attempts`);
  }

  private placeIntersectingPair(): void {
    // Ensure walls are at least 3 tiles so intersection has arms on both sides
    const hLength = 3;
    const vLength = 3;

    // Place intersection towards left side to leave room for detached walls
    const hRow = 2;
    const hStartCol = 2;

    // Place horizontal wall
    for (let c = hStartCol; c < hStartCol + hLength; c++) {
      this.wallMatrix[hRow][c] = true;
    }

    // Intersection in middle of horizontal wall
    const intersectCol = hStartCol + 1;

    // Place vertical wall centered on intersection
    for (let r = 1; r <= 3; r++) {
      this.wallMatrix[r][intersectCol] = true;
    }
  }

  private placeDetachedWall(): boolean {
    const isHorizontal = Math.random() < 0.5;
    const length = MIN_WALL_LENGTH + Math.floor(Math.random() * (MAX_WALL_LENGTH - MIN_WALL_LENGTH + 1));

    let startCol: number, startRow: number;
    let positions: { row: number; col: number }[] = [];

    if (isHorizontal) {
      const maxStartCol = GRID_COLS - 1 - length;
      if (maxStartCol < 1) return false;
      startCol = 1 + Math.floor(Math.random() * maxStartCol);
      startRow = 1 + Math.floor(Math.random() * (GRID_ROWS - 2));

      for (let c = startCol; c < startCol + length; c++) {
        positions.push({ row: startRow, col: c });
      }
    } else {
      const maxStartRow = GRID_ROWS - 1 - length;
      if (maxStartRow < 1) return false;
      startRow = 1 + Math.floor(Math.random() * maxStartRow);
      startCol = 1 + Math.floor(Math.random() * (GRID_COLS - 2));

      for (let r = startRow; r < startRow + length; r++) {
        positions.push({ row: r, col: startCol });
      }
    }

    // Check if any position touches an existing wall
    for (const pos of positions) {
      if (this.touchesAnyWall(pos.row, pos.col)) {
        return false;
      }
    }

    // Place the wall
    for (const pos of positions) {
      this.wallMatrix[pos.row][pos.col] = true;
    }
    return true;
  }

  private touchesAnyWall(row: number, col: number): boolean {
    // Check if cell is occupied or touches any existing wall (all 4 directions)
    if (this.wallMatrix[row][col]) return true;
    if (row > 0 && this.wallMatrix[row - 1][col]) return true;
    if (row < GRID_ROWS - 1 && this.wallMatrix[row + 1][col]) return true;
    if (col > 0 && this.wallMatrix[row][col - 1]) return true;
    if (col < GRID_COLS - 1 && this.wallMatrix[row][col + 1]) return true;
    return false;
  }

  private isWall(row: number, col: number): boolean {
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
      return false;
    }
    return this.wallMatrix[row][col];
  }

  private getTileIndex(row: number, col: number): number {
    // Check neighbors
    const up = this.isWall(row - 1, col);
    const down = this.isWall(row + 1, col);
    const left = this.isWall(row, col - 1);
    const right = this.isWall(row, col + 1);

    const hasVertical = up || down;
    const hasHorizontal = left || right;

    // Intersection (both vertical and horizontal neighbors)
    if (hasVertical && hasHorizontal) {
      return BUSH_JOINER;
    }

    // Vertical segment
    if (hasVertical) {
      if (up && down) {
        return BUSH_VERT_MIDDLE;
      } else if (down) {
        // Only neighbor below = this is the top cap
        return BUSH_VERT_CAP_TOP;
      } else {
        // Only neighbor above = this is the bottom cap
        return BUSH_VERT_CAP_BOTTOM;
      }
    }

    // Horizontal segment
    if (hasHorizontal) {
      if (left && right) {
        return BUSH_HORIZ_MIDDLE;
      } else if (right) {
        // Only neighbor to right = this is the left cap
        return BUSH_HORIZ_CAP_LEFT;
      } else {
        // Only neighbor to left = this is the right cap
        return BUSH_HORIZ_CAP_RIGHT;
      }
    }

    // Isolated - use joiner as default
    return BUSH_JOINER;
  }

  private renderMapToBuffer(): void {
    this.mapCanvas = new OffscreenCanvas(MAP_WIDTH, MAP_HEIGHT);
    this.mapCtx = this.mapCanvas.getContext("2d")!;

    // Draw grass background
    if (this.grassImg) {
      const grassW = this.grassImg.width;
      const grassH = this.grassImg.height;
      for (let y = 0; y < MAP_HEIGHT; y += grassH) {
        for (let x = 0; x < MAP_WIDTH; x += grassW) {
          this.mapCtx.drawImage(this.grassImg, x, y);
        }
      }
    }

    // Draw bush tiles based on wall matrix
    if (this.bushesImg) {
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          if (this.wallMatrix[row][col]) {
            const tileIndex = this.getTileIndex(row, col);
            this.mapCtx.drawImage(
              this.bushesImg,
              tileIndex * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE,
              col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE
            );
          }
        }
      }
    }
  }

  update(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
    if (!this.mapCanvas) return;

    // Handle camera movement
    const SCROLL_SPEED = 15;
    if (this.keys.has("ArrowLeft")) {
      this.cameraX -= SCROLL_SPEED;
    }
    if (this.keys.has("ArrowRight")) {
      this.cameraX += SCROLL_SPEED;
    }
    if (this.keys.has("ArrowUp")) {
      this.cameraY -= SCROLL_SPEED;
    }
    if (this.keys.has("ArrowDown")) {
      this.cameraY += SCROLL_SPEED;
    }

    // Clamp camera to map bounds
    this.cameraX = Math.max(0, Math.min(this.cameraX, MAP_WIDTH - VIEWPORT_WIDTH));
    this.cameraY = Math.max(0, Math.min(this.cameraY, MAP_HEIGHT - VIEWPORT_HEIGHT));

    ctx.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    ctx.drawImage(
      this.mapCanvas,
      this.cameraX, this.cameraY, VIEWPORT_WIDTH, VIEWPORT_HEIGHT,
      0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT
    );
  }
}
