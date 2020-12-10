import * as Dat from "dat.gui";

let config:any = {tmp:3};
window.onload = function() {
  var gui = new Dat.GUI();
  const readableName = (n: string) => n.replace(/([A-Z])/g, ' $1').toLowerCase()
  function addConfig(name: string, initial: any, min?: number, max?: number) {
    config[name] = initial;
    return gui.add(config, name, min, max).name(readableName(name));
  }
  addConfig("includeRotatedAndFlipped", false);
  addConfig("tileSize", 3, 2, 10).step(1).onFinishChange(initTiles);
  addConfig("outputWidth", 20, 5, 1000).step(5);
  addConfig("outputHeight", 20, 5, 1000).step(5);
  console.log("config done");

  initTiles();
};

function initTiles() {
  let img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = "tiles2.png";

  img.onload = function() {
    console.log("image done");
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
      parseImage(imageData);
    }
  };
}

// How we identify a tile - just its index into the list of all tiles.
type TileIndex = number;

// A number giving the relative frequency of a tile.
type FrequencyWeight = number;

// Cardinal directions.
enum Direction {Up, Right, Down, Left};

// A 32-bit RGBA color. Format is 0xRRGGBBAA.
type Color = number;

// An x,y tuple.
type Point = [number, number];
type Size = [number, number];

// Mapping of TileIndex -> color of the top-left pixel of that tile.
type TileColorMapping = Color[];

const $ = (id: string) => document.getElementById(id);

// Manages relative frequencies of all the tiles. The higher a tile's frequency,
// the more likely that tile will appear in the output.
class FrequencyHints {
  // w[n] - the relative frequency of the given tile. This is simply the number of
  // times it appears in the source image.
  weightForTile(index: TileIndex): FrequencyWeight {
    return this._tileWeights[index];
  }
  // Cache of sum(w[n]), used in entropy calculations.
  get sumWeight() { return this._sumWeight; }
  // Cache of sum(w[n]*log(w[n])), used in entropy calculations.
  get sumWeightTimesLogWeight() { return this._sumWeightTimesLogWeight; }

  private readonly _tileWeights: FrequencyWeight[];
  private readonly _sumWeight: FrequencyWeight;
  private readonly _sumWeightTimesLogWeight: number;
}

// Manages rules for which tiles are allowed to be adjacent to which other tiles, in a given direction.
class AdjacencyRules {
  // Returns true if we can place tile `to` in the direction `dir` from `from`.
  isAllowed(from: TileIndex, to: TileIndex, dir: Direction): boolean {
    return true;
  }
}

interface MyImageData extends ImageData {
  get([x, y]: Point): Color;
  set([x, y]: Point, c: Color): void;
}
ImageData.prototype["get"] = function([x, y]: Point): Color {
  let r = 4 * (y * this.width + x);
  return (this.data[r] << 24) | (this.data[r+1] << 16) | (this.data[r+2] << 8) | (this.data[r+3]);
  // return [this.data[r], this.data[r+1], this.data[r+2], this.data[r+3]];
}
ImageData.prototype["set"] = function([x, y]: Point, color: Color): void {
  let r = 4 * (y * this.width + x);
  this.data[r+0] = (color >>> 24) & 0xff;
  this.data[r+1] = (color >>> 16) & 0xff;
  this.data[r+2] = (color >>> 8) & 0xff;
  this.data[r+3] = (color) & 0xff;
}

function* rectRange([w, h]: Size) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      yield <Point>[x,y]
    }
  }
}

// var grayscale = function () {
//   ctx.drawImage(img, 0, 0);
//   const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height) as MyImageData;
//   const data = imageData.data;
//   for (let y = 0; y < imageData.height; y++) {
//     for (let x = 0; x < imageData.width; x++) {
//       let c = imageData.get([x, y]);
//       let avg = (c[0] + c[1] + c[2]) / 3;
//       imageData.set([x, y], [avg, avg, avg, 255]);
//     }
//   }
//   ctx.putImageData(imageData, 0, 0);
// };

class Tile {
  topLeftPixel(): Color { return this._pixels[0]; }
  getPixel([x, y]: Point): Color { return this._pixels[x + y * config.tileSize]; }
  get mapKey(): string {
    if (!this._mapKey)
      this._mapKey = this._pixels.join(",");
    return this._mapKey;
  }

  static fromImageData(imageData: MyImageData, [ix, iy]: Point): Tile {
    let tile = new Tile;
    for (let [tx, ty] of rectRange([config.tileSize, config.tileSize]))
      tile._pixels[tx + ty * config.tileSize] = imageData.get([(ix + tx) % imageData.width, (iy + ty) % imageData.height]);
    return tile;
  }

  private _pixels: Color[] = [];
  private _mapKey: string;
}

class TileCountMap extends Map<string, {tile: Tile, count: number}> {
  addTile(tile: Tile) {
    let value = this.get(tile.mapKey) || {tile: tile, count: 0};
    value.count++;
    this.set(tile.mapKey, value);
  }
}

function parseImage(imageData: MyImageData) {
  let tileMap = new TileCountMap();
  for (let p of rectRange([imageData.width, imageData.height])) {
    let tile = Tile.fromImageData(imageData, p);
    tileMap.addTile(tile);
  }

  let tiles: Tile[] = [];
  let counts: number[] = [];
  for (let {tile, count} of tileMap.values()) {
    tiles.push(tile);
    counts.push(count);
  }
  // let frequencyHints = new FrequencyHints(tiles, counts);

  displayTileset(tiles);
}

function displayTileset(tiles: Tile[]) {
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

  // Blit to an offscreen canvas first, so we can scale it up when drawing it for real.
  let buffer = new OffscreenCanvas(imageData.width, imageData.height);
  {
    let context = buffer.getContext('2d');
    if (!context) return;
    context.putImageData(imageData, 0, 0);
  }

  let canvas = $("tileset") as HTMLCanvasElement;
  let context = canvas.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
}
