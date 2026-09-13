export type LoginInput = {
  email: string;
  password: string;
};

/** The authenticated user, as every other module sees it. */
export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  desk: string;
};

export type EstablishedSession = {
  token: string;
  user: AuthenticatedUser;
};
