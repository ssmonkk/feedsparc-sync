import esbuild from "esbuild";
import process from "node:process";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "browser",
  target: "es2020",
  // Obsidian injects its own module at runtime; bundling it would break the API.
  external: ["obsidian", "electron"],
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  treeShaking: true,
  minify: !watch,
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
