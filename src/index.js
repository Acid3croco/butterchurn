import "ecma-proposal-math-extensions";
import "./presetBase";
import Visualizer from "./visualizer";
import blackHolePreset from "./blackHolePreset";

export default class Butterchurn {
  static createVisualizer(context, canvas, opts) {
    return new Visualizer(context, canvas, opts);
  }

  static getBlackHolePreset() {
    return blackHolePreset;
  }
}
