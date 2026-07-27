export function canonicalEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.includes("@") || email.includes(".");
}
