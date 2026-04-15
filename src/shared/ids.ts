export function makeId(prefix: string): string {
  const now = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `${slug(prefix)}_${now}_${random}`;
}

export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}
