// Tailwind CSS の設定。バージョンは 3.4.17 に固定（以前使っていた Play CDN と同じ見た目を保つため）。
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {}
  },
  plugins: []
};
