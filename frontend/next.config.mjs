/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The fact-checker runs DeBERTa NLI on the server with transformers.js; its ONNX runtime is a native
    // module, so Node loads these at runtime instead of webpack bundling them.
    serverComponentsExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
  },
};

export default nextConfig;
