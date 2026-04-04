export interface StartCommand {
  type: "start";
  slug: string;
}

export function parseDojoCommand(message: string): StartCommand | null {
  const match = /^!dojo\s+start\s+([a-z0-9-]+)\s*$/i.exec(message.trim());

  if (!match) {
    return null;
  }

  return {
    type: "start",
    slug: match[1].toLowerCase(),
  };
}
