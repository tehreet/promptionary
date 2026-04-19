"use client";

export type TokenRole = "subject" | "style" | "modifier" | "filler";
export type PromptToken = {
  position: number;
  token: string;
  role: TokenRole;
};

const ROLE_CLASS: Record<TokenRole, string> = {
  subject: "text-[color:var(--brand-indigo)] font-black",
  style: "text-[color:var(--brand-fuchsia)] font-extrabold italic",
  modifier: "text-[color:var(--brand-rose)] font-bold",
  filler: "text-muted-foreground font-medium",
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
    <div className="w-full rounded-2xl bg-card border border-border shadow-sm px-5 py-5">
      <p className="text-xs uppercase tracking-widest opacity-70 mb-3 text-center">
        The prompt was
      </p>
      <p
        className="text-center text-xl sm:text-2xl font-heading leading-[1.6]"
        style={{ perspective: "800px" }}
      >
        {toShow.map((t, i) => (
          <span
            key={`${t.position}-${i}`}
            data-role={t.role}
            className={`prompt-flip inline-block align-baseline mx-[0.18em] ${ROLE_CLASS[t.role]}`}
            style={{ animationDelay: `${i * perWordMs}ms` }}
          >
            {t.token}
          </span>
        ))}
      </p>
      {useTokens && (
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-4 text-[10px] uppercase tracking-wider">
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
    <li className={`flex items-center gap-1 ${ROLE_CLASS[role]}`}>
      <span className="h-2 w-2 rounded-full bg-current inline-block" />
      {label}
    </li>
  );
}
