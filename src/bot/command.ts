export interface StartCommand {
  type: "start";
  systemSlug: string;
  courseSlug: string;
}

export function parseDojoCommand(message: string): StartCommand | null {
  const match = /^!dojo\s+start\s+([a-z0-9-]+)\s+([a-z0-9-]+)\s*$/i.exec(
    message.trim(),
  );

  if (!match) {
    return null;
  }

  return {
    type: "start",
    systemSlug: match[1].toLowerCase(),
    courseSlug: match[2].toLowerCase(),
  };
}
