import { viteStaticCopy } from "vite-plugin-static-copy";

// Torin-style local development and TouchDesigner packaging shape. Local
// browser libraries and model files are copied into _mpdist so a tox can embed
// them in TouchDesigner's Virtual File System.
export default {
  build: {
    outDir: "_mpdist",
    minify: false,
    rollupOptions: {
      treeshake: false,
    },
    emptyOutDir: true,
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "src/vendor/*",
          dest: "src/vendor",
        },
        {
          src: "src/faceapi/*",
          dest: "src/faceapi",
        },
        {
          src: "src/ml5-local-models/*",
          dest: "src/ml5-local-models",
        },
      ],
    }),
  ],
};
