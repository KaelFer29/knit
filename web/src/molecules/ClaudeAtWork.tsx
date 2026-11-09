import { ClaudeMascot } from "../atoms/ClaudeMascot";
import { formatTokens } from "../flow/format";
import "./ClaudeAtWork.css";

interface Props {
  /** A turn is running. */
  working: boolean;
  /** Tokens of this conversation, summed over its turns. */
  tokens: { input: number; output: number };
}

/** A small scene of Claude: at work while a turn runs (spinner glyphs and changing verbs, as in Claude Code), resting otherwise. */
export function ClaudeAtWork({ working, tokens }: Props) {
  const total = tokens.input + tokens.output;
  return (
    <section className="claude-work" data-working={working} aria-label="Claude">
      <div className="claude-work__stage" aria-hidden="true">
        <span className="claude-work__bubble">
          <span className="claude-work__glyph" />
        </span>
        <ClaudeMascot className="claude-work__mascot" />
        <span className="claude-work__desk" />
      </div>
      <p className="claude-work__status" role="status">
        {working ? (
          <>
            Claude is working <span className="claude-work__verb" aria-hidden="true" />
          </>
        ) : (
          "Ready when you are"
        )}
      </p>
      {total === 0 ? null : <p className="claude-work__tokens">{formatTokens(total)} tokens in this conversation</p>}
    </section>
  );
}
