import DataTile from 'ol/source/DataTile.js';
import TileGrid from 'ol/tilegrid/TileGrid.js';
import { openArray } from 'https://cdn.skypack.dev/pin/zarr@v0.6.3-q9kLEdFRTtoNmWpVmNrd/mode=imports/optimized/zarr.js';

/**
 * Private constructor token to enforce async creation pattern
 */
const CONSTRUCTOR_TOKEN = Symbol('ZarrTile.constructor.token');

/**
 * Default values for all properties
 */
const DEFAULTS = {
  crs: 'EPSG:4326',
  value_array_name: 'value',
  time_array_name: 'time', 
  statistics_array_name: 'statistics',
  bands: [0],
  normalize: null,
  verbose: false,
  statistics_key_indices: {
    min: 0,
    max: 1, 
    mean: 2,
    p2: 3,
    p98: 4,
    mode: 5,
    std: 6
  },
  render_type: 'display',
  nodata_strategy: 'raw',
  nodata_replace_value: 0,
  mask_nodata: true,
  drc: {
    strategy: 'normalize',
    mean_key: 'mean',
    std_key: 'std',
    slope: 2.0
  }
};

/**
 * Required statistics keys that must be present
 */
const REQUIRED_STATS_KEYS = ['min', 'max'];

/**
 * Normalization strategy types
 */
const NORMALIZATION_STRATEGIES = {
  GLOBAL: 'global',                           // Global min/max across all bands and times
  GLOBAL_BAND_PER_TIME: 'global_band_per_time', // Global across bands for current time
  PER_BAND_GLOBAL_TIME: 'per_band_global_time', // Per band across all times  
  PER_BAND_PER_TIME: 'per_band_per_time'      // Per band per time (current behavior)
};

/**
 * NODATA strategy types
 */
const NODATA_STRATEGIES = {
  RAW: 'raw',                    // Pass through NODATA values
  NORMALIZE: 'normalize',        // Normalize NODATA values
  NORMALIZE_CLAMP: 'normalize_clamp', // Normalize and clamp NODATA values
  REPLACE: 'replace'             // Replace NODATA values with specified value
};

/**
 * Render type options
 */
const RENDER_TYPES = {
  RAW: 'raw',        // Raw data for scientific analysis
  DISPLAY: 'display' // Display-ready imagery
};

/**
 * Display render configuration strategy types
 */
const DRC_STRATEGIES = {
  NORMALIZE: 'normalize',    // Use min/max normalization from normalize config
  STD_STRETCH: 'std_stretch' // Use standard deviation stretch with mean and slope
};

/**
 * Complete data type limits for normalization fallbacks
 */
const DTYPE_LIMITS = {
  // Unsigned integers
  '|u1': { min: 0, max: 255 },
  '<u1': { min: 0, max: 255 },
  '>u1': { min: 0, max: 255 },
  '|u2': { min: 0, max: 65535 },
  '<u2': { min: 0, max: 65535 },
  '>u2': { min: 0, max: 65535 },
  '|u4': { min: 0, max: 4294967295 },
  '<u4': { min: 0, max: 4294967295 },
  '>u4': { min: 0, max: 4294967295 },
  '|u8': { min: 0, max: 18446744073709551615n },
  '<u8': { min: 0, max: 18446744073709551615n },
  '>u8': { min: 0, max: 18446744073709551615n },
  
  // Signed integers
  '|i1': { min: -128, max: 127 },
  '<i1': { min: -128, max: 127 },
  '>i1': { min: -128, max: 127 },
  '|i2': { min: -32768, max: 32767 },
  '<i2': { min: -32768, max: 32767 },
  '>i2': { min: -32768, max: 32767 },
  '|i4': { min: -2147483648, max: 2147483647 },
  '<i4': { min: -2147483648, max: 2147483647 },
  '>i4': { min: -2147483648, max: 2147483647 },
  '|i8': { min: -9223372036854775808n, max: 9223372036854775807n },
  '<i8': { min: -9223372036854775808n, max: 9223372036854775807n },
  '>i8': { min: -9223372036854775808n, max: 9223372036854775807n },
  
  // Floating point
  '|f2': { min: -65504, max: 65504 }, // half precision
  '<f2': { min: -65504, max: 65504 },
  '>f2': { min: -65504, max: 65504 },
  '|f4': { min: -3.4028235e+38, max: 3.4028235e+38 }, // single precision
  '<f4': { min: -3.4028235e+38, max: 3.4028235e+38 },
  '>f4': { min: -3.4028235e+38, max: 3.4028235e+38 },
  '|f8': { min: -1.7976931348623157e+308, max: 1.7976931348623157e+308 }, // double precision
  '<f8': { min: -1.7976931348623157e+308, max: 1.7976931348623157e+308 },
  '>f8': { min: -1.7976931348623157e+308, max: 1.7976931348623157e+308 },
  
  // Complex types
  '|c8': { min: -3.4028235e+38, max: 3.4028235e+38 }, // complex64
  '<c8': { min: -3.4028235e+38, max: 3.4028235e+38 },
  '>c8': { min: -3.4028235e+38, max: 3.4028235e+38 },
  '|c16': { min: -1.7976931348623157e+308, max: 1.7976931348623157e+308 }, // complex128
  '<c16': { min: -1.7976931348623157e+308, max: 1.7976931348623157e+308 },
  '>c16': { min: -1.7976931348623157e+308, max: 1.7976931348623157e+308 }
};

/**
 * Statistics format types for case identification
 */
const STATISTICS_FORMATS = {
  CASE1: 'case1', // {min: value, max: value} - global all bands/times
  CASE2: 'case2', // [{min: value}...] - per band composition, global time  
  CASE3: 'case3', // [{min: value}...] - per dataset band, global time
  CASE4: 'case4', // [{min: [value]}...] - per band composition, per time
  CASE5: 'case5'  // [{min: [value]}...] - per dataset band, per time
};

/**
 * NODATA format types
 */
const NODATA_FORMATS = {
  GLOBAL: 'global',                    // Single value for all bands
  PER_BAND_COMPOSITION: 'per_band_composition',  // Array matching band composition
  PER_DATASET_BAND: 'per_dataset_band' // Array for all dataset bands
};

/**
 * Complete ZarrTile validation and extraction utilities
 */
class ZarrTileValidator {
  
  /**
   * Validate required properties with detailed error reporting
   */
  static validateRequired(options) {
    const errors = [];
    
    if (!options) {
      throw new Error('Options object is required');
    }
    
    if (!options.url || typeof options.url !== 'string' || options.url.trim() === '') {
      errors.push('url: must be a non-empty string');
    }
    
    if (!options.path || typeof options.path !== 'string' || options.path.trim() === '') {
      errors.push('path: must be a non-empty string');
    }
    
    if (errors.length > 0) {
      throw new Error(`Required property validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    }
  }

  /**
   * Validate render type
   */
  static validateRenderType(renderType, source = 'user input') {
    if (!renderType) return DEFAULTS.render_type;
    
    if (typeof renderType !== 'string') {
      throw new Error(`render_type: must be string from ${source}`);
    }
    
    const validTypes = Object.values(RENDER_TYPES);
    if (!validTypes.includes(renderType)) {
      throw new Error(`render_type: must be one of [${validTypes.join(', ')}] from ${source}, got '${renderType}'`);
    }
    
    return renderType;
  }

  /**
   * Validate NODATA strategy configuration
   */
  static validateNodataStrategy(nodataStrategy, source = 'user input') {
    if (!nodataStrategy) return DEFAULTS.nodata_strategy;
    
    if (typeof nodataStrategy !== 'string') {
      throw new Error(`nodata_strategy: must be string from ${source}`);
    }
    
    const validStrategies = Object.values(NODATA_STRATEGIES);
    if (!validStrategies.includes(nodataStrategy)) {
      throw new Error(`nodata_strategy: must be one of [${validStrategies.join(', ')}] from ${source}, got '${nodataStrategy}'`);
    }
    
    return nodataStrategy;
  }

  /**
   * Validate NODATA replace value
   */
  static validateNodataReplaceValue(replaceValue, source = 'user input') {
    if (replaceValue === null || replaceValue === undefined) {
      return DEFAULTS.nodata_replace_value;
    }
    
    if (typeof replaceValue !== 'number' || !Number.isFinite(replaceValue)) {
      throw new Error(`nodata_replace_value: must be finite number from ${source}, got ${replaceValue}`);
    }
    
    return replaceValue;
  }

  /**
   * Validate mask NODATA flag
   */
  static validateMaskNodata(maskNodata, source = 'user input') {
    if (maskNodata === null || maskNodata === undefined) {
      return DEFAULTS.mask_nodata;
    }
    
    if (typeof maskNodata !== 'boolean') {
      throw new Error(`mask_nodata: must be boolean from ${source}, got ${typeof maskNodata}`);
    }
    
    return maskNodata;
  }

  /**
   * Validate display render configuration (DRC)
   */
  static validateDisplayRenderConfig(drc, availableStatsKeys = null, source = 'user input') {
    if (drc === null || drc === undefined) {
      return { ...DEFAULTS.drc };
    }
    
    if (typeof drc !== 'object' || Array.isArray(drc)) {
      throw new Error(`drc: must be object from ${source}`);
    }
    
    const validated = { ...DEFAULTS.drc };
    
    // Validate strategy
    if (drc.strategy !== undefined) {
      if (typeof drc.strategy !== 'string') {
        throw new Error(`drc.strategy: must be string from ${source}`);
      }
      
      const validStrategies = Object.values(DRC_STRATEGIES);
      if (!validStrategies.includes(drc.strategy)) {
        throw new Error(`drc.strategy: must be one of [${validStrategies.join(', ')}] from ${source}, got '${drc.strategy}'`);
      }
      validated.strategy = drc.strategy;
    }
    
    // Validate mean_key
    if (drc.mean_key !== undefined) {
      if (typeof drc.mean_key !== 'string' || drc.mean_key.trim() === '') {
        throw new Error(`drc.mean_key: must be non-empty string from ${source}`);
      }
      validated.mean_key = drc.mean_key;
    }
    
    // Validate std_key
    if (drc.std_key !== undefined) {
      if (typeof drc.std_key !== 'string' || drc.std_key.trim() === '') {
        throw new Error(`drc.std_key: must be non-empty string from ${source}`);
      }
      validated.std_key = drc.std_key;
    }
    
    // Validate slope
    if (drc.slope !== undefined) {
      if (typeof drc.slope !== 'number' || !Number.isFinite(drc.slope)) {
        throw new Error(`drc.slope: must be finite number from ${source}`);
      }
      if (drc.slope <= 0) {
        throw new Error(`drc.slope: must be positive number from ${source}, got ${drc.slope}`);
      }
      validated.slope = drc.slope;
    }
    
    // Validate keys against available statistics for std_stretch strategy
    if (validated.strategy === DRC_STRATEGIES.STD_STRETCH && availableStatsKeys) {
      if (!availableStatsKeys.includes(validated.mean_key)) {
        throw new Error(`drc.mean_key: '${validated.mean_key}' not available in statistics keys [${availableStatsKeys.join(', ')}] from ${source}. std_stretch requires mean and standard deviation statistics.`);
      }
      if (!availableStatsKeys.includes(validated.std_key)) {
        throw new Error(`drc.std_key: '${validated.std_key}' not available in statistics keys [${availableStatsKeys.join(', ')}] from ${source}. std_stretch requires mean and standard deviation statistics.`);
      }
    }
    
    return validated;
  }

  /**
   * Validate and normalize extent with comprehensive format support
   */
  static validateExtent(extent, source = 'user input') {
    if (!extent) return null;
    
    let normalizedExtent = null;
    
    if (typeof extent === 'object' && extent !== null) {
      if (extent.xmin !== undefined && extent.ymin !== undefined && 
          extent.xmax !== undefined && extent.ymax !== undefined) {
        const { xmin, ymin, xmax, ymax } = extent;
        if (typeof xmin !== 'number' || typeof ymin !== 'number' || 
            typeof xmax !== 'number' || typeof ymax !== 'number') {
          throw new Error(`extent: all extent values must be numbers from ${source}`);
        }
        if (!Number.isFinite(xmin) || !Number.isFinite(ymin) || 
            !Number.isFinite(xmax) || !Number.isFinite(ymax)) {
          throw new Error(`extent: all extent values must be finite numbers from ${source}`);
        }
        if (xmin >= xmax) {
          throw new Error(`extent: xmin (${xmin}) must be less than xmax (${xmax}) from ${source}`);
        }
        if (ymin >= ymax) {
          throw new Error(`extent: ymin (${ymin}) must be less than ymax (${ymax}) from ${source}`);
        }
        normalizedExtent = [xmin, ymin, xmax, ymax];
      }
    }
    
    if (!normalizedExtent && Array.isArray(extent) && extent.length === 4) {
      const [xmin, ymin, xmax, ymax] = extent;
      if (extent.some(val => typeof val !== 'number' || !Number.isFinite(val))) {
        throw new Error(`extent: all extent array values must be finite numbers from ${source}`);
      }
      if (xmin >= xmax) {
        throw new Error(`extent: xmin (${xmin}) must be less than xmax (${xmax}) from ${source}`);
      }
      if (ymin >= ymax) {
        throw new Error(`extent: ymin (${ymin}) must be less than ymax (${ymax}) from ${source}`);
      }
      normalizedExtent = extent;
    }
    
    if (!normalizedExtent) {
      throw new Error(`extent: invalid extent format from ${source}. Expected {xmin, ymin, xmax, ymax} object or [xmin, ymin, xmax, ymax] array`);
    }
    
    return normalizedExtent;
  }

  /**
   * Validate zoom levels and resolutions with comprehensive checks
   */
  static validateZoomAndResolutions(zoomLevels, resolutions, source = 'user input') {
    if (!Array.isArray(zoomLevels)) {
      throw new Error(`zoomLevels: must be an array from ${source}`);
    }
    
    if (!Array.isArray(resolutions)) {
      throw new Error(`resolutions: must be an array from ${source}`);
    }
    
    if (zoomLevels.length === 0) {
      throw new Error(`zoomLevels: cannot be empty from ${source}`);
    }
    
    if (resolutions.length === 0) {
      throw new Error(`resolutions: cannot be empty from ${source}`);
    }
    
    if (zoomLevels.length !== resolutions.length) {
      throw new Error(`zoomLevels (length ${zoomLevels.length}) and resolutions (length ${resolutions.length}) must have same length from ${source}`);
    }
    
    // Validate zoom levels are non-negative integers and unique
    for (let i = 0; i < zoomLevels.length; i++) {
      const zoom = zoomLevels[i];
      if (!Number.isInteger(zoom) || zoom < 0) {
        throw new Error(`zoomLevels[${i}]: must be a non-negative integer, got ${zoom} from ${source}`);
      }
    }
    
    const uniqueZooms = new Set(zoomLevels);
    if (uniqueZooms.size !== zoomLevels.length) {
      const duplicates = zoomLevels.filter((zoom, index) => zoomLevels.indexOf(zoom) !== index);
      throw new Error(`zoomLevels: must be unique, found duplicates: [${duplicates.join(', ')}] from ${source}`);
    }
    
    // Validate resolutions are positive finite numbers and unique
    for (let i = 0; i < resolutions.length; i++) {
      const resolution = resolutions[i];
      if (typeof resolution !== 'number' || !Number.isFinite(resolution) || resolution <= 0) {
        throw new Error(`resolutions[${i}]: must be a positive finite number, got ${resolution} from ${source}`);
      }
    }
    
    // Check for duplicate resolutions using small epsilon for floating point comparison
    const EPSILON = 1e-10;
    for (let i = 0; i < resolutions.length; i++) {
      for (let j = i + 1; j < resolutions.length; j++) {
        if (Math.abs(resolutions[i] - resolutions[j]) < EPSILON) {
          throw new Error(`resolutions: duplicate values found at indices ${i} and ${j}: ${resolutions[i]} ≈ ${resolutions[j]} from ${source}`);
        }
      }
    }
    
    // Validate ordering - zoomLevels ascending, resolutions descending
    const sortedZooms = [...zoomLevels].sort((a, b) => a - b);
    const sortedResolutions = [...resolutions].sort((a, b) => b - a);
    
    for (let i = 0; i < zoomLevels.length; i++) {
      if (zoomLevels[i] !== sortedZooms[i]) {
        throw new Error(`zoomLevels: must be in ascending order from ${source}. Expected [${sortedZooms.join(', ')}], got [${zoomLevels.join(', ')}]`);
      }
    }
    
    for (let i = 0; i < resolutions.length; i++) {
      if (resolutions[i] !== sortedResolutions[i]) {
        throw new Error(`resolutions: must be in descending order from ${source}. Expected [${sortedResolutions.join(', ')}], got [${resolutions.join(', ')}]`);
      }
    }
    
    return { zoomLevels: [...zoomLevels], resolutions: [...resolutions] };
  }

  /**
   * Complete timestamp validation and normalization with all format support
   */
  static validateTimestamps(timestamps, timeArrayLength = null, source = 'user input') {
    if (!timestamps) return null;
    
    let normalizedTimestamps = [];
    let timestampType = 'unknown';
    
    if (typeof timestamps === 'number') {
      // Case: integer count - generate incremental array
      if (!Number.isInteger(timestamps) || timestamps <= 0) {
        throw new Error(`timestamps: if number, must be positive integer, got ${timestamps} from ${source}`);
      }
      if (timestamps > 100000) { // Sanity check
        throw new Error(`timestamps: count ${timestamps} seems too large, maximum 100000 from ${source}`);
      }
      normalizedTimestamps = Array.from({ length: timestamps }, (_, i) => i);
      timestampType = 'integer_count';
      
    } else if (Array.isArray(timestamps)) {
      if (timestamps.length === 0) {
        throw new Error(`timestamps: array cannot be empty from ${source}`);
      }
      
      if (timestamps.length > 100000) { // Sanity check
        throw new Error(`timestamps: array length ${timestamps.length} seems too large, maximum 100000 from ${source}`);
      }
      
      // Determine array type
      const firstType = this._getTimestampType(timestamps[0]);
      
      for (let i = 0; i < timestamps.length; i++) {
        const currentType = this._getTimestampType(timestamps[i]);
        if (currentType !== firstType) {
          throw new Error(`timestamps: array must contain uniform types, found ${firstType} and ${currentType} at indices 0 and ${i} from ${source}`);
        }
      }
      
      if (firstType === 'integer') {
        // Case: array of integers - validate all are non-negative integers
        for (let i = 0; i < timestamps.length; i++) {
          if (!Number.isInteger(timestamps[i]) || timestamps[i] < 0) {
            throw new Error(`timestamps[${i}]: timestamp IDs must be non-negative integers, got ${timestamps[i]} from ${source}`);
          }
        }
        normalizedTimestamps = [...timestamps];
        timestampType = 'integer_ids';
        
      } else if (firstType === 'date') {
        // Case: array of Date objects - validate all are valid dates and unique
        for (let i = 0; i < timestamps.length; i++) {
          if (!(timestamps[i] instanceof Date) || isNaN(timestamps[i].getTime())) {
            throw new Error(`timestamps[${i}]: must be valid Date object from ${source}`);
          }
        }
        
        // Check for duplicate dates
        const uniqueDates = new Set();
        for (let i = 0; i < timestamps.length; i++) {
          const dateTime = timestamps[i].getTime();
          if (uniqueDates.has(dateTime)) {
            throw new Error(`timestamps: duplicate dates found: ${timestamps[i].toISOString()} from ${source}`);
          }
          uniqueDates.add(dateTime);
        }
        
        normalizedTimestamps = [...timestamps];
        timestampType = 'date_objects';
        
      } else if (firstType === 'string') {
        // Case: array of strings - try to parse as ISO dates, fallback to string IDs
        const parsedTimestamps = [];
        let allParsedSuccessfully = true;
        
        for (let i = 0; i < timestamps.length; i++) {
          const str = timestamps[i];
          if (str.trim() === '') {
            throw new Error(`timestamps[${i}]: string cannot be empty from ${source}`);
          }
          
          try {
            const date = new Date(str);
            if (isNaN(date.getTime())) {
              // Not a valid ISO date string, use as string ID
              allParsedSuccessfully = false;
              break;
            }
            parsedTimestamps.push(date);
          } catch (e) {
            // Parse failed, use as string IDs
            allParsedSuccessfully = false;
            break;
          }
        }
        
        if (allParsedSuccessfully) {
          // All strings successfully parsed as dates - check for duplicates
          const uniqueDates = new Set();
          for (let i = 0; i < parsedTimestamps.length; i++) {
            const dateTime = parsedTimestamps[i].getTime();
            if (uniqueDates.has(dateTime)) {
              throw new Error(`timestamps: duplicate parsed dates found: ${parsedTimestamps[i].toISOString()} from ${source}`);
            }
            uniqueDates.add(dateTime);
          }
          normalizedTimestamps = parsedTimestamps;
          timestampType = 'iso_strings';
        } else {
          // Use as string IDs, validate uniqueness
          const uniqueStrings = new Set(timestamps);
          if (uniqueStrings.size !== timestamps.length) {
            const duplicates = timestamps.filter((str, index) => timestamps.indexOf(str) !== index);
            throw new Error(`timestamps: duplicate string IDs found: [${duplicates.join(', ')}] from ${source}`);
          }
          normalizedTimestamps = [...timestamps];
          timestampType = 'string_ids';
        }
        
      } else {
        throw new Error(`timestamps: unsupported array element type '${firstType}' from ${source}`);
      }
      
    } else {
      throw new Error(`timestamps: must be number or array, got ${typeof timestamps} from ${source}`);
    }
    
    // Validate against time array length if available (from first dimension of time array shape)
    if (timeArrayLength !== null && typeof timeArrayLength === 'number') {
      if (normalizedTimestamps.length !== timeArrayLength) {
        throw new Error(`timestamps: length ${normalizedTimestamps.length} doesn't match time array first dimension ${timeArrayLength} from ${source}`);
      }
    }
    
    return { timestamps: normalizedTimestamps, type: timestampType };
  }

  /**
   * Get timestamp type helper
   * @private
   */
  static _getTimestampType(value) {
    if (Number.isInteger(value)) return 'integer';
    if (value instanceof Date) return 'date';
    if (typeof value === 'string') return 'string';
    return 'unknown';
  }

  /**
   * Complete band validation with detailed error reporting
   */
  static validateBands(bands, totalBandsAvailable = null, source = 'user input') {
    if (!Array.isArray(bands)) {
      throw new Error(`bands: must be an array from ${source}`);
    }
    
    if (bands.length === 0) {
      throw new Error(`bands: cannot be empty from ${source}`);
    }
    
    if (bands.length !== 1 && bands.length !== 3) {
      throw new Error(`bands: must have length 1 (single band) or 3 (RGB composite), got length ${bands.length} from ${source}`);
    }
    
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      if (!Number.isInteger(band) || band < 0) {
        throw new Error(`bands[${i}]: must be non-negative integer, got ${band} from ${source}`);
      }
    }
    
    if (totalBandsAvailable !== null && totalBandsAvailable > 0) {
      for (let i = 0; i < bands.length; i++) {
        const band = bands[i];
        if (band >= totalBandsAvailable) {
          throw new Error(`bands[${i}]: index ${band} exceeds total bands available (${totalBandsAvailable}) from ${source}`);
        }
      }
    }
    
    // Note: Duplicate bands are allowed - users have freedom to use duplicated bands in composition
    
    return [...bands];
  }

  /**
   * Complete NODATA validation with all format support
   */
  static validateNodata(nodata, bandsConfig, totalBandsAvailable = null, source = 'user input') {
    if (nodata === null || nodata === undefined) {
      return { value: null, format: null };
    }
    
    if (typeof nodata === 'number') {
      if (!Number.isFinite(nodata)) {
        throw new Error(`nodata: must be finite number, got ${nodata} from ${source}`);
      }
      return { value: nodata, format: NODATA_FORMATS.GLOBAL };
    }
    
    if (Array.isArray(nodata)) {
      if (nodata.length === 0) {
        throw new Error(`nodata: array cannot be empty from ${source}`);
      }
      
      for (let i = 0; i < nodata.length; i++) {
        if (typeof nodata[i] !== 'number' || !Number.isFinite(nodata[i])) {
          throw new Error(`nodata[${i}]: must be finite number, got ${nodata[i]} from ${source}`);
        }
      }
      
      if (bandsConfig && nodata.length === bandsConfig.length) {
        // Per-band composition NODATA
        return { value: [...nodata], format: NODATA_FORMATS.PER_BAND_COMPOSITION };
      } else if (totalBandsAvailable && nodata.length === totalBandsAvailable) {
        // Per-dataset band NODATA
        return { value: [...nodata], format: NODATA_FORMATS.PER_DATASET_BAND };
      } else {
        const expectedLengths = [];
        if (bandsConfig) expectedLengths.push(`${bandsConfig.length} (band composition)`);
        if (totalBandsAvailable) expectedLengths.push(`${totalBandsAvailable} (total dataset bands)`);
        throw new Error(`nodata: array length ${nodata.length} doesn't match expected lengths: [${expectedLengths.join(', ')}] from ${source}`);
      }
    }
    
    throw new Error(`nodata: must be number, array of numbers, null, or undefined, got ${typeof nodata} from ${source}`);
  }

  /**
   * Complete statistics key indices validation - only min/max required
   */
  static validateStatisticsKeyIndices(keyIndices, source = 'user input') {
    if (!keyIndices || typeof keyIndices !== 'object') {
      throw new Error(`statistics_key_indices: must be object from ${source}`);
    }
    
    // Only min and max are strictly required
    for (const requiredKey of REQUIRED_STATS_KEYS) {
      if (!(requiredKey in keyIndices)) {
        throw new Error(`statistics_key_indices: missing required key '${requiredKey}' from ${source}`);
      }
      
      const index = keyIndices[requiredKey];
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`statistics_key_indices['${requiredKey}']: must be non-negative integer, got ${index} from ${source}`);
      }
    }
    
    // Validate any additional keys
    for (const [key, index] of Object.entries(keyIndices)) {
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`statistics_key_indices['${key}']: must be non-negative integer, got ${index} from ${source}`);
      }
    }
    
    // Check for duplicate indices
    const indices = Object.values(keyIndices);
    const uniqueIndices = new Set(indices);
    if (uniqueIndices.size !== indices.length) {
      throw new Error(`statistics_key_indices: indices must be unique from ${source}`);
    }
    
    return { ...keyIndices };
  }

  /**
   * Complete normalization validation with strategy support
   */
  static validateNormalization(normalize, availableStatsKeys = null, source = 'user input') {
    if (normalize === null || normalize === undefined) {
      return null;
    }
    
    if (typeof normalize !== 'object' || Array.isArray(normalize)) {
      throw new Error(`normalize: must be object with min_key, max_key, and optional strategy properties from ${source}`);
    }
    
    if (!('min_key' in normalize) || !('max_key' in normalize)) {
      throw new Error(`normalize: must have min_key and max_key properties from ${source}`);
    }
    
    const { min_key, max_key, strategy } = normalize;
    
    if (typeof min_key !== 'string' || min_key.trim() === '') {
      throw new Error(`normalize.min_key: must be non-empty string from ${source}`);
    }
    
    if (typeof max_key !== 'string' || max_key.trim() === '') {
      throw new Error(`normalize.max_key: must be non-empty string from ${source}`);
    }
    
    // Validate strategy if provided
    let validatedStrategy = NORMALIZATION_STRATEGIES.PER_BAND_PER_TIME; // Default strategy
    if (strategy !== undefined) {
      if (typeof strategy !== 'string') {
        throw new Error(`normalize.strategy: must be string from ${source}`);
      }
      
      const validStrategies = Object.values(NORMALIZATION_STRATEGIES);
      if (!validStrategies.includes(strategy)) {
        throw new Error(`normalize.strategy: must be one of [${validStrategies.join(', ')}] from ${source}, got '${strategy}'`);
      }
      validatedStrategy = strategy;
    }
    
    // If available statistics keys are provided, validate against them
    // Otherwise, allow min/max and common statistical keys
    const validKeys = availableStatsKeys || ['min', 'max', 'mean', 'p2', 'p98', 'mode', 'std'];
    
    if (!validKeys.includes(min_key)) {
      throw new Error(`normalize.min_key: '${min_key}' not available in statistics keys [${validKeys.join(', ')}] from ${source}`);
    }
    
    if (!validKeys.includes(max_key)) {
      throw new Error(`normalize.max_key: '${max_key}' not available in statistics keys [${validKeys.join(', ')}] from ${source}`);
    }
    
    return { min_key, max_key, strategy: validatedStrategy };
  }
}

/**
 * Complete ZarrTile metadata extraction utilities
 */
class ZarrTileExtractor {
  
  /**
   * Extract group metadata from .zattrs file since zarr.js doesn't have openGroup
   */
  static async extractGroupMetadata(url, path, verbose = false) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    try {
      // Construct .zattrs file URL for the group
      const zattrsUrl = `${url}/${path}/.zattrs`.replace(/\/+/g, '/').replace(':/', '://');
      log(`Fetching group metadata from: ${zattrsUrl}`);
      
      const response = await fetch(zattrsUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const metadata = await response.json();
      log('Successfully extracted group metadata with keys:', Object.keys(metadata));
      return metadata;
    } catch (error) {
      log(`Warning: Could not extract group metadata: ${error.message}`);
      return {};
    }
  }

  /**
   * Extract metadata from value array using highest zoom level only
   */
  static async extractValueArrayMetadata(url, path, arrayName, zoomLevels = null, verbose = false) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    // Use highest zoom level available or fallback
    let targetZoom = null;
    if (zoomLevels && zoomLevels.length > 0) {
      targetZoom = Math.max(...zoomLevels);
    }
    
    const arrayPath = targetZoom !== null ? 
      `${path}/${targetZoom}/${arrayName}`.replace(/\/+/g, '/') :
      `${path}/${arrayName}`.replace(/\/+/g, '/');
    
    try {
      log(`Extracting value array metadata from: ${arrayPath}`);
      
      const valueArray = await openArray({ store: url, path: arrayPath, mode: 'r' });
      
      const metadata = {
        shape: valueArray.meta.shape,           // Only need T and B dimensions
        dtype: valueArray.meta.dtype,           // Data type
        fill_value: valueArray.meta.fill_value, // NODATA value
        path: arrayPath
      };
      
      log('Successfully extracted value array metadata:', {
        shape: metadata.shape,
        dtype: metadata.dtype,
        fill_value: metadata.fill_value
      });
      
      return metadata;
      
    } catch (error) {
      throw new Error(`Could not find value array '${arrayName}' at ${arrayPath}. Error: ${error.message}`);
    }
  }

  /**
   * Extract timestamps - check group root path or highest zoom level path only
   */
  static async extractTimestamps(url, path, arrayName, zoomLevels = null, verbose = false) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    // Try group root first, then highest zoom level
    const candidatePaths = [`${path}/${arrayName}`];
    if (zoomLevels && zoomLevels.length > 0) {
      const highestZoom = Math.max(...zoomLevels);
      candidatePaths.push(`${path}/${highestZoom}/${arrayName}`);
    }
    
    let lastError = null;
    
    for (const candidatePath of candidatePaths) {
      try {
        const cleanPath = candidatePath.replace(/\/+/g, '/');
        log(`Trying time array at: ${cleanPath}`);
        
        const timeArray = await openArray({ store: url, path: cleanPath, mode: 'r' });
        const timeData = await timeArray.get([null]);
        
        let timestamps = [];
        
        // Handle different time data formats
        if (Array.isArray(timeData.data) || timeData.data instanceof Int32Array ) {
          for (let i = 0; i < timeData.data.length; i++) {
            const timeValue = timeData.data[i];
            
            if (typeof timeValue === 'number') {
              // Assume Unix timestamp in seconds or milliseconds
              let date;
              if (timeValue > 1e10) {
                // Milliseconds
                date = new Date(timeValue);
              } else {
                // Seconds
                date = new Date(timeValue * 1000);
              }
              
              if (isNaN(date.getTime())) {
                throw new Error(`Invalid timestamp at index ${i}: ${timeValue}`);
              }
              
              timestamps.push(date);
              
            } else if (typeof timeValue === 'string') {
              // ISO string or custom format
              const date = new Date(timeValue);
              if (isNaN(date.getTime())) {
                throw new Error(`Invalid date string at index ${i}: ${timeValue}`);
              }
              timestamps.push(date);
              
            } else {
              throw new Error(`Unsupported time value type at index ${i}: ${typeof timeValue}`);
            }
          }
        } else {
          throw new Error('Time data is not in expected array format');
        }
        
        log(`Successfully extracted ${timestamps.length} timestamps`);
        return timestamps;
        
      } catch (error) {
        lastError = error;
        log(`Could not extract timestamps from ${candidatePath}: ${error.message}`);
      }
    }
    
    log('Warning: Could not extract timestamps from any time array location');
    return null;
  }

  /**
   * Extract statistics - check group root path or highest zoom level path only
   */
  static async extractStatistics(url, path, arrayName, zoomLevels = null, keyIndices = null, verbose = false) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    // Try group root first, then highest zoom level
    const candidatePaths = [`${path}/${arrayName}`];
    if (zoomLevels && zoomLevels.length > 0) {
      const highestZoom = Math.max(...zoomLevels);
      candidatePaths.push(`${path}/${highestZoom}/${arrayName}`);
    }
    
    let lastError = null;
    
    for (const candidatePath of candidatePaths) {
      try {
        const cleanPath = candidatePath.replace(/\/+/g, '/');
        log(`Trying statistics array at: ${cleanPath}`);
        
        const statsArray = await openArray({ store: url, path: cleanPath, mode: 'r' });
        const statsShape = statsArray.meta.shape;
        
        log(`Statistics array shape: [${statsShape.join(', ')}]`);
        
        if (statsShape.length !== 3) {
          throw new Error(`Expected 3D statistics array [time, band, stats], got ${statsShape.length}D`);
        }
        
        const [timeCount, bandCount, statsCount] = statsShape;
        
        // Load all statistics data
        log('Loading complete statistics array...');
        const statsData = await statsArray.get([null, null, null]);
        
        // Convert to case 5 format: [{min: [value], max: [value], ...}] per dataset band, per time
        const statistics = this._convertStatsArrayToCase5(
          statsData.data, statsShape, keyIndices || DEFAULTS.statistics_key_indices, verbose
        );
        
        log(`Successfully extracted statistics for ${bandCount} bands and ${timeCount} timesteps`);
        
        return {
          statistics: statistics,
          format: STATISTICS_FORMATS.CASE5,
          shape: statsShape,
          path: cleanPath
        };
        
      } catch (error) {
        lastError = error;
        log(`Could not extract statistics from ${candidatePath}: ${error.message}`);
      }
    }
    
    log('Warning: Could not extract statistics from any statistics array location');
    return null;
  }

  /**
   * Convert statistics array data to case 5 format
   * @private
   */
  static _convertStatsArrayToCase5(statsData, shape, keyIndices, verbose) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    const [timeCount, bandCount, statsCount] = shape;
    
    // Initialize case 5 structure: array of objects, one per band
    const case5Stats = [];
    
    for (let bandIdx = 0; bandIdx < bandCount; bandIdx++) {
      const bandStats = {};
      
      // Initialize each statistic key with an array for all timesteps
      for (const [statKey, statIdx] of Object.entries(keyIndices)) {
        bandStats[statKey] = [];
        
        for (let timeIdx = 0; timeIdx < timeCount; timeIdx++) {
          // Extract statistic value for this band, time, and stat type
          const statValue = statsData[timeIdx][bandIdx][statIdx];
          bandStats[statKey].push(statValue);
        }
      }
      
      case5Stats.push(bandStats);
    }
    
    log(`Converted statistics array to case 5 format for ${bandCount} bands`);
    return case5Stats;
  }
}

/**
 * Complete ZarrTile property resolution engine with enhanced normalization strategies
 */
class ZarrTileResolver {
  
  /**
   * Resolve all properties with complete implementation and strategy support
   */
  static async resolveAllProperties(options, groupMetadata, valueArrayMetadata, verbose = false) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    log('Starting resolution of all properties with render configuration...');
    
    const resolved = {};
    
    // Property 1: CRS - user > group > default
    resolved.crs = options.crs || groupMetadata.crs || DEFAULTS.crs;
    log(`1. CRS resolved: ${resolved.crs}`);
    
    // Property 2: Extent (required) - user > group > error
    resolved.extent = this._resolveExtent(options, groupMetadata, verbose);
    log(`2. Extent resolved: [${resolved.extent.join(', ')}]`);
    
    // Property 3 & 4: Zoom levels and resolutions (required) - user > group > error
    const { zoomLevels, resolutions } = this._resolveZoomAndResolutions(options, groupMetadata, verbose);
    resolved.zoomLevels = zoomLevels;
    resolved.resolutions = resolutions;
    log(`3. Zoom levels resolved: [${resolved.zoomLevels.join(', ')}]`);
    log(`4. Resolutions resolved: [${resolved.resolutions.join(', ')}]`);
    
    // Property 5 & 6: URL and path (already validated)
    resolved.url = ZarrTile._normalizeUrl(options.url);
    resolved.path = options.path;
    log(`5. URL resolved: ${resolved.url}`);
    log(`6. Path resolved: ${resolved.path}`);
    
    // Property 7, 8, 9: Array names - user > default
    resolved.arrayNames = {
      value: options.value_array_name || DEFAULTS.value_array_name,
      time: options.time_array_name || DEFAULTS.time_array_name,
      statistics: options.statistics_array_name || DEFAULTS.statistics_array_name
    };
    log(`7. Value array name: ${resolved.arrayNames.value}`);
    log(`8. Time array name: ${resolved.arrayNames.time}`);
    log(`9. Statistics array name: ${resolved.arrayNames.statistics}`);
    
    // Property 10: Timestamps - user > time_array > value_array_shape > error
    const timestampResult = await this._resolveTimestamps(
      options, resolved, valueArrayMetadata, verbose
    );
    resolved.timestamps = timestampResult.timestamps;
    resolved.timestampType = timestampResult.type;
    log(`10. Timestamps resolved: ${resolved.timestamps.length} entries (type: ${resolved.timestampType})`);
    
    // Property 11: Bands - user > default, validated against dataset
    resolved.bands = this._resolveBands(options, valueArrayMetadata, verbose);
    log(`11. Bands resolved: [${resolved.bands.join(', ')}]`);
    
    // Property 12: NODATA - user > group > value_array > null
    const nodataResult = this._resolveNodata(options, groupMetadata, valueArrayMetadata, resolved.bands, verbose);
    resolved.nodata = nodataResult.value;
    resolved.nodataFormat = nodataResult.format;
    log(`12. NODATA resolved: ${resolved.nodata} (format: ${resolved.nodataFormat})`);
    
    // Property 13 & 14: Statistics and key indices - user > stats_array > group > dtype_limits
    const { statistics, statisticsFormat, statisticsKeyIndices, availableStatsKeys } = await this._resolveStatistics(
      options, resolved, valueArrayMetadata, verbose
    );
    resolved.statistics = statistics;
    resolved.statisticsFormat = statisticsFormat;
    resolved.statisticsKeyIndices = statisticsKeyIndices;
    resolved.availableStatsKeys = availableStatsKeys;
    log(`13. Statistics resolved (format: ${resolved.statisticsFormat})`);
    log(`14. Statistics key indices resolved: ${Object.keys(resolved.statisticsKeyIndices).join(', ')}`);
    
    // Property 15: Normalization - user > null, validate against available statistics keys
    resolved.normalize = ZarrTileValidator.validateNormalization(options.normalize, resolved.availableStatsKeys, 'user input');
    log(`15. Normalization resolved: ${resolved.normalize ? `${resolved.normalize.min_key} to ${resolved.normalize.max_key} (strategy: ${resolved.normalize.strategy})` : 'none'}`);
    
    // Property 16: Verbose - user > default
    resolved.verbose = options.verbose || DEFAULTS.verbose;
    log(`16. Verbose resolved: ${resolved.verbose}`);
    
    // Store value array metadata for later use
    resolved.dtype = valueArrayMetadata.dtype;
    resolved.valueArrayShape = valueArrayMetadata.shape;
    log(`17. Value array dtype: ${resolved.dtype}`);
    
    // New Properties: Render Configuration
    resolved.renderType = ZarrTileValidator.validateRenderType(options.render_type, 'user input');
    resolved.nodataStrategy = ZarrTileValidator.validateNodataStrategy(options.nodata_strategy, 'user input');
    resolved.nodataReplaceValue = ZarrTileValidator.validateNodataReplaceValue(options.nodata_replace_value, 'user input');
    resolved.maskNodata = ZarrTileValidator.validateMaskNodata(options.mask_nodata, 'user input');
    log(`18. Render type resolved: ${resolved.renderType}`);
    log(`19. NODATA strategy resolved: ${resolved.nodataStrategy}`);
    log(`20. NODATA replace value resolved: ${resolved.nodataReplaceValue}`);
    log(`21. Mask NODATA resolved: ${resolved.maskNodata}`);
    
    // Display Render Configuration (only for display render type)
    if (resolved.renderType === RENDER_TYPES.DISPLAY) {
      resolved.drc = ZarrTileValidator.validateDisplayRenderConfig(options.drc, resolved.availableStatsKeys, 'user input');
      log(`22. Display render config resolved:`, resolved.drc);
      
      // Additional validation for std_stretch strategy
      if (resolved.drc.strategy === DRC_STRATEGIES.STD_STRETCH) {
        // Ensure statistics contain required keys
        if (!resolved.availableStatsKeys.includes(resolved.drc.mean_key) || 
            !resolved.availableStatsKeys.includes(resolved.drc.std_key)) {
          throw new Error(`Display render config: std_stretch strategy requires '${resolved.drc.mean_key}' and '${resolved.drc.std_key}' in statistics`);
        }
        
        // Validate statistics format compatibility
        const format = resolved.statisticsFormat;
        if (!format) {
          throw new Error(`Display render config: std_stretch strategy requires statistics to be available`);
        }
        
        log(`22a. std_stretch strategy validated for statistics format: ${format}`);
      }
    } else {
      resolved.drc = null;
      log(`22. Display render config: skipped (render type is ${resolved.renderType})`);
    }
    
    // Pre-calculate global statistics for normalization strategies
    if (resolved.normalize && resolved.normalize.strategy !== NORMALIZATION_STRATEGIES.PER_BAND_PER_TIME) {
      resolved.globalStatistics = this._calculateGlobalStatistics(resolved, verbose);
      log('23. Global statistics calculated for normalization strategies');
    }
    
    log('All properties successfully resolved with render configuration and display config');
    return resolved;
  }
  
  /**
   * Calculate global statistics for normalization strategies
   * @private
   */
  static _calculateGlobalStatistics(resolved, verbose) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    const { statistics, statisticsFormat, normalize, bands, timestamps } = resolved;
    
    if (!statistics || !normalize) return null;
    
    const { min_key, max_key, strategy } = normalize;
    const globalStats = {
      global: null,                    // Global min/max across all bands and times
      globalBandPerTime: [],          // Global min/max per timestep across all bands
      perBandGlobalTime: []           // Min/max per band across all times
    };
    
    log(`Calculating global statistics for strategy: ${strategy}`);
    
    try {
      switch (statisticsFormat) {
        case STATISTICS_FORMATS.CASE1:
          // Global statistics already available
          globalStats.global = { min: statistics[min_key], max: statistics[max_key] };
          break;
          
        case STATISTICS_FORMATS.CASE2:
        case STATISTICS_FORMATS.CASE3:
          // Per-band global statistics
          this._calculateFromPerBandGlobal(globalStats, statistics, min_key, max_key, strategy, bands);
          break;
          
        case STATISTICS_FORMATS.CASE4:
        case STATISTICS_FORMATS.CASE5:
          // Per-band per-time statistics
          this._calculateFromPerBandPerTime(globalStats, statistics, min_key, max_key, strategy, bands, timestamps);
          break;
      }
      
      log('Global statistics calculation completed');
      return globalStats;
      
    } catch (error) {
      log('Warning: Failed to calculate global statistics:', error.message);
      return null;
    }
  }
  
  /**
   * Calculate global statistics from per-band global data
   * @private
   */
  static _calculateFromPerBandGlobal(globalStats, statistics, minKey, maxKey, strategy, bands) {
    // Extract min/max values from all bands
    const allMins = [];
    const allMaxs = [];
    
    for (let i = 0; i < statistics.length; i++) {
      const bandStats = statistics[i];
      if (bandStats && bandStats[minKey] !== undefined && bandStats[maxKey] !== undefined) {
        allMins.push(bandStats[minKey]);
        allMaxs.push(bandStats[maxKey]);
      }
    }
    
    if (allMins.length === 0 || allMaxs.length === 0) return;
    
    // Calculate global min/max
    globalStats.global = {
      min: Math.min(...allMins),
      max: Math.max(...allMaxs)
    };
    
    // For per-band global time, use the band-specific values
    if (strategy === NORMALIZATION_STRATEGIES.PER_BAND_GLOBAL_TIME) {
      globalStats.perBandGlobalTime = bands.map(bandIndex => ({
        min: bandIndex < statistics.length ? statistics[bandIndex][minKey] : globalStats.global.min,
        max: bandIndex < statistics.length ? statistics[bandIndex][maxKey] : globalStats.global.max
      }));
    }
  }
  
  /**
   * Calculate global statistics from per-band per-time data  
   * @private
   */
  static _calculateFromPerBandPerTime(globalStats, statistics, minKey, maxKey, strategy, bands, timestamps) {
    const timeCount = timestamps.length;
    
    // Calculate global across all bands and times
    const allMins = [];
    const allMaxs = [];
    
    for (let i = 0; i < statistics.length; i++) {
      const bandStats = statistics[i];
      if (bandStats && Array.isArray(bandStats[minKey]) && Array.isArray(bandStats[maxKey])) {
        allMins.push(...bandStats[minKey]);
        allMaxs.push(...bandStats[maxKey]);
      }
    }
    
    if (allMins.length > 0 && allMaxs.length > 0) {
      globalStats.global = {
        min: Math.min(...allMins),
        max: Math.max(...allMaxs)
      };
    }
    
    // Calculate global per timestep across bands
    if (strategy === NORMALIZATION_STRATEGIES.GLOBAL_BAND_PER_TIME) {
      globalStats.globalBandPerTime = [];
      
      for (let t = 0; t < timeCount; t++) {
        const timeMins = [];
        const timeMaxs = [];
        
        for (let i = 0; i < statistics.length; i++) {
          const bandStats = statistics[i];
          if (bandStats && 
              Array.isArray(bandStats[minKey]) && 
              Array.isArray(bandStats[maxKey]) &&
              t < bandStats[minKey].length && 
              t < bandStats[maxKey].length) {
            timeMins.push(bandStats[minKey][t]);
            timeMaxs.push(bandStats[maxKey][t]);
          }
        }
        
        globalStats.globalBandPerTime.push({
          min: timeMins.length > 0 ? Math.min(...timeMins) : globalStats.global?.min || 0,
          max: timeMaxs.length > 0 ? Math.max(...timeMaxs) : globalStats.global?.max || 1
        });
      }
    }
    
    // Calculate per-band global time
    if (strategy === NORMALIZATION_STRATEGIES.PER_BAND_GLOBAL_TIME) {
      globalStats.perBandGlobalTime = bands.map(bandIndex => {
        if (bandIndex < statistics.length) {
          const bandStats = statistics[bandIndex];
          if (bandStats && 
              Array.isArray(bandStats[minKey]) && 
              Array.isArray(bandStats[maxKey])) {
            return {
              min: Math.min(...bandStats[minKey]),
              max: Math.max(...bandStats[maxKey])
            };
          }
        }
        
        return globalStats.global || { min: 0, max: 1 };
      });
    }
  }
  
  /**
   * Resolve extent with complete validation
   */
  static _resolveExtent(options, groupMetadata, verbose) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    if (options.extent) {
      log('Using user-provided extent');
      return ZarrTileValidator.validateExtent(options.extent, 'user input');
    }
    
    if (groupMetadata.extent) {
      log('Using extent from group metadata');
      return ZarrTileValidator.validateExtent(groupMetadata.extent, 'group metadata');
    }
    
    throw new Error('extent: must be provided by user or available in group metadata');
  }
  
  /**
   * Resolve zoom levels and resolutions with complete validation
   */
  static _resolveZoomAndResolutions(options, groupMetadata, verbose) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    if (options.zoomLevels && options.resolutions) {
      log('Using user-provided zoom levels and resolutions');
      return ZarrTileValidator.validateZoomAndResolutions(
        options.zoomLevels, options.resolutions, 'user input'
      );
    }
    
    if (groupMetadata.zoom_levels && groupMetadata.resolutions) {
      log('Using zoom levels and resolutions from group metadata');
      return ZarrTileValidator.validateZoomAndResolutions(
        groupMetadata.zoom_levels, groupMetadata.resolutions, 'group metadata'
      );
    }
    
    // Alternative group metadata keys
    if (groupMetadata.zoomLevels && groupMetadata.resolutions) {
      log('Using alternative zoom level keys from group metadata');
      return ZarrTileValidator.validateZoomAndResolutions(
        groupMetadata.zoomLevels, groupMetadata.resolutions, 'group metadata (alternative keys)'
      );
    }
    
    throw new Error('zoomLevels and resolutions: must be provided by user or available in group metadata');
  }
  
  /**
   * Complete timestamp resolution with all format support
   */
  static async _resolveTimestamps(options, resolved, valueArrayMetadata, verbose) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    if (options.timestamps) {
      log('Using user-provided timestamps');
      return ZarrTileValidator.validateTimestamps(options.timestamps, null, 'user input');
    }
    
    // Try to extract from time array
    try {
      log('Attempting to extract timestamps from time array');
      const extractedTimestamps = await ZarrTileExtractor.extractTimestamps(
        resolved.url, resolved.path, resolved.arrayNames.time, resolved.zoomLevels, verbose
      );
      
      if (extractedTimestamps && extractedTimestamps.length > 0) {
        log(`Successfully extracted ${extractedTimestamps.length} timestamps from time array`);
        return { timestamps: extractedTimestamps, type: 'extracted_dates' };
      }
    } catch (error) {
      log(`Could not extract timestamps from time array: ${error.message}`);
    }
    
    // Fallback: infer from value array shape (time is first dimension)
    if (valueArrayMetadata.shape && valueArrayMetadata.shape.length >= 3 && valueArrayMetadata.shape[0] > 1) {
      const timeCount = valueArrayMetadata.shape[0];
      log(`Inferring ${timeCount} timestamps from value array shape`);
      const inferredTimestamps = Array.from({ length: timeCount }, (_, i) => i);
      return { timestamps: inferredTimestamps, type: 'inferred_from_shape' };
    }
    
    // Single timestep fallback
    if (valueArrayMetadata.shape && valueArrayMetadata.shape.length >= 3 && valueArrayMetadata.shape[0] === 1) {
      log('Single timestep detected from value array shape');
      return { timestamps: [0], type: 'single_timestep' };
    }
    
    throw new Error('timestamps: could not resolve from user input, time array, or value array shape');
  }
  
  /**
   * Complete band resolution with validation
   */
  static _resolveBands(options, valueArrayMetadata, verbose) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    const bands = options.bands || DEFAULTS.bands;
    let totalBands = null;
    
    if (valueArrayMetadata.shape && valueArrayMetadata.shape.length >= 2) {
      totalBands = valueArrayMetadata.shape[1]; // Second dimension is bands
      log(`Dataset has ${totalBands} bands available`);
    }
    
    log('Validating band configuration');
    return ZarrTileValidator.validateBands(bands, totalBands, 'user input or default');
  }
  
  /**
   * Complete NODATA resolution with all format support
   */
  static _resolveNodata(options, groupMetadata, valueArrayMetadata, bandsConfig, verbose) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    let totalBands = null;
    if (valueArrayMetadata.shape && valueArrayMetadata.shape.length >= 2) {
      totalBands = valueArrayMetadata.shape[1];
    }
    
    if (options.nodata !== undefined) {
      log('Using user-provided NODATA configuration');
      return ZarrTileValidator.validateNodata(options.nodata, bandsConfig, totalBands, 'user input');
    }
    
    // Try group metadata
    if (groupMetadata.nodata !== undefined) {
      log('Using NODATA from group metadata');
      return ZarrTileValidator.validateNodata(groupMetadata.nodata, bandsConfig, totalBands, 'group metadata');
    }
    
    // Try value array metadata
    if (valueArrayMetadata.fill_value !== undefined && valueArrayMetadata.fill_value !== null) {
      log('Using fill_value from value array metadata as NODATA');
      return ZarrTileValidator.validateNodata(valueArrayMetadata.fill_value, bandsConfig, totalBands, 'value array fill_value');
    }
    
    log('No NODATA configuration found, disabling NODATA masking');
    return { value: null, format: null };
  }
  
  /**
   * Complete statistics resolution with flexible key support
   */
  static async _resolveStatistics(options, resolved, valueArrayMetadata, verbose) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    // Resolve statistics key indices first
    let statisticsKeyIndices = DEFAULTS.statistics_key_indices;
    if (options.statistics_key_indices) {
      log('Using user-provided statistics key indices');
      statisticsKeyIndices = ZarrTileValidator.validateStatisticsKeyIndices(options.statistics_key_indices, 'user input');
    } else {
      log('Using default statistics key indices');
    }
    
    let statistics = null;
    let statisticsFormat = null;
    let availableStatsKeys = null;
    
    if (options.statistics) {
      log('Using user-provided statistics');
      const result = this._identifyAndValidateStatisticsFormat(options.statistics, resolved.bands, resolved.timestamps, verbose);
      statistics = result.statistics;
      statisticsFormat = result.format;
      
      // Extract available keys from user's statistics for normalization validation
      availableStatsKeys = this._extractAvailableStatsKeys(statistics, statisticsFormat);
      
    } else {
      // Try to extract from statistics array
      log('Attempting to extract statistics from statistics array');
      try {
        const extractedStats = await ZarrTileExtractor.extractStatistics(
          resolved.url, resolved.path, resolved.arrayNames.statistics, 
          resolved.zoomLevels, statisticsKeyIndices, verbose
        );
        
        if (extractedStats) {
          log('Successfully extracted statistics from statistics array');
          statistics = extractedStats.statistics;
          statisticsFormat = extractedStats.format;
          
          // Available keys are from the statistics key indices
          availableStatsKeys = Object.keys(statisticsKeyIndices);
        }
      } catch (error) {
        log(`Could not extract statistics from statistics array: ${error.message}`);
      }
      
      // Fallback to dtype limits
      if (!statistics) {
        log('Using dtype limits as fallback statistics');
        const dtypeLimits = this._getDtypeLimits(valueArrayMetadata.dtype);
        statistics = { min: dtypeLimits.min, max: dtypeLimits.max };
        statisticsFormat = STATISTICS_FORMATS.CASE1;
        availableStatsKeys = ['min', 'max'];
      }
    }
    
    return { statistics, statisticsFormat, statisticsKeyIndices, availableStatsKeys };
  }

  /**
   * Extract available statistics keys from user's statistics definition
   * @private
   */
  static _extractAvailableStatsKeys(statistics, format) {
    if (!statistics) return ['min', 'max']; // fallback
    
    switch (format) {
      case STATISTICS_FORMATS.CASE1:
        // Global object - keys are directly available
        return Object.keys(statistics);
        
      case STATISTICS_FORMATS.CASE2:
      case STATISTICS_FORMATS.CASE3:
      case STATISTICS_FORMATS.CASE4:
      case STATISTICS_FORMATS.CASE5:
        // Array of objects - get keys from first object
        if (Array.isArray(statistics) && statistics.length > 0) {
          return Object.keys(statistics[0]);
        }
        break;
    }
    
    return ['min', 'max']; // fallback
  }
  
  /**
   * Identify and validate statistics format - flexible keys, only min/max required
   */
  static _identifyAndValidateStatisticsFormat(statistics, bandsConfig, timestampsConfig, verbose) {
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    const bandCount = bandsConfig.length;
    const timeCount = timestampsConfig.length;
    
    if (typeof statistics === 'object' && !Array.isArray(statistics)) {
      // Case 1: {min: value, max: value, ...} - global for all bands and times
      log('Statistics format identified as Case 1: global object');
      
      // Check required keys
      for (const requiredKey of REQUIRED_STATS_KEYS) {
        if (!(requiredKey in statistics)) {
          throw new Error(`statistics: missing required key '${requiredKey}' in case 1 format`);
        }
      }
      
      // Validate all provided keys (flexible - user can define any keys)
      for (const [key, value] of Object.entries(statistics)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(`statistics['${key}']: must be finite number in case 1 format`);
        }
      }
      
      return { statistics, format: STATISTICS_FORMATS.CASE1 };
    }
    
    if (Array.isArray(statistics)) {
      const arrayLength = statistics.length;
      
      // Check if all elements are objects
      const allObjects = statistics.every(item => typeof item === 'object' && !Array.isArray(item));
      if (!allObjects) {
        throw new Error('statistics: all array elements must be objects');
      }
      
      // Check if object values are numbers (case 2/3) or arrays (case 4/5)
      const firstItem = statistics[0];
      const firstValues = Object.values(firstItem);
      const hasArrayValues = firstValues.some(val => Array.isArray(val));
      
      if (!hasArrayValues) {
        // Case 2 or 3: objects with number values
        if (arrayLength === bandCount) {
          log('Statistics format identified as Case 2: per band composition, global time');
          this._validateStatisticsCase2or3(statistics, 'case 2');
          return { statistics, format: STATISTICS_FORMATS.CASE2 };
        } else {
          log('Statistics format identified as Case 3: per dataset band, global time');
          this._validateStatisticsCase2or3(statistics, 'case 3');
          return { statistics, format: STATISTICS_FORMATS.CASE3 };
        }
      } else {
        // Case 4 or 5: objects with array values
        if (arrayLength === bandCount) {
          log('Statistics format identified as Case 4: per band composition, per time');
          this._validateStatisticsCase4or5(statistics, timeCount, 'case 4');
          return { statistics, format: STATISTICS_FORMATS.CASE4 };
        } else {
          log('Statistics format identified as Case 5: per dataset band, per time');
          this._validateStatisticsCase4or5(statistics, timeCount, 'case 5');
          return { statistics, format: STATISTICS_FORMATS.CASE5 };
        }
      }
    }
    
    throw new Error('statistics: unrecognized format. Must be object (case 1) or array of objects (cases 2-5)');
  }
  
  /**
   * Validate statistics case 2 or 3 format - flexible keys, only min/max required
   * @private
   */
  static _validateStatisticsCase2or3(statistics, caseName) {
    for (let i = 0; i < statistics.length; i++) {
      const bandStats = statistics[i];
      
      // Check required keys are present
      for (const requiredKey of REQUIRED_STATS_KEYS) {
        if (!(requiredKey in bandStats)) {
          throw new Error(`statistics[${i}]: missing required key '${requiredKey}' in ${caseName} format`);
        }
      }
      
      // Validate all provided keys (flexible - user can define any keys)
      for (const [key, value] of Object.entries(bandStats)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(`statistics[${i}]['${key}']: must be finite number in ${caseName} format`);
        }
      }
    }
  }
  
  /**
   * Validate statistics case 4 or 5 format - flexible keys, only min/max required
   * @private
   */
  static _validateStatisticsCase4or5(statistics, expectedTimeCount, caseName) {
    for (let i = 0; i < statistics.length; i++) {
      const bandStats = statistics[i];
      
      // Check required keys are present
      for (const requiredKey of REQUIRED_STATS_KEYS) {
        if (!(requiredKey in bandStats)) {
          throw new Error(`statistics[${i}]: missing required key '${requiredKey}' in ${caseName} format`);
        }
      }
      
      // Validate all provided keys (flexible - user can define any keys)
      for (const [key, value] of Object.entries(bandStats)) {
        if (!Array.isArray(value)) {
          throw new Error(`statistics[${i}]['${key}']: must be array in ${caseName} format`);
        }
        
        if (value.length !== expectedTimeCount) {
          throw new Error(`statistics[${i}]['${key}']: array length ${value.length} doesn't match time count ${expectedTimeCount} in ${caseName} format`);
        }
        
        for (let j = 0; j < value.length; j++) {
          if (typeof value[j] !== 'number' || !Number.isFinite(value[j])) {
            throw new Error(`statistics[${i}]['${key}'][${j}]: must be finite number in ${caseName} format`);
          }
        }
      }
    }
  }
  
  /**
   * Get dtype limits with complete dtype support
   */
  static _getDtypeLimits(dtype) {
    if (!dtype) {
      console.warn('[ZarrTile] No dtype provided, using float32 limits');
      return DTYPE_LIMITS['<f4'];
    }
    
    const limits = DTYPE_LIMITS[dtype];
    if (!limits) {
      console.warn(`[ZarrTile] Unsupported dtype '${dtype}', using float32 limits`);
      return DTYPE_LIMITS['<f4'];
    }
    
    return limits;
  }
}

/**
 * Complete ZarrTile implementation with enhanced render configuration support
 * @extends {DataTile}
 */
export default class ZarrTile extends DataTile {
  
  /**
   * Static worker pool for efficient worker reuse
   * @private
   */
  static workerPool_ = [];
  static maxWorkers_ = 16;
  static workerUrl_ = null;
  
  /**
   * Get worker URL with caching
   * @private
   */
  static _getWorkerUrl() {
    if (!this.workerUrl_) {
      try {
        this.workerUrl_ = new URL('./zarr.worker.js', import.meta.url);
      } catch (e) {
        this.workerUrl_ = 'zarr.worker.js';
      }
    }
    return this.workerUrl_;
  }
  
  /**
   * Get worker from pool or create new one
   * @private
   */
  static async _getWorker() {
    if (this.workerPool_.length > 0) {
      return this.workerPool_.pop();
    }
    
    // Create new worker only if pool is empty
    const workerUrl = this._getWorkerUrl();
    return new Worker(workerUrl, { type: 'module' });
  }
  
  /**
   * Return worker to pool or terminate if pool is full
   * @private
   */
  static _returnWorker(worker) {
    if (this.workerPool_.length < this.maxWorkers_) {
      this.workerPool_.push(worker);
    } else {
      worker.terminate();
    }
  }
  
  /**
   * Terminate all workers in pool (cleanup method)
   */
  static terminateAllWorkers() {
    while (this.workerPool_.length > 0) {
      const worker = this.workerPool_.pop();
      worker.terminate();
    }
  }
  
  /**
   * Create ZarrTile instance with complete automatic metadata extraction and validation
   * @param {Object} options Configuration options supporting all properties
   * @return {Promise<ZarrTile>} ZarrTile instance
   */
  static async create(options = {}) {
    // Phase 1: Validate required properties
    ZarrTileValidator.validateRequired(options);
    
    const verbose = options.verbose || false;
    const log = verbose ? console.log.bind(console, '[ZarrTile]') : () => {};
    
    log('=== Starting ZarrTile creation process with render configuration ===');
    log('Options provided:', Object.keys(options));
    
    try {
      // Phase 2: Extract metadata from Zarr store
      const url = ZarrTile._normalizeUrl(options.url);
      const path = options.path;
      
      log('Phase 2: Extracting metadata from Zarr store');
      const groupMetadata = await ZarrTileExtractor.extractGroupMetadata(url, path, verbose);
      
      const valueArrayName = options.value_array_name || DEFAULTS.value_array_name;
      const valueArrayMetadata = await ZarrTileExtractor.extractValueArrayMetadata(
        url, path, valueArrayName, 
        options.zoomLevels || groupMetadata.zoom_levels || groupMetadata.zoomLevels, 
        verbose
      );
      
      // Phase 3: Resolve all properties including render configuration
      log('Phase 3: Resolving all properties with render configuration validation');
      const resolvedConfig = await ZarrTileResolver.resolveAllProperties(
        options, groupMetadata, valueArrayMetadata, verbose
      );
      
      // Phase 4: Create instance
      log('Phase 4: Creating ZarrTile instance with resolved configuration');
      const instance = new ZarrTile(CONSTRUCTOR_TOKEN, {
        ...resolvedConfig,
        // Additional OpenLayers options
        transition: options.transition || 0,
        interpolate: options.interpolate !== undefined ? options.interpolate : true,
        wrapX: options.wrapX !== undefined ? options.wrapX : false
      });
      
      log('=== ZarrTile creation completed successfully with render configuration ===');
      return instance;
      
    } catch (error) {
      const errorMessage = `ZarrTile creation failed: ${error.message}`;
      if (verbose) {
        console.error('[ZarrTile Error]', errorMessage);
        console.error('[ZarrTile Stack]', error.stack);
      }
      throw new Error(errorMessage);
    }
  }
  
  /**
   * Generate full resolution array for all zoom levels with proper gap filling
   */
  static _generateFullArrays(resolutions, zoomLevels) {
    const maxZoom = Math.max(...zoomLevels);
    const minZoom = Math.min(...zoomLevels);
    const fullResolutions = new Array(maxZoom + 1);
    const INCREMENT = 0.001;

    // Fill supported levels first
    zoomLevels.forEach((z, index) => {
      fullResolutions[z] = resolutions[index];
    });

    // Fill gaps and unsupported levels
    for (let z = 0; z <= maxZoom; z++) {
      if (fullResolutions[z] === undefined) {
        if (z < minZoom) {
          // Below minimum supported level
          fullResolutions[z] = resolutions[0] + ((minZoom - z) * INCREMENT);
        } else if (z > Math.max(...zoomLevels)) {
          // Above maximum supported level
          fullResolutions[z] = resolutions[resolutions.length - 1] - ((z - Math.max(...zoomLevels)) * INCREMENT);
        } else {
          // Between supported levels - interpolate
          let prevSupportedIdx = -1;
          let nextSupportedIdx = -1;
          
          for (let i = 0; i < zoomLevels.length; i++) {
            if (zoomLevels[i] < z) prevSupportedIdx = i;
            if (zoomLevels[i] > z && nextSupportedIdx === -1) nextSupportedIdx = i;
          }
          
          if (prevSupportedIdx >= 0 && nextSupportedIdx >= 0) {
            const prevZoom = zoomLevels[prevSupportedIdx];
            const nextZoom = zoomLevels[nextSupportedIdx];
            const ratio = (z - prevZoom) / (nextZoom - prevZoom);
            const interpolated = resolutions[prevSupportedIdx] + 
              (resolutions[nextSupportedIdx] - resolutions[prevSupportedIdx]) * ratio;
            fullResolutions[z] = interpolated + (INCREMENT * (z - prevZoom));
          } else {
            // Fallback to nearest
            const nearestIdx = prevSupportedIdx >= 0 ? prevSupportedIdx : nextSupportedIdx;
            fullResolutions[z] = resolutions[nearestIdx];
          }
        }
      }
    }

    // Ensure first resolution is unique for OpenLayers
    fullResolutions[0] = fullResolutions[0] + 0.5;
    return fullResolutions;
  }

  /**
   * Private constructor - use ZarrTile.create() instead
   */
  constructor(token, config) {
    if (token !== CONSTRUCTOR_TOKEN) {
      throw new Error('Use ZarrTile.create() instead of new ZarrTile(). Direct instantiation is not allowed.');
    }
    
    // Generate full resolutions array
    const fullResolutions = ZarrTile._generateFullArrays(config.resolutions, config.zoomLevels);
    
    // Create tile grid
    const tileGrid = new TileGrid({
      extent: config.extent,
      resolutions: fullResolutions,
      minZoom: Math.min(...config.zoomLevels),
      maxZoom: Math.max(...config.zoomLevels)
    });
    
    // Initialize parent DataTile
    super({
      projection: config.crs,
      tileGrid: tileGrid,
      interpolate: config.interpolate,
      transition: config.transition,
      wrapX: config.wrapX,
      loader: (z, x, y) => this.tileLoader(z, x, y)
    });
    
    // Store complete resolved configuration
    this.config_ = Object.freeze({ ...config }); // Immutable config
    this.url_ = config.url;
    this.path_ = config.path;
    this.arrayNames_ = config.arrayNames;
    this.verbose_ = config.verbose;
    
    // Current state management
    this.currentTimeIndex_ = 0;
    this.bands_ = [...config.bands];
    this.timestamps_ = config.timestamps || [];
    
    // Resolved configuration cache for current time/band combination
    this.resolvedCache_ = {
      timeIndex: -1,
      bands: null,
      nodata: null,
      normalization: null,
      statistics: null,
      displayRenderParams: null,  // For display render configuration
      valid: false
    };
    
    // Set up change listeners for cache invalidation and tile refresh
    this.on('propertychange', (event) => {
      if (event.key === 'time' || event.key === 'bands') {
        this._invalidateCache('Property change: ' + event.key);
        this._log(`Property ${event.key} changed, refreshing tiles`);
        this.refresh(); // Force OpenLayers to reload tiles
      }
    });
    
    // Initialize observable properties
    if (this.timestamps_.length > 0) {
      this.set('time', this.timestamps_[0]);
    }
    this.set('bands', [...this.bands_]);
    
    this._log('ZarrTile instance initialized with', Object.keys(config).length, 'configuration properties');
    this._log('Render configuration:', {
      renderType: config.renderType,
      nodataStrategy: config.nodataStrategy,
      maskNodata: config.maskNodata
    });
  }
  
  // ===== RESOLVED CONFIGURATION CACHE MANAGEMENT =====
  
  /**
   * Update resolved cache if needed (complete implementation with strategy support)
   * @private
   */
  _updateResolvedCache() {
    const cache = this.resolvedCache_;
    
    // Check if cache is still valid
    if (cache.valid && 
        cache.timeIndex === this.currentTimeIndex_ && 
        this._arraysEqual(cache.bands, this.bands_)) {
      return; // Cache is valid
    }
    
    this._log('Updating resolved cache for time:', this.currentTimeIndex_, 'bands:', this.bands_);
    
    // Update cache with complete resolution
    cache.timeIndex = this.currentTimeIndex_;
    cache.bands = [...this.bands_];
    cache.nodata = this._resolveCurrentNodata();
    cache.statistics = this._resolveCurrentStatistics();
    cache.normalization = this._resolveCurrentNormalization();
    cache.displayRenderParams = this._resolveCurrentDisplayRenderParams();
    cache.valid = true;
    
    this._log('Resolved cache updated successfully');
  }
  
  /**
   * Complete NODATA resolution for current bands with proper band index mapping
   * @private
   */
  _resolveCurrentNodata() {
    const nodata = this.config_.nodata;
    if (!nodata) return null;
    
    const format = this.config_.nodataFormat;
    
    switch (format) {
      case NODATA_FORMATS.GLOBAL:
        // Single value for all bands
        return new Array(this.bands_.length).fill(nodata);
        
      case NODATA_FORMATS.PER_BAND_COMPOSITION:
        // Array matching current band composition - use band indices as keys
        // For fixed compositions (1 or 3 bands), map band indices to proper nodata indices
        return this.bands_.map((bandIndex, i) => {
          // Check if we have stored NODATA using band index as key
          if (typeof nodata === 'object' && !Array.isArray(nodata)) {
            return nodata[bandIndex] || null;
          }
          // Fallback to array order
          return i < nodata.length ? nodata[i] : null;
        });
        
      case NODATA_FORMATS.PER_DATASET_BAND:
        // Array for all dataset bands - extract for current bands using band indices
        return this.bands_.map(bandIndex => 
          bandIndex < nodata.length ? nodata[bandIndex] : null
        );
        
      default:
        this._log('Warning: Unknown NODATA format:', format);
        return null;
    }
  }
  
  /**
   * Complete statistics resolution for current time/bands (all 5 cases implemented)
   * @private
   */
  _resolveCurrentStatistics() {
    const statistics = this.config_.statistics;
    if (!statistics) return null;
    
    const format = this.config_.statisticsFormat;
    const timeIndex = this.currentTimeIndex_;
    const resolvedStats = [];
    
    switch (format) {
      case STATISTICS_FORMATS.CASE1:
        // {min: value, max: value} - global for all bands and times
        for (let i = 0; i < this.bands_.length; i++) {
          resolvedStats.push({ ...statistics });
        }
        break;
        
      case STATISTICS_FORMATS.CASE2:
        // [{min: value}...] - per band composition, global time
        for (let i = 0; i < this.bands_.length; i++) {
          if (i < statistics.length) {
            resolvedStats.push({ ...statistics[i] });
          } else {
            this._log('Warning: Missing statistics for band composition index', i);
            resolvedStats.push(null);
          }
        }
        break;
        
      case STATISTICS_FORMATS.CASE3:
        // [{min: value}...] - per dataset band, global time
        for (let i = 0; i < this.bands_.length; i++) {
          const bandIndex = this.bands_[i];
          if (bandIndex < statistics.length) {
            resolvedStats.push({ ...statistics[bandIndex] });
          } else {
            this._log('Warning: Missing statistics for dataset band', bandIndex);
            resolvedStats.push(null);
          }
        }
        break;
        
      case STATISTICS_FORMATS.CASE4:
        // [{min: [value]}...] - per band composition, per time
        for (let i = 0; i < this.bands_.length; i++) {
          if (i < statistics.length) {
            const bandStats = statistics[i];
            const resolvedBandStats = {};
            
            for (const [key, values] of Object.entries(bandStats)) {
              if (Array.isArray(values) && timeIndex < values.length) {
                resolvedBandStats[key] = values[timeIndex];
              } else {
                this._log('Warning: Missing time statistics for band composition', i, 'key', key, 'time', timeIndex);
                resolvedBandStats[key] = null;
              }
            }
            
            resolvedStats.push(resolvedBandStats);
          } else {
            this._log('Warning: Missing statistics for band composition index', i);
            resolvedStats.push(null);
          }
        }
        break;
        
      case STATISTICS_FORMATS.CASE5:
        // [{min: [value]}...] - per dataset band, per time
        for (let i = 0; i < this.bands_.length; i++) {
          const bandIndex = this.bands_[i];
          if (bandIndex < statistics.length) {
            const bandStats = statistics[bandIndex];
            const resolvedBandStats = {};
            
            for (const [key, values] of Object.entries(bandStats)) {
              if (Array.isArray(values) && timeIndex < values.length) {
                resolvedBandStats[key] = values[timeIndex];
              } else {
                this._log('Warning: Missing time statistics for dataset band', bandIndex, 'key', key, 'time', timeIndex);
                resolvedBandStats[key] = null;
              }
            }
            
            resolvedStats.push(resolvedBandStats);
          } else {
            this._log('Warning: Missing statistics for dataset band', bandIndex);
            resolvedStats.push(null);
          }
        }
        break;
        
      default:
        this._log('Warning: Unknown statistics format:', format);
        return null;
    }
    
    return resolvedStats;
  }
  
  /**
   * Complete normalization resolution for current bands with strategy support
   * @private
   */
  _resolveCurrentNormalization() {
    const normalize = this.config_.normalize;
    if (!normalize) return null;
    
    const { min_key, max_key, strategy } = normalize;
    const globalStats = this.config_.globalStatistics;
    const dtypeLimits = ZarrTileResolver._getDtypeLimits(this.config_.dtype);
    const normalization = [];
    
    switch (strategy) {
      case NORMALIZATION_STRATEGIES.GLOBAL:
        // Use global min/max for all bands
        const globalMin = globalStats?.global?.min ?? dtypeLimits.min;
        const globalMax = globalStats?.global?.max ?? dtypeLimits.max;
        for (let i = 0; i < this.bands_.length; i++) {
          normalization.push({ min: globalMin, max: globalMax });
        }
        break;
        
      case NORMALIZATION_STRATEGIES.GLOBAL_BAND_PER_TIME:
        // Use global across bands for current timestep
        const timeStats = globalStats?.globalBandPerTime?.[this.currentTimeIndex_];
        const timeMin = timeStats?.min ?? dtypeLimits.min;
        const timeMax = timeStats?.max ?? dtypeLimits.max;
        for (let i = 0; i < this.bands_.length; i++) {
          normalization.push({ min: timeMin, max: timeMax });
        }
        break;
        
      case NORMALIZATION_STRATEGIES.PER_BAND_GLOBAL_TIME:
        // Use per-band global across all times
        for (let i = 0; i < this.bands_.length; i++) {
          const bandStats = globalStats?.perBandGlobalTime?.[i];
          normalization.push({
            min: bandStats?.min ?? dtypeLimits.min,
            max: bandStats?.max ?? dtypeLimits.max
          });
        }
        break;
        
      case NORMALIZATION_STRATEGIES.PER_BAND_PER_TIME:
      default:
        // Use current resolved statistics (existing behavior)
        const currentStats = this.resolvedCache_.statistics;
        if (!currentStats) {
          // Fallback to dtype limits
          for (let i = 0; i < this.bands_.length; i++) {
            normalization.push({ min: dtypeLimits.min, max: dtypeLimits.max });
          }
        } else {
          for (let i = 0; i < this.bands_.length; i++) {
            const stats = currentStats[i];
            if (!stats) {
              normalization.push({ min: dtypeLimits.min, max: dtypeLimits.max });
            } else {
              normalization.push({
                min: stats[min_key] !== undefined ? stats[min_key] : dtypeLimits.min,
                max: stats[max_key] !== undefined ? stats[max_key] : dtypeLimits.max
              });
            }
          }
        }
        break;
    }
    
    return normalization;
  }
  
  /**
   * Resolve display render parameters for current bands and time
   * @private
   */
  _resolveCurrentDisplayRenderParams() {
    const drc = this.config_.drc;
    if (!drc || this.config_.renderType !== RENDER_TYPES.DISPLAY) {
      return null;
    }
    
    const { strategy, mean_key, std_key, slope } = drc;
    
    if (strategy === DRC_STRATEGIES.NORMALIZE) {
      // Use existing normalization - no additional parameters needed
      return { strategy, useNormalization: true };
    }
    
    if (strategy === DRC_STRATEGIES.STD_STRETCH) {
      const currentStats = this.resolvedCache_.statistics;
      if (!currentStats) {
        this._log('Warning: No statistics available for std_stretch strategy');
        return null;
      }
      
      const stretchParams = [];
      
      for (let i = 0; i < this.bands_.length; i++) {
        const stats = currentStats[i];
        if (!stats) {
          this._log('Warning: No statistics for band', i, 'using defaults');
          stretchParams.push({ mean: 0, std: 1, slope });
        } else if (stats[mean_key] === undefined || stats[std_key] === undefined) {
          this._log('Warning: Missing mean or std for band', i, 'using defaults');
          stretchParams.push({ mean: 0, std: 1, slope });
        } else {
          stretchParams.push({
            mean: stats[mean_key],
            std: stats[std_key],
            slope
          });
        }
      }
      
      return { strategy, stretchParams };
    }
    
    return null;
  }
  
  /**
   * Invalidate resolved cache
   * @private
   */
  _invalidateCache(reason) {
    this.resolvedCache_.valid = false;
    this._log('Cache invalidated:', reason);
  }
  
  // ===== TILE LOADING IMPLEMENTATION =====
  
  /**
   * Complete tile loader implementation with enhanced render configuration support and worker pooling
   */
  async tileLoader(z, x, y) {
    if (!this.isZoomSupported(z)) {
      this._log(`Zoom level ${z} not supported, skipping tile (${z}, ${x}, ${y})`);
      return undefined;
    }
    
    // Ensure resolved cache is up to date
    this._updateResolvedCache();
    
    const tileGrid = this.getTileGrid();
    const tileSize = tileGrid.getTileSize(z);
    const tileRange = tileGrid.getFullTileRange(z);
    
    this._log(`Loading tile (${z}, ${x}, ${y}) with render configuration`);
    
    return new Promise(async (resolve, reject) => {
      let worker = null;
      
      try {
        // Get worker from pool
        worker = await ZarrTile._getWorker();
        
        worker.onmessage = (e) => {
          // Return worker to pool instead of terminating
          ZarrTile._returnWorker(worker);
          
          if (e.data.error) {
            this._log('Worker error for tile', z, x, y, ':', e.data.error);
            reject(new Error(e.data.error));
          } else {
            this._log('Successfully loaded tile', z, x, y);
            resolve(e.data.tileData);
          }
        };
        
        worker.onerror = (error) => {
          // Return worker to pool even on error
          ZarrTile._returnWorker(worker);
          this._log('Worker error for tile', z, x, y, ':', error.message);
          reject(error);
        };
        
        // Send completely resolved, simple parameters to worker with render configuration
        const message = {
          // Tile coordinates
          z, x, y, tileSize, tileRange,
          
          // Band and time configuration
          bands: [...this.bands_],
          timeIndex: this.currentTimeIndex_,
          
          // Pre-resolved configurations (simple arrays and objects only!)
          nodata: this.resolvedCache_.nodata,           // [val1, val2, val3] or null
          normalization: this.resolvedCache_.normalization, // [{min, max}, {min, max}] or null
          
          // Render configuration (NEW)
          renderType: this.config_.renderType,
          nodataStrategy: this.config_.nodataStrategy,
          nodataReplaceValue: this.config_.nodataReplaceValue,
          maskNodata: this.config_.maskNodata,
          displayRenderParams: this.resolvedCache_.displayRenderParams, // Display render parameters
          
          // Storage paths
          storeUrl: this.url_,
          storePath: this._getArrayPath(z, this.arrayNames_.value),
          
          // Simple flags
          verbose: this.verbose_
        };
        
        this._log('Sending resolved message to worker with render configuration:', {
          ...message,
          tileData: '[ArrayBuffer data would be here]' // Don't log large data
        });
        
        worker.postMessage(message);
        
      } catch (error) {
        // If worker acquisition failed, still need to handle cleanup
        if (worker) {
          ZarrTile._returnWorker(worker);
        }
        this._log('Failed to acquire worker for tile', z, x, y, ':', error.message);
        reject(error);
      }
    });
  }
  
  // ===== UTILITY METHODS =====
  
  /**
   * Check if zoom level is supported
   */
  isZoomSupported(z) {
    return this.config_.zoomLevels.includes(z);
  }
  
  /**
   * Get array path for zoom level and array name
   * @private
   */
  _getArrayPath(z, arrayName) {
    return `${this.path_}/${z}/${arrayName}`.replace(/\/+/g, '/');
  }
  
  /**
   * Normalize URL by removing trailing slashes
   * @private
   */
  static _normalizeUrl(url) {
    return url.replace(/\/+$/, '');
  }
  
  /**
   * Check if two arrays are equal
   * @private
   */
  _arraysEqual(a, b) {
    return Array.isArray(a) && Array.isArray(b) && 
           a.length === b.length && a.every((val, i) => val === b[i]);
  }
  
  /**
   * Log helper with verbose control
   * @private
   */
  _log(...args) {
    if (this.verbose_) {
      console.log('[ZarrTile]', ...args);
    }
  }
  
  // ===== PUBLIC API METHODS =====
  
  /**
   * Get all timestamps
   */
  getTimestamps() {
    return [...this.timestamps_];
  }
  
  /**
   * Get current time index
   */
  getCurrentTimeIndex() {
    return this.currentTimeIndex_;
  }
  
  /**
   * Set current time index with validation
   */
  setCurrentTimeIndex(index) {
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      throw new Error('Time index must be an integer');
    }
    
    const clampedIndex = Math.max(0, Math.min(index, this.timestamps_.length - 1));
    if (clampedIndex !== this.currentTimeIndex_) {
      this.currentTimeIndex_ = clampedIndex;
      if (this.timestamps_.length > 0) {
        this.set('time', this.timestamps_[clampedIndex]);
      }
      this._invalidateCache('Time index changed');
    }
  }
  
  /**
   * Get current time value
   */
  getCurrentTime() {
    return this.timestamps_[this.currentTimeIndex_] || null;
  }
  
  /**
   * Set current time by finding closest timestamp
   */
  setCurrentTime(timeValue) {
    if (!timeValue) return;
    
    let bestIndex = 0;
    let bestDiff = Infinity;
    
    for (let i = 0; i < this.timestamps_.length; i++) {
      const timestamp = this.timestamps_[i];
      
      let diff;
      if (timestamp instanceof Date && timeValue instanceof Date) {
        diff = Math.abs(timestamp.getTime() - timeValue.getTime());
      } else if (typeof timestamp === 'number' && typeof timeValue === 'number') {
        diff = Math.abs(timestamp - timeValue);
      } else if (typeof timestamp === 'string' && typeof timeValue === 'string') {
        diff = timestamp === timeValue ? 0 : Infinity;
      } else {
        continue; // Type mismatch
      }
      
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }
    
    this.setCurrentTimeIndex(bestIndex);
  }
  
  /**
   * Get current bands
   */
  getBands() {
    return [...this.bands_];
  }
  
  /**
   * Set current bands with validation
   */
  setBands(bands) {
    const totalBands = this.config_.valueArrayMetadata?.shape?.[1] || null;
    const validatedBands = ZarrTileValidator.validateBands(bands, totalBands, 'setBands call');
    
    if (!this._arraysEqual(validatedBands, this.bands_)) {
      this.bands_ = validatedBands;
      this.set('bands', [...this.bands_]);
      this._invalidateCache('Bands changed');
    }
  }
  
  /**
   * Get current resolved NODATA values
   */
  getCurrentNodata() {
    this._updateResolvedCache();
    return this.resolvedCache_.nodata ? [...this.resolvedCache_.nodata] : null;
  }
  
  /**
   * Get current resolved statistics
   */
  getCurrentStatistics() {
    this._updateResolvedCache();
    return this.resolvedCache_.statistics ? [...this.resolvedCache_.statistics] : null;
  }
  
  /**
   * Get current resolved normalization with strategy support
   */
  getCurrentNormalization() {
    this._updateResolvedCache();
    return this.resolvedCache_.normalization ? [...this.resolvedCache_.normalization] : null;
  }
  
  /**
   * Get render configuration
   */
  getRenderConfiguration() {
    return {
      renderType: this.config_.renderType,
      nodataStrategy: this.config_.nodataStrategy,
      nodataReplaceValue: this.config_.nodataReplaceValue,
      maskNodata: this.config_.maskNodata,
      normalizationStrategy: this.config_.normalize?.strategy || null,
      drc: this.config_.drc ? { ...this.config_.drc } : null
    };
  }

  /**
   * Get current resolved display render parameters
   */
  getCurrentDisplayRenderParams() {
    if (this.config_.renderType !== RENDER_TYPES.DISPLAY) {
      return null;
    }
    
    this._updateResolvedCache();
    return this.resolvedCache_.displayRenderParams ? 
      JSON.parse(JSON.stringify(this.resolvedCache_.displayRenderParams)) : null;
  }
  
  /**
   * Get complete immutable configuration
   */
  getConfiguration() {
    return this.config_; // Already frozen
  }
  
  /**
   * Get array paths for current configuration
   */
  getArrayPaths() {
    return { ...this.arrayNames_ };
  }
  
  /**
   * Get supported zoom levels
   */
  getSupportedZoomLevels() {
    return [...this.config_.zoomLevels];
  }
  
  /**
   * Get resolutions
   */
  getResolutions() {
    return [...this.config_.resolutions];
  }
  
  /**
   * Get extent
   */
  getExtent() {
    return [...this.config_.extent];
  }
  
  /**
   * Get CRS
   */
  getCRS() {
    return this.config_.crs;
  }
  
  /**
   * Check if verbose logging is enabled
   */
  isVerbose() {
    return this.verbose_;
  }
  
  /**
   * Move to the next timestep (caps at last timestep if at boundary)
   * @return {boolean} True if index changed, false if already at last timestep
   */
  nextTimestep() {
    if (this.currentTimeIndex_ < this.timestamps_.length - 1) {
      this.setCurrentTimeIndex(this.currentTimeIndex_ + 1);
      return true;
    }
    return false; // Already at last timestep
  }

  /**
   * Move to the previous timestep (caps at first timestep if at boundary)
   * @return {boolean} True if index changed, false if already at first timestep
   */
  previousTimestep() {
    if (this.currentTimeIndex_ > 0) {
      this.setCurrentTimeIndex(this.currentTimeIndex_ - 1);
      return true;
    }
    return false; // Already at first timestep
  }

  /**
   * Move forward by n timesteps (caps at last timestep if would exceed)
   * @param {number} n Number of timesteps to move forward
   * @return {boolean} True if index changed, false if already at target position
   */
  nextTimesteps(n) {
    if (typeof n !== 'number' || !Number.isInteger(n)) {
      throw new Error('Number of timesteps must be an integer');
    }
    
    if (n < 0) {
      throw new Error('Number of timesteps must be non-negative. Use previousTimesteps() for backward movement.');
    }
    
    if (n === 0) {
      return false; // No movement requested
    }
    
    const targetIndex = Math.min(this.currentTimeIndex_ + n, this.timestamps_.length - 1);
    
    if (targetIndex !== this.currentTimeIndex_) {
      this.setCurrentTimeIndex(targetIndex);
      return true;
    }
    
    return false; // Already at target position
  }

  /**
   * Move backward by n timesteps (caps at first timestep if would exceed)
   * @param {number} n Number of timesteps to move backward
   * @return {boolean} True if index changed, false if already at target position
   */
  previousTimesteps(n) {
    if (typeof n !== 'number' || !Number.isInteger(n)) {
      throw new Error('Number of timesteps must be an integer');
    }
    
    if (n < 0) {
      throw new Error('Number of timesteps must be non-negative. Use nextTimesteps() for forward movement.');
    }
    
    if (n === 0) {
      return false; // No movement requested
    }
    
    const targetIndex = Math.max(this.currentTimeIndex_ - n, 0);
    
    if (targetIndex !== this.currentTimeIndex_) {
      this.setCurrentTimeIndex(targetIndex);
      return true;
    }
    
    return false; // Already at target position
  }

  /**
   * Get cache status with render configuration
   */
  getCacheStatus() {
    return {
      valid: this.resolvedCache_.valid,
      timeIndex: this.resolvedCache_.timeIndex,
      bands: this.resolvedCache_.bands ? [...this.resolvedCache_.bands] : null,
      hasNodata: this.resolvedCache_.nodata !== null,
      hasStatistics: this.resolvedCache_.statistics !== null,
      hasNormalization: this.resolvedCache_.normalization !== null,
      hasDisplayRenderParams: this.resolvedCache_.displayRenderParams !== null,
      renderConfiguration: this.getRenderConfiguration()
    };
  }
}