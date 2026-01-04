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

// Player sprite config (120x120 per frame, extensible for animation)
const PLAYER_FRAME_SIZE = 120;
const PLAYER_FRAMES = 1;
const PLAYER_SPEED = 8;

// NPC config
const NPC_SIZE = 120;

// Hitbox is 80x80 centered in the 120x120 sprite
const HITBOX_SIZE = 80;
const HITBOX_OFFSET = (TILE_SIZE - HITBOX_SIZE) / 2; // 20px offset

interface Player {
  x: number;
  y: number;
  width: number;
  height: number;
  frame: number;
}

interface NPC {
  x: number;
  y: number;
  width: number;
  height: number;
  img: HTMLImageElement;
  type: "dog" | "chick";
  dead: boolean;
}

export class MazeScene implements Scene {
  private grassImg: HTMLImageElement | null = null;
  private bushesImg: HTMLImageElement | null = null;
  private foxImg: HTMLImageElement | null = null;
  private dogImg: HTMLImageElement | null = null;
  private chickImg: HTMLImageElement | null = null;
  private chickBonesImg: HTMLImageElement | null = null;
  private mapCanvas: OffscreenCanvas | null = null;
  private mapCtx: OffscreenCanvasRenderingContext2D | null = null;
  private wallMatrix: boolean[][] = []; // true = wall, false = grass
  private cameraX = 0;
  private cameraY = 0;
  private keys: Set<string> = new Set();
  private player: Player = { x: 0, y: 0, width: 0, height: 0, frame: 0 };
  private npcs: NPC[] = [];

  async create(ctx: CanvasRenderingContext2D): Promise<void> {
    await this.loadAssets();
    this.generateMaze();
    this.initPlayer();
    this.initNPCs();
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
    [this.grassImg, this.bushesImg, this.foxImg, this.dogImg, this.chickImg, this.chickBonesImg] = await Promise.all([
      this.loadImage("/assets/plain_grass.png"),
      this.loadImage("/assets/bushes.png"),
      this.loadImage("/assets/test-fox.png"),
      this.loadImage("/assets/test-dog.png"),
      this.loadImage("/assets/test-chick.png"),
      this.loadImage("/assets/chick-bones.png"),
    ]);
  }

  private initPlayer(): void {
    if (!this.foxImg) return;

    // Player size (120x120 per frame)
    this.player.width = PLAYER_FRAME_SIZE;
    this.player.height = PLAYER_FRAME_SIZE;

    // Find a random grass tile within the map grid
    for (let attempt = 0; attempt < 50; attempt++) {
      const tileCol = Math.floor(Math.random() * GRID_COLS);
      const tileRow = Math.floor(Math.random() * GRID_ROWS);

      // Skip if out of bounds or is a wall
      if (tileRow < 0 || tileRow >= GRID_ROWS || tileCol < 0 || tileCol >= GRID_COLS) continue;
      if (!this.wallMatrix[tileRow][tileCol]) {
        // Place player at tile origin
        this.player.x = tileCol * TILE_SIZE;
        this.player.y = tileRow * TILE_SIZE;
        return;
      }
    }

    // Fallback: place at tile 1,1 if no grass found
    this.player.x = TILE_SIZE;
    this.player.y = TILE_SIZE;
  }

  private initNPCs(): void {
    const npcData: { img: HTMLImageElement | null; type: "dog" | "chick" }[] = [
      { img: this.dogImg, type: "dog" },
      { img: this.chickImg, type: "chick" },
    ];

    for (const { img, type } of npcData) {
      if (!img) continue;

      // Find a random grass tile not occupied by player or other NPCs
      for (let attempt = 0; attempt < 50; attempt++) {
        const tileCol = Math.floor(Math.random() * GRID_COLS);
        const tileRow = Math.floor(Math.random() * GRID_ROWS);

        // Skip if out of bounds or is a wall
        if (tileRow < 0 || tileRow >= GRID_ROWS || tileCol < 0 || tileCol >= GRID_COLS) continue;
        if (this.wallMatrix[tileRow][tileCol]) continue;

        const x = tileCol * TILE_SIZE;
        const y = tileRow * TILE_SIZE;

        // Skip if hitbox overlaps with player hitbox
        if (this.hitboxesOverlap(x, y, this.player.x, this.player.y)) {
          continue;
        }

        // Skip if overlaps with existing NPCs
        let overlapsNPC = false;
        for (const npc of this.npcs) {
          if (this.hitboxesOverlap(x, y, npc.x, npc.y)) {
            overlapsNPC = true;
            break;
          }
        }
        if (overlapsNPC) continue;

        // Place NPC
        this.npcs.push({ x, y, width: NPC_SIZE, height: NPC_SIZE, img, type, dead: false });
        break;
      }
    }

    // Sort NPCs so dog renders before chick (dog at bottom)
    this.npcs.sort((a, b) => {
      const order = { dog: 0, chick: 1 };
      return order[a.type] - order[b.type];
    });
  }

  private hitboxesOverlap(x1: number, y1: number, x2: number, y2: number): boolean {
    // 60x60 hitboxes centered in 120x120 sprites
    const hx1 = x1 + HITBOX_OFFSET;
    const hy1 = y1 + HITBOX_OFFSET;
    const hx2 = x2 + HITBOX_OFFSET;
    const hy2 = y2 + HITBOX_OFFSET;

    return hx1 < hx2 + HITBOX_SIZE && hx1 + HITBOX_SIZE > hx2 &&
           hy1 < hy2 + HITBOX_SIZE && hy1 + HITBOX_SIZE > hy2;
  }

  private rectsOverlap(x1: number, y1: number, w1: number, h1: number,
                       x2: number, y2: number, w2: number, h2: number): boolean {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
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

    // Handle player movement
    let newX = this.player.x;
    let newY = this.player.y;

    if (this.keys.has("ArrowLeft")) {
      newX -= PLAYER_SPEED;
    }
    if (this.keys.has("ArrowRight")) {
      newX += PLAYER_SPEED;
    }
    if (this.keys.has("ArrowUp")) {
      newY -= PLAYER_SPEED;
    }
    if (this.keys.has("ArrowDown")) {
      newY += PLAYER_SPEED;
    }

    // Check collision and update position
    if (!this.collidesWithWall(newX, this.player.y)) {
      this.player.x = newX;
    }
    if (!this.collidesWithWall(this.player.x, newY)) {
      this.player.y = newY;
    }

    // Clamp player to map bounds
    this.player.x = Math.max(0, Math.min(this.player.x, MAP_WIDTH - this.player.width));
    this.player.y = Math.max(0, Math.min(this.player.y, MAP_HEIGHT - this.player.height));

    // Check if player caught a chick
    this.checkChickCollisions();

    // Camera follows player (centered)
    this.cameraX = this.player.x + this.player.width / 2 - VIEWPORT_WIDTH / 2;
    this.cameraY = this.player.y + this.player.height / 2 - VIEWPORT_HEIGHT / 2;

    // Clamp camera to map bounds
    this.cameraX = Math.max(0, Math.min(this.cameraX, MAP_WIDTH - VIEWPORT_WIDTH));
    this.cameraY = Math.max(0, Math.min(this.cameraY, MAP_HEIGHT - VIEWPORT_HEIGHT));

    // Draw map
    ctx.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    ctx.drawImage(
      this.mapCanvas,
      this.cameraX, this.cameraY, VIEWPORT_WIDTH, VIEWPORT_HEIGHT,
      0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT
    );

    // Draw dead NPCs (bones) right above background
    for (const npc of this.npcs) {
      if (!npc.dead) continue;
      const screenX = npc.x - this.cameraX;
      const screenY = npc.y - this.cameraY;
      ctx.drawImage(
        npc.img,
        0, 0, npc.img.width, npc.img.height,
        screenX, screenY, npc.width, npc.height
      );
    }

    // Draw player (fox)
    if (this.foxImg) {
      const screenX = this.player.x - this.cameraX;
      const screenY = this.player.y - this.cameraY;
      const frameWidth = this.foxImg.width / PLAYER_FRAMES;
      const frameX = this.player.frame * frameWidth;

      ctx.drawImage(
        this.foxImg,
        frameX, 0, frameWidth, this.foxImg.height,
        screenX, screenY, this.player.width, this.player.height
      );
    }

    // Draw live NPCs on top (dog, then chick)
    for (const npc of this.npcs) {
      if (npc.dead) continue;
      const screenX = npc.x - this.cameraX;
      const screenY = npc.y - this.cameraY;
      ctx.drawImage(
        npc.img,
        0, 0, npc.img.width, npc.img.height,
        screenX, screenY, npc.width, npc.height
      );
    }
  }

  private collidesWithWall(x: number, y: number): boolean {
    // Player hitbox (60x60 centered)
    const phx = x + HITBOX_OFFSET;
    const phy = y + HITBOX_OFFSET;

    // Check collision with bush tiles using 60x60 hitboxes
    const startCol = Math.floor(phx / TILE_SIZE);
    const endCol = Math.floor((phx + HITBOX_SIZE - 1) / TILE_SIZE);
    const startRow = Math.floor(phy / TILE_SIZE);
    const endRow = Math.floor((phy + HITBOX_SIZE - 1) / TILE_SIZE);

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        if (this.wallMatrix[row]?.[col]) {
          // Bush hitbox (60x60 centered in tile)
          const bhx = col * TILE_SIZE + HITBOX_OFFSET;
          const bhy = row * TILE_SIZE + HITBOX_OFFSET;

          if (phx < bhx + HITBOX_SIZE && phx + HITBOX_SIZE > bhx &&
              phy < bhy + HITBOX_SIZE && phy + HITBOX_SIZE > bhy) {
            return true;
          }
        }
      }
    }

    // Check collision with NPCs using 60x60 hitboxes (skip dead NPCs and chicks)
    // Chicks don't block movement - they get caught instead
    for (const npc of this.npcs) {
      if (!npc.dead && npc.type !== "chick" && this.hitboxesOverlap(x, y, npc.x, npc.y)) {
        return true;
      }
    }

    return false;
  }

  private checkChickCollisions(): void {
    for (const npc of this.npcs) {
      if (npc.type === "chick" && !npc.dead) {
        if (this.hitboxesOverlap(this.player.x, this.player.y, npc.x, npc.y)) {
          // Kill the chick
          npc.dead = true;
          if (this.chickBonesImg) {
            npc.img = this.chickBonesImg;
          }
        }
      }
    }
  }
}
