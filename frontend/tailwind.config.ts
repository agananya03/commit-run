import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // One accent, after reflect.app: indigo-black surfaces, near-white text, and violet only.
        // Status is told by brightness, words and icons, not by extra hues:
        // danger = vivid lavender, caution = dusty violet, verified = quiet grey-lavender.
        canvas: "#09081A",
        panel: "#100F22",
        raised: "#17162C",
        line: "#25233D",
        ink: "#EEECFB",
        muted: "#A4A1BF",
        faint: "#6F6C8C",
        evidence: "#A78BFA",
        ice: { DEFAULT: "#C4B5FD", light: "#EDE9FE" },
        night: { DEFAULT: "#0C0B1D", soft: "#17162C" },
        indigo: { DEFAULT: "#8B5CF6", soft: "#A78BFA" },
        caution: "#8E7FC4",
        danger: "#B392FF",
        verified: "#7E7A9E",
      },
      fontFamily: {
        // Same stacks as the intro: the root Inter for prose, the system mono for labels and numbers.
        forensic: ["inherit"],
        code: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      keyframes: {
        "border-beam": { "100%": { "offset-distance": "100%" } },
        "strip-in": { from: { opacity: "0", transform: "translateY(-4px)" }, to: { opacity: "1", transform: "none" } },
        drift: {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(4%, 3%, 0) scale(1.08)" },
        },
        bob: {
          "0%, 100%": { transform: "translateY(0)", opacity: "0.55" },
          "50%": { transform: "translateY(6px)", opacity: "1" },
        },
      },
      animation: {
        "border-beam": "border-beam 7s linear infinite",
        "strip-in": "strip-in 220ms ease-out",
        drift: "drift 18s ease-in-out infinite",
        "drift-slow": "drift 26s ease-in-out infinite reverse",
        bob: "bob 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
