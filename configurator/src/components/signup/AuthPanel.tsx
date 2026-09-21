import { useEffect, useState } from 'react';

/**
 * Backdrop layers, taken from the reference implementation rather than
 * approximated. A single flat scrim was what made ours read washed out next to
 * it: the reference stacks a gradient base, the photograph, three overlays with
 * different directions, and a very slow drifting glow.
 *
 * The fallback gradient's first stop is `#0B1F3A`, which is also Bomet's own
 * `--color-secondary`, so the brand colour showing through when the photograph
 * fails is already the right one.
 */
const OVERLAY_BASE = 'rgba(10, 16, 28, 0.22)';
const OVERLAY_DIRECTIONAL =
  'linear-gradient(90deg, rgba(10,16,28,0.46) 0%, rgba(10,16,28,0.24) 35%, rgba(10,16,28,0.10) 70%, rgba(10,16,28,0.06) 100%)';
const OVERLAY_VERTICAL =
  'linear-gradient(180deg, rgba(10,16,28,0.06) 0%, rgba(10,16,28,0.06) 55%, rgba(8,12,24,0.48) 100%)';
const GRADIENT_FALLBACK =
  'radial-gradient(120% 90% at 15% 10%, rgba(45,79,196,0.55) 0%, rgba(45,79,196,0) 60%),' +
  'radial-gradient(100% 80% at 85% 90%, rgba(53,91,224,0.45) 0%, rgba(53,91,224,0) 55%),' +
  'linear-gradient(160deg, #0B1F3A 0%, #10275A 45%, #1B3A8A 100%)';

/**
 * The strap-lines rotate. Three of them, fading out at 5.2s and advancing at
 * 6s, which is the reference's own timing — slow enough to read, and the gap
 * between fade and advance is what stops the swap being abrupt.
 *
 * `aria-live="polite"` because the text changes without the reader asking, and
 * the fixed `minHeight` stops the footer below it jumping on every swap.
 */
const AUTH_ROTATING: { title: string; quote: string }[] = [
  {
    title: 'Governance that learns',
    quote:
      'Connecting citizen voices to responsive institutions and efficient services through an experience that feels natural.',
  },
  {
    title: 'Service you can track',
    quote:
      'Every complaint carries a clear owner, a service timeline, and a record of what was done - visible end to end.',
  },
  {
    title: 'Trust, built daily',
    quote:
      'Turning everyday civic signals into faster resolution and steady confidence in public institutions.',
  },
];

export function RotatingNarrative() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const fadeOut = window.setTimeout(() => setVisible(false), 5200);
    const advance = window.setTimeout(() => {
      setIndex((i) => (i + 1) % AUTH_ROTATING.length);
      setVisible(true);
    }, 6000);
    return () => {
      window.clearTimeout(fadeOut);
      window.clearTimeout(advance);
    };
  }, [index]);

  const item = AUTH_ROTATING[index]!;
  return (
    <div
      aria-live="polite"
      className="mt-8 max-w-md"
      style={{
        // Fixed height so the footer below does not jump on every swap.
        minHeight: 96,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity 800ms ease, transform 800ms ease',
      }}
    >
      <p className="text-sm font-semibold">{item.title}</p>
      <p className="mt-2 text-sm italic leading-relaxed text-white/75">“{item.quote}”</p>
    </div>
  );
}

export function AuthBackdrop() {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0" style={{ background: GRADIENT_FALLBACK }} />
      {!imageFailed && (
        <img
          src="/configurator/brand/signup-crowd.jpg"
          alt=""
          onError={() => setImageFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0" style={{ background: OVERLAY_BASE }} />
      <div className="absolute inset-0" style={{ background: OVERLAY_DIRECTIONAL }} />
      <div className="absolute inset-0" style={{ background: OVERLAY_VERTICAL }} />
      {/* Very slow, very faint drift so a still frame does not read as dead. */}
      <div
        className="signup-backdrop-drift absolute"
        style={{
          inset: '-25%',
          background:
            'radial-gradient(45% 45% at 30% 35%, rgba(53,91,224,0.08) 0%, rgba(53,91,224,0) 70%),' +
            'radial-gradient(40% 40% at 70% 70%, rgba(94,140,255,0.06) 0%, rgba(94,140,255,0) 70%)',
        }}
      />
      <style>{`
        @keyframes signupBackdropDrift {
          0%   { transform: translate3d(0,0,0) scale(1); }
          50%  { transform: translate3d(2.5%, -2%, 0) scale(1.05); }
          100% { transform: translate3d(0,0,0) scale(1); }
        }
        .signup-backdrop-drift { animation: signupBackdropDrift 46s ease-in-out infinite; will-change: transform; }
        @media (prefers-reduced-motion: reduce) { .signup-backdrop-drift { animation: none; } }
        .signup-brand-mark { top: 20px; left: 20px; }
        .signup-brand-logo { width: 140px; }
        @media (min-width: 768px) {
          .signup-brand-mark { top: 28px; left: 28px; }
          .signup-brand-logo { width: 160px; }
        }
        @media (min-width: 1024px) {
          .signup-brand-mark { top: 36px; left: 40px; }
          .signup-brand-logo { width: 180px; }
        }
      `}</style>
    </div>
  );
}
