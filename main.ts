import * as Dat from "dat.gui";
import Heap from 'heap-js';

let config:any = {};
window.onload = function() {
  var gui = new Dat.GUI();
  const readableName = (n: string) => n.replace(/([A-Z])/g, ' $1').toLowerCase()
  function addConfig(name: string, initial: any, min?: any, max?: number) {
    config[name] = initial;
    return gui.add(config, name, min, max).name(readableName(name));
  }
  addConfig("includeRotatedAndFlipped", false).onFinishChange(initTiles);
  addConfig("tileSize", 3, 2, 10).step(1).onFinishChange(initTiles);
  addConfig("outputWidth", 50, 5, 1000).step(5).onFinishChange(initTiles);
  addConfig("outputHeight", 50, 5, 1000).step(5).onFinishChange(initTiles);
  addConfig("input", "tiles/Water.png", [
    "tiles/3Bricks.png", "tiles/Angular.png", "tiles/Cat.png", "tiles/Cats.png", "tiles/Cave.png", "tiles/Chess.png",
    "tiles/City.png", "tiles/ColoredCity.png", "tiles/Dungeon.png", "tiles/Fabric.png", "tiles/Flowers.png", "tiles/Forest.png",
    "tiles/Grid.png", "tiles/GridLong.png", "tiles/Hogs.png", "tiles/Knot.png", "tiles/Lake.png", "tiles/LessRooms.png", "tiles/Link.png",
    "tiles/Link2.png", "tiles/MagicOffice.png", "tiles/Maze.png", "tiles/Mazelike.png", "tiles/MoreFlowers.png", "tiles/Mountains.png",
    "tiles/Nested.png", "tiles/Office.png", "tiles/Office2.png", "tiles/Paths.png", "tiles/Platformer.png", "tiles/Qud.png", "tiles/RedDot.png",
    "tiles/RedMaze.png", "tiles/Rooms.png", "tiles/Rule126.png", "tiles/ScaledMaze.png", "tiles/Sewers.png", "tiles/SimpleKnot.png",
    "tiles/SimpleMaze.png", "tiles/SimpleWall.png", "tiles/Skew1.png", "tiles/Skew2.png", "tiles/Skyline.png", "tiles/Skyline2.png",
    "tiles/SmileCity.png", "tiles/Spirals.png", "tiles/Town.png", "tiles/TrickKnot.png", "tiles/Village.png", "tiles/Wall.png", "tiles/Water.png",
  ]).onFinishChange(initTiles);

  gui.useLocalStorage = true;

  initTiles();
};

let intervalId: number;
function initTiles() {
  let img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = config.input;

  if (intervalId)
    window.clearInterval(intervalId);

  img.onload = function() {
    // Update the input tile display.
    {
      let canvas = $("input") as HTMLCanvasElement;
      let context = canvas.getContext('2d');
      if (!context) return;
      context.imageSmoothingEnabled = false;
      // [canvas.width, canvas.height] = [img.width, img.height];
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    // Get the image data from the image.
    {
      let canvas = new OffscreenCanvas(img.width, img.height);
      let context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(img, 0, 0);
      let imageData = context.getImageData(0, 0, img.width, img.height) as MyImageData;
      let results = parseImage(imageData);
      let core = new CoreState(...results);
      core.init();
      core.render();
      let paused = true;
      window.onclick = () => {paused = !paused; };
      intervalId = window.setInterval(() => {
        if (paused) return;
        if (!core.step())
          window.clearInterval(intervalId);
        core.render();
      }, 0);
    }
  };
}

// Shameless hack to extend ImageData with concise pixel accessors.
interface MyImageData extends ImageData {
  get([x, y]: Point): Color;
  set([x, y]: Point, c: Color): void;
}
ImageData.prototype["get"] = function([x, y]: Point): Color {
  let r = 4 * (y * this.width + x);
  return (this.data[r] << 24) | (this.data[r+1] << 16) | (this.data[r+2] << 8) | (this.data[r+3]);
}
ImageData.prototype["set"] = function([x, y]: Point, color: Color): void {
  let r = 4 * (y * this.width + x);
  this.data[r+0] = (color >>> 24) & 0xff;
  this.data[r+1] = (color >>> 16) & 0xff;
  this.data[r+2] = (color >>> 8) & 0xff;
  this.data[r+3] = (color) & 0xff;
}

// Convenience function for iterating over rectangular regions.
function* rectRange([w, h]: Size) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      yield <Point>[x,y]
    }
  }
}

// Helper for flattening a 2d coord to an index (row-major order).
function pointToIndex([x, y]: Point, width: number): number {
  return x + y*width;
}

// Helper to draw an ImageData to a canvas, scaled to that canvas's size.
function renderToCanvas(canvasId: string, imageData: ImageData): void {
  // Blit to an offscreen canvas first, so we can scale it up when drawing it for real.
  let buffer = new OffscreenCanvas(imageData.width, imageData.height);
  {
    let context = buffer.getContext('2d');
    if (!context) return;
    context.putImageData(imageData, 0, 0);
  }

  let canvas = $(canvasId) as HTMLCanvasElement;
  let context = canvas.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
}

// Full jquery emulation.
const $ = (id: string) => document.getElementById(id);

// How we identify a tile - just its index into the list of all tiles.
type TileIndex = number;

// A number giving the relative frequency of a tile.
type FrequencyWeight = number;

// Cardinal directions.
enum Direction { Up, Right, Down, Left };
namespace Direction {
  export const items: Direction[] = [Direction.Up, Direction.Right, Direction.Down, Direction.Left];
  export const toOpposite: Direction[] = [Direction.Down, Direction.Left, Direction.Up, Direction.Right];
  export const toOffset: Size[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
}

// A 32-bit RGBA color. Format is 0xRRGGBBAA.
type Color = number;

// An x,y tuple.
type Point = [number, number];
type Size = [number, number];

// Mapping of TileIndex -> color of the top-left pixel of that tile.
type TileColorMapping = Color[];

// Manages relative frequencies of all the tiles. The higher a tile's frequency,
// the more likely that tile will appear in the output.
class FrequencyHints {
  constructor(counts: number[]) {
    this._tileWeights = counts;
  }
  // w[n] - the relative frequency of the given tile. This is simply the number of
  // times it appears in the source image.
  weightForTile(index: TileIndex): FrequencyWeight {
    return this._tileWeights[index];
  }
  get numTiles() { return this._tileWeights.length; }

  private readonly _tileWeights: FrequencyWeight[] = [];
  private readonly _sumWeight: FrequencyWeight = 0;
  private readonly _sumWeightTimesLogWeight: number = 0;
}

// Manages rules for which tiles are allowed to be adjacent to which other tiles, in a given direction.
class AdjacencyRules {
  constructor(tiles: Tile[]) {
    for (let i = 0; i < tiles.length; i++) {
      for (let j = 0; j < tiles.length; j++) {
        for (let dir of Direction.items) {
          if (AdjacencyRules._isCompatible(tiles[i], tiles[j], dir))
            this._allow(i, j, dir);
        }
      }
    }
  }
  get numTiles() { return this._allowed.length; }
  // Returns true if we can place tile `to` in the direction `dir` from `from`.
  isAllowed(from: TileIndex, to: TileIndex, dir: Direction): boolean {
    return true;
  }
  // Returns an iterator of all the tiles which can be placed one space in direction `dir`
  // from tile `from`.
  *allowedTiles(from: TileIndex, dir: Direction) {
    let allowed = this._allowed[from][dir];
    for (let tile of allowed)
      yield tile;
  }

  // Returns true if tile we can place tile `b` in the direction `dir` from `a`.
  private static _isCompatible(a: Tile, b: Tile, dir: Direction): boolean {
    let offset = Direction.toOffset[dir];
    for (let [ax, ay] of rectRange([config.tileSize, config.tileSize])) {
      let [bx, by] = [ax - offset[0], ay - offset[1]];
      if (bx < 0 || by < 0 || bx >= config.tileSize || by >= config.tileSize)
        continue;  // not an overlapping region, ignore
      if (a.getPixel([ax, ay]) != b.getPixel([bx, by]))
        return false;
    }
    return true;
  }
  // Adds a new rule to the ruleset.
  private _allow(from: TileIndex, to: TileIndex, dir: Direction): void {
    if (!this._allowed[from]) this._allowed[from] = [];
    if (!this._allowed[from][dir]) this._allowed[from][dir] = [];
    this._allowed[from][dir].push(to);
  }

  private readonly _allowed: TileIndex[][][] = []; // _allowed[from][dir] = [tileIndices...]
}

// Pixel data for a Tile. Only used during pre-processing. During the actual algorithm,
// we refer to tiles by index. The AdjacencyRules and FrequencyHints govern how we
// can place tiles in the grid, and the TileColorMapping tells us what color to use.
class Tile {
  topLeftPixel(): Color { return this._pixels[0]; }
  getPixel([x, y]: Point): Color { return this._pixels[x + y * config.tileSize]; }

  // Map does not provide a way to provide our own hash or equality functions,
  // so we generate our own key based on the tile's pixel data.
  get mapKey(): string {
    if (!this._mapKey)
      this._mapKey = this._pixels.join(",");
    return this._mapKey;
  }

  // Returns the Tile found at the given coord in the image, wrapping coordinates.
  static fromImageData(imageData: MyImageData, [ix, iy]: Point): Tile {
    let tile = new Tile;
    for (let [tx, ty] of rectRange([config.tileSize, config.tileSize]))
      tile._pixels[pointToIndex([tx, ty], config.tileSize)] = imageData.get([(ix + tx) % imageData.width, (iy + ty) % imageData.height]);
    return tile;
  }
  // Returns a copy of `orig` rotated 90 degrees clockwise.
  static rotated(orig: Tile): Tile {
    // (x,y) => (w-y,x)
    let tile = new Tile;
    for (let [x, y] of rectRange([config.tileSize, config.tileSize]))
      tile._pixels[pointToIndex([config.tileSize - 1 - y, x], config.tileSize)] = orig._pixels[pointToIndex([x, y], config.tileSize)];
    return tile;
  }
  // Returns a copy of `orig` flipped vertically.
  static flipped(orig: Tile): Tile {
    // (x,y) => (x,w-y)
    let tile = new Tile;
    for (let [x, y] of rectRange([config.tileSize, config.tileSize]))
      tile._pixels[pointToIndex([x, config.tileSize - 1 - y], config.tileSize)] = orig._pixels[pointToIndex([x, y], config.tileSize)];
    return tile;
  }

  private _pixels: Color[] = [];
  private _mapKey: string;
}

// Maps Tile to appearance count for that tile.
class TileCountMap extends Map<string, {tile: Tile, count: number}> {
  addTile(tile: Tile): number {
    let value = this.get(tile.mapKey) || {tile: tile, count: 0};
    value.count++;
    this.set(tile.mapKey, value);
    return value.count;
  }
}

// Pre-processing step. Reads an image and cuts it up into NxN tiles (N=tileSize).
// Also calculates the rules that are fed into the main algorithm.
function parseImage(imageData: MyImageData): [AdjacencyRules, FrequencyHints, TileColorMapping] {
  let tileMap = new TileCountMap();
  for (let p of rectRange([imageData.width, imageData.height])) {
    let tile = Tile.fromImageData(imageData, p);
    let count = tileMap.addTile(tile);
    if (config.includeRotatedAndFlipped) {
      // Add the other 3 rotations, and the 4 rotations of the flipped case (for 0, 90, 180, and 270 degrees)
      let subtile = tile;
      tileMap.addTile(subtile = Tile.rotated(subtile));
      tileMap.addTile(subtile = Tile.rotated(subtile));
      tileMap.addTile(subtile = Tile.rotated(subtile));
      tileMap.addTile(subtile = Tile.flipped(tile));
      tileMap.addTile(subtile = Tile.rotated(subtile));
      tileMap.addTile(subtile = Tile.rotated(subtile));
      tileMap.addTile(subtile = Tile.rotated(subtile));
    }
  }

  let tiles: Tile[] = [];
  let counts: number[] = [];
  for (let {tile, count} of tileMap.values()) {
    tiles.push(tile);
    counts.push(count);
  }

  let adjacencyRules = new AdjacencyRules(tiles);
  let frequencyHints = new FrequencyHints(counts);
  let colorForTile: TileColorMapping = tiles.map(tile => tile.topLeftPixel());

  renderTileset(tiles);
  return [adjacencyRules, frequencyHints, colorForTile];
}

// Draws the tileset to the canvas.
function renderTileset(tiles: Tile[]) {
  let across = Math.floor(Math.sqrt(tiles.length));
  let down = Math.ceil(tiles.length / across);
  let imageData = new ImageData((config.tileSize+1)*across - 1, (config.tileSize+1)*down - 1) as MyImageData;

  for (let [i, j] of rectRange([across, down])) {
    let tile = i + j*across;
    if (tile >= tiles.length)
      break;
    for (let [x, y] of rectRange([config.tileSize, config.tileSize]))
      imageData.set([(config.tileSize+1)*i + x, (config.tileSize+1)*j + y], tiles[tile].getPixel([x,y]));
  }

  renderToCanvas("tileset", imageData);
}

// Represents the state of a single pixel in the output, mainly which tiles are possible to be placed
// in this cell. Possible tiles are eliminated as the algorithm proceeds, until all cells are "collapsed"
// (e.g. they have a single possible tile).
class Cell {
  // All Cells start the same, so we clone them from a template.
  static createTemplate(adjacencyRules: AdjacencyRules, frequencyHints: FrequencyHints): Cell {
    let cell = new Cell;
    cell._possible = new Array(frequencyHints.numTiles).fill(true);
    for (let i = 0; i < frequencyHints.numTiles; i++) {
      let w = frequencyHints.weightForTile(i);
      cell._sumWeight += w;
      cell._sumWeightTimesLogWeight += w * Math.log2(w);
    }
    for (let i = 0; i < adjacencyRules.numTiles; i++) {
      cell._tileEnablerCounts[i] = [0, 0, 0, 0]; // 4 directions
      for (let dir of Direction.items) {
        for (let j of adjacencyRules.allowedTiles(i, dir)) {
          cell._tileEnablerCounts[i][dir]++;
        }
      }
    }
    return cell;
  }
  // Returns a deep copy of the template.
  static fromTemplate(template: Cell): Cell {
    let cell = new Cell;
    cell._possible = Array.from(template._possible);
    cell._sumWeight = template._sumWeight;
    cell._sumWeightTimesLogWeight = template._sumWeightTimesLogWeight;
    cell._tileEnablerCounts = Array.from(template._tileEnablerCounts, inner => Array.from(inner));
    return cell;
  }

  private constructor() {}

  // Returns an iterator of all the tiles that can be placed in this Cell.
  *possibleTiles() {
    for (let i = 0; i < this._possible.length; i++) {
      if (this._possible[i])
        yield i;
    }
  }

  // Picks a tile at random from the remaining possible tiles, with higher
  // frequency tiles being more likely to be picked.
  chooseTile(frequencyHints: FrequencyHints): TileIndex {
    let chosenWeight = Math.random() * this._sumWeight;
    for (let tile of this.possibleTiles()) {
      chosenWeight -= frequencyHints.weightForTile(tile);
      if (chosenWeight < 0)
        return this._chosenTile = tile;
    }
    throw new Error("cell weights were invalid");
  }

  // Removes a tile from the list of possible tiles.
  removeTile(tile: TileIndex, frequencyHints: FrequencyHints | null = null): void {
    this._possible[tile] = false;
    if (frequencyHints) {
      let weight = frequencyHints.weightForTile(tile);
      this._sumWeight -= weight;
      this._sumWeightTimesLogWeight -= weight * Math.log2(weight);
    }
  }

  // Returns true if we've locked in a choice for this tile (e.g. chooseTile was called).
  get isCollapsed(): boolean { return this._chosenTile != -1; }

  // Returns true of there are no possible tiles remaining to choose. This signals
  // a contradiction was reached.
  get noPossibleTiles(): boolean { return this._sumWeight == 0; }
  // entropy = log(W) - sum(w[n]*log(w[n]))/W where W = sum(w[n])
  get entropy(): number { return Math.log2(this._sumWeight) - this._sumWeightTimesLogWeight / this._sumWeight; }
  enablerCountsForTile(tile: TileIndex): number[] { return this._tileEnablerCounts[tile]; }

  // _possible[tileIndex] is true if tileIndex can be placed in this cell, false otherwise.
  private _possible: boolean[] = [];
  private _chosenTile: TileIndex = -1;
  // Cache of sum(w[n]), used in entropy calculations.
  private _sumWeight: FrequencyWeight = 0;
  // Cache of sum(w[n]*log(w[n])), used in entropy calculations.
  private _sumWeightTimesLogWeight: number = 0;
   // tileEnablerCounts[tileIndex][dir] = for adjacentCell in direction `dir` from this cell, this is the count
   // of possible tiles in adjacentCell that are compatible with `tileIndex` in this cell. Used in propagation.
  private _tileEnablerCounts: number[][] = [];
}

class CoreState {
  constructor(a, f, c) {
    this._adjacencyRules = a;
    this._frequencyHints = f;
    this._colorForTile = c;
  }

  // Initalizes the grid, etc.
  init(): void {
    this._entropyHeap = new Heap((a, b) => a.entropy - b.entropy);
    let cellTemplate = Cell.createTemplate(this._adjacencyRules, this._frequencyHints);
    for (let y = 0; y < config.outputHeight; y++) {
      this._grid[y] = [];
      for (let x = 0; x < config.outputWidth; x++) {
        this._grid[y][x] = Cell.fromTemplate(cellTemplate);
        this._entropyHeap.add({pos: [x, y], entropy: this._grid[y][x].entropy});
      }
    }
  }

  // Handles a single step of the WFC algorithm:
  // 1. Pick the cell with minimum entropy.
  // 2. Choose a tile at random for that cell and eliminate all other options.
  // 3. Propagate the consequences, recursively.
  // Returns true if there is more work to do, false if we're done.
  step(): boolean {
    let p = this._chooseCell();
    if (!p)
      return false;
    let removals = this._collapseCell(p);
    return this._propagate(removals);
  }

  // Draws the current state of the generated image to our output canvas.
  // For collapsed cells, use the top-left pixel value of the tile that was chosen for that cell.
  // For uncollapsed cells, use a weighted average of that cell's possible tiles.
  render(): void {
    let imageData = new ImageData(config.outputWidth, config.outputHeight) as MyImageData;

    for (let [x,y] of rectRange([config.outputWidth, config.outputHeight])) {
      let color: Color = 0;
      let sumWeight = 0;
      for (let tile of this._grid[y][x].possibleTiles()) {
        let w = this._frequencyHints.weightForTile(tile);
        color += this._colorForTile[tile] * w;
        sumWeight += w;
      }
      color = (color / sumWeight) | 0xff; // full alpha
      imageData.set([x, y], color);
    }

    renderToCanvas("output", imageData);
  }

  // Returns the lowest-entropy cell, or null if all cells have been collapsed.
  private _chooseCell(): Point | null {
    let cell: HeapCell | undefined;
    while (cell = this._entropyHeap.pop()) {
      let [x,y] = cell.pos;
      if (!this._grid[y][x].isCollapsed)
        return cell.pos;
    }
    return null;
  }

  // Chooses a tile for the given cell, and return a list representing the removal of
  // the unchosen tiles.
  private _collapseCell([x, y]: Point): RemoveEvent[] {
    let cell = this._grid[y][x];
    let chosenTile = cell.chooseTile(this._frequencyHints);
    let removals: RemoveEvent[] = [];
    for (let tile of cell.possibleTiles()) {
      if (chosenTile != tile) {
        cell.removeTile(tile);
        removals.push({ pos: [x, y], tile: tile });
      }
    }
    return removals;
  }

  // Propagates the consequences of removing tiles from a cell's possible list.
  // This involves possibly removing other tiles from adjacent cells when they are
  // incompatible with the remaining tiles around them. Those removals are then
  // propagated in turn, until the grid reaches a steady state.
  private _propagate(removals: RemoveEvent[]): boolean {
    while (removals.length > 0) {
      let { pos: [rx, ry], tile: removedTile } = removals.shift() as RemoveEvent;
      for (let dir of Direction.items) {
        let offset = Direction.toOffset[dir];
        let oppositeDir = Direction.toOpposite[dir];
        let [ax, ay] = [rx + offset[0], ry + offset[1]];
        if (!(ax >= 0 && ay >= 0 && ax < config.outputWidth && ay < config.outputHeight))
          continue;  // out of bounds
        let adjacentCell = this._grid[ay][ax];
        if (adjacentCell.isCollapsed)
          continue;
        for (let enabledTile of this._adjacencyRules.allowedTiles(removedTile, dir)) {
          // For every tile that was enabled by the removed tile, decrement its enabler count.
          // If a count reaches zero, that tile is impossible, so remove it.
          let enablerCounts = adjacentCell.enablerCountsForTile(enabledTile);
          let wasZero = enablerCounts.some(count => count <= 0);
          let isZero = --enablerCounts[oppositeDir] == 0;

          // Only remove the tile if this is the first direction to reach 0 enablers (otherwise
          // we've already removed it).
          if (isZero && !wasZero) {
            adjacentCell.removeTile(enabledTile, this._frequencyHints);
            if (adjacentCell.noPossibleTiles) {
              console.error(`Contradiction at cell ${ax},${ay}. Removed ${enabledTile} after ${removedTile} was removed in cell ${rx},${ry}.`);
              return false;
            }
            removals.push({pos: [ax, ay], tile: enabledTile});
            this._entropyHeap.push({pos: [ax, ay], entropy: adjacentCell.entropy});
          }
        }
      }
    }
    return true;
  }

  private _grid: Cell[][] = [];
  private _adjacencyRules: AdjacencyRules;
  private _frequencyHints: FrequencyHints;
  private _colorForTile: TileColorMapping;
  private _entropyHeap: Heap<HeapCell>;
}

type HeapCell = {
  pos: Point;
  entropy: number;
};

type RemoveEvent = {
  pos: Point;
  tile: TileIndex;
};