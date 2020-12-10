import * as Dat from "dat.gui";

let config = {};
window.onload = function() {
  var gui = new Dat.GUI();
  const readableName = (n: string) => n.replace(/([A-Z])/g, ' $1').toLowerCase()
  function addConfig(name: string, initial: any, min?: number, max?: number) {
    config[name] = initial;
    return gui.add(config, name, min, max).name(readableName(name));
  }
  addConfig("includeRotatedAndFlipped", false);
  addConfig("tileSize", 3, 2, 10).step(1);
  addConfig("outputWidth", 20, 5, 1000).step(5);
  addConfig("outputHeight", 20, 5, 1000).step(5);
};

var img = new Image();
img.crossOrigin = 'anonymous';
img.src = "tiles.png";

const $ = (id: string) => document.getElementById(id);

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
    parseImage(imageData);
  }
};

// How we identify a tile - just its index into the list of all tiles.
type TileIndex = number;

// A number giving the relative frequency of a tile.
type FrequencyWeight = number;

// Cardinal directions.
enum Direction {Up, Right, Down, Left};

// An RGBA color. Range is 0-255.
type Color = [number, number, number, number];

// An x,y tuple.
type Point = [number, number];

// Mapping of TileIndex -> color of the top-left pixel of that tile.
type TileColorMapping = Color[];

// Manages relative frequencies of all the tiles. The higher a tile's frequency,
// the more likely that tile will appear in the output.
class FrequencyHints {
  readonly _tileWeights: FrequencyWeight[];
  readonly _sumWeight: FrequencyWeight;
  readonly _sumWeightTimesLogWeight: number;

  // w[n] - the relative frequency of the given tile. This is simply the number of
  // times it appears in the source image.
  weightForTile(index: TileIndex): FrequencyWeight {
    return this._tileWeights[index];
  }
  // Cache of sum(w[n]), used in entropy calculations.
  get sumWeight() { return this._sumWeight; }
  // Cache of sum(w[n]*log(w[n])), used in entropy calculations.
  get sumWeightTimesLogWeight() { return this._sumWeight; }
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
  return [this.data[r], this.data[r+1], this.data[r+2], this.data[r+3]];
}
ImageData.prototype["set"] = function([x, y]: Point, color: Color): void {
  let r = 4 * (y * this.width + x);
  for (let i = 0; i < 4; i++)
    this.data[r+i] = color[i];
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

function parseImage(imageData: MyImageData) {
}
