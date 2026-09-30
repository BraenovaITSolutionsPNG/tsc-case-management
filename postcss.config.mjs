// Tailwind v4 ships as a PostCSS plugin. The Vite build ran it through
// @tailwindcss/vite; Next has no Vite, so it goes through PostCSS instead.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
