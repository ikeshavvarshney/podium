/** The prototype's orbit mark: coloured nodes breathing around a centre. */
export function OrbitMark({ hues, label }: { hues: string[]; label: string }) {
  const points = [
    { cx: 60, cy: 8 },
    { cx: 93, cy: 27 },
    { cx: 93, cy: 65 },
    { cx: 60, cy: 84 },
    { cx: 27, cy: 65 },
    { cx: 27, cy: 27 },
  ];

  return (
    <svg viewBox="0 0 120 92" className="block h-auto w-[88px] flex-none" role="img" aria-label={label}>
      <circle cx="60" cy="46" r="38" fill="none" stroke="var(--ln)" strokeDasharray="2 5" />
      <circle cx="60" cy="46" r="5" fill="var(--ac)" />
      {points.map((p, i) => (
        <circle key={i} cx={p.cx} cy={p.cy} r="4" fill={hues[i % hues.length]}>
          <animate
            attributeName="opacity"
            values="0.3;1;0.3"
            dur="3.6s"
            begin={`${i * 0.6}s`}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </svg>
  );
}
