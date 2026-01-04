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

// NPC AI speeds (pixels per frame)
const CHICK_SPEED_WANDER = 2;
const CHICK_SPEED_FLEE = 5;
const DOG_SPEED_WANDER = 3;
const DOG_SPEED_CHASE = 5;
const DOG_CHASE_RANGE = 300; // pixels - dog only chases if within this distance

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
  img: ImageBitmap;
  type: "dog" | "chick";
  dead: boolean;
  // AI state
  wanderTarget: { x: number; y: number };
  nextWanderTime: number;
  stuckTime: number;
  prevX: number;
  prevY: number;
}

export class MazeScene implements Scene {
  private grassImg: ImageBitmap | null = null;
  private bushesImg: ImageBitmap | null = null;
  private foxImg: ImageBitmap | null = null;
  private dogImg: ImageBitmap | null = null;
  private chickImg: ImageBitmap | null = null;
  private chickBonesImg: ImageBitmap | null = null;
  private titleImg: ImageBitmap | null = null;
  private mapCanvas: OffscreenCanvas | null = null;
  private mapCtx: OffscreenCanvasRenderingContext2D | null = null;
  private wallMatrix: boolean[][] = []; // true = wall, false = grass
  private cameraX = 0;
  private cameraY = 0;
  private keys: Set<string> = new Set();
  private player: Player = { x: 0, y: 0, width: 0, height: 0, frame: 0 };
  private npcs: NPC[] = [];
  private gameStarted = false;
  private gameOver = false;
  private levelComplete = false;
  private canvas: HTMLCanvasElement | null = null;
  private mouseTarget: { x: number; y: number } | null = null;
  private isMouseDown = false;
  private score = 0;
  private highScore = 0;
  private level = 1;

  async create(ctx: CanvasRenderingContext2D): Promise<void> {
    this.canvas = ctx.canvas;
    this.loadHighScore();
    await this.loadAssets();
    this.generateMaze();
    this.initPlayer();
    this.initNPCs();
    this.renderMapToBuffer();
    this.setupInput();
  }

  private loadHighScore(): void {
    const match = document.cookie.match(/foxHighScore=(\d+)/);
    if (match) {
      this.highScore = parseInt(match[1], 10);
    }
  }

  private saveHighScore(): void {
    // Cookie expires in 1 year
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1);
    document.cookie = `foxHighScore=${this.highScore};expires=${expires.toUTCString()};path=/`;
  }

  private setupInput(): void {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key);
      // Space to start game, restart when game over, or continue when level complete
      if (e.key === " ") {
        if (!this.gameStarted) {
          this.startGame();
        } else if (this.gameOver) {
          this.restartGame();
        } else if (this.levelComplete) {
          this.nextLevel();
        }
      }
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.key);
    });

    // Mouse/touch input for movement and restart
    const getWorldPos = (clientX: number, clientY: number) => {
      if (!this.canvas) return null;
      const rect = this.canvas.getBoundingClientRect();
      const screenX = clientX - rect.left;
      const screenY = clientY - rect.top;
      return {
        x: screenX + this.cameraX,
        y: screenY + this.cameraY,
      };
    };

    // Mouse events
    this.canvas?.addEventListener("mousedown", (e) => {
      if (!this.gameStarted) {
        this.startGame();
        return;
      }
      if (this.gameOver) {
        this.restartGame();
        return;
      }
      if (this.levelComplete) {
        this.nextLevel();
        return;
      }
      this.isMouseDown = true;
      this.mouseTarget = getWorldPos(e.clientX, e.clientY);
    });

    this.canvas?.addEventListener("mousemove", (e) => {
      if (this.isMouseDown && !this.gameOver) {
        this.mouseTarget = getWorldPos(e.clientX, e.clientY);
      }
    });

    window.addEventListener("mouseup", () => {
      this.isMouseDown = false;
    });

    // Touch events
    this.canvas?.addEventListener("touchstart", (e) => {
      if (!this.gameStarted) {
        this.startGame();
        return;
      }
      if (this.gameOver) {
        this.restartGame();
        return;
      }
      if (this.levelComplete) {
        this.nextLevel();
        return;
      }
      e.preventDefault();
      const touch = e.touches[0];
      this.isMouseDown = true;
      this.mouseTarget = getWorldPos(touch.clientX, touch.clientY);
    });

    this.canvas?.addEventListener("touchmove", (e) => {
      if (this.isMouseDown && !this.gameOver) {
        e.preventDefault();
        const touch = e.touches[0];
        this.mouseTarget = getWorldPos(touch.clientX, touch.clientY);
      }
    });

    window.addEventListener("touchend", () => {
      this.isMouseDown = false;
    });
  }

  private startGame(): void {
    this.gameStarted = true;
  }

  private restartGame(): void {
    this.gameOver = false;
    this.levelComplete = false;
    this.score = 0;
    this.level = 1;
    this.npcs = [];
    this.generateMaze();
    this.initPlayer();
    this.initNPCs();
    this.renderMapToBuffer();
  }

  private nextLevel(): void {
    this.levelComplete = false;
    this.level++;
    this.npcs = [];
    this.generateMaze();
    this.initPlayer();
    this.initNPCs();
    this.renderMapToBuffer();
  }

  private getSpeedMultiplier(): number {
    // Smooth exponential increase - 10% faster each level
    return Math.pow(1.1, this.level - 1);
  }

  private async loadImage(src: string): Promise<ImageBitmap> {
    const response = await fetch(src);
    const blob = await response.blob();
    return createImageBitmap(blob, {
      premultiplyAlpha: 'premultiply',
    });
  }

  private async loadAssets(): Promise<void> {
    [this.grassImg, this.bushesImg, this.foxImg, this.dogImg, this.chickImg, this.chickBonesImg, this.titleImg] = await Promise.all([
      this.loadImage("/assets/plain_grass.png"),
      this.loadImage("/assets/bushes.png"),
      this.loadImage("/assets/test-fox.png"),
      this.loadImage("/assets/test-dog.png"),
      this.loadImage("/assets/test-chick.png"),
      this.loadImage("/assets/chick-bones.png"),
      this.loadImage("/assets/title.png"),
    ]);
  }

  private playerOnLeft = true; // Track which side player spawned on

  private initPlayer(): void {
    if (!this.foxImg) return;

    // Player size (120x120 per frame)
    this.player.width = PLAYER_FRAME_SIZE;
    this.player.height = PLAYER_FRAME_SIZE;

    // Randomly choose left or right side
    this.playerOnLeft = Math.random() < 0.5;
    const sideWidth = Math.floor(GRID_COLS / 3);

    let minCol: number, maxCol: number;
    if (this.playerOnLeft) {
      minCol = 0;
      maxCol = sideWidth;
    } else {
      minCol = GRID_COLS - sideWidth - 1;
      maxCol = GRID_COLS - 1;
    }

    for (let attempt = 0; attempt < 50; attempt++) {
      const tileCol = minCol + Math.floor(Math.random() * (maxCol - minCol + 1));
      const tileRow = Math.floor(Math.random() * GRID_ROWS);

      // Skip if is a wall
      if (this.wallMatrix[tileRow]?.[tileCol]) continue;

      // Place player at tile origin
      this.player.x = tileCol * TILE_SIZE;
      this.player.y = tileRow * TILE_SIZE;
      return;
    }

    // Fallback: place at tile 0,0
    this.player.x = 0;
    this.player.y = 0;
  }

  private initNPCs(): void {
    // Spawn 1 dog on OPPOSITE side from player
    if (this.dogImg) {
      const sideWidth = Math.floor(GRID_COLS / 3);
      let minCol: number, maxCol: number;
      if (this.playerOnLeft) {
        // Dog on right
        minCol = GRID_COLS - sideWidth - 1;
        maxCol = GRID_COLS - 1;
      } else {
        // Dog on left
        minCol = 0;
        maxCol = sideWidth;
      }
      this.spawnNPC(this.dogImg, "dog", minCol, maxCol);
    }

    // Spawn 4-5 chicks anywhere
    if (this.chickImg) {
      const chickCount = 4 + Math.floor(Math.random() * 2);
      for (let i = 0; i < chickCount; i++) {
        this.spawnNPC(this.chickImg, "chick");
      }
    }
  }

  private spawnNPC(img: ImageBitmap, type: "dog" | "chick", minCol = 0, maxCol = GRID_COLS - 1): void {
    // Find a random grass tile not occupied by player or other NPCs
    for (let attempt = 0; attempt < 50; attempt++) {
      const tileCol = minCol + Math.floor(Math.random() * (maxCol - minCol + 1));
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

      // Place NPC with AI state
      this.npcs.push({
        x,
        y,
        width: NPC_SIZE,
        height: NPC_SIZE,
        img,
        type,
        dead: false,
        wanderTarget: { x, y },
        nextWanderTime: 0,
        stuckTime: 0,
        prevX: x,
        prevY: y,
      });
      break;
    }
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

    // Draw grass background only (bushes rendered dynamically for z-sorting)
    if (this.grassImg) {
      const grassW = this.grassImg.width;
      const grassH = this.grassImg.height;
      for (let y = 0; y < MAP_HEIGHT; y += grassH) {
        for (let x = 0; x < MAP_WIDTH; x += grassW) {
          this.mapCtx.drawImage(this.grassImg, x, y);
        }
      }
    }
  }

  update(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
    // Show title screen before game starts
    if (!this.gameStarted) {
      ctx.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
      if (this.titleImg) {
        // Draw title image scaled to fit viewport
        ctx.drawImage(this.titleImg, 0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
      }
      return;
    }

    if (!this.mapCanvas) return;

    // Only update game logic if not game over or level complete
    if (!this.gameOver && !this.levelComplete) {
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

      // Mouse/touch movement - move toward target while held
      if (this.mouseTarget && this.isMouseDown) {
        const dx = this.mouseTarget.x - (this.player.x + this.player.width / 2);
        const dy = this.mouseTarget.y - (this.player.y + this.player.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 10) { // dead zone to prevent jitter
          newX = this.player.x + (dx / dist) * PLAYER_SPEED;
          newY = this.player.y + (dy / dist) * PLAYER_SPEED;
        }
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

      // Update NPC AI
      this.updateNPCs(performance.now());

      // Check if player caught a chick
      this.checkChickCollisions();

      // Check if dog caught the player
      this.checkDogCollision();
    }

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

    // Ensure proper alpha blending for sprites
    ctx.globalCompositeOperation = 'source-over';

    // Draw score (below characters)
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const scoreText = "Score: ";
    const scoreNum = `${this.score}`;
    const scoreX = 12 + ctx.measureText(scoreText).width;

    // Set up shadow for halo effect
    ctx.shadowColor = "rgba(0, 0, 0, 1)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Draw colored text with shadow
    ctx.fillStyle = "#ff5555";
    ctx.fillText(scoreText, 12, 40);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(scoreNum, scoreX, 40);

    // Draw high score in smaller text below
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`High Score: ${this.highScore}`, 12, 68);

    // Reset shadow
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    // Collect all sprites for y-sorted rendering (bushes, bones, player, NPCs)
    const sprites: { type: 'bush' | 'bone' | 'sprite'; img: ImageBitmap; x: number; y: number; tileIndex?: number }[] = [];

    // Add bushes
    if (this.bushesImg) {
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          if (this.wallMatrix[row][col]) {
            const tileIndex = this.getTileIndex(row, col);
            sprites.push({
              type: 'bush',
              img: this.bushesImg,
              x: col * TILE_SIZE,
              y: row * TILE_SIZE,
              tileIndex,
            });
          }
        }
      }
    }

    // Add player
    if (this.foxImg) {
      sprites.push({ type: 'sprite', img: this.foxImg, x: this.player.x, y: this.player.y });
    }

    // Add NPCs (bones for dead, sprites for live)
    for (const npc of this.npcs) {
      if (npc.dead) {
        sprites.push({ type: 'bone', img: npc.img, x: npc.x, y: npc.y });
      } else {
        sprites.push({ type: 'sprite', img: npc.img, x: npc.x, y: npc.y });
      }
    }

    // Sort by y position (lower y = further back, drawn first)
    sprites.sort((a, b) => a.y - b.y);

    // Draw all sprites in sorted order
    for (const sprite of sprites) {
      const screenX = sprite.x - this.cameraX;
      const screenY = sprite.y - this.cameraY;
      if (sprite.type === 'bush' && sprite.tileIndex !== undefined) {
        ctx.drawImage(
          sprite.img,
          sprite.tileIndex * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE,
          screenX, screenY, TILE_SIZE, TILE_SIZE
        );
      } else {
        ctx.drawImage(sprite.img, screenX, screenY, TILE_SIZE, TILE_SIZE);
      }
    }

    // Draw game over UI
    if (this.gameOver) {
      // Semi-transparent overlay
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

      // Game Over text
      ctx.fillStyle = "#ff5555";
      ctx.font = "bold 48px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Game Over", VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 - 30);

      // Tap to Retry text
      ctx.fillStyle = "#ffffff";
      ctx.font = "24px sans-serif";
      ctx.fillText("Tap to Retry", VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 + 30);
    }

    // Draw level complete UI
    if (this.levelComplete) {
      // Semi-transparent overlay
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

      // Level Complete text
      ctx.fillStyle = "#55ff55";
      ctx.font = "bold 48px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Level Complete", VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 - 30);

      // Tap to Continue text
      ctx.fillStyle = "#ffffff";
      ctx.font = "24px sans-serif";
      ctx.fillText("Tap to Continue", VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 + 30);
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
          this.score++;
          if (this.score > this.highScore) {
            this.highScore = this.score;
            this.saveHighScore();
          }
          if (this.chickBonesImg) {
            npc.img = this.chickBonesImg;
          }
          // Check if all chicks are dead
          const aliveChicks = this.npcs.filter(n => n.type === "chick" && !n.dead);
          if (aliveChicks.length === 0) {
            this.levelComplete = true;
          }
        }
      }
    }
  }

  private checkDogCollision(): void {
    for (const npc of this.npcs) {
      if (npc.type === "dog" && !npc.dead) {
        if (this.hitboxesOverlap(this.player.x, this.player.y, npc.x, npc.y)) {
          this.gameOver = true;
          return;
        }
      }
    }
  }

  private updateNPCs(currentTime: number): void {
    const speedMult = this.getSpeedMultiplier();

    for (const npc of this.npcs) {
      if (npc.dead) continue;

      const hasLOS = this.hasLineOfSight(npc.x, npc.y, this.player.x, this.player.y);
      const dx = this.player.x - npc.x;
      const dy = this.player.y - npc.y;
      const distanceToPlayer = Math.sqrt(dx * dx + dy * dy);

      if (npc.type === "chick") {
        if (hasLOS) {
          // Flee from player
          this.moveNpcAway(npc, this.player.x, this.player.y, CHICK_SPEED_FLEE * speedMult);
        } else {
          // Wander
          this.wanderNpc(npc, currentTime, CHICK_SPEED_WANDER * speedMult);
        }
      } else if (npc.type === "dog") {
        if (hasLOS && distanceToPlayer < DOG_CHASE_RANGE) {
          // Chase player
          this.moveNpcToward(npc, this.player.x, this.player.y, DOG_SPEED_CHASE * speedMult);
        } else {
          // Wander
          this.wanderNpc(npc, currentTime, DOG_SPEED_WANDER * speedMult);
        }
      }

      // Clamp to map bounds
      npc.x = Math.max(0, Math.min(npc.x, MAP_WIDTH - npc.width));
      npc.y = Math.max(0, Math.min(npc.y, MAP_HEIGHT - npc.height));

      // Check if stuck
      const movedDist = Math.abs(npc.x - npc.prevX) + Math.abs(npc.y - npc.prevY);
      if (movedDist < 0.5) {
        npc.stuckTime++;
      } else {
        npc.stuckTime = 0;
      }
      npc.prevX = npc.x;
      npc.prevY = npc.y;
    }
  }

  private wanderNpc(npc: NPC, currentTime: number, speed: number): void {
    // Check if need to pick new wander target
    const dx = npc.wanderTarget.x - npc.x;
    const dy = npc.wanderTarget.y - npc.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);
    const reachedTarget = distToTarget < 20;

    if (reachedTarget || currentTime > npc.nextWanderTime || npc.stuckTime > 15) {
      this.pickRandomWanderTarget(npc);
      npc.nextWanderTime = currentTime + 1000 + Math.random() * 1000;
      npc.stuckTime = 0;
    }

    // Move toward wander target
    this.moveNpcToward(npc, npc.wanderTarget.x, npc.wanderTarget.y, speed);
  }

  private pickRandomWanderTarget(npc: NPC): void {
    // Try to find a grass tile
    for (let attempt = 0; attempt < 20; attempt++) {
      const tileCol = Math.floor(Math.random() * GRID_COLS);
      const tileRow = Math.floor(Math.random() * GRID_ROWS);

      if (tileRow >= 0 && tileRow < GRID_ROWS && tileCol >= 0 && tileCol < GRID_COLS) {
        if (!this.wallMatrix[tileRow][tileCol]) {
          npc.wanderTarget.x = tileCol * TILE_SIZE;
          npc.wanderTarget.y = tileRow * TILE_SIZE;
          return;
        }
      }
    }
  }

  private moveNpcToward(npc: NPC, targetX: number, targetY: number, speed: number): void {
    const dx = targetX - npc.x;
    const dy = targetY - npc.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 1) return;

    const vx = (dx / distance) * speed;
    const vy = (dy / distance) * speed;

    // Try to move, check collisions
    const newX = npc.x + vx;
    const newY = npc.y + vy;

    if (!this.npcCollidesWithWall(npc, newX, npc.y)) {
      npc.x = newX;
    }
    if (!this.npcCollidesWithWall(npc, npc.x, newY)) {
      npc.y = newY;
    }
  }

  private moveNpcAway(npc: NPC, targetX: number, targetY: number, speed: number): void {
    const dx = npc.x - targetX;
    const dy = npc.y - targetY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 1) return;

    let vx = (dx / distance) * speed;
    let vy = (dy / distance) * speed;

    // Edge-safe fleeing: don't push further out if near bounds
    const pad = 20;
    let atEdge = false;
    if (npc.x <= pad && vx < 0) { vx = 0; atEdge = true; }
    if (npc.x >= MAP_WIDTH - npc.width - pad && vx > 0) { vx = 0; atEdge = true; }
    if (npc.y <= pad && vy < 0) { vy = 0; atEdge = true; }
    if (npc.y >= MAP_HEIGHT - npc.height - pad && vy > 0) { vy = 0; atEdge = true; }

    // Add jitter when at edge or stuck to help escape corners
    if (atEdge || npc.stuckTime > 5) {
      const jitterStrength = speed * 0.8;
      vx += (Math.random() - 0.5) * jitterStrength * 2;
      vy += (Math.random() - 0.5) * jitterStrength * 2;
    }

    const newX = npc.x + vx;
    const newY = npc.y + vy;

    if (!this.npcCollidesWithWall(npc, newX, npc.y)) {
      npc.x = newX;
    }
    if (!this.npcCollidesWithWall(npc, npc.x, newY)) {
      npc.y = newY;
    }
  }

  private npcCollidesWithWall(npc: NPC, x: number, y: number): boolean {
    // NPC hitbox (80x80 centered)
    const hx = x + HITBOX_OFFSET;
    const hy = y + HITBOX_OFFSET;

    // Check collision with bush tiles
    const startCol = Math.floor(hx / TILE_SIZE);
    const endCol = Math.floor((hx + HITBOX_SIZE - 1) / TILE_SIZE);
    const startRow = Math.floor(hy / TILE_SIZE);
    const endRow = Math.floor((hy + HITBOX_SIZE - 1) / TILE_SIZE);

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        if (this.wallMatrix[row]?.[col]) {
          // Bush hitbox (80x80 centered in tile)
          const bhx = col * TILE_SIZE + HITBOX_OFFSET;
          const bhy = row * TILE_SIZE + HITBOX_OFFSET;

          if (hx < bhx + HITBOX_SIZE && hx + HITBOX_SIZE > bhx &&
              hy < bhy + HITBOX_SIZE && hy + HITBOX_SIZE > bhy) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    // Check from center of sprite to center of sprite
    const cx1 = x1 + TILE_SIZE / 2;
    const cy1 = y1 + TILE_SIZE / 2;
    const cx2 = x2 + TILE_SIZE / 2;
    const cy2 = y2 + TILE_SIZE / 2;

    const dx = cx2 - cx1;
    const dy = cy2 - cy1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.floor(distance / 20)); // check every ~20px

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = cx1 + dx * t;
      const y = cy1 + dy * t;
      const col = Math.floor(x / TILE_SIZE);
      const row = Math.floor(y / TILE_SIZE);
      if (this.wallMatrix[row]?.[col]) {
        return false;
      }
    }
    return true;
  }
}
