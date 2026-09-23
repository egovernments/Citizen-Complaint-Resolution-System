const path = require('path');
const webpack = require('webpack');
const ModuleScopePlugin = require('react-dev-utils/ModuleScopePlugin');

module.exports = function override(config, env) {
    // src/*.jsx imports the machine from ../../nodejs/src, which CRA blocks by default
    config.resolve.plugins = config.resolve.plugins.filter(plugin => !(plugin instanceof ModuleScopePlugin));

    // webpack 5 stopped auto-polyfilling node core modules. The machine reaches
    // fs/path/url only from server-side paths (image upload in egov-pgr), and os is
    // imported by env-variables but never used, so an empty module is enough there.
    // urlencode -> iconv-lite -> safer-buffer genuinely needs Buffer, so that one
    // gets a real polyfill.
    config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        os: false,
        path: false,
        url: false,
        buffer: require.resolve('buffer/'),
        process: require.resolve('process/browser.js')
    };

    // Server-only drivers that must never reach the browser bundle. kafka-node is
    // only constructed behind kafkaConsumerEnabled, so dropping it is safe; pg needs
    // a stub because postgres-config builds a Pool at import time.
    config.resolve.alias = {
        ...config.resolve.alias,
        'kafka-node': false,
        pg: path.resolve(__dirname, 'browser-shims/pg.js')
    };

    // CRA 5 runs source-map-loader across node_modules, and the Kendo packages ship
    // source maps pointing at .ts files they never published. 78 warnings of noise.
    config.ignoreWarnings = [...(config.ignoreWarnings || []), /Failed to parse source map/];

    // iconv-lite reaches for the Buffer/process globals, which webpack 5 no longer defines
    config.plugins.push(new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser.js'
    }));

    return config;
}
