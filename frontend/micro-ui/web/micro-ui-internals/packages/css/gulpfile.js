const fs = require("fs");
const { name, version, author, cssConfig } = JSON.parse(fs.readFileSync("package.json"));

const headerString = `
@charset "UTF-8";
/*!
 * ${name} - ${version}
 *
 * Copyright (c) ${new Date().getFullYear()} ${author}
 * 
 */
  `;
const { series, src, dest, watch, task } = require("gulp");
const header = require("postcss-header");

const clean = require("gulp-clean");
const postcss = require("gulp-postcss");
// gulp-sass 5+ takes the compiler as an argument and no longer bundles node-sass.
// node-sass 4.x ships no prebuilt binary past node 14 and falls back to a
// node-gyp/python2 source build, so it cannot install on a modern node; dart-sass
// (the `sass` package) is pure JS and produces equivalent output here.
const sass = require('gulp-sass')(require('sass'));

const postcssPresetEnv = require("postcss-preset-env");
const cleanCSS = require("gulp-clean-css");
const rename = require("gulp-rename");
const livereload = require("gulp-livereload");

let output = "./example";
if (process.env.NODE_ENV === "production") {
  output = "./dist";
}

function cleanStyles() {
  return src(`${output}/*.css`, { read: false }).pipe(clean());
}

function styles() {
  const plugins = [
    require("postcss-import"),
    require("tailwindcss"),
    postcssPresetEnv({ stage: 2, autoprefixer: { cascade: false }, features: { "custom-properties": true } }),
    require("autoprefixer"),
    require("cssnano"),
    header({ header: headerString }),
  ];
  return src("src/index.scss").pipe(postcss(plugins)).pipe(sass()).pipe(dest(output));
}

function minify() {
  return src(`${output}/index.css`).pipe(cleanCSS()).pipe(rename(`index.min.css`)).pipe(dest(output));
}

function stylesLive() {
  styles().pipe(livereload({ start: true }));
}

function livereloadStyles() {
  livereload.listen();
  watch("src/**/*.scss", series(stylesLive));
}

exports.styles = styles;
exports.default = series(styles);
exports.watch = livereloadStyles;
if (process.env.NODE_ENV === "production") {
  exports.build = series(cleanStyles, styles, minify);
} else {
  exports.build = series(styles, livereloadStyles);
}

// gulp.task("watch:styles", function () {
//   livereload.listen();
//   gulp.watch("**/*.scss", ["styles"]);
// });
