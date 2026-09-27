import type { Config } from "tailwindcss";

/**
 * Colours are CSS variables so the whole palette flips between the light and
 * dark themes without any class-level branching. The roles are defined in
 * src/app/globals.css.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--sf)",
        elevated: "var(--el)",
        line: "var(--ln)",
        "line-strong": "var(--ln-strong)",
        text: "var(--tx)",
        muted: "var(--mu)",
        action: "var(--action)",
        "action-fg": "var(--action-fg)",
        accent: "var(--ac)",
        focus: "var(--focus)",
        "accent-soft": "var(--acs)",
        "accent-text": "var(--act)",
        "accent-line": "var(--acl)",
        success: "var(--ok)",
        "success-soft": "var(--ok-bg)",
        "success-text": "var(--ok-fg)",
        warning: "var(--warn)",
        "warning-soft": "var(--warn-bg)",
        "warning-text": "var(--warn-fg)",
        info: "var(--info)",
        "info-soft": "var(--info-bg)",
        "info-text": "var(--info-fg)",
        danger: "var(--err)",
        "danger-soft": "var(--errbg)",
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "Helvetica Neue", "sans-serif"],
        display: ["var(--font-jost)", "var(--font-dm-sans)", "Helvetica Neue", "sans-serif"],
        accent: ["var(--font-playfair)", "Georgia", "serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "10px",
      },
      // Type roles. Sizes are rem so they follow the user's browser font setting.
      // label and meta are mono; small, ui and body are sans; title and heading are
      // semibold sans; figure is a numeral; page and hero are serif titles, console and
      // subject are sans semibold titles for working screens.
      fontSize: {
        label: ["0.65625rem", { lineHeight: "1.4" }], // 10.5px: eyebrows, chip text
        meta: ["0.71875rem", { lineHeight: "1.4" }], // 11.5px: metadata, timestamps
        small: ["0.78125rem", { lineHeight: "1.45" }], // 12.5px: helper text, errors, table cells
        ui: ["0.84375rem", { lineHeight: "1.4" }], // 13.5px: controls, labels, dense rows
        body: ["0.9375rem", { lineHeight: "1.5" }], // 15px: descriptions, card copy
        prose: ["1rem", { lineHeight: "1.7" }], // 16px: long-form reading
        title: ["1.0625rem", { lineHeight: "1.3" }], // 17px: section and card titles
        heading: ["1.3125rem", { lineHeight: "1.2" }], // 21px: major headings
        figure: ["1.5rem", { lineHeight: "1.15" }], // 24px: statistics and scores
        subject: ["clamp(1.3125rem, 2.2vw, 1.625rem)", { lineHeight: "1.15" }], // a project's name in a console
        page: ["clamp(1.6rem, 3.2vw, 2.25rem)", { lineHeight: "1.08" }], // serif page titles (editorial screens)
        console: ["clamp(1.45rem, 2.7vw, 1.9rem)", { lineHeight: "1.1" }], // sans semibold titles (working screens)
        hero: ["clamp(1.9rem, 3.8vw, 2.9rem)", { lineHeight: "1.06" }], // event and result titles
        landing: ["clamp(2rem, 4vw, 3.4rem)", { lineHeight: "1.06" }], // the public landing headline
      },
      letterSpacing: {
        head: "-0.02em", // headings and card titles
        display: "-0.03em", // serif titles and large numerals
        stamp: "0.06em", // chips and short mono tags
        label: "0.13em", // uppercase mono eyebrows
      },
    },
  },
  plugins: [],
};

export default config;
