# ZarrTile (ol-zarr)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.17013896.svg)](https://doi.org/10.5281/zenodo.17013896)

**ZarrTile (ol-zarr)** is an [OpenLayers](https://openlayers.org/) extension for visualizing large time-series datacubes stored in [Zarr](https://zarr.dev/) format.
It provides a fully web-native framework for interactive, multi-resolution rendering of 4D datacubes (`[time, band, y, x]`) directly in the browser, powered by WebGL acceleration and a dedicated Web Worker pipeline.

This package is designed to be general-purpose: you define the rendering styles, visual encodings, and colormaps as required for your application.

---

## ✨ Features

* **Native Zarr pyramid support**: load multi-resolution datasets efficiently
* **Time navigation**: step through temporal slices with API methods or UI controls
* **Multi-band composites**: render single-band or multi-band data (e.g. RGB)
* **Flexible rendering modes**:

  * `raw` → float32 values for analytical use
  * `display` → Uint8Clamped arrays for visualization
* **NODATA handling**: configurable strategies for transparency or replacement values
* **Statistics-based normalization**: min, max, percentiles, standard deviation, etc.
* **Web Worker integration**: responsive rendering and non-blocking tile loading
* **Configurable pipeline**: all rendering logic and styling expressions are defined by the user

---

## 📂 Repository Structure

```
src/
  ZarrTile.js       # Main OpenLayers DataTile source extension
  zarr.worker.js    # Web Worker for async tile retrieval & preprocessing
examples/
  demo.html         # Example usage with dataset switcher and UI controls
```

---

## 📦 Dataset Structure

ZarrTile expects Zarr stores organized as **multi-resolution pyramids**:

```
datacube.zarr/
├── .zattrs
├── time/                # [T] timestamps
├── statistics/          # [T, B, S] statistics arrays
├── 6/value/             # [T, B, H, W] lowest zoom
├── ...
└── 15/value/            # [T, B, H, W] highest zoom
```

* **Value arrays**: `[time, band, y, x]`
* **Time arrays**: `[time]` (ISO strings or epoch integers)
* **Statistics arrays**: `[time, band, stat]` (min, max, mean, std, percentiles, etc.)
* **Metadata (`.zattrs`)** should include:

  * Coordinate Reference System (CRS)
  * Spatial extent
  * Resolutions and zoom levels
  * Band names
  * NODATA values

---

## ⚙️ Configuration Reference

### Core

```js
url: "https://server/datacube.zarr"   // Zarr store URL
path: "variable"                      // group inside store
```

### Spatial

```js
extent: [xmin, ymin, xmax, ymax]
crs: "EPSG:xxxx"
zoomLevels: [6,7,...,15]
resolutions: [640, 320, ..., 1.25]
```

### Data Selection

```js
bands: [0]       // single band
bands: [2,1,0]   // multi-band composite
```

### NODATA Handling

```js
mask_nodata: true
nodata_strategy: "replace"       // or "normalize_clamp"
nodata_replace_value: 0
```

### Normalization & Statistics

```js
normalize: {
  min_key: "p2",
  max_key: "p98",
  strategy: "global_band_per_time"
}

statistics_key_indices: { min:0, max:1, mean:2, p2:3, p98:4, std:5 }
```

### Render Modes

```js
render_type: "raw"      // float32 output
render_type: "display"  // Uint8Clamped output

drc: { strategy: "std_stretch", slope: 2.0 } // optional display adjustment
```

---

## 🔄 Data Flow Architecture

1. **Initialization**
   Metadata is loaded, extent and resolution are parsed, and a `ZarrTile` instance is created.

2. **Tile request**
   OpenLayers requests a tile → ZarrTile resolves parameters → Worker fetches array chunk → preprocessing applied → processed tile returned.

3. **State change**
   Time index or band selection updated → cache invalidated → tiles re-requested.

4. **Worker communication**
   Main thread sends configuration/state → Worker returns arrays as transferable data.

---

## 💻 Usage Examples

### Single-band analytical layer

```js
import ZarrTile from './src/ZarrTile.js';
import WebGLTile from 'ol/layer/WebGLTile.js';

const source = await ZarrTile.create({
  url: 'https://example.com/datacube.zarr',
  path: 'variable',
  bands: [0],
  mask_nodata: true,
  render_type: 'raw',
  normalize: { min_key: 'min', max_key: 'max', strategy: 'global_band_per_time' },
  statistics_key_indices: { min:0, max:1, mean:2, std:3 }
});

const layer = new WebGLTile({ source, style: customStyleExpression });
map.addLayer(layer);
```

### Multi-band composite

```js
const source = await ZarrTile.create({
  url: 'https://example.com/datacube.zarr',
  path: 'reflectance',
  bands: [2,1,0],    // RGB composite
  render_type: 'display'
});

const layer = new WebGLTile({ source, style: compositeStyle });
```

---

## ⏱️ Time Navigation

ZarrTile provides a temporal API:

* `.nextTimestep()` / `.previousTimestep()`
* `.setCurrentTimeIndex(index)`
* `.setCurrentTimestamp(timestamp)` (snaps to nearest available)
* `.getTimestamps()` returns full list of timesteps

---

## 🛠 Implementation Patterns

* **Configuration precedence**: user input > metadata > defaults
* **State caching**: recompute only on change
* **Worker messaging**: keep communication lightweight
* **Multi-format support**: timestamps can be ISO strings, epoch values, etc.

---

## ✅ Best Practices

* Use chunk sizes aligned with tile size (e.g. `[1, 1, 256, 256]`)
* Provide per-time statistics for robust normalization
* Reserve a sentinel value (e.g., `255`) for NODATA in categorical datasets
* Ensure consistent extent and resolution across all bands
* Always enable `mask_nodata` for transparent backgrounds

---

## ❗ Troubleshooting

* **Extent missing** → must be supplied via config if not in `.zattrs`
* **Zoom/resolution mismatch** → arrays must match zoom level count
* **Statistics errors** → verify keys against `statistics_key_indices`
* **Shape errors** → arrays must be 4D `[time, band, y, x]`

---

## 📜 License

This project is licensed under the MIT License.
See the [LICENSE](./LICENSE) file for details.

---

## 🙌 Credits

Developed at [Z\_GIS – University of Salzburg](https://zgis.at) within the **SpongeCity Toolbox** project.
Based on datacube research and implementations by the Spatial Services and EO Analytics teams.
