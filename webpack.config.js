const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = [
  // ES Modules build
  {
    name: 'esm',
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'index.esm.js',
      library: {
        type: 'module'
      },
      environment: {
        module: true
      }
    },
    experiments: {
      outputModule: true
    },
    externals: {
      'ol': 'ol',
      'ol/source/DataTile': 'ol/source/DataTile',
      'ol/tilegrid/TileGrid': 'ol/tilegrid/TileGrid',
      'ol/color': 'ol/color',
      'zarr': 'zarr'
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    mode: 'production'
  },

  // UMD build for CDN
  {
    name: 'umd',
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'index.umd.js',
      library: {
        name: 'ZarrOpenLayers',
        type: 'umd',
        export: 'default'
      },
      globalObject: 'this'
    },
    externals: {
      'ol': {
        root: 'ol',
        commonjs: 'ol',
        commonjs2: 'ol',
        amd: 'ol'
      },
      'ol/source/DataTile': {
        root: ['ol', 'source', 'DataTile'],
        commonjs: 'ol/source/DataTile',
        commonjs2: 'ol/source/DataTile',
        amd: 'ol/source/DataTile'
      },
      'ol/tilegrid/TileGrid': {
        root: ['ol', 'tilegrid', 'TileGrid'],
        commonjs: 'ol/tilegrid/TileGrid',
        commonjs2: 'ol/tilegrid/TileGrid',
        amd: 'ol/tilegrid/TileGrid'
      },
      'ol/color': {
        root: ['ol', 'color'],
        commonjs: 'ol/color',
        commonjs2: 'ol/color',
        amd: 'ol/color'
      },
      'zarr': {
        root: 'zarr',
        commonjs: 'zarr',
        commonjs2: 'zarr',
        amd: 'zarr'
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    mode: 'production'
  },

  // CommonJS build
  {
    name: 'cjs',
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'index.cjs.js',
      library: {
        type: 'commonjs2'
      }
    },
    externals: {
      'ol': 'ol',
      'ol/source/DataTile': 'ol/source/DataTile',
      'ol/tilegrid/TileGrid': 'ol/tilegrid/TileGrid',
      'ol/color': 'ol/color',
      'zarr': 'zarr'
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    target: 'node',
    mode: 'production'
  },

  // Worker build
  {
    name: 'worker',
    entry: './src/zarr-worker.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'zarr-worker.js'
    },
    target: 'webworker',
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    mode: 'production'
  }
];