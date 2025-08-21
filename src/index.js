// src/index.js
import ZarrTile from './ZarrTile.js';

// Export for different module systems
export default ZarrTile;
export { ZarrTile };

// For UMD builds
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZarrTile;
  module.exports.ZarrTile = ZarrTile;
  module.exports.default = ZarrTile;
}