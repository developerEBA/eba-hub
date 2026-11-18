export function mentionToken(userId: string) {
  return "@{" + userId + "}";
}

export function mentionParts(body: string) {
  return body.split(/(@\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\})/gi);
}

export function mentionId(part: string) {
  return /^@\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}$/i.test(part)
    ? part.slice(2, -1).toLowerCase() : null;
}

export function encodeMentions(body: string, selected: Map<string, string>) {
  const names = [...selected.keys()].sort((a, b) => b.length - a.length);
  if (!names.length) return body;
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp("(^|\\s)@(" + escaped.join("|") + ")(?=$|[\\s.,!?;:])", "g");
  return body.replace(pattern, (_, prefix: string, name: string) => prefix + mentionToken(selected.get(name)!));
}
