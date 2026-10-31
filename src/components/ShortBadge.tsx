/**
 * The small red 'Short' flag pinned to the bottom-left of a sub-minute
 * clip's thumbnail — the one corner no other badge claims (Ad sits
 * top-left, 'Yours' top-right, the duration bottom-right). Rendered by
 * every card surface (Shorts wall, grid cards, list rows), so a short is
 * recognisable as one wherever it appears, not only inside the wall.
 * `inset` matches the corner padding each surface uses for its duration
 * badge so the two pills sit on the same line.
 */
export default function ShortBadge({ inset = 'bottom-2 left-2' }: { inset?: string }) {
  return (
    <span
      className={`pointer-events-none absolute ${inset} rounded-[4px] bg-red-600 px-1.5 py-[2.5px] text-[10px] font-bold uppercase leading-none tracking-[0.04em] text-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]`}
    >
      Short
    </span>
  )
}
