import type { PaletteCommand } from "../sessions/commands";
import "./CommandPalette.css";

interface Props {
  /** Id of the list; the text field points at it with `aria-controls`. */
  id: string;
  commands: PaletteCommand[];
  activeIndex: number;
  onPick: (command: PaletteCommand) => void;
}

/** The list that opens above the composer while a slash command is typed. Focus stays in the text field. */
export function CommandPalette({ id, commands, activeIndex, onPick }: Props) {
  return (
    <ul className="command-palette" id={id} role="listbox" aria-label="Commands">
      {commands.map((command, i) => (
        <li
          key={`${command.source}:${command.name}`}
          id={`${id}-option-${i}`}
          className="command-palette__option"
          role="option"
          aria-selected={i === activeIndex}
          // Mouse down, not click: the text field must keep focus.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(command);
          }}
        >
          <span className="command-palette__name">/{command.name}</span>
          <span className="command-palette__description">{command.description}</span>
        </li>
      ))}
    </ul>
  );
}
