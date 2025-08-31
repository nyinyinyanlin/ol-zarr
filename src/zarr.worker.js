// Enhanced zarr-worker.js with render configuration support
import { slice, openArray } from 'https://cdn.skypack.dev/pin/zarr@v0.6.3-q9kLEdFRTtoNmWpVmNrd/mode=imports/optimized/zarr.js';

/**
 * Calculate array indices for tile coordinates
 */
function calculateArrayIndices(tileCoord, arrayShape, tileSize, tileRange) {
    const [z, x, y] = tileCoord;
    const [timeSize, bandSize, arrayHeight, arrayWidth] = arrayShape;

    // Calculate array indices
    const xStart = x * tileSize;
    const xEnd = ((x + 1) * tileSize) - 1;
    const yStart = y * tileSize;
    const yEnd = ((y + 1) * tileSize) - 1;

    // Calculate padding for edge tiles
    let paddingBottom = 0;
    let paddingRight = 0;

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
            x: [xStart, finalXEnd + 1],  // +1 because indices are exclusive
            y: [yStart, finalYEnd + 1]
        },
        dataSize: {
            width: finalXEnd - xStart + 1,
            height: finalYEnd - yStart + 1
        }
    };
}

/**
 * Get data type limits for fallback values
 */
function getDtypeLimits(dtype) {
    const dtypeLimits = {
        '|u1': { min: 0, max: 255 },
        '<u1': { min: 0, max: 255 },
        '>u1': { min: 0, max: 255 },
        '|u2': { min: 0, max: 65535 },
        '<u2': { min: 0, max: 65535 },
        '>u2': { min: 0, max: 65535 },
        '|i2': { min: -32768, max: 32767 },
        '<i2': { min: -32768, max: 32767 },
        '>i2': { min: -32768, max: 32767 },
        '|f4': { min: -3.4028235e+38, max: 3.4028235e+38 },
        '<f4': { min: -3.4028235e+38, max: 3.4028235e+38 },
        '>f4': { min: -3.4028235e+38, max: 3.4028235e+38 },
        '|f8': { min: -1.7976931348623157e+308, max: 1.7976931348623157e+308 },
        '<f8': { min: -1.7976931348623157e+308, max: 1.7976931348623157e+308 },
        '>f8': { min: -1.7976931348623157e+308, max: 1.7976931348623157e+308 }
    };

    return dtypeLimits[dtype] || dtypeLimits['<f4'];
}

/**
 * Check if value is NODATA
 */
function isNodata(value, nodataValue) {
    if (nodataValue === null || nodataValue === undefined) {
        return false;
    }

    // Handle NaN values
    if (value !== value) {  // NaN check
        return nodataValue !== nodataValue || nodataValue === null;
    }

    return value === nodataValue;
}

/**
 * Apply NODATA strategy to value
 */
function applyNodataStrategy(value, nodataValue, strategy, replaceValue, normalizationRange) {
    if (!isNodata(value, nodataValue)) {
        return { value, isNodata: false };
    }

    switch (strategy) {
        case 'raw':
            return { value, isNodata: true };

        case 'normalize':
            if (normalizationRange) {
                const { min, max } = normalizationRange;
                const normalized = (value - min) / (max - min);
                return { value: normalized, isNodata: true };
            }
            return { value: 0, isNodata: true };

        case 'normalize_clamp':
            if (normalizationRange) {
                const { min, max } = normalizationRange;
                const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
                return { value: normalized, isNodata: true };
            }
            return { value: 0, isNodata: true };

        case 'replace':
            return { value: replaceValue, isNodata: true };

        default:
            return { value, isNodata: true };
    }
}

/**
 * Apply display render strategy (normalize or std_stretch)
 */
function applyDisplayStrategy(value, strategy, params) {
    if (strategy === 'normalize' && params.useNormalization) {
        // Will be handled by normalization logic
        return value;
    }

    if (strategy === 'std_stretch') {
        const { mean, std, slope } = params;
        // Standard deviation stretch: (value - mean) / (slope * std) 
        // Then map from [-inf, +inf] to [0, 1] using: result * 0.5 + 0.5
        const stretched = (value - mean) / (slope * std);
        const normalized = stretched * 0.5 + 0.5;
        return Math.max(0, Math.min(1, normalized)); // Clamp to [0, 1]
    }

    return value;
}

/**
 * Determine output array type and channel count
 */
function determineOutputFormat(renderType, normalization, maskNodata, bandCount) {
    const hasAlpha = maskNodata;
    const channelCount = hasAlpha ? bandCount + 1 : bandCount;

    if (renderType === 'display') {
        // Display always uses Float32Array
        return { ArrayType: Uint8ClampedArray, channelCount, hasAlpha };
    }

    // Raw render type
    if (normalization) {
        // If normalization is applied, use Float32Array
        return { ArrayType: Float32Array, channelCount, hasAlpha };
    }

    // No normalization in raw mode - could use original dtype
    // For now, default to Float32Array for consistency
    return { ArrayType: Float32Array, channelCount, hasAlpha };
}

/**
 * Main worker message handler
 */
self.onmessage = async function (e) {
    const startTime = performance.now();

    const {
        z, x, y, tileSize, tileRange,
        bands = [0],
        timeIndex = 0,
        nodata = null,
        normalization = null,
        renderType = 'raw',
        nodataStrategy = 'raw',
        nodataReplaceValue = 0,
        maskNodata = true,
        displayRenderParams = null,
        storeUrl,
        storePath,
        verbose = false
    } = e.data;

    const log = verbose ? console.log.bind(console, '[ZarrWorker]') : () => { };

    log("Nodata replace value:", nodataReplaceValue);

    log('Worker processing tile:', { z, x, y, renderType, bands, timeIndex });

    try {
        // Open Zarr array
        log('Opening Zarr array:', storePath);
        const valueArray = await openArray({
            store: storeUrl,
            path: storePath,
            mode: 'r'
        });

        log('Array metadata:', {
            shape: valueArray.meta.shape,
            dtype: valueArray.meta.dtype,
            fill_value: valueArray.meta.fill_value
        });

        // Calculate array indices for this tile
        const indices = calculateArrayIndices([z, x, y], valueArray.meta.shape, tileSize, tileRange);
        log('Calculated indices:', indices);

        // Determine output format
        const { ArrayType, channelCount, hasAlpha } = determineOutputFormat(
            renderType, normalization, (nodata !== null && maskNodata), bands.length
        );

        log('Output format:', {
            ArrayType: ArrayType.name,
            channelCount,
            hasAlpha,
            totalPixels: tileSize * tileSize
        });

        // Single allocation for final tile data
        const totalPixels = tileSize * tileSize;
        const tileData = new ArrayType(totalPixels * channelCount);
        const alphaMask = hasAlpha ? new ArrayType(indices.dataSize.width * indices.dataSize.height) : null;

        // Initialize with appropriate background values
        const bgValue = renderType === 'display' ? 0.0 : 0.0;
        const alphaValue = renderType === 'display' ? 255.0 : 1.0; // Opaque background
        tileData.fill(bgValue);

        if (alphaMask) {
            alphaMask.fill(alphaValue);
        }

        log('Starting parallel band processing...');

        // Process all bands in parallel
        const bandPromises = bands.map(async (bandIndex, bandArrayIndex) => {
            // Get data selection for this band
            const selection = [
                timeIndex,
                bandIndex,
                slice(indices.indices.y[0], indices.indices.y[1]),
                slice(indices.indices.x[0], indices.indices.x[1])
            ];

            log(`Processing band ${bandIndex} with selection:`, selection);

            // Fetch band data
            const data = await valueArray.get(selection);
            const bandNodata = Array.isArray(nodata) ? nodata[bandArrayIndex] : nodata;

            // Get normalization range for this band
            const normRange = normalization && normalization[bandArrayIndex] ?
                normalization[bandArrayIndex] : null;

            // Get display strategy params for this band
            const displayParams = displayRenderParams?.stretchParams ?
                displayRenderParams.stretchParams[bandArrayIndex] :
                displayRenderParams;

            // Process each pixel directly into final tileData
            for (let y = 0; y < indices.dataSize.height; y++) {
                for (let x = 0; x < indices.dataSize.width; x++) {
                    let pixelValue = data.data[y][x];

                    // Apply NODATA strategy
                    const nodataResult = applyNodataStrategy(
                        pixelValue, bandNodata, nodataStrategy, nodataReplaceValue, normRange
                    );

                    pixelValue = nodataResult.value;
                    const isNodataPixel = nodataResult.isNodata;

                    // Apply processing based on render type
                    if (renderType === 'display') {
                        // Display render type processing
                        if (displayRenderParams && isNodataPixel === false) {
                            // Apply display strategy (normalize or std_stretch)
                            if (displayRenderParams.strategy === 'std_stretch') {
                                pixelValue = applyDisplayStrategy(pixelValue, 'std_stretch', displayParams);
                            } else if (displayRenderParams.strategy === 'normalize' && normRange) {
                                // Apply normalization for display
                                const { min, max } = normRange;
                                pixelValue = (pixelValue - min) / (max - min);
                                pixelValue = Math.max(0, Math.min(1, pixelValue)); // Clamp to [0, 1]
                            }
                            // Scale to [0, 255] for display
                            pixelValue = pixelValue // Math.round(pixelValue * 255);
                        } 
                    } else {
                        // Raw render type processing
                        if (normRange && isNodataPixel === false) {
                            // Apply normalization if configured
                            const { min, max } = normRange;
                            pixelValue = (pixelValue - min) / (max - min);
                        }
                    }

                    // Write directly to final tileData
                    const tileIndex = (y * tileSize + x) * channelCount + bandArrayIndex;
                    if (tileIndex < tileData.length) {
                        tileData[tileIndex] = pixelValue;
                    }

                    // Update alpha mask if this is the first band or single band
                    if (alphaMask && bandArrayIndex === 0) {
                        const alphaIndex = y * indices.dataSize.width + x;
                        if (isNodataPixel && maskNodata) {
                            alphaMask[alphaIndex] = renderType === 'display' ? 0 : 0.0; // Transparent
                        } else {
                            alphaMask[alphaIndex] = renderType === 'display' ? 255.0 : 1.0; // Opaque
                        }
                    }
                }
            }

            log(`Band ${bandIndex} processed: ${indices.dataSize.width * indices.dataSize.height} pixels`);
            return bandArrayIndex;
        });

        // Wait for all bands to complete
        await Promise.all(bandPromises);

        log('All bands processed, applying alpha channel...');

        // Apply alpha channel if present
        if (hasAlpha && alphaMask) {
            const alphaChannelIndex = channelCount - 1;

            for (let y = 0; y < indices.dataSize.height; y++) {
                for (let x = 0; x < indices.dataSize.width; x++) {
                    const srcIndex = y * indices.dataSize.width + x;
                    const tileAlphaIndex = (y * tileSize + x) * channelCount + alphaChannelIndex;

                    if (tileAlphaIndex < tileData.length) {
                        tileData[tileAlphaIndex] = alphaMask[srcIndex];
                    }
                }
            }
        }

        const endTime = performance.now();
        log(`Tile processing completed in ${(endTime - startTime).toFixed(2)}ms`);

        // Send result back to main thread
        self.postMessage({
            tileData,
            success: true,
            metadata: {
                renderType,
                channels: channelCount,
                hasAlpha,
                processingTime: endTime - startTime,
                dataSize: indices.dataSize
            }
        }, [tileData.buffer]);

    } catch (error) {
        log('Worker error:', error);

        // Send error back to main thread
        self.postMessage({
            error: error.message,
            success: false,
            stack: error.stack
        });
    }
};

/**
 * Handle worker errors
 */
self.onerror = function (error) {
    console.error('[ZarrWorker] Unhandled error:', error);
    self.postMessage({
        error: `Worker unhandled error: ${error.message}`,
        success: false
    });
};