import * as Dat from "dat.gui";

let config:any = {tmp:3};
window.onload = function() {
  var gui = new Dat.GUI();
  const readableName = (n: string) => n.replace(/([A-Z])/g, ' $1').toLowerCase()
  function addConfig(name: string, initial: any, min?: number, max?: number) {
    config[name] = initial;
    return gui.add(config, name, min, max).name(readableName(name));
  }
  addConfig("includeRotatedAndFlipped", false).onFinishChange(initTiles);
  addConfig("tileSize", 3, 2, 10).step(1).onFinishChange(initTiles);
  addConfig("outputWidth", 20, 5, 1000).step(5);
  addConfig("outputHeight", 20, 5, 1000).step(5);

  initTiles();
};

function initTiles() {
  let img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = "tiles.png";

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
      // window.onclick = () => {
      //   core.step();
      //   core.render();
      // };
      let intervalId = window.setInterval(() => {
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
    // cell._possible = cell._possible.fill(false);
    // cell._possible[Math.floor(Math.random()*cell._possible.length)] = true;
    // cell._possible[Math.floor(Math.random()*cell._possible.length)] = true;
    cell._sumWeight = template._sumWeight;
    cell._sumWeightTimesLogWeight = template._sumWeightTimesLogWeight;
    cell._tileEnablerCounts = Array.from(template._tileEnablerCounts, inner => Array.from(inner));
    return cell;
  }

  private constructor() {}

  *possibleTiles() {
    for (let i = 0; i < this._possible.length; i++) {
      if (this._possible[i])
        yield i;
    }
  }

  chooseTile(frequencyHints: FrequencyHints): TileIndex {
    // return this._chosenTile = 12;

    let chosenWeight = Math.random() * this._sumWeight;
    for (let tile of this.possibleTiles()) {
      chosenWeight -= frequencyHints.weightForTile(tile);
      if (chosenWeight < 0)
        return this._chosenTile = tile;
    }
    throw new Error("cell weights were invalid");
  }
  removeTile(tile: TileIndex, frequencyHints: FrequencyHints | null = null): void {
    this._possible[tile] = false;
    if (frequencyHints) {
      let weight = frequencyHints.weightForTile(tile);
      this._sumWeight -= weight;
      this._sumWeightTimesLogWeight -= weight * Math.log2(weight);
    }
  }

  get isCollapsed(): boolean { return this._chosenTile != -1; }
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

  init(): void {
    let cellTemplate = Cell.createTemplate(this._adjacencyRules, this._frequencyHints);
    for (let y = 0; y < config.outputHeight; y++) {
      this._grid[y] = [];
      for (let x = 0; x < config.outputWidth; x++) {
        this._grid[y][x] = Cell.fromTemplate(cellTemplate);
      }
    }

    this._entropyHeap = Array.from(rectRange([config.outputWidth, config.outputHeight]));
  }

  step(): boolean {
    let p = this._chooseCell();
    if (!p)
      return false;
    let removals = this._collapseCell(p);
    return this._propagate(removals);
  }

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

  private _chooseCell(): Point | null {
    let [p, entropy, heapIndex]: [Point | null, number, string] = [null, Number.POSITIVE_INFINITY, ""];
    for (let i in this._entropyHeap) {
      let [x, y] = this._entropyHeap[i];
      if (this._grid[y][x].entropy < entropy)
        [p, entropy, heapIndex] = [[x,y], this._grid[y][x].entropy, i];
    }
    if (heapIndex)
      delete this._entropyHeap[heapIndex];
    return p;
  }

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
  private _entropyHeap: Point[]; // TODO: use a real heap
}

type RemoveEvent = {
  pos: Point;
  tile: TileIndex;
};