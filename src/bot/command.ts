export interface StartCommand {
  type: "start";
  systemNameKey: string;
  courseNameKey: string;
}

export type DojoCommand =
  | StartCommand
  | { type: "help" }
  | { type: "prev" }
  | { type: "invalid" };

export const DOJO_USAGE_LINE =
  "Commands: !dojo start <system-name> <course-name> | !dojo prev | !dojo help";

export function parseDojoCommand(message: string): DojoCommand | null {
  const trimmedMessage = message.trim();

  if (!/^!dojo(\s|$)/i.test(trimmedMessage)) {
    return null;
  }

  const startMatch =
    /^!dojo\s+start\s+([a-z0-9-]+)\s+([a-z0-9-]+)\s*$/i.exec(trimmedMessage);
  if (startMatch) {
    return {
      type: "start",
      systemNameKey: startMatch[1].toLowerCase(),
      courseNameKey: startMatch[2].toLowerCase(),
    };
  }

  if (/^!dojo\s+help\s*$/i.test(trimmedMessage)) {
    return { type: "help" };
  }

  if (/^!dojo\s+prev\s*$/i.test(trimmedMessage)) {
    return { type: "prev" };
  }

  return { type: "invalid" };
}
