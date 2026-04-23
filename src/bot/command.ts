export interface StartCommand {
  type: "start";
  systemNameKey: string;
  courseNameKey: string;
}

export type DojoCommand =
  | StartCommand
  | (Omit<StartCommand, "type"> & { type: "draft" })
  | { type: "help" }
  | { type: "prev" }
  | { type: "skip" }
  | { type: "invalid" };

export const DOJO_USAGE_LINE =
  "DM: !dojo start <system-name> <course-name> | !dojo draft <system-name> <course-name> | !dojo prev | !dojo help. In the lobby chat: !dojo skip.";

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

  const draftMatch =
    /^!dojo\s+draft\s+([a-z0-9-]+)\s+([a-z0-9-]+)\s*$/i.exec(trimmedMessage);
  if (draftMatch) {
    return {
      type: "draft",
      systemNameKey: draftMatch[1].toLowerCase(),
      courseNameKey: draftMatch[2].toLowerCase(),
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
