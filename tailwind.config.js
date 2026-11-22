/** @type {import('tailwindcss').Config} */
// Without this file (and postcss.config.js) Vite never ran Tailwind, so the
// built app shipped with none of its utility classes: no w-full on the
// canvases, no max width, no hidden screens. Full-size 1024 px previews then
// pushed the page wider than the phone, which is why it needed zooming.
export default {
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      screens: {
        // A phone held sideways: wide but short. Tablets and desktops in
        // landscape are taller than this and keep the single column.
        'phone-land': { raw: '(orientation: landscape) and (max-height: 540px)' },
      },
    },
  },
  plugins: [],
};
