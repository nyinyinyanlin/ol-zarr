// src/zarr-worker.js
import { slice, openArray } from 'zarr';

/**
 * Calculate array indices for a specific tile coordinate
 * @param {Array} tileCoord Tile coordinate [z, x, y]
 * @param {Array} arrayShape Shape of the Zarr array [time, band, height, width]
 * @param {number} tileSize Size of the tile
 * @param {Object} tileRange Tile range object with maxX and maxY
 * @return {Object} Object with indices and dataSize information
 */
function calculateArrayIndices(tileCoord, arrayShape, tileSize, tileRange) {
  const [z, x, y] = tileCoord;
  const [timeSize, bandSize, arrayHeight, arrayWidth] = arrayShape;

  // Calculate base array indices
  const xStart = x * tileSize;
  const xEnd = ((x + 1) * tileSize) - 1;
  const yStart = y * tileSize;
  const yEnd = ((y + 1) * tileSize) - 1;

  // Calculate padding for edge tiles
  let paddingBottom = 0;
  let paddingRight = 0;

  if (y === tileRange.maxY && (arrayHeight % tileSize) !== 0) {
    paddingBottom = tileSize - (arrayHeight % tileSize);
  }

  if (x === tileRange.maxX && (arrayWidth % tileSize) !== 0) {
    paddingRight = tileSize - (arrayWidth % tileSize);
  }

  // Adjust end indices for edge tiles
  const finalXEnd = x === tileRange.maxX ? xEnd - paddingRight : xEnd;
  const finalYEnd = y === tileRange.maxY ? yEnd - paddingBottom : yEnd;

  // Ensure indices are within array bounds
  const clampedXStart = Math.max(0, Math.min(xStart, arrayWidth - 1));
  const clampedXEnd = Math.max(0, Math.min(finalXEnd, arrayWidth - 1));
  const clampedYStart = Math.max(0, Math.min(yStart, arrayHeight - 1));
  const clampedYEnd = Math.max(0, Math.min(finalYEnd, arrayHeight - 1));

  return {
    indices: {
      x: [clampedXStart, clampedXEnd + 1], // +1 because slice end is exclusive
      y: [clampedYStart, clampedYEnd + 1]
    },
    dataSize: {
      width: clampedXEnd - clampedXStart + 1,
      height: clampedYEnd - clampedYStart + 1
    },
    padding: {
      right: paddingRight,
      bottom: paddingBottom
    }
  };
}

/**
 * Get data type limits for normalization
 * @param {string} dtype Zarr data type string
 * @return {Object} Object with min and max values
 */
function getDtypeLimits(dtype) {
  switch (dtype) {
    case '|u1': // uint8
      return { min: 0, max: 255 };
      
    case '<u2': // uint16, little endian
      return { min: 0, max: 65535 };
      
    case '<f4': // float32, little endian
      return { min: -3.4028234663852886e+38, max: 3.4028234663852886e+38 };
      
    case '<f8': // float64, little endian
      return { min: -1.7976931348623157e+308, max: 1.7976931348623157e+308 };
      
    default:
      console.warn(`Unsupported dtype: ${dtype}, using float32 limits`);
      return { min: -3.4028234663852886e+38, max: 3.4028234663852886e+38 };
  }
}

/**
 * Check if a value is considered NODATA
 * @param {*} value Value to check
 * @param {*} nodata NODATA specification
 * @return {boolean} True if value is NODATA
 */
function isNoData(value, nodata) {
  if (nodata === null || nodata === undefined) {
    return false;
  }
  
  if (nodata === 'nan' || (typeof nodata === 'string' && nodata.toLowerCase() === 'nan')) {
    return value !== value; // NaN check
  }
  
  if (Array.isArray(nodata)) {
    return nodata.includes(value);
  }
  
  return value === nodata;
}

/**
 * Get normalization range from statistics
 * @param {Object} statistics Statistics object
 * @param {boolean} usePercentiles Whether to use percentiles instead of min/max
 * @param {Object} dtypeLimits Data type limits as fallback
 * @return {Object} Object with min and max values
 */
function getNormalizationRange(statistics, usePercentiles, dtypeLimits) {
  if (!statistics) {
    return { min: dtypeLimits.min, max: dtypeLimits.max };
  }
  
  if (usePercentiles) {
    return {
      min: statistics.p2 !== undefined ? statistics.p2 : (statistics.min || dtypeLimits.min),
      max: statistics.p98 !== undefined ? statistics.p98 : (statistics.max || dtypeLimits.max)
    };
  } else {
    return {
      min: statistics.min !== undefined ? statistics.min : dtypeLimits.min,
      max: statistics.max !== undefined ? statistics.max : dtypeLimits.max
    };
  }
}

/**
 * Process tile data for a single band
 * @param {Object} params Processing parameters
 * @return {Promise<void>}
 */
async function processBand(params) {
  const {
    valueArray, bandIndex, timeIndex, indices, tileSize, tileData, 
    alphaMask, bandOffset, nodata, normalize, normRange
  } = params;

  const selection = [
    timeIndex,
    bandIndex,
    slice(indices.indices.y[0], indices.indices.y[1]),
    slice(indices.indices.x[0], indices.indices.x[1])
  ];

  const data = await valueArray.get(selection);
  
  // Process each pixel in the data
  for (let y = 0; y < indices.dataSize.height; y++) {
    for (let x = 0; x < indices.dataSize.width; x++) {
      const dataValue = data.data[y][x];
      
      // Calculate tile index (use full tileSize for proper alignment)
      const tileIndex = (y * tileSize + x) + bandOffset;
      const alphaIndex = y * indices.dataSize.width + x;
      
      if (isNoData(dataValue, nodata)) {
        // Handle NODATA values
        tileData[tileIndex] = 0;
        if (alphaMask) {
          alphaMask[alphaIndex] = 0; // Transparent
        }
      } else {
        // Process valid data
        if (normalize && normRange) {
          // Normalize to 0-1 range
          const normalizedValue = (dataValue - normRange.min) / (normRange.max - normRange.min);
          tileData[tileIndex] = Math.max(0, Math.min(1, normalizedValue));
        } else {
          tileData[tileIndex] = dataValue;
        }
        
        if (alphaMask) {
          const alphaValue = tileData.constructor === Float32Array ? 1.0 : 255;
          alphaMask[alphaIndex] = alphaValue; // Opaque
        }
      }
    }
  }
}

/**
 * Main worker message handler
 */
self.onmessage = async function(e) {
  const {
    z, x, y, tileSize,
    bands = [0],
    timeIndex = 0,
    tileRange,
    nodata,
    normalize = false,
    statistics,
    usePercentiles = true,
    storeUrl,
    storePath
  } = e.data;

  try {
    // Open the Zarr array
    const valueArray = await openArray({
      store: storeUrl,
      path: storePath,
      mode: 'r'
    });

    // Calculate array indices for this tile
    const indices = calculateArrayIndices([z, x, y], valueArray.meta.shape, tileSize, tileRange);
    
    // Determine output format
    const bandCount = bands.length;
    const hasAlpha = nodata !== undefined && nodata !== null;
    const channelsPerPixel = hasAlpha ? bandCount + 1 : bandCount;
    const totalPixels = tileSize * tileSize;
    
    // Choose appropriate array type
    const useFloat = (valueArray.meta.dtype !== '|u1') || normalize;
    const ArrayConstructor = useFloat ? Float32Array : Uint8ClampedArray;
    
    // Create output arrays
    const tileData = new ArrayConstructor(totalPixels * channelsPerPixel);
    const alphaMask = hasAlpha ? new ArrayConstructor(indices.dataSize.width * indices.dataSize.height) : null;
    
    // Initialize alpha mask
    if (alphaMask) {
      const alphaValue = useFloat ? 1.0 : 255;
      alphaMask.fill(alphaValue);
    }

    // Get normalization range
    const dtypeLimits = getDtypeLimits(valueArray.meta.dtype);
    const normRange = normalize ? getNormalizationRange(statistics, usePercentiles, dtypeLimits) : null;

    // Process each band
    const processingPromises = bands.map(async (bandIndex, arrayIndex) => {
      if (bandIndex !== undefined && bandIndex >= 0) {
        await processBand({
          valueArray,
          bandIndex,
          timeIndex,
          indices,
          tileSize,
          tileData,
          alphaMask,
          bandOffset: arrayIndex * totalPixels,
          nodata,
          normalize,
          normRange
        });
      }
    });

    // Wait for all bands to be processed
    await Promise.all(processingPromises);

    // Apply alpha channel if needed
    if (hasAlpha && alphaMask) {
      const alphaOffset = bandCount * totalPixels;
      for (let y = 0; y < indices.dataSize.height; y++) {
        for (let x = 0; x < indices.dataSize.width; x++) {
          const alphaMaskIndex = y * indices.dataSize.width + x;
          const tileAlphaIndex = (y * tileSize + x) + alphaOffset;
          tileData[tileAlphaIndex] = alphaMask[alphaMaskIndex];
        }
      }
    }

    // Send result back to main thread
    self.postMessage({ 
      tileData: tileData,
      success: true 
    }, [tileData.buffer]);

  } catch (error) {
    // Send error back to main thread
    self.postMessage({ 
      error: error.message,
      success: false 
    });
  }
};

// Handle worker errors
self.onerror = function(error) {
  self.postMessage({ 
    error: `Worker error: ${error.message}`,
    success: false 
  });
};