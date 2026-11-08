import type { TokenTotals } from "@board";
import { formatTokens, totalTokens } from "../flow/format";
import "./TokenStat.css";

/** Token usage of one agent: the total large, the input and output split small. */
export function TokenStat({ tokens }: { tokens: TokenTotals }) {
  const total = totalTokens(tokens);
  const split = `${tokens.input.toLocaleString("en-US")} in · ${tokens.output.toLocaleString("en-US")} out`;
  return (
    <dl className="token-stat" title={total === 0 ? undefined : split}>
      <dt className="token-stat__label">Tokens</dt>
      <dd className="token-stat__value" data-empty={total === 0 ? "true" : undefined}>{total === 0 ? "—" : formatTokens(total)}</dd>
      <dd className="token-stat__split">{total === 0 ? "none recorded" : `${formatTokens(tokens.input)} in · ${formatTokens(tokens.output)} out`}</dd>
    </dl>
  );
}
