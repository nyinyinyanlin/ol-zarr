# ZarrTile (ol-zarr)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.17013896.svg)](https://doi.org/10.5281/zenodo.17013896)

**ZarrTile** is an [OpenLayers](https://openlayers.org/) extension for visualizing large-scale geospatial time-series data stored in [Zarr](https://zarr.dev/) format. It provides WebGL-accelerated, multi-resolution rendering of 4D datacubes directly in web browsers, making it ideal for Earth Observation data visualization and analysis.

🎮 **[Live Demo](https://nyinyinyanlin.github.io/ol-zarr/demo.html)** - Try ZarrTile with real datasets including vegetation greenness and land surface categories.

## 🚀 Quick Start

```javascript
import ZarrTile from './src/ZarrTile.js';
import WebGLTile from 'ol/layer/WebGLTile.js';

// Create a ZarrTile source
const source = await ZarrTile.create({
  url: 'https://example.com/data.zarr',
  path: 'temperature',
  bands: [0],
  normalize: { min_key: 'p2', max_key: 'p98', strategy: 'per_band_per_time' }
});

// Add to OpenLayers map
const layer = new WebGLTile({ 
  source, 
  style: { color: ['interpolate', ['linear'], ['band', 1], 0, 'blue', 1, 'red'] }
});
map.addLayer(layer);

// Navigate through time
source.nextTimestep();  // Move forward in time
source.previousTimestep();  // Move backward in time
```

## ✨ Key Features

* **🌐 Native Zarr Support**: Direct streaming from Zarr stores with multi-resolution pyramids
* **⏱️ Time-Series Navigation**: Built-in temporal controls for 4D data exploration
* **🎨 Flexible Rendering**: Raw scientific values or display-optimized visualization
* **📊 Advanced Normalization**: Multiple strategies including percentile-based scaling
* **🚀 High Performance**: WebGL rendering with Web Worker parallelization
* **🔧 Fully Configurable**: Customize every aspect of data processing and visualization

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ol-zarr.git

# Include in your project
import ZarrTile from './path/to/ZarrTile.js';
```

### Dependencies
- OpenLayers ≥ 10.0.0
- Modern browser with WebGL support
- zarr.js (automatically imported via CDN)

## 🗂️ Zarr Dataset Structure

ZarrTile expects a specific organization for optimal performance:

### Required Structure

```
your-dataset.zarr/
├── .zattrs                 # Optional: metadata (CRS, extent, etc.)
├── .zgroup                 # Zarr group marker
├── time/                   # Optional: temporal coordinates
│   └── .zarray            # 1D array [time_steps]
├── statistics/            # Optional: pre-computed statistics  
│   └── .zarray            # 3D array [time, bands, stats]
└── {zoom_level}/          # Multiple zoom levels (e.g., 6-15)
    └── value/             # Actual data arrays
        └── .zarray        # 4D array [time, bands, height, width]
```

### Data Array Dimensions

Your value arrays **must** follow this dimension order:
```python
[time, bands, y, x]

# Example shapes at different zoom levels:
zoom_15: [365, 3, 2048, 2048]  # 365 days, 3 bands, 2048x2048 pixels
zoom_14: [365, 3, 1024, 1024]  # Lower resolution
zoom_13: [365, 3, 512, 512]    # Even lower resolution
```

### Recommended Chunking

Align chunks with typical tile sizes for optimal performance:
```python
chunks = [1, 1, 256, 256]  # [time, bands, y, x]
```

### Metadata Structure (.zattrs)

```json
{
  "crs": "EPSG:32633",
  "extent": [xmin, ymin, xmax, ymax],
  "zoom_levels": [6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  "resolutions": [640.0, 320.0, 160.0, 80.0, 40.0, 20.0, 10.0, 5.0, 2.5, 1.25],
  "nodata": -9999,
  "band_names": ["red", "green", "blue"]
}
```

## ⚙️ Configuration

### Essential Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | ✅ | Zarr store URL |
| `path` | string | ✅ | Path within the Zarr store |
| `extent` | array/object | ✅* | Spatial extent [xmin, ymin, xmax, ymax] |
| `zoomLevels` | array | ✅* | Available zoom levels |
| `resolutions` | array | ✅* | Resolution per zoom level |

*Required if not provided in `.zattrs` metadata

### Data Selection

```javascript
{
  // Band selection
  bands: [0],           // Single band
  bands: [2, 1, 0],    // RGB composite (band indices)
  
  // Temporal selection
  timestamps: 12,                        // Generate 12 indices
  timestamps: [0, 3, 6, 9],             // Specific indices
  timestamps: ['2023-01', '2023-02'],   // ISO strings
}
```

### Visualization Options

```javascript
{
  // Render type
  render_type: 'display',  // Uint8 [0-255] for visualization
  render_type: 'raw',      // Float32 for analysis
  
  // Normalization
  normalize: {
    min_key: 'p2',        // Use 2nd percentile as minimum
    max_key: 'p98',       // Use 98th percentile as maximum
    strategy: 'per_band_per_time'  // See strategies below
  },
  
  // NODATA handling
  mask_nodata: true,              // Make NODATA pixels transparent
  nodata_strategy: 'replace',     // How to handle NODATA
  nodata_replace_value: 0,        // Replacement value
}
```

### Normalization Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `'global'` | Single min/max for all bands/times | Consistent scaling across dataset |
| `'global_band_per_time'` | Min/max across bands per timestep | Temporal comparison |
| `'per_band_global_time'` | Min/max per band across all times | Band-specific analysis |
| `'per_band_per_time'` | Min/max per band per time | Maximum local contrast |

## 📊 Statistics Configuration

### Pre-computed Statistics Array

If provided, statistics should be a 3D array: `[time, bands, statistics]`

```javascript
// Define which statistics are at which indices
statistics_key_indices: {
  min: 0,    // Minimum value at index 0
  max: 1,    // Maximum value at index 1
  mean: 2,   // Mean at index 2
  p2: 3,     // 2nd percentile at index 3
  p98: 4,    // 98th percentile at index 4
  std: 5     // Standard deviation at index 5
}
```

### User-Provided Statistics

You can also provide statistics directly:

```javascript
statistics: [
  // Per band statistics
  { min: 0.1, max: 0.9, mean: 0.5, std: 0.2 },  // Band 0
  { min: 0.2, max: 0.8, mean: 0.4, std: 0.15 }  // Band 1
]
```

## 🎮 API Reference

### Core Methods

#### Creating a Source
```javascript
const source = await ZarrTile.create(config);
```

#### Time Navigation
```javascript
// Navigate through time
source.nextTimestep();           // Move forward one step
source.previousTimestep();        // Move backward one step
source.setCurrentTimeIndex(5);   // Jump to specific index
source.setCurrentTime(timestamp); // Jump to nearest timestamp

// Query time information
const timestamps = source.getTimestamps();        // Get all timestamps
const currentIndex = source.getCurrentTimeIndex(); // Get current index
const currentTime = source.getCurrentTime();       // Get current timestamp
```

#### Band Management
```javascript
// Change band selection
source.setBands([2, 1, 0]);  // Change to different band combination
const bands = source.getBands();  // Get current bands
```

#### Configuration Access
```javascript
// Get configuration information
const config = source.getConfiguration();         // Full config (immutable)
const renderConfig = source.getRenderConfiguration(); // Render settings
const crs = source.getCRS();                     // Coordinate system
const extent = source.getExtent();               // Spatial extent
```

#### Current State
```javascript
// Get resolved values for current time/bands
const nodata = source.getCurrentNodata();         // NODATA values
const stats = source.getCurrentStatistics();      // Statistics
const norm = source.getCurrentNormalization();    // Normalization ranges
```

## 💡 Complete Examples

### Example 1: Simple Vegetation Index

```javascript
const ndviSource = await ZarrTile.create({
  url: 'https://data.example.com/ndvi.zarr',
  path: 'vegetation',
  bands: [0],
  
  // Use percentiles to handle outliers
  normalize: {
    min_key: 'p2',
    max_key: 'p98',
    strategy: 'per_band_per_time'
  },
  
  // Transparent NODATA
  mask_nodata: true,
  render_type: 'display'
});

// Create layer with color gradient
const ndviLayer = new WebGLTile({
  source: ndviSource,
  style: {
    color: ['interpolate', ['linear'], ['band', 1],
      0.0, [247, 252, 245, 1],  // Light green
      0.5, [116, 196, 118, 1],  // Medium green  
      1.0, [0, 68, 27, 1]        // Dark green
    ]
  }
});
```

### Example 2: Multi-band RGB Composite

```javascript
const rgbSource = await ZarrTile.create({
  url: 'https://data.example.com/sentinel2.zarr',
  path: 'surface_reflectance',
  bands: [3, 2, 1],  // NIR, Red, Green for false color
  
  // Global normalization for consistent colors
  normalize: {
    min_key: 'min',
    max_key: 'max',
    strategy: 'global_band_per_time'
  },
  
  // Enhanced display
  drc: {
    strategy: 'std_stretch',
    slope: 2.0
  }
});
```

### Example 3: Scientific Analysis Mode

```javascript
const analysisSource = await ZarrTile.create({
  url: 'https://data.example.com/temperature.zarr',
  path: 'land_surface_temp',
  bands: [0],
  
  // Raw values for analysis
  render_type: 'raw',
  
  // No normalization - preserve original values
  normalize: null,
  
  // Replace NODATA with specific value
  nodata_strategy: 'replace',
  nodata_replace_value: -273.15
});

// Access raw values programmatically
const stats = analysisSource.getCurrentStatistics();
console.log('Temperature range:', stats[0].min, 'to', stats[0].max);
```

## 🔄 Data Flow Architecture

### Initialization
```
User Config → Validation → Metadata Extraction → Resolution → Instance Creation
```

### Runtime Tile Loading
```
1. OpenLayers requests tile (z, x, y)
2. ZarrTile resolves current state (time, bands, normalization)
3. Worker fetches Zarr chunk and processes data
4. Processed tile returned to map
```

### State Management
- Configuration changes trigger cache invalidation
- Tiles automatically refresh with new parameters
- Worker pool manages parallel processing

## 🛠️ Best Practices

### Dataset Preparation
- ✅ Use chunk size of `[1, 1, 256, 256]` for optimal tile alignment
- ✅ Pre-compute statistics for all bands and timesteps
- ✅ Store data in Web-Mercator or local projection (avoid WGS84 for tiles)
- ✅ Use compression appropriate for your data type (LZ4 for speed, Zstd for size)

### Configuration
- ✅ Always provide `extent` and `resolutions` if not in metadata
- ✅ Use percentile normalization (`p2`/`p98`) to handle outliers
- ✅ Enable `mask_nodata` for transparent backgrounds
- ✅ Use `render_type: 'display'` for visualization, `'raw'` for analysis

### Performance
- ✅ Limit to 1-3 bands for display purposes
- ✅ Use appropriate zoom levels (typically 6-15)
- ✅ Consider data volume when setting time range
- ✅ Enable `verbose: true` only for debugging

## ❗ Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "Extent must be provided" | Add `extent: [xmin, ymin, xmax, ymax]` to config |
| "Zoom levels mismatch" | Ensure `zoomLevels` and `resolutions` have same length |
| "Statistics key not found" | Check available keys in `statistics_key_indices` |
| "Shape error" | Verify array is 4D: `[time, bands, y, x]` |
| Slow tile loading | Check chunk alignment, try reducing tile size |

### Debugging

```javascript
// Enable verbose logging
const source = await ZarrTile.create({
  ...config,
  verbose: true  // Detailed console output
});

// Check current state
console.log('Cache status:', source.getCacheStatus());
console.log('Current stats:', source.getCurrentStatistics());
console.log('Render config:', source.getRenderConfiguration());
```



## 📜 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](./LICENSE) file for details.

## 📖 Citation

If you use ZarrTile in your research, please cite:

```bibtex
@software{zarrtile2025,
  title = {ZarrTile: An OpenLayers extension for visualizing Zarr datacubes},
  author = {Lin, Nyi Nyi Nyan},
  year = {2025},
  doi = {10.5281/zenodo.17013896},
  url = {https://github.com/nyinyinyanlin/ol-zarr}
}
```

## 🙏 Acknowledgments

Developed at [Z_GIS – University of Salzburg](https://zgis.at) as part of the **SpongeCity Toolbox** project. Based on research and implementations by the Spatial Services and EO Analytics teams.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## 📮 Support

For questions and support, please open an issue on the [GitHub repository](https://github.com/nyinyinyanlin/ol-zarr/issues).