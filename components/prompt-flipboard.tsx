"use client";

export type TokenRole = "subject" | "style" | "modifier" | "filler";
export type PromptToken = {
  position: number;
  token: string;
  role: TokenRole;
};

const ROLE_UNDERLINE: Record<TokenRole, string> = {
  subject: "role-subject-underline",
  style: "role-style-underline",
  modifier: "role-modifier-underline",
  filler: "role-filler-underline",
};

const ROLE_LEGEND_DOT: Record<TokenRole, string> = {
  subject: "bg-[var(--game-pink)]",
  style: "bg-[var(--game-cyan)]",
  modifier: "bg-[var(--game-orange)]",
  filler: "bg-[color-mix(in_oklch,var(--game-ink)_20%,transparent)]",
};

export function PromptFlipboard({
  prompt,
  tokens,
  perWordMs = 110,
}: {
  prompt: string;
  tokens: PromptToken[];
  perWordMs?: number;
}) {
  const useTokens = tokens.length > 0;
  const toShow: PromptToken[] = useTokens
    ? [...tokens].sort((a, b) => a.position - b.position)
    : prompt.split(/\s+/).filter(Boolean).map((w, i) => ({
        position: i,
        token: w,
        role: "filler" as TokenRole,
      }));

  return (
    <div className="w-full game-card bg-[var(--game-paper)] px-5 py-5 text-[var(--game-ink)]">
      <p className="text-xs uppercase tracking-widest opacity-70 mb-3 text-center">
        The prompt was
      </p>
      <p
        className="text-center text-xl sm:text-2xl font-heading leading-[1.6] text-[var(--game-ink)]"
        style={{ perspective: "800px" }}
      >
        {toShow.map((t, i) => (
          <span
            key={`${t.position}-${i}`}
            data-role={t.role}
            className="prompt-flip inline-block px-2 py-1 mx-0.5 rounded-md border-2 bg-[var(--game-paper)] text-[var(--game-ink)]"
            style={{
              borderColor: "var(--game-ink)",
              animationDelay: `${i * perWordMs}ms`,
            }}
          >
            <span className={ROLE_UNDERLINE[t.role]}>{t.token}</span>
          </span>
        ))}
      </p>
      {useTokens && (
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-4 text-[10px] uppercase tracking-wider text-[var(--game-ink)]">
          <LegendDot role="subject" label="subject" />
          <LegendDot role="style" label="style" />
          <LegendDot role="modifier" label="mood" />
          <LegendDot role="filler" label="glue" />
        </ul>
      )}
    </div>
  );
}

function LegendDot({ role, label }: { role: TokenRole; label: string }) {
  return (
    <li className="flex items-center gap-1 font-bold">
      <span
        className={`h-2 w-2 rounded-full inline-block ${ROLE_LEGEND_DOT[role]}`}
      />
      {label}
    </li>
  );
}
