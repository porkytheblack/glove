import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/silero-vad.ts"],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
  external: [
    "glove-voice",
    "eventemitter3",
    "react-native",
    "react-native-audio-api",
    "onnxruntime-react-native",
    "expo-file-system",
    "expo-file-system/legacy",
  ],
});
