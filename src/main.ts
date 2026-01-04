import { Game } from "./engine/game";
import { MazeScene } from "./scenes/maze";

const game = new Game("game");
await game.setScene(new MazeScene());
game.start();
