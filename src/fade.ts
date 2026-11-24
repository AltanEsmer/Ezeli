// How long a layer (the menu, the full-screen photo) fades out before it goes: the `--fade` token of
// tokens.css, and nothing at all when the device is set to less motion.
export const fadeMs = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fade')))
