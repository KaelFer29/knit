import type { PlanDraftView } from "../sessions/plans";
import "./PlanDrafts.css";

interface Props {
  dir: string;
  plans: PlanDraftView[];
  /** Path of the plan being launched right now, if any. */
  launching?: string | undefined;
  error?: string | undefined;
  onLaunch: (plan: PlanDraftView) => void;
}

const runHref = (id: string): string => `?run=${encodeURIComponent(id)}#/runs`;

/**
 * The draft plans a session left in the repository: validation result, tasks, the runs started from each, and the
 * button that launches one. Launching is only ever this explicit click (S15); an invalid plan has no button.
 */
export function PlanDrafts({ dir, plans, launching, error, onLaunch }: Props) {
  if (plans.length === 0) return null;
  return (
    <section className="plan-drafts" aria-label="Draft plans">
      <h3 className="plan-drafts__heading">
        Draft plans <span className="plan-drafts__dir">{dir}/</span>
      </h3>
      <ul className="plan-drafts__list">
        {plans.map((plan) => (
          <li key={plan.path} className="plan-draft">
            <div className="plan-draft__top">
              <div className="plan-draft__title">
                <span className="plan-draft__name">{plan.name}</span>
                <span className="plan-draft__file">{plan.file}</span>
              </div>
              <span className="plan-draft__result" data-valid={plan.valid}>
                {plan.valid ? "Valid" : `Invalid · ${plan.issues.length} ${plan.issues.length === 1 ? "issue" : "issues"}`}
              </span>
              {plan.valid ? (
                <button type="button" className="plan-draft__launch" disabled={launching !== undefined} onClick={() => onLaunch(plan)}>
                  {launching === plan.path ? "Launching…" : "Launch run"}
                </button>
              ) : null}
            </div>
            {plan.valid ? (
              <ol className="plan-draft__tasks">
                {plan.tasks.map((task) => (
                  <li key={task.id}>
                    <span className="plan-draft__task-id">{task.id}</span> {task.title} <span className="plan-draft__branch">{task.branch}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <ul className="plan-draft__issues">
                {plan.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
            {plan.runs.length > 0 ? (
              <p className="plan-draft__runs">
                Runs:{" "}
                {plan.runs.map((run) => (
                  <a key={run.id} className="plan-draft__run" href={runHref(run.id)}>
                    {run.id.slice(0, 8)} · {run.status}
                  </a>
                ))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="plan-drafts__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
