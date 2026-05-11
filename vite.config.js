import { viteStaticCopy } from "vite-plugin-static-copy";

// Torin's MediaPipe project uses this Vite shape for local development and
// TouchDesigner packaging. Local browser libraries and model files are copied
// into _mpdist so a tox can embed them in TouchDesigner's Virtual File System.
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
      ],
    }),
  ],
};
