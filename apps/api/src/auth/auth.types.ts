export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authUser?: AuthenticatedUser;
}
