import { useEffect, useState } from "react";
import { useBranding } from "../branding/BrandingContext";

export type BannerImage = { id?: number; image: string; title?: string; description?: string };

/** LoginConfig[0].bannerImages — the switch between the two login layouts. */
export function bannerImagesOf(loginConfig: unknown): BannerImage[] | undefined {
    if (typeof loginConfig !== "object" || loginConfig === null) return undefined;
    const raw = (loginConfig as { bannerImages?: unknown }).bannerImages;
    if (!Array.isArray(raw)) return undefined;
    const images = raw.filter(
        (item): item is BannerImage =>
            typeof item === "object" && item !== null && typeof (item as BannerImage).image === "string"
    );
    return images.length > 0 ? [...images].sort((x, y) => (x.id ?? 0) - (y.id ?? 0)) : undefined;
}

/** pages/employee/Login/Carousel/Carousel.js: rotates every five seconds. */
export function Carousel(props: { images: BannerImage[] }) {
    const { i18n } = useBranding();
    const { images } = props;
    const [current, setCurrent] = useState(0);

    useEffect(() => {
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const interval = setInterval(() => setCurrent(prev => (prev === images.length - 1 ? 0 : prev + 1)), 5000);
        return () => clearInterval(interval);
    }, [images.length]);

    return (
        <div className="dg-carousel">
            {images.map((item, index) => (
                <div
                    key={item.id ?? index}
                    className={`dg-carousel__slide${index === current ? " is-active" : ""}`}
                    style={{ backgroundImage: `url(${JSON.stringify(item.image)})` }}
                    aria-hidden={index !== current}
                >
                    <div className="dg-carousel__content">
                        {item.title && <h2>{i18n.tr(item.title, item.title)}</h2>}
                        {item.description && <p>{i18n.tr(item.description, item.description)}</p>}
                    </div>
                </div>
            ))}
            {images.length > 1 && (
                <div className="dg-carousel__controls">
                    <button
                        type="button"
                        className="dg-carousel__nav"
                        aria-label="Previous"
                        onClick={() => setCurrent(prev => (prev === 0 ? images.length - 1 : prev - 1))}
                    >
                        &lt;
                    </button>
                    <div className="dg-carousel__dots">
                        {images.map((_, index) => (
                            <button
                                key={index}
                                type="button"
                                aria-label={`Slide ${index + 1}`}
                                className={`dg-carousel__dot${index === current ? " is-active" : ""}`}
                                onClick={() => setCurrent(index)}
                            />
                        ))}
                    </div>
                    <button
                        type="button"
                        className="dg-carousel__nav"
                        aria-label="Next"
                        onClick={() => setCurrent(prev => (prev === images.length - 1 ? 0 : prev + 1))}
                    >
                        &gt;
                    </button>
                </div>
            )}
        </div>
    );
}
