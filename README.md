# ol-zarr

![npm version](https://img.shields.io/npm/v/ol-zarr.svg)
![npm downloads](https://img.shields.io/npm/dm/ol-zarr.svg)
![license](https://img.shields.io/npm/l/ol-zarr.svg)

OpenLayers extension for visualizing Zarr-based geospatial data as map tiles with WebGL acceleration.

## ✨ Features

- 🚀 **Self-contained**: Bundles all dependencies for maximum reliability
- 🌍 **WebGL accelerated**: High-performance tile rendering
- 📊 **Multi-dimensional**: Support for temporal and multi-band data
- ⏱️ **Temporal navigation**: Built-in time series support
- 🎯 **Easy integration**: Drop-in replacement for standard tile sources
- 🔧 **Flexible**: Configurable data normalization and statistics

## 📦 Installation

### NPM
```bash
npm install ol-zarr ol
```

### Yarn
```bash
yarn add ol-zarr ol
```

### CDN (UMD)
```html
<script src="https://unpkg.com/ol@10/dist/ol.js"></script>
<script src="https://unpkg.com/ol-zarr/dist/index.umd.js"></script>
```

## 🚀 Quick Start

### ES Modules
```javascript
import { ZarrTile } from 'ol-zarr';
import { Map, View } from 'ol';
import { WebGLTile } from 'ol/layer';

const source = new ZarrTile({
  metadata: {
    url: 'https://example.com/zarr-data',
    path: 'temperature',
    extent: [-180, -90, 180, 90],
    crs: 'EPSG:4326',
    zoomLevels: [0, 1, 2, 3, 4],
    resolutions: [180, 90, 45, 22.5, 11.25]
  }
});

const layer = new WebGLTile({ source });

const map = new Map({
  target: 'map',
  layers: [layer],
  view: new View({
    center: [0, 0],
    zoom: 2
  })
});
```

### CDN Usage
```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://unpkg.com/ol@10/ol.css">
</head>
<body>
  <div id="map" style="width: 100%; height: 400px;"></div>
  
  <script src="https://unpkg.com/ol@10/dist/ol.js"></script>
  <script src="https://unpkg.com/ol-zarr/dist/index.umd.js"></script>
  
  <script>
    const source = new olZarr.ZarrTile({
      metadata: {
        url: 'https://example.com/zarr-data',
        path: 'temperature',
        extent: [-180, -90, 180, 90],
        crs: 'EPSG:4326',
        zoomLevels: [0, 1, 2, 3],
        resolutions: [180, 90, 45, 22.5]
      }
    });

    const map = new ol.Map({
      target: 'map',
      layers: [new ol.layer.WebGLTile({ source })],
      view: new ol.View({ center: [0, 0], zoom: 2 })
    });
  </script>
</body>
</html>
```

## 📊 Working with Temporal Data

```javascript
const source = new ZarrTile({
  metadata: {
    url: 'https://example.com/temporal-data',
    path: 'lst_time_series',
    extent: [-180, -90, 180, 90],
    crs: 'EPSG:4326',
    zoomLevels: [0, 1, 2, 3],
    resolutions: [180, 90, 45, 22.5],
    // Optional: pre-loaded timestamps
    timestamps: [
      new Date('2024-01-01'),
      new Date('2024-01-02'),
      new Date('2024-01-03')
    ]
  }
});

// Load timestamps dynamically from Zarr store
await source.retrieveTimestamps();

// Navigate through time
source.setTimeIndex(0);  // First timestamp
source.setCurrentTime(new Date('2024-01-02'));  // Specific date

// Listen for time changes
source.addChangeListener('time', () => {
  console.log('Current time:', source.getTimeAtIndex(source.getTimeIndex()));
});
```

## 🎛️ Multi-band Data

```javascript
const source = new ZarrTile({
  metadata: {
    url: 'https://example.com/multispectral',
    path: 'sentinel2',
    extent: [1000000, 6000000, 1500000, 6500000],
    crs: 'EPSG:3857',
    zoomLevels: [8, 9, 10, 11, 12],
    resolutions: [305.7, 152.9, 76.4, 38.2, 19.1],
    bandIndices: [0, 1, 2, 3], // Red, Green, Blue, NIR
    nodata: -9999
  }
});

// Switch between bands
source.setBandIndex(0);  // Red band
source.setBandIndex(3);  // NIR band

// Get coordinate information
const indices = source.getIndicesFromCoord([1250000, 6250000]);
const coords = source.getCoordinateAtIndex(500, 300);
```

## 🔧 Configuration Options

### Required Metadata
```javascript
{
  url: "string",           // Zarr store base URL
  path: "string",          // Dataset path within store  
  extent: [number],        // [xmin, ymin, xmax, ymax]
  crs: "string",           // Coordinate reference system
  zoomLevels: [number],    // Supported zoom levels
  resolutions: [number]    // Resolution per zoom level
}
```

### Optional Metadata
```javascript
{
  bandIndices: [number],      // Band indices to use (default: [0])
  nodata: number|"nan",       // NODATA value (default: undefined)
  normalize: boolean,         // Apply normalization (default: false)
  usePercentiles: boolean,    // Use p2/p98 vs min/max (default: true)
  timestamps: [Date],         // Pre-loaded timestamps
  statistics: [Object],       // Pre-computed statistics
  arrayPaths: {               // Custom Zarr array paths
    value: "string",          // Value array path (default: "value")
    time: "string",           // Time array path (default: "time") 
    statistics: "string"      // Statistics path (default: "statistics")
  }
}
```

### Constructor Options
```javascript
{
  metadata: Object,          // Required metadata (above)
  bandIndex: number,         // Initial band index (default: 0)
  timeIndex: number,         // Initial time index (default: 0)
  interpolate: boolean,      // Use interpolation (default: true)
  transition: number,        // Fade duration in ms (default: 0)
  wrapX: boolean            // Wrap around antimeridian (default: false)
}
```

## 📖 API Reference

### Core Methods
- `getMetadata()` - Get source metadata
- `getBandIndex()` / `setBandIndex(index)` - Band control
- `getTimeIndex()` / `setTimeIndex(index)` - Time control
- `setCurrentTime(date)` - Set time by Date object

### Temporal Methods
- `getTimestamps()` - Get all available timestamps
- `retrieveTimestamps()` - Load timestamps from Zarr store
- `getCurrentStatistics()` - Get statistics for current time
- `retrieveStatistics()` - Load statistics from Zarr store
- `getTimeRangeIndices(start, end)` - Get index range for date range

### Coordinate Utilities
- `getIndicesFromCoord([x, y])` - Map coordinates to array indices
- `getCoordinateAtIndex(x, y)` - Array indices to map coordinates
- `getIndicesFromExtent([xmin, ymin, xmax, ymax])` - Extent to indices
- `getExtentFromIndices(x0, y0, x1, y1)` - Indices to extent

## 📁 Data Preparation

### Required Zarr Structure
```
/{path}/
├── {zoom_level}/              # One folder per zoom level
│   ├── value/                 # Main data [time, band, y, x] or [band, y, x]
│   ├── time/                  # Time coordinates (temporal data only)
│   ├── statistics/            # Statistics [time, band, stats] or [band, stats]
│   ├── x/                     # X coordinates
│   └── y/                     # Y coordinates
```

### Python Data Preparation
We provide Python scripts to convert your geospatial data into ol-zarr compatible format:

```python
# Example using our data preparation tools
python prepare_zarr_data.py \
  --input satellite_images/ \
  --output zarr_output/ \
  --zoom-levels 0,1,2,3,4 \
  --chunk-size 256
```

See [docs/data-preparation.md](docs/data-preparation.md) for detailed instructions.

## 🏗️ Bundle Information

ol-zarr includes a self-contained worker (~515 KiB) that bundles the Zarr JavaScript library. This design choice ensures:

- ✅ **Reliability**: Works offline and in restricted networks
- ✅ **Consistency**: Same Zarr version across all environments  
- ✅ **Simplicity**: Zero configuration required
- ✅ **Compatibility**: No CDN dependencies or version conflicts

## 🌟 Examples

- [Basic Usage](examples/basic.html) - Simple static data visualization
- [Temporal Data](examples/temporal.html) - Time series navigation
- [Multi-band](examples/multi-band.html) - Band switching and analysis
- [Statistics](examples/statistics.html) - Dynamic data statistics

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [OpenLayers](https://openlayers.org/) - Web mapping library
- [Zarr](https://zarr.readthedocs.io/) - Chunked, compressed array storage
- [Zarr JavaScript](https://github.com/gzuidhof/zarr.js/) - JavaScript implementation

## 📞 Support

- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/nyinyinyanlin/ol-zarr/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/nyinyinyanlin/ol-zarr/discussions)
- 📧 **Email**: [nyinyinyan.lin@plus.ac.at]

---

Made with ❤️ for the geospatial community