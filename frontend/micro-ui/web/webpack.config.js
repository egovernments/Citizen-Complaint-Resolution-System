const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports = {
  // mode: 'development',
  entry: "./src/index.js",
  devtool: "none",
  module: {
    rules: [
      {
        test: /\.js$/,
        include: /node_modules\/axios\//,
        use: {
          loader: "babel-loader",
          options: {
            presets: [["@babel/preset-env", { targets: { ie: 11 } }]]
          }
        }
      },
      {
        // Match .jsx too: the src/dashboard/* feature is authored in .jsx,
        // which this rule (preset-react) must transpile — a bare /\.js$/
        // silently skips them and webpack fails on the JSX syntax.
        test: /\.(jsx?)$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env", "@babel/preset-react"],
            plugins: ["@babel/plugin-proposal-optional-chaining"]
          }
        }
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(png|jpe?g|gif)$/i,
        use: [
          {
            loader: 'file-loader',
          },
        ],
      },
    ],
  },
  resolve: {
    // Without this, extensionless imports like `./dashboard/AdminDashboard`
    // only resolve .js — webpack's defaults don't include .jsx — so the
    // .jsx dashboard modules fail to resolve.
    extensions: [".js", ".jsx", ".json"],
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
