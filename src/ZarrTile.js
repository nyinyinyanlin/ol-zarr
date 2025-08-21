// src/ZarrTile.js
import DataTile from 'ol/source/DataTile';
import TileGrid from 'ol/tilegrid/TileGrid';
import { openArray } from 'zarr';

/**
 * @typedef {Object} ZarrTileOptions
 * @property {Object} metadata Dataset metadata containing extent, zoomLevels, resolutions, etc.
 * @property {number} [bandIndex=0] Initial band index to display.
 * @property {number} [timeIndex=0] Initial time index to display.
 * @property {number} [transition=0] Fade duration when updating tiles.
 * @property {boolean} [interpolate=true] Use interpolation when resampling.
 * @property {boolean} [wrapX=false] Whether to wrap around the antimeridian.
 */

/**
 * Layer source for visualizing Zarr arrays as tiles.
 * @extends {DataTile}
 */
class ZarrTile extends DataTile {
  /**
   * Generate full resolution array for all zoom levels, filling gaps with interpolated values.
   * @param {Array<number>} resolutions Original resolutions for supported levels
   * @param {Array<number>} zoomLevels Supported zoom levels
   * @return {Array<number>} Full resolutions array for all zoom levels
   * @private
   */
  static _generateFullArrays(resolutions, zoomLevels) {
    const maxZoom = Math.max(...zoomLevels);
    const minZoom = Math.min(...zoomLevels);
    const fullResolutions = new Array(maxZoom + 1);
    
    // Small increment for unique resolutions
    const INCREMENT = 0.001;

    // Fill supported levels first
    zoomLevels.forEach((z, index) => {
      fullResolutions[z] = resolutions[index];
    });

    // Fill gaps and unsupported levels
    for (let z = 0; z <= maxZoom; z++) {
      if (fullResolutions[z] === undefined) {
        if (z < minZoom) {
          // Below minimum supported level - use first supported level with increment
          fullResolutions[z] = resolutions[0] + ((minZoom - z) * INCREMENT);
        } else {
          // Find next supported level for interpolation
          let nextSupportedIndex = -1;
          for (let i = 0; i < zoomLevels.length; i++) {
            if (zoomLevels[i] > z) {
              nextSupportedIndex = i;
              break;
            }
          }
          
          if (nextSupportedIndex === -1) {
            // Use last supported level
            fullResolutions[z] = resolutions[resolutions.length - 1];
          } else {
            // Interpolate between previous and next supported levels
            const prevIndex = nextSupportedIndex - 1;
            if (prevIndex >= 0) {
              const prevLevel = zoomLevels[prevIndex];
              const nextLevel = zoomLevels[nextSupportedIndex];
              const ratio = (z - prevLevel) / (nextLevel - prevLevel);
              const baseResolution = resolutions[prevIndex] + 
                (resolutions[nextSupportedIndex] - resolutions[prevIndex]) * ratio;
              fullResolutions[z] = baseResolution + (INCREMENT * (z - prevLevel));
            } else {
              fullResolutions[z] = resolutions[nextSupportedIndex];
            }
          }
        }
      }
    }

    // Ensure first resolution is unique for OpenLayers
    fullResolutions[0] = fullResolutions[0] + 0.5;

    return fullResolutions;
  }

  /**
   * @param {ZarrTileOptions} options ZarrTile options.
   */
  constructor(options) {
    // Validate required options
    if (!options?.metadata) {
      throw new Error('Metadata is required for ZarrTile source');
    }
    if (!options.metadata.url) {
      throw new Error('URL is required in ZarrTile metadata');
    }

    const {
      extent,
      zoomLevels,
      resolutions,
      crs,
      bandIndices,
      currentTime,
      nodata,
      path = '',
      arrayPaths = { value: 'value', time: 'time', statistics: 'statistics' }
    } = options.metadata;

    // Validate required metadata
    if (!extent || !zoomLevels || !resolutions || !crs) {
      throw new Error('Missing required metadata: extent, zoomLevels, resolutions, and crs are required');
    }

    // Generate full resolutions array
    const fullResolutions = ZarrTile._generateFullArrays(resolutions, zoomLevels);

    // Create tile grid
    const tileGrid = new TileGrid({
      extent: extent,
      resolutions: fullResolutions,
      minZoom: Math.min(...zoomLevels),
      maxZoom: Math.max(...zoomLevels)
    });

    // Initialize parent DataTile
    super({
      projection: crs,
      tileGrid: tileGrid,
      interpolate: options.interpolate !== undefined ? options.interpolate : true,
      transition: options.transition || 0,
      wrapX: options.wrapX !== undefined ? options.wrapX : false,
      loader: async (z, x, y) => await this.tileLoader(z, x, y)
    });

    // Initialize instance properties
    this.url_ = this._normalizeUrl(options.metadata.url);
    this.path_ = path;
    this.arrayPaths_ = arrayPaths;
    this.metadata_ = options.metadata;
    this.bandIndices_ = bandIndices || [0];
    this.bandIndex_ = options.bandIndex || 0;
    this.timestamps_ = options.metadata.timestamps || [];
    this.statistics_ = options.metadata.statistics || [];
    this.nodata_ = nodata;
    this.usePercentiles_ = options.metadata.usePercentiles !== undefined ? 
      options.metadata.usePercentiles : true;

    // Initialize time index
    this.currentTimeIndex_ = 0;
    if (currentTime && this.timestamps_.length > 0) {
      this.currentTimeIndex_ = this._findClosestTimestampIndex(currentTime);
    } else if (options.timeIndex !== undefined) {
      this.currentTimeIndex_ = Math.max(0, Math.min(options.timeIndex, this.timestamps_.length - 1));
    }

    // Set up change listeners
    this.addChangeListener('time', () => this.refresh());
    this.addChangeListener('bands', () => this.refresh());

    // Set initial property values
    if (this.timestamps_.length > 0) {
      this.set('time', this.timestamps_[this.currentTimeIndex_]);
    }
    this.set('bands', this.bandIndices_);
  }

  /**
   * Normalize URL by removing trailing slashes
   * @param {string} url The URL to normalize
   * @return {string} Normalized URL
   * @private
   */
  _normalizeUrl(url) {
    return url.replace(/\/+$/, '');
  }

  /**
   * Get URL for a specific zoom level
   * @param {number} z Zoom level
   * @return {string} Zoom level URL
   */
  getZoomUrl(z) {
    return `${this.url_}/${this.path_}/${z}`.replace(/\/+/g, '/');
  }

  /**
   * Get URL for value array at specific zoom level
   * @param {number} z Zoom level
   * @return {string} Value array URL
   */
  getValueArrayUrl(z) {
    return `${this.getZoomUrl(z)}/${this.arrayPaths_.value}`;
  }

  /**
   * Check if zoom level is supported
   * @param {number} z Zoom level
   * @return {boolean} True if supported
   */
  isZoomSupported(z) {
    return this.metadata_.zoomLevels.includes(z);
  }

  /**
   * Load a tile
   * @param {number} z Zoom level
   * @param {number} x Tile X coordinate
   * @param {number} y Tile Y coordinate
   * @return {Promise<Uint8Array|Float32Array>} Tile data
   * @private
   */
  async tileLoader(z, x, y) {
    if (!this.isZoomSupported(z)) {
      return undefined;
    }

    const tileGrid = this.getTileGrid();
    const tileSize = tileGrid.getTileSize(z);
    const tileRange = tileGrid.getFullTileRange(z);

    return new Promise((resolve, reject) => {
      // Create worker with proper URL handling for different environments
      let workerUrl;
      try {
        // Try to get worker from same location as main script
        if (typeof __webpack_public_path__ !== 'undefined') {
          workerUrl = new URL('zarr-worker.js', __webpack_public_path__);
        } else {
          workerUrl = new URL('./zarr-worker.js', import.meta.url);
        }
      } catch (e) {
        // Fallback for older environments
        workerUrl = 'zarr-worker.js';
      }

      const worker = new Worker(workerUrl, { type: 'module' });

      worker.onmessage = (e) => {
        worker.terminate();
        if (e.data.error) {
          reject(new Error(e.data.error));
        } else {
          resolve(e.data.tileData);
        }
      };

      worker.onerror = (error) => {
        worker.terminate();
        reject(error);
      };

      // Send tile request to worker
      worker.postMessage({
        z: z,
        x: x,
        y: y,
        tileSize: tileSize,
        tileRange: tileRange,
        bands: this.bandIndices_,
        bandIndex: this.bandIndex_,
        timeIndex: this.currentTimeIndex_,
        nodata: this.nodata_,
        normalize: this.metadata_.normalize || false,
        statistics: this.getCurrentStatistics(),
        usePercentiles: this.usePercentiles_,
        storeUrl: this.url_,
        storePath: this.getValueArrayUrl(z)
      });
    });
  }

  // ==================== TEMPORAL DATA METHODS ====================

  /**
   * Retrieve timestamps from Zarr store
   * @return {Promise<void>}
   */
  async retrieveTimestamps() {
    if (this.timestamps_.length > 0) return; // Already loaded

    const timestamps = [];
    try {
      const highestZoom = Math.max(...this.metadata_.zoomLevels);
      const timeArray = await openArray({
        store: this.url_,
        path: `${this.path_}/${highestZoom}/${this.arrayPaths_.time}`.replace(/\/+/g, '/'),
        mode: 'r'
      });
      
      const ts = await timeArray.get([null]);
      ts.data.forEach(element => {
        timestamps.push(new Date(element * 1000));
      });
      
      this.timestamps_ = timestamps;
      if (timestamps.length > 0 && this.currentTimeIndex_ >= timestamps.length) {
        this.currentTimeIndex_ = timestamps.length - 1;
      }
    } catch (error) {
      console.warn('Could not retrieve timestamps:', error.message);
    }
  }

  /**
   * Retrieve statistics from Zarr store
   * @return {Promise<void>}
   */
  async retrieveStatistics() {
    if (this.statistics_.length > 0) return; // Already loaded

    const statistics = [];
    try {
      const highestZoom = Math.max(...this.metadata_.zoomLevels);
      const statsArray = await openArray({
        store: this.url_,
        path: `${this.path_}/${highestZoom}/${this.arrayPaths_.statistics}`.replace(/\/+/g, '/'),
        mode: 'r'
      });
      
      const stats = await statsArray.get([null, this.bandIndex_, null]);
      stats.data.forEach(element => {
        statistics.push({
          min: element[0],
          max: element[1],
          mean: element[2],
          p2: element[3],
          p98: element[4],
          mode: element[5],
          std: element[6]
        });
      });
      
      this.statistics_ = statistics;
    } catch (error) {
      console.warn('Could not retrieve statistics:', error.message);
    }
  }

  /**
   * Get statistics for current time index
   * @return {Object|null} Current statistics
   */
  getCurrentStatistics() {
    if (this.statistics_.length === 0) return null;
    const index = Math.min(this.currentTimeIndex_, this.statistics_.length - 1);
    return this.statistics_[index];
  }

  /**
   * Find closest timestamp index for a given date
   * @param {Date} targetTimestamp Target date
   * @return {number} Closest timestamp index
   * @private
   */
  _findClosestTimestampIndex(targetTimestamp) {
    if (this.timestamps_.length === 0) return 0;

    let closestIndex = 0;
    let minDiff = Math.abs(this.timestamps_[0].getTime() - targetTimestamp.getTime());

    for (let i = 1; i < this.timestamps_.length; i++) {
      const diff = Math.abs(this.timestamps_[i].getTime() - targetTimestamp.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    return closestIndex;
  }

  /**
   * Get index range for date range
   * @param {Date} startDate Start date
   * @param {Date} endDate End date
   * @return {Object} Object with startIndex and endIndex
   */
  getTimeRangeIndices(startDate, endDate) {
    const startTimestamp = startDate.getTime();
    const endTimestamp = endDate.getTime();

    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < this.timestamps_.length; i++) {
      const dateTimestamp = this.timestamps_[i].getTime();

      if (startIndex === -1 && dateTimestamp >= startTimestamp) {
        startIndex = i;
      }

      if (dateTimestamp > endTimestamp) {
        endIndex = i - 1;
        break;
      } else if (dateTimestamp <= endTimestamp) {
        endIndex = i;
      }
    }

    return {
      startIndex: startIndex === -1 ? 0 : startIndex,
      endIndex: endIndex === -1 ? this.timestamps_.length - 1 : endIndex
    };
  }

  // ==================== COORDINATE CONVERSION METHODS ====================

  /**
   * Convert map coordinates to array indices
   * @param {Array<number>} coord Coordinate [x, y] in map projection
   * @return {Array<number>} Array indices [x, y]
   */
  getIndicesFromCoord(coord) {
    const resolution = this.metadata_.resolutions[this.metadata_.resolutions.length - 1];
    const extent = this.metadata_.extent;
    
    // Clamp coordinates to extent
    const x = Math.max(extent[0], Math.min(coord[0], extent[2]));
    const y = Math.max(extent[1], Math.min(coord[1], extent[3]));
    
    // Convert to array indices
    const xIndex = Math.floor((x - extent[0]) / resolution);
    const yIndex = Math.floor((extent[3] - y) / resolution);
    
    return [xIndex, yIndex];
  }

  /**
   * Convert array indices to map coordinates
   * @param {number} x Array x index
   * @param {number} y Array y index
   * @return {Array<number>} Map coordinates [x, y]
   */
  getCoordinateAtIndex(x, y) {
    const extent = this.metadata_.extent;
    const resolution = this.metadata_.resolutions[this.metadata_.resolutions.length - 1];
    
    const coordX = (x * resolution) + extent[0];
    const coordY = extent[3] - (y * resolution);
    
    return [coordX, coordY];
  }

  /**
   * Convert extent to array indices
   * @param {Array<number>} extent Extent [xmin, ymin, xmax, ymax]
   * @return {Array<number>} Array indices [x0, y0, x1, y1]
   */
  getIndicesFromExtent(extent) {
    const resolution = this.metadata_.resolutions[this.metadata_.resolutions.length - 1];
    const dataExtent = this.metadata_.extent;
    
    // Clamp to data extent
    const xmin = Math.max(extent[0], dataExtent[0]);
    const xmax = Math.min(extent[2], dataExtent[2]);
    const ymin = Math.max(extent[1], dataExtent[1]);
    const ymax = Math.min(extent[3], dataExtent[3]);
    
    // Convert to indices
    const x0 = Math.floor((xmin - dataExtent[0]) / resolution);
    const y0 = Math.floor((dataExtent[3] - ymax) / resolution);
    const x1 = Math.floor((xmax - dataExtent[0]) / resolution);
    const y1 = Math.floor((dataExtent[3] - ymin) / resolution);
    
    return [x0, y0, x1, y1];
  }

  /**
   * Convert array indices to extent
   * @param {number} x0 Start x index
   * @param {number} y0 Start y index
   * @param {number} x1 End x index
   * @param {number} y1 End y index
   * @return {Array<number>} Extent [xmin, ymin, xmax, ymax]
   */
  getExtentFromIndices(x0, y0, x1, y1) {
    const resolution = this.metadata_.resolutions[this.metadata_.resolutions.length - 1];
    const extent = this.metadata_.extent;
    
    const xmin = (x0 * resolution) + extent[0];
    const ymax = extent[3] - (y0 * resolution);
    const xmax = (x1 * resolution) + extent[0];
    const ymin = extent[3] - (y1 * resolution);
    
    return [xmin, ymin, xmax, ymax];
  }

  // ==================== PUBLIC API METHODS ====================

  /**
   * Get base URL
   * @return {string} Base URL
   */
  getUrl() {
    return this.url_;
  }

  /**
   * Get metadata
   * @return {Object} Metadata object
   */
  getMetadata() {
    return this.metadata_;
  }

  /**
   * Get current band index
   * @return {number} Band index
   */
  getBandIndex() {
    return this.bandIndex_;
  }

  /**
   * Set band index
   * @param {number} index Band index
   */
  setBandIndex(index) {
    if (index !== this.bandIndex_ && index >= 0 && index < this.bandIndices_.length) {
      this.bandIndex_ = index;
      this.set('bands', this.bandIndices_);
      this.refresh();
    }
  }

  /**
   * Get current time index
   * @return {number} Time index
   */
  getTimeIndex() {
    return this.currentTimeIndex_;
  }

  /**
   * Set time index
   * @param {number} index Time index
   */
  setTimeIndex(index) {
    if (index !== this.currentTimeIndex_ && index >= 0 && index < this.timestamps_.length) {
      this.currentTimeIndex_ = index;
      this.set('time', this.timestamps_[this.currentTimeIndex_]);
      this.refresh();
    }
  }

  /**
   * Set current time by Date object
   * @param {Date} time Date object
   */
  setCurrentTime(time) {
    const index = this._findClosestTimestampIndex(time);
    this.setTimeIndex(index);
  }

  /**
   * Get all timestamps
   * @return {Array<Date>} Array of timestamps
   */
  getTimestamps() {
    return this.timestamps_;
  }

  /**
   * Get timestamp at specific index
   * @param {number} index Time index
   * @return {Date|null} Date object or null
   */
  getTimeAtIndex(index) {
    return this.timestamps_[index] || null;
  }

  /**
   * Get index for specific time
   * @param {Date} time Date object
   * @return {number} Time index
   */
  getIndexAtTime(time) {
    return this._findClosestTimestampIndex(time);
  }

  /**
   * Get current time index
   * @return {number} Current time index
   */
  getCurrentTimeIndex() {
    return this.currentTimeIndex_;
  }
}

export default ZarrTile;