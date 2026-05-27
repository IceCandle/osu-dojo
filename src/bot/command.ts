export interface StartCommand {
  type: "start";
  systemNameKey: string;
  courseNameKey: string;
}

export type DojoCommand =
  | StartCommand
  | { type: "help" }
  | { type: "prev" }
  | { type: "skip" }
  | { type: "invalid" };

export const DOJO_USAGE_LINE =
  "DM: !dojo start <system-name> <course-name> | !dojo prev | !dojo help. In the lobby chat: !dojo skip.";

export function parseDojoCommand(message: string): DojoCommand | null {
  const trimmedMessage = message.trim();

  if (!/^!dojo(\s|$)/i.test(trimmedMessage)) {
    return null;
  }

  const startMatch =
    /^!dojo\s+start\s+([a-z0-9-]+)\s+([a-z0-9-]+)\s*$/i.exec(trimmedMessage);
  if (startMatch) {
    const systemNameKey = startMatch[1];
    const courseNameKey = startMatch[2];
    if (!systemNameKey || !courseNameKey) {
      return { type: "invalid" };
    }

    return {
      type: "start",
      systemNameKey: systemNameKey.toLowerCase(),
      courseNameKey: courseNameKey.toLowerCase(),
    };
  }

  if (/^!dojo\s+help\s*$/i.test(trimmedMessage)) {
    return { type: "help" };
  }

  if (/^!dojo\s+prev\s*$/i.test(trimmedMessage)) {
    return { type: "prev" };
  }

  if (/^!dojo\s+skip\s*$/i.test(trimmedMessage)) {
    return { type: "skip" };
  }

  return { type: "invalid" };
}
