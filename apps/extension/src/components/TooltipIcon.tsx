import { useState } from "react";
import { Icon } from "./icons";

type TooltipIconProps = {
    onClick?: () => void;
    onSkip?: () => void;
}

// Stage 1 of the selection flow: a small floating trigger appears next to
// the highlighted word. Clicking the mark opens the full add-to-dictionary
// card (Tooltip); clicking the skip control leaves a quiet "skipped" chip
// instead, per the approved two-stage design.
export default function TooltipIcon({ onClick, onSkip }: TooltipIconProps) {
    const [hover, setHover] = useState(false);
    return (
        <span
            className={`vf-seltrigger ${hover ? "exp" : ""}`}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        >
            <button className="vfst-mark" title="Add to dictionary" onClick={onClick}>
                <span className="vfst-glyph" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="15" height="15">
                        <path d="M5 5 L12 18 L19 5" fill="none" stroke="currentColor"
                            strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="19" cy="5" r="2.6" fill="var(--gold)" stroke="none" />
                    </svg>
                </span>
                <span className="vfst-plus" aria-hidden="true">+</span>
            </button>
            <span className="vfst-body">
                <span className="vfst-inner">
                    <span className="vfst-label">Add to dictionary</span>
                    <kbd className="vfst-kbd">⌘E</kbd>
                    <button
                        className="vfst-skip"
                        onClick={(e) => { e.stopPropagation(); onSkip?.(); }}
                        title="Skip — don't save"
                    >
                        <Icon name="close" size={10} />
                    </button>
                </span>
            </span>
        </span>
    );
}
