import React from 'react';

interface Props {
  onClick: () => void;
}

// Quiet dashed chip left behind when the user skips a selection instead of
// saving it. Clicking it brings the add-to-dictionary trigger back.
export default function SkippedChip({ onClick }: Props) {
  return (
    <button className="vfst-ghost" onClick={onClick} title="Show again">
      <span className="vfst-ghost-dot" /> skipped
    </button>
  );
}
