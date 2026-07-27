import { isValidEmail, normalizeEmail } from "./email";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
}

export interface RegisterInput {
  email: string;
  displayName: string;
}

export function registerUser(existingUsers: UserRecord[], input: RegisterInput): UserRecord[] {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();

  if (!isValidEmail(email)) {
    throw new Error("Invalid email");
  }

  if (!displayName) {
    throw new Error("Display name is required");
  }

  const nextUser: UserRecord = {
    id: `user-${existingUsers.length + 1}`,
    email,
    displayName
  };

  return [...existingUsers, nextUser];
}
