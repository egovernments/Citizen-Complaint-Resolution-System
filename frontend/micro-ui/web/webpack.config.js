const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports = {
  // mode: 'development',
  entry: "./src/index.js",
  devtool: "none",
  resolve: {
    alias: {
      // Build core module from local source instead of npm package to pick up
      // UnifiedLogin, routing fixes, and auth adapter integration
      "@egovernments/digit-ui-module-core": path.resolve(__dirname, "micro-ui-internals/packages/modules/core/src/Module.js"),
      // Ensure single React instance across all packages (prevents React #321)
      "react": path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
  },
  module: {
    rules: [
      {
        test: /\.(js)$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env", "@babel/preset-react"],
            plugins: ["@babel/plugin-proposal-optional-chaining", "@babel/plugin-proposal-class-properties"]
          }
        }
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/i,
        use: [
          {
            loader: 'file-loader',
          },
        ],
      },
    ],
  },
  resolve: {
    modules: [
      "node_modules",
      path.resolve(__dirname, "micro-ui-internals/node_modules"),
    ],
    alias: {
      // Resolve workspace packages from local source (skip build:libraries)
      "@egovernments/digit-ui-libraries": path.resolve(
        __dirname,
        "micro-ui-internals/packages/libraries/src/index.js"
      ),
      "@egovernments/digit-ui-module-core": path.resolve(
        __dirname,
        "micro-ui-internals/packages/modules/core/src/Module.js"
      ),
      "@egovernments/digit-ui-module-pgr": path.resolve(
        __dirname,
        "micro-ui-internals/packages/modules/pgr/src/Module.js"
      ),
      // Force single React instance to prevent "Invalid hook call" errors
      // when the core module alias resolves from a different path
      "react": path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react-router-dom": path.resolve(__dirname, "node_modules/react-router-dom"),
      "react-redux": path.resolve(__dirname, "node_modules/react-redux"),
      "react-query": path.resolve(__dirname, "node_modules/react-query"),
    },
  },
  output: {
    filename: "[name].bundle.js",
    path: path.resolve(__dirname, "build"),
    publicPath: "/digit-ui/",
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      minSize:20000,
      maxSize:50000,
      enforceSizeThreshold:50000,
      minChunks:1,
      maxAsyncRequests:30,
      maxInitialRequests:30
    },
  },
  plugins: [
    new CleanWebpackPlugin(),
    // new BundleAnalyzerPlugin(),
    new HtmlWebpackPlugin({ inject: true, template: "public/index.html" }),
  ],
};