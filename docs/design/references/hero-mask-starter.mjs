// Starting adapter for Grade, based on the official GSAP SplitText API:
// https://gsap.com/docs/v3/Plugins/SplitText/
// Not connected to the application; requires visual integration and verification.
// Export SplitText from client/motion-vendor.js and rebuild the existing bundle.
// Use the installed GSAP package under its license; no external CDN is needed.

export function mountHeroMask(root, { gsap, SplitText }) {
  const heading = root.querySelector('h1');
  if (!heading) return () => {};

  gsap.registerPlugin(SplitText);
  const media = gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)', () => {
    const split = SplitText.create(heading, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,
      onSplit(parts) {
        const frames = root.querySelectorAll('[data-hero-media]');
        const reveal = gsap.timeline();
        reveal.fromTo(parts.lines,
          { yPercent: 105 },
          { yPercent: 0, duration: 0.95, stagger: 0.07, ease: 'power3.inOut' }, 0);
        if (frames.length) reveal.fromTo(frames,
          { clipPath: 'inset(100% 0 0 0 round 14px)' },
          { clipPath: 'inset(0% 0 0 0 round 14px)', duration: 0.85,
            stagger: 0.06, ease: 'power3.inOut' }, 0.12);
        return reveal;
      },
    });
    return () => split.revert();
  }, root);

  return () => media.revert();
}
