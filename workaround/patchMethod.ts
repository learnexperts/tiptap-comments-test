const patched = new WeakMap<object, Set<PropertyKey>>();

/** Replaces `target[name]` with `wrap(original)`, once per target and name. */
export function patchMethod<T extends object, K extends keyof T>(
  target: T,
  name: K,
  wrap: (original: T[K]) => T[K],
): void {
  const names = patched.get(target) ?? new Set<PropertyKey>();
  if (names.has(name)) {
    return;
  }
  names.add(name);
  patched.set(target, names);
  target[name] = wrap(target[name]);
}
