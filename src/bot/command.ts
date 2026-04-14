export interface StartCommand {
  type: "start";
  systemNameKey: string;
  courseNameKey: string;
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
    systemNameKey: match[1].toLowerCase(),
    courseNameKey: match[2].toLowerCase(),
  };
}
