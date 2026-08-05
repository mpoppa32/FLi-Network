// DELIBERATELY BROKEN — Mission 2 acceptance demo (red X on a failing build).
// This file exists to prove CI catches a type error on a PR before it reaches main.
// It is deleted as soon as the demo is captured.
export function ciRedXDemo(): number {
  const n: number = "this is a string, not a number";
  return n;
}
