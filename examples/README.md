# Examples

Sample plans for `knit run <plan> --dry-run` (prints the prompts without changing anything).

| Plan | Shows |
| --- | --- |
| [plans/hello-greet.md](plans/hello-greet.md) | the smallest useful plan: two tasks, the second stacked on the first |
| [plans/stacked-with-setup.md](plans/stacked-with-setup.md) | `Setup`, a stacked task (`Depends`) and an independent task (it branches from the base and its PR targets it) |

See [../docs/plan-format.md](../docs/plan-format.md) for every field.
