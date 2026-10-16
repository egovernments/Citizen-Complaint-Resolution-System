import { useEffect, useState } from "react";
import type { Brand } from "../brand";

/**
 * Backdrop and rotating strap-lines, ported from
 * configurator/src/components/signup/AuthPanel.tsx. The layer stack, the
 * timings and the reduced-motion behaviour are the reference's; only the
 * styling mechanism changed (Tailwind utilities became `digit-brand__*`).
 */
const OVERLAY_BASE = "rgba(10, 16, 28, 0.22)";
const OVERLAY_DIRECTIONAL =
    "linear-gradient(90deg, rgba(10,16,28,0.46) 0%, rgba(10,16,28,0.24) 35%, rgba(10,16,28,0.10) 70%, rgba(10,16,28,0.06) 100%)";
const OVERLAY_VERTICAL =
    "linear-gradient(180deg, rgba(10,16,28,0.06) 0%, rgba(10,16,28,0.06) 55%, rgba(8,12,24,0.48) 100%)";
const GRADIENT_FALLBACK =
    "radial-gradient(120% 90% at 15% 10%, rgba(45,79,196,0.55) 0%, rgba(45,79,196,0) 60%)," +
    "radial-gradient(100% 80% at 85% 90%, rgba(53,91,224,0.45) 0%, rgba(53,91,224,0) 55%)," +
    "linear-gradient(160deg, #0B1F3A 0%, #10275A 45%, #1B3A8A 100%)";
const DRIFT =
    "radial-gradient(45% 45% at 30% 35%, rgba(53,91,224,0.08) 0%, rgba(53,91,224,0) 70%)," +
    "radial-gradient(40% 40% at 70% 70%, rgba(94,140,255,0.06) 0%, rgba(94,140,255,0) 70%)";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const AUTH_ROTATING: { title: string; quote: string }[] = [
    {
        title: "Governance that learns",
        quote: "Connecting citizen voices to responsive institutions and efficient services through an experience that feels natural."
    },
    {
        title: "Service you can track",
        quote: "Every complaint carries a clear owner, a service timeline, and a record of what was done - visible end to end."
    },
    {
        title: "Trust, built daily",
        quote: "Turning everyday civic signals into faster resolution and steady confidence in public institutions."
    }
];

function usePrefersReducedMotion() {
    const [reduced, setReduced] = useState(
        () => window.matchMedia?.(REDUCED_MOTION).matches ?? false
    );
    useEffect(() => {
        const query = window.matchMedia?.(REDUCED_MOTION);
        if (!query) {
            return;
        }
        const onChange = () => setReduced(query.matches);
        query.addEventListener("change", onChange);
        return () => query.removeEventListener("change", onChange);
    }, []);
    return reduced;
}

export function RotatingNarrative() {
    const [index, setIndex] = useState(0);
    const [visible, setVisible] = useState(true);
    const reduced = usePrefersReducedMotion();

    useEffect(() => {
        if (reduced) {
            return;
        }
        const fadeOut = window.setTimeout(() => setVisible(false), 5200);
        const advance = window.setTimeout(() => {
            setIndex(i => (i + 1) % AUTH_ROTATING.length);
            setVisible(true);
        }, 6000);
        return () => {
            window.clearTimeout(fadeOut);
            window.clearTimeout(advance);
        };
    }, [index, reduced]);

    const item = AUTH_ROTATING[reduced ? 0 : index]!;
    return (
        <div
            aria-hidden="true"
            className="digit-brand__rotator"
            data-visible={reduced || visible ? "true" : "false"}
        >
            <p className="digit-brand__rotator-title">{item.title}</p>
            <p className="digit-brand__rotator-quote">{`“${item.quote}”`}</p>
        </div>
    );
}

export function AuthBackdrop(props: { brand: Brand }) {
    const [photoFailed, setPhotoFailed] = useState(false);
    return (
        <div aria-hidden="true" className="digit-brand__layer">
            <div className="digit-brand__scrim" style={{ background: GRADIENT_FALLBACK }} />
            {!photoFailed && (
                <img
                    src={props.brand.photoUrl}
                    alt=""
                    width={1440}
                    height={1800}
                    onError={() => setPhotoFailed(true)}
                    className="digit-brand__photo"
                />
            )}
            <div className="digit-brand__scrim" style={{ background: OVERLAY_BASE }} />
            <div className="digit-brand__scrim" style={{ background: OVERLAY_DIRECTIONAL }} />
            <div className="digit-brand__scrim" style={{ background: OVERLAY_VERTICAL }} />
            <div className="digit-brand__drift" style={{ background: DRIFT }} />
        </div>
    );
}
