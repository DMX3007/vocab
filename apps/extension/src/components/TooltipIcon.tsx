import { useState } from "react";

type TooltipIconProps = {
    onClick?: () => void;
}

export default function TooltipIcon({ onClick }: TooltipIconProps) {

    const [hover, setHover] = useState(false);
    return (
        <span
            className={`vf-seltrigger ${hover ? "exp" : ""}`}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        // onClick={onClick}
        >
            <button
                className="vfst-mark"
                title="Add to dictionary"
                ref={(el) => el?.addEventListener('click', () => {
                    onClick?.();
                    console.log('[vf] NATIVE click on button')

                })}
            >
                <span className="vfst-glyph" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="15" height="15">
                        <path d="M5 5 L12 18 L19 5" fill="none" stroke="currentColor"
                            strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="19" cy="5" r="2.6" fill="var(--gold)" stroke="none" />
                    </svg>
                </span>
            </button>
            <span className="vfst-body">
                <span className="vfst-inner">
                    <span className="vfst-label">Add to dictionary</span>
                    <kbd className="vfst-kbd">⌘E</kbd>
                </span>
            </span>
        </span>
    )

}
