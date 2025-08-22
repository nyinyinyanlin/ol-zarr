import DataTile from 'ol/source/DataTile';
import TileGrid from 'ol/tilegrid/TileGrid';
import { slice, openArray } from "zarr";

/**
 * @typedef {Object} ZarrTileOptions
 * @property {string} url URL to the Zarr dataset.
 * @property {Object} metadata Dataset metadata containing extent, zoomLevels, resolutions, tileSizes.
 * @property {number} [bandIndex=0] Band index to display.
 * @property {number} [timeIndex=0] Time index to display.
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
   * Fill arrays for full zoom level range
   * @param {Array<number>} tileSizes Original tile sizes for supported levels
   * @param {Array<number>} resolutions Original resolutions for supported levels
   * @param {Array<number>} zoomLevels Supported zoom levels
   * @return {Object} Full arrays for all zoom levels
   * @private
   */
  static _generateFullArrays(/*tileSizes,*/ resolutions, zoomLevels) {
    const maxZoom = Math.max(...zoomLevels);
    const minZoom = Math.min(...zoomLevels);

    // const fullTileSizes = new Array(maxZoom + 1);
    const fullResolutions = new Array(maxZoom + 1);

    // Small increment for unique resolutions
    const INCREMENT = 0.001;

    // Fill supported levels first
    zoomLevels.forEach((z, index) => {
      // fullTileSizes[z] = tileSizes[index];
      fullResolutions[z] = resolutions[index];
    });

    // Fill gaps and unsupported levels
    for (let z = 0; z <= maxZoom; z++) {
      if (!fullResolutions[z]) {
        // Find nearest supported level for reference
        let nearestSupportedLevel;
        let nearestIndex;

        if (z < minZoom) {
          // Below minimum supported level - use first supported level
          nearestSupportedLevel = minZoom;
          nearestIndex = 0;
          // Add increment to resolution for unique values
          fullResolutions[z] = resolutions[0] + ((minZoom - z) * INCREMENT);
        } else {
          // Find next supported level
          for (let i = 0; i < zoomLevels.length; i++) {
            if (zoomLevels[i] > z) {
              nearestSupportedLevel = zoomLevels[i];
              nearestIndex = i;
              break;
            }
          }
          // If no next level found, use last supported level
          if (!nearestSupportedLevel) {
            nearestSupportedLevel = zoomLevels[zoomLevels.length - 1];
            nearestIndex = zoomLevels.length - 1;
          }
          // Calculate resolution for gap level
          const prevLevel = zoomLevels[nearestIndex - 1];
          const nextLevel = zoomLevels[nearestIndex];
          if (prevLevel && nextLevel) {
            // Interpolate resolution with small increment
            const ratio = (z - prevLevel) / (nextLevel - prevLevel);
            const baseResolution = resolutions[nearestIndex - 1] +
              (resolutions[nearestIndex] - resolutions[nearestIndex - 1]) * ratio;
            fullResolutions[z] = baseResolution + (INCREMENT * (z - prevLevel));
          } else {
            fullResolutions[z] = resolutions[nearestIndex];
          }
        }

        // Use the reference level's values for shapes and tile sizes
        // fullTileSizes[z] = tileSizes[nearestIndex];
      }
    }

    return {
      // tileSizes: fullTileSizes,
      resolutions: fullResolutions,
    };
  }

  /**
   * @param {ZarrTileOptions} options ZarrTile options.
   */
  constructor(options) {
    if (!options.metadata.url) {
      throw new Error('URL is required for ZarrTile source');
    }
    if (!options.metadata) {
      throw new Error('Metadata is required for ZarrTile source');
    }

    const {
      extent,
      zoomLevels,
      resolutions,
      // tileSizes,
      crs,
      bandSize,
      bandIndices,
      currentTime,
      nodata
    } = options.metadata;
    // Generate full arrays for all zoom levels

    const {
      // tileSizes: fullTileSizes,
      resolutions: fullResolutions
    } = ZarrTile._generateFullArrays(/*tileSizes, */ resolutions, zoomLevels);

    fullResolutions[0] = fullResolutions[0] + 0.5;


    // const fullResolutions = resolutions

    // Create tile grid
    const tileGrid = new TileGrid({
      extent: extent,
      resolutions: fullResolutions,
      // tileSizes: fullTileSizes.map(size => [size, size])
      minZoom: zoomLevels[0],
      maxZoom: zoomLevels[zoomLevels.length - 1]
    });

    // Initialize parent
    super({
      projection: crs,
      tileGrid: tileGrid,
      interpolate: options.interpolate !== undefined ? options.interpolate : true,
      transition: options.transition || 0,
      wrapX: options.wrapX !== undefined ? options.wrapX : false,
      loader: async (z, y, x) => await this.tileLoader(z, y, x)
    });

    this.url_ = this.normalizeUrl_(options.metadata.url);
    this.bandIndex_ = options.bandIndex || 0;
    this.metadata_ = options.metadata;
    this.timestamps_ = options.metadata.timestamps || [];
    this.statistics_ = options.metadata.statistics || [];
    this.currentTimeIndex_ = options.metadata.currentTime ? this.getIndexAtTime(options.metadata.currentTime) : 0;// this.timestamps_.length > 0 ? this.timestamps_.length - 1 : 0;
    this.bandSize_ = bandSize ? bandSize : 1;
    this.bandIndices_ = bandIndices ? bandIndices : [0];
    this.usePercentiles = options.metadata.usePercentiles;
    this.addChangeListener('time', (e) => {
      this.refresh();
    }
    );
    this.addChangeListener('bands', (e) => {
      this.refresh();
    });
    this.set("time", this.timestamps_[this.currentTimeIndex_]);
    this.set("bands", this.bandIndices_);
  }

  async retrieveTimestamps() {
    const timestamps = [];
    try {
      const timeArray = await openArray({
        store: this.metadata_.url,
        path: `${this.metadata_.path}/${this.metadata_.zoomLevels[this.metadata_.zoomLevels.length - 1]}/time`,
        mode: "r"
      });
      const ts = await timeArray.get([null])
      ts.data.forEach(element => {
        timestamps.push(new Date(element * 1000));
      })
    } catch (error) {
      console.error(error);
    }
    this.timestamps_ = timestamps;
  }

  async retrieveStatistics() {
    if (this.metadata_.statistics) return;
    const statistics = [];
    try {
      const statsArray = await openArray({
        store: this.metadata_.url,
        path: `${this.metadata_.path}/${this.metadata_.zoomLevels[this.metadata_.zoomLevels.length - 1]}/statistics`,
        mode: "r"
      });
      const stats = await statsArray.get([null, this.bandIndex_, null])
      stats.data.forEach(element => {
        statistics.push({
          min: element[0],
          max: element[1],
          mean: element[2],
          p2: element[3],
          p98: element[4],
          mode: element[5],
          std: element[6],
        });
      })

    } catch (error) {
      console.error(error);
    }
    this.statistics_ = statistics;
  }

  getCurrentStatistics() {
    return this.statistics_[this.currentTimeIndex_];
  }

  findClosestTimestampIndex_(targetTimestamp) {
    if (this.timestamps_.length === 0) return 0;

    let closestIndex = 0;
    let minDiff = Math.abs(this.timestamps_[0] - targetTimestamp);

    for (let i = 1; i < this.timestamps_.length; i++) {
      const diff = Math.abs(this.timestamps_[i] - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    return closestIndex;
  }

  getTimeRangeIndices(startDate, endDate) {
    const startTimestamp = startDate.getTime();
    const endTimestamp = endDate.getTime();

    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < this.timestamps_.length; i++) {
      const dateTimestamp = this.timestamps_[i].getTime();

      // Find the first date within the range (start index)
      if (startIndex === -1 && dateTimestamp >= startTimestamp) {
        startIndex = i;
      }

      // Find the last date within the range (end index)
      if (dateTimestamp > endTimestamp) {
        endIndex = i - 1;
      } else if (dateTimestamp === endTimestamp) {
        endIndex = i;
      }

      // If both indices are found, break out early
      if (startIndex !== -1 && endIndex !== -1) {
        break;
      }
    }

    if (startIndex === -1) startIndex=0;
    if (endIndex === -1) endIndex=this.timestamps_.length - 1; 

    return { startIndex: startIndex, endIndex: endIndex };
  }

  getTimestamps() { return this.timestamps_; }
  getTimeAtIndex(index) { return this.timestamps_[index]; }
  getIndexAtTime(time) { return this.findClosestTimestampIndex_(time); }
  setCurrentTime(time) { this.setCurrentTimeIndex(this.findClosestTimestampIndex_(time)); }
  setCurrentTimeIndex(index) { this.currentTimeIndex_ = index; this.set("time", this.getTimeAtIndex(this.currentTimeIndex_), false); }
  getCurrentTimeIndex() { return this.currentTimeIndex_; }
  getIndicesFromCoord(coord) {
    const resolution = this.metadata_.resolutions[this.metadata_.resolutions.length - 1];
    const xmin = coord[0] < this.metadata_.extent[0] ? this.metadata_.extent[0] : coord[0] > this.metadata_.extent[2] ? this.metadata_.extent[2] : coord[0];
    const ymin = coord[1] < this.metadata_.extent[1] ? this.metadata_.extent[1] : coord[1] > this.metadata_.extent[3] ? this.metadata_.extent[3] : coord[1];
    const x = Math.floor((xmin - this.metadata_.extent[0]) / resolution);
    const y = Math.floor((this.metadata_.extent[3] - ymin) / resolution);
    return [x, y];
  }
  getIndicesFromExtent(extent) {
    const resolution = this.metadata_.resolutions[this.metadata_.resolutions.length - 1];
    const xmin = extent[0] < this.metadata_.extent[0] ? this.metadata_.extent[0] : extent[0];
    const xmax = extent[2] > this.metadata_.extent[2] ? this.metadata_.extent[2] : extent[2];
    const ymin = extent[1] < this.metadata_.extent[1] ? this.metadata_.extent[1] : extent[1];
    const ymax = extent[3] > this.metadata_.extent[3] ? this.metadata_.extent[3] : extent[3];
    const x0 = Math.floor((xmin - this.metadata_.extent[0]) / resolution);
    const y0 = Math.floor((this.metadata_.extent[3] - ymax) / resolution);
    const x1 = Math.floor((xmax - this.metadata_.extent[0]) / resolution);
    const y1 = Math.floor((this.metadata_.extent[3] - ymin) / resolution);
    return [x0, y0, x1, y1]
  }
  getCoordinateAtIndex(index) {
    const extent = this.metadata_.extent;
    const resolution = this.metadata_.resolutions[this.metadata_.resolutions.length - 1];
    x = (x * resolution) + extent[0];
    y = (extent[3] - (y * resolution)) + extent[3];
    return x, y
  }
  getExtentFromIndices(indices) {
    const resolution = this.metadata_.resolutions[this.metadata_.resolutions.length - 1];
    const extent = this.metadata_.extent;
    x0 = (x0 * resolution) + extent[0];
    y0 = (extent[3] - (y0 * resolution)) + extent[3];
    x1 = (x1 * resolution) + extent[0];
    y1 = (extent[3] - (y1 * resolution)) + extent[3];
    return [x0, y0, x1, y1];
  }

  /**
   * Load a tile
   * @param {number} z Zoom level
   * @param {number} x Tile X coordinate
   * @param {number} y Tile Y coordinate
   * @return {Promise<Uint8Array>} Tile data as RGBA
   * @private
   */
  async tileLoader(z, x, y) {
    if (!this.isZoomSupported(z)) {
      return undefined;
    }

    const tileGrid = this.getTileGrid();
    const tileSize = tileGrid.getTileSize(z);
    const tileRange = this.getTileGrid().getFullTileRange(z);

    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./zarr-worker.js', import.meta.url), { type: 'module' });

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

      worker.postMessage({
        z: z,
        x: x,
        y: y,
        tileSize: tileSize,
        tileRange: tileRange,
        nodata: this.metadata_.nodata,
        normalize: this.metadata_.normalize ? this.metadata_.normalize : false,
        statistics: this.getCurrentStatistics(),
        usePercentiles: this.usePercentiles,
        bands: this.metadata_.bands,
        timeIndex: this.currentTimeIndex_,
        storeUrl: this.metadata_.url,
        storePath: `${this.metadata_.path}/${z}/value`
      });
    });
  }

  /**
   * Normalize URL
   * @param {string} url The URL
   * @return {string} Normalized URL
   * @private
   */
  normalizeUrl_(url) {
    return url.replace(/\/*$/, '');
  }

  /**
   * Get URL for zoom level
   * @param {number} z Zoom level
   * @return {string} URL
   */
  getZoomUrl(z) {
    return `${this.url_}/${z}`;
  }

  /**
   * Get URL for value array
   * @param {number} z Zoom level
   * @return {string} URL
   */
  getValueArrayUrl(z) {
    return `${this.getZoomUrl(z)}/value`;
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
   * Get tile URL parameters
   * @param {number} z Zoom level
   * @param {number} x Tile X coordinate
   * @param {number} y Tile Y coordinate
   * @return {Object} URL parameters
   */
  getTileUrlParams(z, x, y) {
    return {
      valueArrayUrl: this.getValueArrayUrl(z),
      supported: this.isZoomSupported(z),
      zoomLevel: z,
      tileCoord: [z, x, y],
      bandIndex: this.bandIndex_,
      timeIndex: this.currentTimeIndex_
    };
  }

  /**
   * Get URL
   * @return {string} URL
   */
  getUrl() {
    return this.url_;
  }

  /**
   * Get band index
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
    if (index !== this.bandIndex_) {
      this.bandIndex_ = index;
      this.refresh();
    }
  }

  /**
   * Get time index
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
    if (index !== this.currentTimeIndex_) {
      this.currentTimeIndex_ = index;

    }
  }

  /**
   * Get metadata
   * @return {Object} Metadata
   */
  getMetadata() {
    return this.metadata_;
  }
}

export default ZarrTile;