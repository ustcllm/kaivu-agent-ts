import { join } from "node:path";

export function userLiteratureRoot(root: string, userId: string): string {
  return join(root, ".kaivu", "users", safeLiteratureUserSegment(userId), "literature");
}

export function userLiteratureDigestRoot(root: string, userId: string): string {
  return join(userLiteratureRoot(root, userId), "digests");
}

export function userLiteratureWikiRoot(root: string, userId: string): string {
  return join(userLiteratureRoot(root, userId), "wiki");
}

export function safeLiteratureUserSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "anonymous-user";
}
