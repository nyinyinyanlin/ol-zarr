// zarr-worker.js
import { slice, openArray } from "zarr";

function calculateArrayIndices_(tileCoord, arrayShape, tileSize, tileRange) {
  const [z, x, y] = tileCoord;
  const [timeSize, bandSize, arrayHeight, arrayWidth] = arrayShape;

  // Calculate array indices
  const xStart = x * tileSize;
  const xEnd = ((x + 1) * tileSize) - 1;
  const yStart = y * tileSize;
  const yEnd = ((y + 1) * tileSize) - 1;

  // Calculate padding
  let paddingBottom = 0;
  let paddingRight = 0;

  // Adjust end indices and calculate padding for edge tiles
  if (y === tileRange.maxY) {
    paddingBottom = tileSize - (arrayHeight % tileSize);
  }

  if (x === tileRange.maxX) {
    paddingRight = tileSize - (arrayWidth % tileSize);
  }

  const finalXEnd = x === tileRange.maxX ? xEnd - paddingRight : xEnd;
  const finalYEnd = y === tileRange.maxY ? yEnd - paddingBottom : yEnd;

  return {
    indices: {
      x: [xStart, finalXEnd + 1],  // +1 because xEnd/yEnd are inclusive
      y: [yStart, finalYEnd + 1]
    },
    dataSize: {
      width: finalXEnd - xStart + 1,
      height: finalYEnd - yStart + 1
    }
  }
}

self.onmessage = async function (e) {
  const { z, x, y, tileSize, bands = [0], timeIndex, tileRange, nodata = undefined, normalize = false, statistics = undefined, usePercentiles = true, storeUrl, storePath } = e.data;
  try {
    const valueArray = await openArray({
      store: storeUrl,
      path: storePath,
      mode: "r"
    });

    const indices = calculateArrayIndices_([z, x, y], valueArray.meta.shape, tileSize, tileRange);

    const bandCount = (bands.length === 1 && nodata === undefined) ? 1 : 3;
    const tileData = (valueArray.meta.dtype !== '|u8' || normalize) ? new Float32Array(tileSize * tileSize * (bandCount + (nodata ? 1 : 0))) : new Uint8ClampedArray(tileSize * tileSize * (bandCount + (nodata ? 1 : 0)))
    const alphaMask = new tileData.constructor(indices.dataSize.width * indices.dataSize.height);
    const alphaValue = alphaMask.constructor === Float32Array ? 1 : 255;
    alphaMask.fill(alphaValue);

    const dtypeLimits = getDtypeLimits(valueArray.meta.dtype);

    const min = usePercentiles ? statistics?.p2 : statistics?.min // something weird is going on here, so removed using dtypeLimits, investigate later.
    const max = usePercentiles ? (statistics?.p98 || dtypeLimits.max) : (statistics?.max || dtypeLimits.max)


    const promises = bands.map(async (bandIndex, index) => {
      if (bandIndex !== undefined) {
        const selection = [
          timeIndex,
          bandIndex,
          slice(indices.indices.y[0], indices.indices.y[1]),
          slice(indices.indices.x[0], indices.indices.x[1]),
        ];

        const data = await valueArray.get(selection);
        
        for (let y = 0; y < indices.dataSize.height; y++) {
          for (let x = 0; x < indices.dataSize.width; x++) {
            // When calculating the tileIndex, we still use tileSize for the full width
            // because the output array expects a full tile's worth of data
            const tileIndex = (y * tileSize + x) * (bandCount + (nodata ? 1 : 0)) + index;
            const value = data.data[y][x];

            // if (nodata[index] is "NaN" and value!==value) or value === nodata[index]
            
            // Only write to the array if we're within the actual data bounds
            if (x < indices.dataSize.width && y < indices.dataSize.height) {
              const alphaIndex = y * indices.dataSize.width + x;
              if (nodata && ((value !== value) || (value === nodata[index]))) {
                // For NaN values, set a default value in the tile data
                tileData[tileIndex] = normalize ? 0 : 0;
                
                // Set alpha to 0 for NaN or nodata values
                alphaMask[alphaIndex] = 0;
              } else {
                // For valid values, apply normalization if needed
                tileData[tileIndex] = normalize ? ((value - min) / (max - min)) : value;
              }
            }
            // The remaining pixels in the tile (outside our data dimensions) 
            // will keep their initialized values
          }
        }
      }
    });

    await Promise.all(promises);

    if (nodata) {
      for (let y = 0; y < indices.dataSize.height; y++) {
        for (let x = 0; x < indices.dataSize.width; x++) {
            const alphaMaskIndex = y * indices.dataSize.width + x;
            const tileAlphaIndex = (y * tileSize + x) * 4 + 3;
            tileData[tileAlphaIndex] = alphaMask[alphaMaskIndex];
        }
      }  
    }

    self.postMessage({ tileData }, [tileData.buffer]);

  //self.postMessage({ rgba }, [rgba.buffer]);
} catch (error) {
  self.postMessage({ error: error.message });
}
};

function getDtypeLimits(dtype) {
  switch(dtype) {
      case '|u1':  // uint8
          return {
              min: 0,
              max: 255  // 2^8 - 1
          };
      
      case '<u2':  // uint16, little endian
          return {
              min: 0,
              max: 65535  // 2^16 - 1
          };
          
      case '<f4':  // float32, little endian
          return {
              min: -3.4028234663852886e+38,
              max: 3.4028234663852886e+38
          };
          
      default:
          throw new Error(`Unsupported dtype: ${dtype}`);
  }
}